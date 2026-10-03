import 'server-only';
import { cache } from 'react';
import {
  honoured,
  type MajorIncidentRow,
  type MetricBatchQuery,
  type MetricResult,
  type OnCallRow,
  type SlaTimers,
  type Ticket,
  type TicketCountDimension,
  type TicketFilter,
  type Workbench,
} from '@itsm/sdk';
import { incidentChip } from '../navigation.js';
import { resolvePeople } from '../server/people.js';
import { apiFor, currentTeams, requireSession } from '../server/session.js';
import { orNullWhenForbidden, settle, type Settled } from '../server/settle.js';
import type { PeopleMap } from '../inbox/presentation.js';
import { clockFrom, fromCount, WAITING_STATES, type Clock, type Figure, type RangeKey, type Scope } from './derive.js';

/**
 * The Overview's reads (A6 §5.2.6; SPEC §7.1.1 Data, §7.0.2).
 *
 * Each card is its own async server component that waits on its own reads,
 * so every loader here *settles* — `{ ok, value }` or `{ ok: false,
 * problem }`, never a rejection — and one card's failure costs that card
 * alone. Each is wrapped in `cache()`: the hero, the tiles and "Needs you"
 * all read the scope's open work, and within one request that is one call.
 * The page starts them all together (`startOverview`), so the cards wait in
 * parallel rather than in turn.
 *
 * The grammar is the API's newest — grouped counts (R2g) and the date and
 * SLA windows (R2) — read defensively: an API that predates a grouped count
 * answers 404 and the loader says `null`, and a count whose window the API
 * did not apply (`honoured()`, R2's `applied` echo) is `null` too, so the
 * card falls back to what the probe rows can honestly say ("200+") rather
 * than draw a figure for a filter nobody applied.
 *
 * Arguments are strings and booleans only, so `cache()` matches them.
 */

/** The longest list a probe reads (the API's own page limit). A full page means "at least this many". */
export const PROBE_LIMIT = 200;
/** Pages of resolved tickets read for a sparkline before it is called incomplete. */
export const RESOLVED_PAGES = 5;
/** The soonest clocks the hero's aside and "Time left" read. */
export const CLOCKS = 6;
/** Rotations read for "On call now". */
export const ROTATIONS = 6;

const OPEN_WORK = 'open,paused';
const WAITING = WAITING_STATES.join(',');

/** The SDK for this request's session. */
const desk = cache(async (): Promise<Workbench> => apiFor(await requireSession()));

function scoped(scope: Scope): TicketFilter {
  return scope === 'mine' ? { assignee: 'me' } : {};
}

/* ---------------------------------------------------------------- Rows */

/** A probe: the first page of a list, and whether there was more. */
export interface Probe {
  readonly rows: readonly Ticket[];
  readonly capped: boolean;
}

/** Open and paused work in scope, soonest due first: the hero, "Needs you", "Time left" and the Open series. */
export const loadOpenRows = cache(
  async (scope: Scope): Promise<Settled<Probe>> =>
    settle(async () => {
      const page = await (await desk()).tickets({ ...scoped(scope), statusCategory: OPEN_WORK, sort: 'dueAt', limit: PROBE_LIMIT });
      return { rows: page.data, capped: page.nextCursor !== null };
    }),
);

/**
 * Waiting work in scope, oldest first. Its own list: R2a clears a paused
 * ticket's due time, so in the due-ordered list waiting work comes last and
 * would be the first to fall off a full page.
 */
export const loadWaitingRows = cache(
  async (scope: Scope): Promise<Settled<Probe>> =>
    settle(async () => {
      const page = await (await desk()).tickets({ ...scoped(scope), status: WAITING, statusCategory: OPEN_WORK, sort: 'createdAt', limit: PROBE_LIMIT });
      return { rows: page.data, capped: page.nextCursor !== null };
    }),
);

/** Resolved and closed tickets resolved since `sinceIso`, read up to `RESOLVED_PAGES` pages. */
export interface ResolvedRows {
  readonly rows: readonly Ticket[];
  /** Whether every ticket in the window was read; an incomplete set draws no series. */
  readonly complete: boolean;
}

export const loadResolvedRows = cache(
  async (scope: Scope, sinceIso: string): Promise<Settled<ResolvedRows | null>> =>
    settle(async () => {
      const api = await desk();
      const rows: Ticket[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < RESOLVED_PAGES; page += 1) {
        const answer = await api.tickets({
          ...scoped(scope),
          statusCategory: 'resolved,closed',
          resolvedAfter: sinceIso,
          sort: '-createdAt',
          limit: PROBE_LIMIT,
          ...(cursor ? { cursor } : {}),
        });
        // An API that did not apply the window answered with every resolved
        // ticket ever: no series can be drawn from that.
        if (!honoured(answer, ['resolvedAfter'])) return null;
        rows.push(...answer.data);
        if (answer.nextCursor === null) return { rows, complete: true };
        cursor = answer.nextCursor;
      }
      return { rows, complete: false };
    }),
);

/* -------------------------------------------------------------- Counts */

/** A grouped count (R2g): the total, which is exact, and each key's share. */
export interface Grouped {
  readonly total: number;
  readonly groups: ReadonlyMap<string | null, number>;
}

/**
 * One grouped count, or `null` when this API cannot answer it (404: a route
 * older than R2g; or a newer key it did not apply). The caller then counts
 * from its rows.
 */
async function grouped(dimension: TicketCountDimension, filter: TicketFilter, newKeys: readonly string[] = []): Promise<Settled<Grouped | null>> {
  const settled = await settle(async () => (await desk()).ticketCounts(dimension, filter));
  if (!settled.ok) return settled.problem.status === 404 ? { ok: true, value: null } : settled;
  if (!honoured(settled.value, newKeys)) return { ok: true, value: null };
  return { ok: true, value: { total: settled.value.total, groups: new Map(settled.value.groups.map((group) => [group.key, group.count])) } };
}

/** Open and paused work in scope by priority: the Open tile's value and split, and "My work by priority". */
export const loadOpenByPriority = cache(async (scope: Scope) => grouped('priority', { ...scoped(scope), statusCategory: OPEN_WORK }));

/** Open and paused work in scope by SLA state: breached, due within the hour, later, no target, paused. */
export const loadBySla = cache(async (scope: Scope) => grouped('sla', scoped(scope)));

/** Breached work in scope by priority: the Breached tile's value and strip. */
export const loadBreachedByPriority = cache(async (scope: Scope) => grouped('priority', { ...scoped(scope), sla: 'breached' }, ['sla']));

/** Open work in scope due within the reader's today, by priority: the Due today tile. */
export const loadDueTodayByPriority = cache(async (scope: Scope, startIso: string, endIso: string) =>
  grouped('priority', { ...scoped(scope), statusCategory: 'open', dueAfter: startIso, dueBefore: endIso }, ['dueAfter', 'dueBefore']),
);

/** Waiting work in scope, by what it waits on: the Waiting tile's value and strip. */
export const loadWaitingByStatus = cache(async (scope: Scope) => grouped('status', { ...scoped(scope), status: WAITING, statusCategory: OPEN_WORK }));

/** The teams' open work by status, for "Team queue by status" (the API scopes it to the reader's teams). */
export const loadTeamByStatus = cache(async () => grouped('status', { statusCategory: OPEN_WORK }));

/**
 * The teams' open work by status the older way, three counts, for an API
 * without grouped counts: New, In progress (with reopened) and Waiting.
 */
export const loadTeamByStatusCounts = cache(
  async (): Promise<Settled<{ readonly new: Figure; readonly progress: Figure; readonly waiting: Figure }>> =>
    settle(async () => {
      const api = await desk();
      const [fresh, progress, waiting] = await Promise.all([
        api.ticketCount({ status: 'new' }),
        api.ticketCount({ status: 'in_progress,reopened' }),
        api.ticketCount({ status: WAITING }),
      ]);
      return { new: fromCount(fresh), progress: fromCount(progress), waiting: fromCount(waiting) };
    }),
);

/** Resolved in the current period and the one before it (R2), or `null` when the API did not apply the window. */
export const loadResolvedCounts = cache(
  async (scope: Scope, startIso: string, previousIso: string): Promise<Settled<{ readonly current: Figure; readonly previous: Figure } | null>> =>
    settle(async () => {
      const api = await desk();
      const base = { ...scoped(scope), statusCategory: 'resolved,closed' };
      const [current, previous] = await Promise.all([
        api.ticketCount({ ...base, resolvedAfter: startIso }),
        api.ticketCount({ ...base, resolvedAfter: previousIso, resolvedBefore: startIso }),
      ]);
      if (!honoured(current, ['resolvedAfter']) || !honoured(previous, ['resolvedAfter', 'resolvedBefore'])) return null;
      return { current: fromCount(current), previous: fromCount(previous) };
    }),
);

/** Unassigned open work in the reader's teams (both scopes: nobody's work is the team's). */
export const loadUnassignedCount = cache(async (): Promise<Settled<Figure>> => settle(async () => fromCount(await (await desk()).ticketCount({ assignee: 'none', statusCategory: 'open' }))));

/** The oldest unassigned open ticket, for "Oldest 2 h". */
export const loadOldestUnassigned = cache(
  async (): Promise<Settled<Ticket | null>> =>
    settle(async () => (await (await desk()).tickets({ assignee: 'none', statusCategory: 'open', sort: 'createdAt', limit: 1 })).data[0] ?? null),
);

/** Unassigned P1 and P2 tickets in the reader's teams, oldest first. */
export const loadUnassignedUrgent = cache(
  async (): Promise<Settled<Probe>> =>
    settle(async () => {
      const page = await (await desk()).tickets({ assignee: 'none', statusCategory: 'open', priority: 'P1,P2', sort: 'createdAt', limit: 10 });
      return { rows: page.data, capped: page.nextCursor !== null };
    }),
);

/* -------------------------------------------------------------- Clocks */

/**
 * The soonest-due running clocks in scope (A6 §5.2.5 Time left, §5.2.3
 * aside): the first `CLOCKS` open tickets with a due time, each ticket's
 * timers read in parallel. Best effort: a ticket whose timers cannot be read
 * is left out rather than failing the card; only the list failing does.
 */
export const loadClocks = cache(
  async (scope: Scope): Promise<Settled<readonly Clock[]>> => {
    const open = await loadOpenRows(scope);
    if (!open.ok) return open;
    const soonest = open.value.rows.filter((ticket) => ticket.statusCategory === 'open' && ticket.dueAt).slice(0, CLOCKS);
    const api = await desk();
    const read = await Promise.all(soonest.map((ticket) => settle<SlaTimers>(() => api.slaTimers(ticket.number))));
    const clocks: Clock[] = [];
    read.forEach((answer, index) => {
      if (!answer.ok) return;
      const ticket = soonest[index]!;
      const clock = clockFrom({ id: ticket.id, number: ticket.number, title: ticket.title }, answer.value.timers);
      if (clock) clocks.push(clock);
    });
    return { ok: true, value: clocks };
  },
);

/* -------------------------------------------------------------- Replies */

/** The notification a customer's reply raises (A6 §5.2.5 Replied; A4 seeds it). */
export const REPLY_EVENT = 'ticket.comment.added';

/** Unread "customer replied" notices: ticket id → when the newest arrived. */
export const loadReplies = cache(
  async (): Promise<Settled<ReadonlyMap<string, string>>> =>
    settle(async () => {
      const inbox = await (await desk()).notifications({ unread: true, limit: 50 });
      const replies = new Map<string, string>();
      for (const row of inbox.data) {
        if (row.eventType !== REPLY_EVENT || !row.ticketId) continue;
        const known = replies.get(row.ticketId);
        if (!known || known < row.createdAt) replies.set(row.ticketId, row.createdAt);
      }
      return replies;
    }),
);

/* -------------------------------------------------------- Major incidents */

/** A running major incident, as the hero and the banner below 1024 px say it. */
export interface LiveIncident {
  readonly row: MajorIncidentRow;
  /** Where its link goes: the war room once it ships, the incident's ticket until then (RV6). */
  readonly href: string | null;
  /** How many are running. */
  readonly count: number;
}

/** `SEV1` first; among equals, the most recently declared. */
function bySeverity(a: MajorIncidentRow, b: MajorIncidentRow): number {
  return a.severity.localeCompare(b.severity) || b.declaredAt.localeCompare(a.declaredAt);
}

/**
 * The running major incident, or `null` for none. Only asked of a reader
 * who may see major incidents (`incident.major.read`); the caller decides.
 * The link follows the frame's chip (`incidentChip`): the incident's ticket
 * while the war room is pending, the war room after.
 */
export const loadIncident = cache(
  async (): Promise<Settled<LiveIncident | null>> =>
    settle(async () => {
      const api = await desk();
      const rows = [...(await api.majorIncidents({ open: true }))].sort(bySeverity);
      const top = rows[0];
      if (!top) return null;
      const frame = rows.map((row) => ({ number: row.number, title: row.title, severity: row.severity, ticketId: null as string | null }));
      let chip = incidentChip(frame);
      if (chip && !chip.href) {
        const detail = await settle(() => api.majorIncident(top.number));
        if (detail.ok) chip = incidentChip([{ ...frame[0]!, ticketId: detail.value.ticketId }, ...frame.slice(1)]);
      }
      return { row: top, href: chip?.href ?? null, count: rows.length };
    }),
);

/* ---------------------------------------------------------------- On call */

/** One rotation's person on call now. */
export interface OnCallNow {
  readonly rotation: OnCallRow['rotation'];
  readonly userId: string;
  readonly name: string | null;
  readonly teamName: string | null;
  /** The next handover, when this person's turn ends. */
  readonly until: string | null;
  /** `available`, `busy`, `away`, `off_shift`: what routing reads (MOD-20), when the reader may see it. */
  readonly availability: string | null;
}

/**
 * Who is on call now (A6 §5.2.5 On call now, R5-W): the rotations the
 * reader may see, then who holds each now. `null` when the reader may see
 * no rotation — the card is then not drawn, the way a missing permission is
 * not drawn (D9). A rotation whose read fails is left out.
 */
export const loadOnCall = cache(
  async (): Promise<Settled<readonly OnCallNow[] | null>> => {
    const listed = orNullWhenForbidden(await settle(async () => (await desk()).rotations()));
    if (!listed.ok) return listed;
    const rotations = (listed.value ?? []).slice(0, ROTATIONS);
    if (rotations.length === 0) return { ok: true, value: null };
    const api = await desk();
    const answers = await Promise.all(rotations.map((rotation) => settle(() => api.onCall(rotation.key))));
    const holders = answers.flatMap((answer) => (answer.ok && answer.value.userId ? [answer.value] : []));
    const ids = holders.map((holder) => holder.userId!);
    const [people, teams, availability] = await Promise.all([
      resolvePeople(ids),
      currentTeams(),
      ids.length > 0 ? settle(() => api.availability(ids)) : Promise.resolve({ ok: true as const, value: [] }),
    ]);
    const teamNames = new Map((teams ?? []).map((team) => [team.id.toLowerCase(), team.name]));
    const status = new Map((availability.ok ? availability.value : []).map((row) => [row.userId.toLowerCase(), row.effectiveStatus]));
    return {
      ok: true,
      value: holders.map((holder) => {
        const id = holder.userId!.toLowerCase();
        return {
          rotation: holder.rotation,
          userId: holder.userId!,
          name: people[id]?.name ?? null,
          teamName: teamNames.get(holder.rotation.teamId.toLowerCase()) ?? null,
          until: holder.upcoming[0]?.at ?? null,
          availability: status.get(id) ?? null,
        };
      }),
    };
  },
);

/* -------------------------------------------------------------- Analytics */

/** The analytics row's answers (A6 §5.2.5), each its own outcome: one failing question costs only its own card. */
export interface AnalyticsRow {
  readonly raised: Settled<MetricResult>;
  readonly resolved: Settled<MetricResult>;
  readonly attainment: Settled<MetricResult>;
  readonly byTarget: Settled<MetricResult>;
}

/**
 * Raised and resolved per day (per week over 90 days) and SLA attainment,
 * overall and by target — one batch (R4), asked only of a reader who holds
 * `analytics.read` (D9; the caller decides before calling). A refusal of the
 * whole batch (403) is `null`: the cards are then not drawn.
 */
export const loadAnalytics = cache(
  async (range: RangeKey): Promise<Settled<AnalyticsRow | null>> => {
    const bucket = range === '90d' ? 'week' : 'day';
    const queries: MetricBatchQuery[] = [
      { id: 'raised', metricKey: 'tickets.created', range, series: true, bucket },
      { id: 'resolved', metricKey: 'tickets.resolved', range, series: true, bucket },
      { id: 'attainment', metricKey: 'sla.attainment', range },
      { id: 'byTarget', metricKey: 'sla.attainment', range, groupBy: 'target' },
    ];
    const answered = orNullWhenForbidden(await settle(async () => (await desk()).insights.queryBatch(queries)));
    if (!answered.ok || answered.value === null) return answered as Settled<null>;
    const byId = new Map(answered.value.map((answer) => [answer.id, answer]));
    const pick = (id: string): Settled<MetricResult> => {
      const answer = byId.get(id);
      if (!answer) return { ok: false, problem: { status: 502, retryable: true } };
      if (answer.ok) return { ok: true, value: answer.result };
      return { ok: false, problem: { status: answer.problem.status, retryable: answer.problem.status >= 500, ...(answer.problem.title ? { title: answer.problem.title } : {}) } };
    };
    return { ok: true, value: { raised: pick('raised'), resolved: pick('resolved'), attainment: pick('attainment'), byTarget: pick('byTarget') } };
  },
);

/* ---------------------------------------------------------------- People */

/** Names for the people a card shows, in one batched read per request (`resolvePeople`). */
export async function loadPeople(ids: readonly (string | null | undefined)[]): Promise<PeopleMap> {
  return resolvePeople(ids);
}
