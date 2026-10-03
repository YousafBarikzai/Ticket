import 'server-only';
import { cache } from 'react';
import type { Admin, Me, UsageMeter } from '@itsm/sdk';
import { crossAreaHref, crossAreaTicketHref, type AreaModel } from '@itsm/contracts/areas';
import type { IconName, Problem } from '@itsm/ui';
import { formatBytes, formatNumber } from '@itsm/ui/format';
import { isPending, mayOpen, routeFor } from '../navigation.js';
import { holdsAny, type Grants } from '../permissions.js';
import { problemFrom } from '../problem.js';

/**
 * "What needs me?" — the Command centre's first card (SPEC §6.1, X-30).
 *
 * One prioritised list assembled from the sources the API really has, each
 * of them asked only of someone who holds the permission its route checks,
 * all of them in parallel, each failing on its own. A source contributes a
 * row only when there is something to do (a count above zero), and every row
 * carries exactly one way to act on it. The list is ordered danger, warning,
 * then information; within a tone, in the order below, which is roughly "how
 * soon does somebody notice if this is ignored".
 *
 * Counts are honest: the list routes have no totals, so a full page reads
 * "50+", never a guess. A source that could not be read is reported as such —
 * and while any source is unread the card never claims "Nothing needs you".
 *
 * Links are only ever to pages this person may open and that exist (the same
 * `navigation.ts` gates the sidebar uses). A page still being built falls
 * back to its item's first page, and with no page to go to a row has no
 * action rather than a dead one.
 *
 * Pure apart from the SDK calls, and the SDK is passed in: the test drives it
 * with fakes (`needs-attention.test.ts`).
 */

export type AttentionTone = 'danger' | 'warning' | 'info';

export type AttentionSource =
  | 'failed-runs'
  | 'failed-deliveries'
  | 'urgent-unowned'
  | 'sla-risk'
  | 'security-alerts'
  | 'credentials'
  | 'drafts'
  | 'usage'
  | 'ai-budget'
  | 'warranties';

/** The one thing a row lets the person do. */
export interface AttentionAction {
  readonly label: string;
  readonly href: string;
  /** Opens a sheet to rotate this credential in place, instead of following `href`. */
  readonly rotate?: { readonly ref: string };
}

/** A line under a row: one of the tickets, credentials or meters it counts. */
export interface AttentionDetailRow {
  readonly id: string;
  readonly label: string;
  /** Plain words after the label: "P1", "Agents". */
  readonly meta?: string;
  /** A moment the line is about, shown relative ("in 38 min", "2 h ago"), after `when`. */
  readonly at?: string;
  /** How the moment is introduced: "Due", "Raised", "Expires". */
  readonly when?: string;
  readonly href?: string;
}

export interface AttentionItem {
  readonly id: AttentionSource;
  readonly tone: AttentionTone;
  readonly icon: IconName;
  /** The sentence: "3 workflow runs failed". */
  readonly title: string;
  /** Quiet words under it: "2 rules · 1 request type". */
  readonly detail?: string;
  /** The moment behind the row — the latest failure, the nearest deadline. */
  readonly at?: string;
  readonly when?: string;
  readonly action?: AttentionAction;
  readonly rows?: readonly AttentionDetailRow[];
}

export interface AttentionFailure {
  readonly id: AttentionSource;
  /** What could not be checked, as a noun phrase: "failed deliveries". */
  readonly label: string;
  readonly problem: Problem;
}

/** An open major incident, for the banner above everything. */
export interface MajorIncidentNotice {
  readonly number: string;
  readonly title: string;
  readonly severity: string;
  readonly declaredAt: string;
}

export interface NeedsAttention {
  readonly items: readonly AttentionItem[];
  readonly failures: readonly AttentionFailure[];
  /** How many sources this person's permissions let the card consult. Zero: the card is not shown. */
  readonly consulted: number;
  readonly checkedAt: string;
  readonly incidents: readonly MajorIncidentNotice[];
}

export interface NeedsAttentionOptions {
  /**
   * The person's areas (`currentAreas()`): tickets and queues open in the
   * Service Desk when it is listed for them, through `crossAreaHref`, so a
   * demo visitor arrives as Alex Morgan rather than at a sign-in (A2 §3.7).
   * Without it, or without the Service Desk, rows open in the console.
   */
  readonly areas?: AreaModel;
  readonly now?: Date;
}

/* -------------------------------------------------------------------------
 * Words and thresholds
 * ---------------------------------------------------------------------- */

/** The page size a count is read from; a full page is shown as "50+". */
export const PAGE = 50;
/** An open ticket due within this long is at risk. */
export const RISK_WINDOW_MS = 2 * 60 * 60 * 1000;
/** Security alerts this recent count. */
export const ALERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Credentials expiring this soon, and warranties ending this soon, count. */
export const EXPIRY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const TONE_ORDER: Readonly<Record<AttentionTone, number>> = { danger: 0, warning: 1, info: 2 };

/** "3", or "50+" when the page was full. */
export function countText(count: number, capped: boolean): string {
  return capped ? `${formatNumber(count, { locale: 'en-GB' })}+` : formatNumber(count, { locale: 'en-GB' });
}

/** "1 workflow run", "3 workflow runs", "50+ workflow runs". */
export function counted(count: number, capped: boolean, one: string, other: string): string {
  return `${countText(count, capped)} ${count === 1 && !capped ? one : other}`;
}

/** Whether a verb agrees with one thing or several: "has"/"have". */
function agree(count: number, capped: boolean, one: string, other: string): string {
  return count === 1 && !capped ? one : other;
}

/**
 * A console link this person can follow: the page must exist (not pending)
 * and open for them. Otherwise the first fallback that does, or nothing.
 */
export function reachable(me: Grants, ...hrefs: readonly string[]): string | undefined {
  for (const href of hrefs) {
    const route = routeFor(href);
    if (route !== null && !isPending(route) && mayOpen(me, route)) return href;
  }
  return undefined;
}

/**
 * A ticket's link: its Service Desk page when the Service Desk is listed for
 * this person (the area gate replaces v2's own "works tickets" test), or the
 * console's read-only drawer. In a demo, a ticket outside Alex Morgan's teams
 * would 404 in the Service Desk (X-B2), so it opens in the console instead.
 */
function ticketHref(me: Grants, ticket: { readonly number: string; readonly groupId: string | null }, areas: AreaModel | undefined): string | undefined {
  return (areas ? crossAreaTicketHref(areas, ticket) : null) ?? reachable(me, `/tickets?open=ticket:${encodeURIComponent(ticket.number)}`);
}

/** A Service Desk queue when the Service Desk is listed, otherwise the console's own filtered register. */
function queueHref(me: Grants, areas: AreaModel | undefined, deskPath: string, consolePath: string): string | undefined {
  return (areas ? crossAreaHref(areas, 'workbench', deskPath) : null) ?? reachable(me, consolePath);
}

function latest(dates: readonly (string | null | undefined)[]): string | undefined {
  let best: string | undefined;
  let bestTime = -Infinity;
  for (const date of dates) {
    if (!date) continue;
    const time = Date.parse(date);
    if (Number.isFinite(time) && time > bestTime) {
      best = date;
      bestTime = time;
    }
  }
  return best;
}

const METER_NAMES: Readonly<Record<string, string>> = {
  agents: 'Agents',
  tickets: 'Tickets',
  storage: 'Storage',
  api_calls: 'API calls',
};

/**
 * A meter against the plan's limit, in words: "Agents: 47 people of 50
 * people", "Storage: 4.8 GB of 5 GB" — the warning line is what raised the
 * row, the limit is what the reader needs to compare with. Only a plan with
 * no limit is compared with the warning line.
 */
export function meterSentence(meter: Pick<UsageMeter, 'meter' | 'unit' | 'display' | 'value' | 'hard' | 'soft' | 'state'>): string {
  const name = METER_NAMES[meter.meter] ?? meter.meter.replace(/_/g, ' ');
  const line = meter.hard ?? meter.soft;
  const written = (value: number): string =>
    meter.unit === 'bytes' ? formatBytes(value, { locale: 'en-GB' }) : `${formatNumber(value, { locale: 'en-GB' })} ${meter.unit}`;
  if (meter.state === 'blocked') return `${name}: plan limit reached (${meter.hard === null ? meter.display : written(meter.hard)})`;
  return line === null ? `${name}: ${meter.display}` : `${name}: ${meter.display} of ${written(line)}`;
}

/* -------------------------------------------------------------------------
 * The sources
 * ---------------------------------------------------------------------- */

interface Source<T> {
  readonly id: AttentionSource;
  /** What could not be checked, as a noun phrase, when the load fails. */
  readonly label: string;
  /** Any one of these lets the person ask. */
  readonly needs: readonly string[];
  load(api: Admin, me: Grants): Promise<T>;
  /** The row, or null when there is nothing to do. */
  toItem(value: T, context: Context): AttentionItem | null;
  /** A part of the source that could not be read, although the rest could. */
  partial?(value: T): Problem | null;
}

interface Context {
  readonly me: Grants;
  readonly now: number;
  readonly areas: AreaModel | undefined;
}

function source<T>(definition: Source<T>): Source<unknown> {
  return definition as Source<unknown>;
}

type DraftCounts = { readonly rules: number | null; readonly requestTypes: number | null; readonly workflows: number | null; readonly problem: Problem | null };

const RULES_READ = ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish'] as const;
const WORKFLOWS_READ = ['workflow.read', 'workflow.manage'] as const;

/** A source that answered with a problem of its own making rather than throwing the SDK's error. */
class SourceFailure extends Error {
  constructor(readonly problem: Problem) {
    super('source failed');
  }
}

export const SOURCES: readonly Source<unknown>[] = [
  source({
    id: 'failed-runs',
    label: 'failed workflow runs',
    needs: ['workflow.read', 'workflow.manage'],
    load: (api) => api.configure.workflows.runs({ status: 'failed', limit: PAGE }),
    toItem: (runs, { me }) => {
      if (runs.length === 0) return null;
      const capped = runs.length >= PAGE;
      const href = reachable(me, '/workflows/runs?status=failed', '/workflows');
      return {
        id: 'failed-runs',
        tone: 'danger',
        icon: 'workflow',
        title: `${counted(runs.length, capped, 'workflow run', 'workflow runs')} failed`,
        detail: 'Each stopped part way; the ticket it was acting on may be half done.',
        ...optional('at', latest(runs.map((run) => run.endedAt ?? run.startedAt))),
        when: 'Latest',
        ...(href ? { action: { label: 'Review', href } } : {}),
      };
    },
  }),
  source({
    id: 'failed-deliveries',
    label: 'failed deliveries',
    needs: ['integration.action.read', 'integration.action.manage'],
    load: (api) => api.observe.integrations.errorQueue('open'),
    toItem: (rows, { me }) => {
      if (rows.length === 0) return null;
      const href = reachable(me, '/integrations');
      return {
        id: 'failed-deliveries',
        tone: 'danger',
        icon: 'integrations',
        title: `${counted(rows.length, false, 'outbound delivery', 'outbound deliveries')} failed`,
        detail: 'Something this desk meant to tell another system did not arrive.',
        ...optional('at', latest(rows.map((row) => row.createdAt))),
        when: 'Latest',
        ...(href ? { action: { label: 'Review', href } } : {}),
      };
    },
  }),
  source({
    id: 'urgent-unowned',
    label: 'urgent tickets',
    needs: ['ticket.read'],
    load: (api) => api.observe.tickets({ statusCategory: 'open', assignee: 'none', priority: 'P1,P2', limit: 5 }),
    toItem: (page, { me, areas }) => {
      if (page.data.length === 0) return null;
      const capped = page.nextCursor !== null;
      const href = queueHref(me, areas, '/inbox/unassigned', '/tickets?status=open&assignee=none');
      return {
        id: 'urgent-unowned',
        tone: page.data.some((ticket) => ticket.priority === 'P1') ? 'danger' : 'warning',
        icon: 'ticket',
        title: `${counted(page.data.length, capped, 'urgent ticket', 'urgent tickets')} ${agree(page.data.length, capped, 'has', 'have')} no owner`,
        rows: page.data.slice(0, 3).map((ticket) => ({
          id: ticket.id,
          label: `${ticket.number} · ${ticket.title}`,
          meta: ticket.priority,
          at: ticket.createdAt,
          when: 'Raised',
          ...optional('href', ticketHref(me, ticket, areas)),
        })),
        ...(href ? { action: { label: 'Open', href } } : {}),
      };
    },
  }),
  source({
    id: 'sla-risk',
    label: 'tickets close to their deadline',
    needs: ['ticket.read'],
    load: (api) => api.observe.tickets({ statusCategory: 'open', sort: 'dueAt', limit: 5 }),
    toItem: (page, { me, now, areas }) => {
      const atRisk = page.data.filter((ticket) => ticket.dueAt !== null && Date.parse(ticket.dueAt) <= now + RISK_WINDOW_MS);
      if (atRisk.length === 0) return null;
      const overdue = atRisk.filter((ticket) => Date.parse(ticket.dueAt!) < now).length;
      // Five were asked for; five at risk may mean more.
      const capped = atRisk.length === page.data.length && page.nextCursor !== null;
      const first = atRisk[0]!;
      const href = queueHref(me, areas, '/inbox/due', '/tickets?status=open&sort=dueAt');
      const title =
        atRisk.length === 1 && !capped
          ? overdue === 1
            ? `${first.number} is past its deadline`
            : `${first.number} is due within 2 hours`
          : overdue === atRisk.length
            ? `${counted(atRisk.length, capped, 'ticket is', 'tickets are')} past their deadline`
            : `${counted(atRisk.length, capped, 'ticket is', 'tickets are')} close to breaching`;
      return {
        id: 'sla-risk',
        tone: overdue > 0 ? 'danger' : 'warning',
        icon: 'clock',
        title,
        ...(overdue > 0 && overdue < atRisk.length ? { detail: `${overdue} already overdue` } : {}),
        rows: atRisk.slice(0, 3).map((ticket) => ({
          id: ticket.id,
          label: `${ticket.number} · ${ticket.title}`,
          meta: ticket.priority,
          at: ticket.dueAt!,
          when: 'Due',
          ...optional('href', ticketHref(me, ticket, areas)),
        })),
        ...(href ? { action: { label: 'Open', href } } : {}),
      };
    },
  }),
  source({
    id: 'security-alerts',
    label: 'security alerts',
    needs: ['security.alert.read'],
    load: (api) => api.observe.securityAlerts(),
    toItem: (alerts, { me, now }) => {
      const serious = alerts.filter(
        (alert) => (alert.severity === 'high' || alert.severity === 'critical') && Date.parse(alert.createdAt) >= now - ALERT_WINDOW_MS,
      );
      if (serious.length === 0) return null;
      const critical = serious.some((alert) => alert.severity === 'critical');
      const href = reachable(me, '/security');
      return {
        id: 'security-alerts',
        tone: critical ? 'danger' : 'warning',
        icon: 'security',
        title: `${counted(serious.length, false, critical ? 'serious security alert' : 'high-severity security alert', critical ? 'serious security alerts' : 'high-severity security alerts')} this week`,
        ...optional('at', latest(serious.map((alert) => alert.createdAt))),
        when: 'Latest',
        ...(href ? { action: { label: 'Review', href } } : {}),
      };
    },
  }),
  source({
    id: 'credentials',
    label: 'credentials',
    needs: ['integration.credential.read', 'integration.credential.manage'],
    load: (api) => api.observe.integrations.credentials(),
    toItem: (credentials, { me, now }) => {
      const horizon = now + EXPIRY_WINDOW_DAYS * DAY_MS;
      const due = credentials
        .filter((credential) => credential.needsRewrap || (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= horizon))
        .sort((a, b) => (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) - (b.expiresAt ? Date.parse(b.expiresAt) : Infinity));
      if (due.length === 0) return null;
      const expired = due.filter((credential) => credential.expiresAt !== null && Date.parse(credential.expiresAt) < now);
      const soon = due.filter((credential) => credential.expiresAt !== null && Date.parse(credential.expiresAt) <= now + 7 * DAY_MS);
      const canRotate = holdsAny(me, ['integration.credential.manage']);
      const list = reachable(me, '/integrations/credentials', '/integrations');
      const first = due[0]!;
      const one = due.length === 1;
      const title = one
        ? first.expiresAt !== null && Date.parse(first.expiresAt) < now
          ? `Credential ${first.ref} has expired`
          : first.expiresAt !== null && Date.parse(first.expiresAt) <= horizon
            ? `Credential ${first.ref} expires soon`
            : `Credential ${first.ref} needs re-encrypting`
        : `${counted(due.length, false, 'credential needs', 'credentials need')} rotating`;
      return {
        id: 'credentials',
        tone: expired.length > 0 ? 'danger' : soon.length > 0 ? 'warning' : 'info',
        icon: 'key',
        title,
        ...(one && first.expiresAt ? { at: first.expiresAt, when: Date.parse(first.expiresAt) < now ? 'Expired' : 'Expires' } : {}),
        ...(one && first.needsRewrap && first.expiresAt === null ? { detail: 'The encryption key has changed since it was stored.' } : {}),
        ...(one
          ? {}
          : {
              rows: due.slice(0, 3).map((credential) => ({
                id: credential.ref,
                label: credential.ref,
                ...(credential.expiresAt
                  ? { at: credential.expiresAt, when: Date.parse(credential.expiresAt) < now ? 'Expired' : 'Expires' }
                  : { meta: 'Needs re-encrypting' }),
              })),
            }),
        ...(one && canRotate
          ? { action: { label: 'Rotate', href: list ?? '/', rotate: { ref: first.ref } } }
          : list
            ? { action: { label: 'Review', href: list } }
            : {}),
      };
    },
  }),
  source({
    id: 'drafts',
    label: 'drafts',
    needs: [...RULES_READ, 'catalogue.manage', ...WORKFLOWS_READ],
    load: async (api, me): Promise<DraftCounts> => {
      // Three lists, one row. Each is asked only of someone who may read it —
      // this source runs for anyone holding any of them — and one failing
      // leaves the other two counted (and the card says which it missed).
      const settle = async (wanted: boolean, list: () => Promise<readonly { status: string }[]>): Promise<number | null | Problem> => {
        if (!wanted) return null;
        try {
          // The status filter is applied again here: a list that ignored it
          // would otherwise count every rule as a draft.
          return (await list()).filter((row) => row.status === 'draft').length;
        } catch (error) {
          return problemFrom(error);
        }
      };
      const [rules, requestTypes, workflows] = await Promise.all([
        settle(holdsAny(me, RULES_READ), () => api.configure.rules.list({ status: 'draft' })),
        settle(holdsAny(me, ['catalogue.manage']), () => api.configure.catalogue.requestTypes({ status: 'draft' })),
        settle(holdsAny(me, WORKFLOWS_READ), () => api.configure.workflows.list('draft')),
      ]);
      const counts = [rules, requestTypes, workflows];
      const problems = counts.filter((value): value is Problem => typeof value === 'object' && value !== null);
      // All of them failing is a failure of the source; some of them is a partial answer.
      if (problems.length > 0 && problems.length === counts.filter((value) => value !== null).length) throw new SourceFailure(problems[0]!);
      const number = (value: number | null | Problem): number | null => (typeof value === 'number' ? value : null);
      return { rules: number(rules), requestTypes: number(requestTypes), workflows: number(workflows), problem: problems[0] ?? null };
    },
    partial: (counts) => counts.problem,
    toItem: (counts, { me }) => {
      const kinds = [
        { count: counts.rules ?? 0, one: 'rule', other: 'rules', href: reachable(me, '/rules?status=draft', '/rules') },
        { count: counts.requestTypes ?? 0, one: 'request type', other: 'request types', href: reachable(me, '/catalogue?status=draft', '/catalogue') },
        { count: counts.workflows ?? 0, one: 'workflow', other: 'workflows', href: reachable(me, '/workflows?status=draft', '/workflows') },
      ].filter((kind) => kind.count > 0);
      const total = kinds.reduce((sum, kind) => sum + kind.count, 0);
      if (total === 0) return null;
      const most = [...kinds].sort((a, b) => b.count - a.count).find((kind) => kind.href);
      return {
        id: 'drafts',
        tone: 'info',
        icon: 'pencil',
        title: `${counted(total, false, 'draft is', 'drafts are')} waiting to be published`,
        detail: kinds.map((kind) => counted(kind.count, false, kind.one, kind.other)).join(' · '),
        ...(most?.href ? { action: { label: 'Review', href: most.href } } : {}),
      };
    },
  }),
  source({
    id: 'usage',
    label: 'usage and plan',
    needs: ['tenant.usage.read'],
    load: (api) => api.tenant.usage(),
    toItem: (report, { me }) => {
      const pressing = report.meters.filter((meter) => meter.state === 'warned' || meter.state === 'blocked');
      if (pressing.length === 0) return null;
      const blocked = pressing.some((meter) => meter.state === 'blocked');
      const href = reachable(me, '/settings/usage', '/settings');
      const one = pressing.length === 1;
      return {
        id: 'usage',
        tone: blocked ? 'danger' : 'warning',
        icon: 'trending-up',
        title: one ? meterSentence(pressing[0]!) : `${counted(pressing.length, false, 'usage limit needs', 'usage limits need')} attention`,
        ...(one
          ? { detail: blocked ? 'New ones are refused until the plan changes.' : 'Past the warning line you set.' }
          : { rows: pressing.map((meter) => ({ id: meter.meter, label: meterSentence(meter) })) }),
        ...(href ? { action: { label: 'Usage', href } } : {}),
      };
    },
  }),
  source({
    id: 'ai-budget',
    label: 'the AI budget',
    needs: ['ai.read'],
    load: (api) => api.observe.ai.budget(),
    toItem: (budget, { me }) => {
      if (budget.state === 'ok') return null;
      const href = reachable(me, '/settings/ai', '/settings', '/ai-triage');
      return {
        id: 'ai-budget',
        tone: budget.state === 'blocked' ? 'danger' : 'warning',
        icon: 'sparkles',
        title: budget.state === 'blocked' ? 'Monthly AI budget reached' : 'AI spend has passed its warning line',
        detail:
          budget.state === 'blocked'
            ? `${budget.spentDisplay} spent this month. Suggestions fall back to rules until the budget changes or the month ends.`
            : `${budget.spentDisplay} spent this month.`,
        ...(href ? { action: { label: 'Budget', href } } : {}),
      };
    },
  }),
  source({
    id: 'warranties',
    label: 'asset warranties',
    needs: ['asset.read', 'asset.manage'],
    load: (api) => api.observe.estate.warranties(EXPIRY_WINDOW_DAYS),
    toItem: (assets, { me }) => {
      const ending = assets.filter((asset) => !asset.expired);
      if (ending.length === 0) return null;
      const href = reachable(me, `/cmdb/assets?warranty=${EXPIRY_WINDOW_DAYS}`);
      return {
        id: 'warranties',
        tone: 'info',
        icon: 'assets',
        title: `${counted(ending.length, false, 'asset warranty ends', 'asset warranties end')} within ${EXPIRY_WINDOW_DAYS} days`,
        ...(href ? { action: { label: 'View', href } } : {}),
      };
    },
  }),
];

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------- */

/** The sources this person may consult: any one of each source's permissions. */
export function sourcesFor(me: Grants): readonly Source<unknown>[] {
  return SOURCES.filter((entry) => holdsAny(me, entry.needs));
}

/** Danger, then warning, then information; the source order within a tone. */
export function prioritise(items: readonly AttentionItem[]): AttentionItem[] {
  const order = new Map(SOURCES.map((entry, index) => [entry.id, index]));
  return [...items].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Every source this person may consult, in parallel, each failing on its own.
 * Never throws: a source that fails is a `failures` entry, and a source whose
 * answer makes no sense (a shape the SDK did not promise) is one too, rather
 * than taking the card down.
 */
export async function collectNeedsAttention(me: Me | Grants, api: Admin, options: NeedsAttentionOptions = {}): Promise<NeedsAttention> {
  const now = options.now ?? new Date();
  const context: Context = { me, now: now.getTime(), areas: options.areas };
  const consulted = sourcesFor(me);

  const [settled, incidents] = await Promise.all([
    Promise.all(
      consulted.map(async (entry): Promise<{ item: AttentionItem | null; failure: AttentionFailure | null }> => {
        try {
          const value = await entry.load(api, me);
          const partial = entry.partial?.(value) ?? null;
          return {
            item: entry.toItem(value, context),
            failure: partial ? { id: entry.id, label: entry.label, problem: partial } : null,
          };
        } catch (error) {
          return {
            item: null,
            failure: { id: entry.id, label: entry.label, problem: error instanceof SourceFailure ? error.problem : problemFrom(error) },
          };
        }
      }),
    ),
    openMajorIncidents(me, api),
  ]);

  return {
    items: prioritise(settled.flatMap((result) => (result.item ? [result.item] : []))),
    failures: settled.flatMap((result) => (result.failure ? [result.failure] : [])),
    consulted: consulted.length,
    checkedAt: now.toISOString(),
    incidents,
  };
}

/**
 * Open major incidents, for the banner. Quietly nothing when the person may
 * not read them or the module does not answer: a banner that could not be
 * checked is not a banner, and the list below still says what it missed.
 */
export async function openMajorIncidents(me: Grants, api: Admin): Promise<MajorIncidentNotice[]> {
  if (!holdsAny(me, ['incident.major.read'])) return [];
  try {
    const rows = await api.observe.majorIncidents({ open: true });
    return rows
      .filter((row) => row.resolvedAt === null)
      .sort((a, b) => a.severity.localeCompare(b.severity) || Date.parse(b.declaredAt) - Date.parse(a.declaredAt))
      .map((row) => ({ number: row.number, title: row.title, severity: row.severity, declaredAt: row.declaredAt }));
  } catch {
    return [];
  }
}

/**
 * One answer per request: the page's status line and the card read the same
 * result (`cache()` lasts for one server request, keyed by these arguments).
 */
export const needsAttention = cache(
  // The third argument is the v2 origin the Command centre's cards still pass
  // (`command-centre/Cards.tsx`, rebuilt by WP-55); it is ignored. The areas
  // come from the request's own `currentAreas()`, loaded lazily so the pure
  // collector above stays importable without the session's server modules.
  async (me: Me, api: Admin, _origin?: string): Promise<NeedsAttention> => {
    const { currentAreas } = await import('./session.js');
    return collectNeedsAttention(me, api, { areas: await currentAreas() });
  },
);

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
