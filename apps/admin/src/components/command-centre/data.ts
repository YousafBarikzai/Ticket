import 'server-only';
import type { Admin, Me, MetricQuery, MetricRange, MetricResult, OnCallRow } from '@itsm/sdk';
import type { ActivityItem, Problem } from '@itsm/ui';
import { holdsAny, type Grants } from '../../permissions.js';
import { read, type Read } from '../../server/read.js';
import { reachable } from '../../server/needs-attention.js';
import { resolvePeople } from '../../server/people.js';
import type { PersonRef } from '../PersonCell.js';
import { hasData } from '../insights/presentation.js';
import { describeChange, isConfigurationChange, nameFrom, setupSteps, type SetupFacts, type SetupStep, type SetupStepId } from './presentation.js';

/**
 * What the Command centre's cards load, one loader per card (SPEC §6.1).
 *
 * Every loader is asked only by a card this person's permissions allow, runs
 * its calls in parallel, and hands back plain data the card renders — a
 * failed call is a `Problem` on the part it would have filled, never an
 * exception, so one card (or one number in it) fails on its own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------
 * Desk health
 * ---------------------------------------------------------------------- */

export interface HealthStat {
  readonly id: 'open' | 'unassigned' | 'sla' | 'first-reply';
  readonly label: string;
  readonly value: number | null;
  readonly unit: 'count' | 'percent' | 'minutes';
  readonly approx?: boolean;
  readonly href?: string;
  readonly trend?: readonly number[];
  readonly secondary?: string;
  readonly footnote?: string;
  readonly status?: 'default' | 'attention' | 'critical';
  readonly delta?: { readonly value: number; readonly period: string };
  readonly problem?: Problem;
}

export interface DeskHealth {
  /** `analytics`: the projection's numbers; `counts`: open lists counted by page; `none`: nothing to show. */
  readonly source: 'analytics' | 'counts' | 'none';
  readonly stats: readonly HealthStat[];
  /** Every query answered and none found a ticket: the projection has nothing for this period yet. */
  readonly empty: boolean;
}

/** The previous period of the same length as a named one, as the API resolves them (ending at tomorrow's UTC midnight). */
export function previousPeriod(range: '7d' | '30d' | '90d', now: Date): { from: string; to: string } {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  const to = tomorrow - days * DAY_MS;
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString() };
}

const query = (api: Admin, body: MetricQuery): Promise<Read<MetricResult>> => read(() => api.observe.insights.query(body));
const problemOf = <T>(result: Read<T>): { problem?: Problem } => (result.ok ? {} : { problem: result.problem });
const valueOf = (result: Read<MetricResult>): number | null => (result.ok && typeof result.value.value === 'number' ? result.value.value : null);

export async function loadDeskHealth(me: Grants, api: Admin, now: Date = new Date()): Promise<DeskHealth> {
  const openHref = reachable(me, '/tickets?status=open');
  const unassignedHref = reachable(me, '/tickets?status=open&assignee=none');

  if (holdsAny(me, ['analytics.read'])) {
    const unassigned = [{ field: 'assigneeId', op: 'is_null' as const }];
    const previous = previousPeriod('30d', now);
    const [open, idle, created, attainment, breaches, reply, replyBefore] = await Promise.all([
      query(api, { metricKey: 'tickets.open', range: '90d' }),
      query(api, { metricKey: 'tickets.open', range: '90d', filters: unassigned }),
      query(api, { metricKey: 'tickets.created', range: '90d', series: true, bucket: 'week' }),
      query(api, { metricKey: 'sla.attainment', range: '30d' }),
      query(api, { metricKey: 'sla.breaches', range: '30d' }),
      query(api, { metricKey: 'tickets.first_response', range: '30d' }),
      query(api, { metricKey: 'tickets.first_response', range: 'custom', ...previous }),
    ]);
    const trend = created.ok ? (created.value.series ?? []).map((point) => point.value ?? 0) : [];
    const breached = valueOf(breaches);
    const replyNow = valueOf(reply);
    const replyThen = valueOf(replyBefore);
    const slaHref = reachable(me, '/insights?dashboard=sla');
    const deskHref = reachable(me, '/insights?dashboard=service-desk');
    const stats: HealthStat[] = [
      {
        id: 'open',
        label: 'Open · last 90 days',
        value: valueOf(open),
        unit: 'count',
        ...(openHref ? { href: openHref } : {}),
        ...(trend.length > 1 ? { trend } : {}),
        ...problemOf(open),
      },
      {
        id: 'unassigned',
        label: 'Unassigned · last 90 days',
        value: valueOf(idle),
        unit: 'count',
        ...(unassignedHref ? { href: unassignedHref } : {}),
        ...problemOf(idle),
      },
      {
        id: 'sla',
        label: 'SLA met · 30 days',
        value: valueOf(attainment),
        unit: 'percent',
        ...(slaHref ? { href: slaHref } : {}),
        ...(breached !== null && breached > 0 ? { secondary: `· ${breached} breached`, status: 'attention' as const } : {}),
        ...(attainment.ok && valueOf(attainment) === null ? { footnote: 'No targets finished in 30 days' } : {}),
        ...problemOf(attainment),
      },
      {
        id: 'first-reply',
        label: 'First reply · 30 days',
        value: replyNow,
        unit: 'minutes',
        ...(deskHref ? { href: deskHref } : {}),
        ...(replyNow !== null && replyThen !== null && replyThen > 0
          ? { delta: { value: (replyNow - replyThen) / replyThen, period: 'vs previous 30 days' } }
          : {}),
        ...(reply.ok && replyNow === null ? { footnote: 'No first replies in 30 days' } : {}),
        ...problemOf(reply),
      },
    ];
    const answered = [open, idle, created, attainment, breaches, reply].every((result) => result.ok);
    const empty =
      answered &&
      [open, idle, created, attainment, breaches, reply].every((result) => !hasData(result.ok ? result.value : null));
    return { source: 'analytics', stats, empty };
  }

  if (holdsAny(me, ['ticket.read'])) {
    // Without the projection, count the open lists — a page of 50, so a full
    // page is "50+" rather than a number that is quietly wrong (SPEC §6.1).
    const [open, idle] = await Promise.all([
      read(() => api.observe.tickets({ statusCategory: 'open', limit: 50 })),
      read(() => api.observe.tickets({ statusCategory: 'open', assignee: 'none', limit: 50 })),
    ]);
    const counted = (result: typeof open): Pick<HealthStat, 'value' | 'approx' | 'problem'> =>
      result.ok ? { value: result.value.data.length, ...(result.value.nextCursor ? { approx: true } : {}) } : { value: null, problem: result.problem };
    return {
      source: 'counts',
      stats: [
        { id: 'open', label: 'Open', unit: 'count', ...counted(open), ...(openHref ? { href: openHref } : {}) },
        { id: 'unassigned', label: 'Unassigned', unit: 'count', ...counted(idle), ...(unassignedHref ? { href: unassignedHref } : {}) },
      ],
      empty: false,
    };
  }

  return { source: 'none', stats: [], empty: false };
}

/* -------------------------------------------------------------------------
 * Volume
 * ---------------------------------------------------------------------- */

export type VolumeRange = '7d' | '30d' | '90d';

export interface Volume {
  readonly range: VolumeRange;
  readonly raised: Read<MetricResult>;
  readonly resolved: Read<MetricResult>;
  readonly byChannel: Read<MetricResult>;
  readonly byTeam: Read<MetricResult>;
}

export function volumeRange(value: unknown): VolumeRange {
  return value === '7d' || value === '90d' ? value : '30d';
}

export async function loadVolume(api: Admin, range: VolumeRange): Promise<Volume> {
  // Days for a week or a month, weeks for a quarter: enough points to see a
  // shape, few enough to read (the API's own rule, stated so both lines agree).
  const bucket = range === '90d' ? 'week' : 'day';
  const [raised, resolved, byChannel, byTeam] = await Promise.all([
    query(api, { metricKey: 'tickets.created', range: range as MetricRange, series: true, bucket }),
    query(api, { metricKey: 'tickets.resolved', range: range as MetricRange, series: true, bucket }),
    query(api, { metricKey: 'tickets.created', range: range as MetricRange, groupBy: 'channel' }),
    query(api, { metricKey: 'tickets.created', range: range as MetricRange, groupBy: 'teamId' }),
  ]);
  return { range, raised, resolved, byChannel, byTeam };
}

/* -------------------------------------------------------------------------
 * On call now
 * ---------------------------------------------------------------------- */

export interface OnCallRota {
  readonly key: string;
  readonly name: string;
  readonly timeZone: string;
  readonly person: PersonRef | null;
  /** Somebody is covering this turn rather than the rota's own member. */
  readonly covering: boolean;
  readonly handoverAt: string | null;
  readonly next: PersonRef | null;
  readonly problem?: Problem;
}

export interface OnCall {
  readonly rotas: readonly OnCallRota[];
  /** Rotas beyond the few shown. */
  readonly more: number;
  readonly problem?: Problem;
}

/** Rotas shown on the briefing; the rest are one link away. */
export const ON_CALL_SHOWN = 4;

export async function loadOnCall(api: Admin, now: Date = new Date()): Promise<OnCall> {
  const rotations = await read(() => api.observe.queues.rotations());
  if (!rotations.ok) return { rotas: [], more: 0, problem: rotations.problem };
  const shown = [...rotations.value].sort((a, b) => a.name.localeCompare(b.name)).slice(0, ON_CALL_SHOWN);
  const answers = await Promise.all(shown.map((rota) => read(() => api.observe.queues.onCall(rota.key, now.toISOString()))));
  const ids = answers.flatMap((answer) => (answer.ok ? [answer.value.userId, answer.value.upcoming[0]?.userId] : []));
  const people = await resolvePeople(api, ids);
  const person = (id: string | null | undefined): PersonRef | null => (id ? (people.get(id) ?? { id, name: null }) : null);
  return {
    rotas: shown.map((rota, index) => {
      const answer = answers[index]!;
      if (!answer.ok) return { key: rota.key, name: rota.name, timeZone: rota.timeZone, person: null, covering: false, handoverAt: null, next: null, problem: answer.problem };
      const row: OnCallRow = answer.value;
      const upcoming = row.upcoming[0];
      return {
        key: rota.key,
        name: rota.name,
        timeZone: row.rotation.timeZone || rota.timeZone,
        person: person(row.userId),
        covering: row.via === 'override',
        handoverAt: upcoming?.at ?? null,
        next: person(upcoming?.userId),
      };
    }),
    more: Math.max(0, rotations.value.length - shown.length),
  };
}

/* -------------------------------------------------------------------------
 * Recent changes
 * ---------------------------------------------------------------------- */

export interface RecentChanges {
  readonly items: readonly ActivityItem[];
  readonly problem?: Problem;
}

export const CHANGES_SHOWN = 5;

/**
 * The last few configuration changes. The audit trail, filtered to changes
 * of configuration, where the person may read it; otherwise the narrower
 * admin activity log (settings, features, modules, roles, webhooks).
 */
export async function loadRecentChanges(me: Grants, api: Admin): Promise<RecentChanges | null> {
  type Row = { id: string; action: string; actorType: string; actorId: string | null; occurredAt: string; before?: unknown; after?: unknown };
  let rows: Row[];
  if (holdsAny(me, ['audit.read'])) {
    const events = await read(() => api.observe.auditEvents({ limit: 50 }));
    if (!events.ok) return { items: [], problem: events.problem };
    rows = events.value.data.filter((event) => isConfigurationChange(event.action)).slice(0, CHANGES_SHOWN);
  } else if (holdsAny(me, ['admin.activity.read'])) {
    const activity = await read(() => api.tenant.activity(CHANGES_SHOWN));
    if (!activity.ok) return { items: [], problem: activity.problem };
    rows = activity.value.slice(0, CHANGES_SHOWN);
  } else {
    return null;
  }
  const people = await resolvePeople(api, rows.map((row) => row.actorId));
  return {
    items: rows.map((row) => {
      const actor = row.actorId ? people.get(row.actorId) : undefined;
      const automatic = row.actorType !== 'user' && row.actorType !== 'person';
      return {
        id: row.id,
        at: row.occurredAt,
        ...(actor?.name
          ? { actor: { name: actor.name, kind: 'person' as const } }
          : automatic
            ? { actor: { name: 'Automation', kind: 'system' as const } }
            : { actor: { name: 'Someone', kind: 'person' as const } }),
        ...describeChange(row.action, nameFrom(row.after, row.before)),
      };
    }),
  };
}

/* -------------------------------------------------------------------------
 * First run
 * ---------------------------------------------------------------------- */

/** The permission each step's change needs: the step is offered only to someone who holds it. */
export const SETUP_WRITES: Readonly<Record<SetupStepId, string>> = {
  catalogue: 'catalogue.manage',
  'service-levels': 'sla.policy.manage',
  'business-hours': 'sla.policy.manage',
  people: 'identity.user.manage',
  email: 'admin.setting.manage',
};

/**
 * The step pages, each only for someone who may make the change and open the
 * page (a page still being built falls back to its item's first page).
 */
export function setupHref(me: Grants): (step: SetupStepId, facts: SetupFacts) => string | undefined {
  return (step, facts) => {
    if (!holdsAny(me, [SETUP_WRITES[step]])) return undefined;
    switch (step) {
      case 'catalogue':
        return reachable(me, facts.services === 0 ? '/catalogue?new=service' : '/catalogue?new=request-type');
      case 'service-levels':
        return reachable(me, '/sla?new=1');
      case 'business-hours':
        return reachable(me, '/sla/calendars?new=1', '/sla');
      case 'people':
        return reachable(me, '/people?new=1');
      case 'email':
        return reachable(me, '/settings?q=email');
    }
  };
}

/**
 * The checklist's facts, each read only where the person may read its source.
 * A source that fails reads as "unknown" — the step shows without a tick
 * rather than claiming either way.
 */
export async function loadSetup(me: Me | Grants, api: Admin): Promise<SetupStep[]> {
  const when = <T>(permissions: readonly string[], load: () => Promise<T>): Promise<T | undefined> =>
    holdsAny(me, permissions) ? load().catch(() => undefined) : Promise.resolve(undefined);
  const [services, requestTypes, policies, calendars, people, transport] = await Promise.all([
    when(['catalogue.manage'], () => api.configure.catalogue.services()),
    when(['catalogue.manage'], () => api.configure.catalogue.requestTypes({ status: 'published' })),
    when(['sla.policy.read', 'sla.policy.manage'], () => api.configure.sla.policies()),
    when(['sla.policy.read', 'sla.policy.manage'], () => api.configure.sla.calendars()),
    when(['identity.user.read', 'identity.user.manage'], () => api.tenant.users({ status: 'active', limit: 2 })),
    when(['admin.setting.read', 'admin.setting.manage'], () => api.tenant.setting('channel.email.transport')),
  ]);
  const facts: SetupFacts = {
    ...(services ? { services: services.length } : {}),
    ...(requestTypes ? { publishedRequestTypes: requestTypes.filter((row) => row.status === 'published').length } : {}),
    ...(policies ? { publishedPolicies: policies.filter((row) => row.status === 'published').length } : {}),
    ...(calendars ? { calendars: calendars.length } : {}),
    ...(people ? { activePeople: people.filter((row) => row.status === 'active').length } : {}),
    ...(transport ? { emailConnected: transport.value !== 'development' } : {}),
  };
  return setupSteps(facts, setupHref(me));
}
