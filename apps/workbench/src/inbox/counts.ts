import { ApiError, type Page, type Ticket, type TicketCount, type TicketFilter } from '@itsm/sdk';
import { MAX_TEAM_TOPICS, VIEWS, isUuid, viewFilter, viewKey, type ViewCount, type ViewRef } from './views.js';

/**
 * The sidebar's counts (SPEC §5.3), behind `GET /api/desk/counts`.
 *
 * With `GET /tickets/count` (WA1) every counted view is exact — the same
 * filter and the same visibility as its list, so a badge never promises a
 * ticket the list will not show. An API without that route answers 404 (or
 * 405 behind some proxies); then only My work, Unassigned and Due soon are
 * counted, by asking for a page of 100 and counting what came back, which is
 * "99+" at 100 and never a guess. Team views stay uncounted without WA1: a
 * probe per team on every refresh is too much load for a number.
 *
 * A view whose count fails for any other reason is left out rather than
 * shown as zero: an empty badge is honest, a "0" is a claim. A 401 is not
 * one view's failure but the session's, so it is thrown for the handler to
 * answer as such.
 */

/** A page this long says "99+": the probe never asks for more. */
export const PROBE_LIMIT = 100;

/** As many teams as the live stream follows: the ones whose changes would refresh the counts. */
export const MAX_COUNTED_TEAMS = MAX_TEAM_TOPICS;

export interface DeskCounts {
  /** By view key: `mine`, `team:<uuid>`. Absent means unknown. */
  readonly counts: Readonly<Record<string, ViewCount>>;
  /** Whether the numbers came from the count route (exact) or from probes. */
  readonly exact: boolean;
}

export interface CountingApi {
  ticketCount(filter: TicketFilter): Promise<TicketCount>;
  tickets(filter: TicketFilter): Promise<Page<Ticket>>;
}

/** The session has ended: nothing else will work either, and the caller must say so. */
function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** The first ended-session failure among the results, to rethrow. */
function endedSession(results: readonly PromiseSettledResult<unknown>[]): unknown {
  return results.find((result): result is PromiseRejectedResult => result.status === 'rejected' && sessionEnded(result.reason))?.reason;
}

/** The count route is missing on this API: fall back to probes. */
function routeMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

/** Team ids from a query string, cleaned: UUIDs only, each once, at most 19. */
export function teamIdsFrom(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(isUuid);
  return [...new Set(ids)].slice(0, MAX_COUNTED_TEAMS);
}

async function probe(api: CountingApi, ref: ViewRef): Promise<ViewCount> {
  const page = await api.tickets({ ...viewFilter(ref), limit: PROBE_LIMIT });
  const count = page.data.length;
  return { count, capped: count >= PROBE_LIMIT && page.nextCursor !== null };
}

export async function countViews(api: CountingApi, teamIds: readonly string[] = []): Promise<DeskCounts> {
  const exactRefs: ViewRef[] = [
    ...VIEWS.filter((view) => view.count !== false).map((view): ViewRef => ({ kind: 'view', id: view.id })),
    ...teamIds.slice(0, MAX_COUNTED_TEAMS).map((teamId): ViewRef => ({ kind: 'team', teamId })),
  ];

  const settled = await Promise.allSettled(exactRefs.map((ref) => api.ticketCount(viewFilter(ref))));
  if (endedSession(settled)) throw endedSession(settled);

  if (!settled.some((result) => result.status === 'rejected' && routeMissing(result.reason))) {
    const counts: Record<string, ViewCount> = {};
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') counts[viewKey(exactRefs[index]!)] = { count: result.value.count, capped: result.value.capped };
    });
    return { counts, exact: true };
  }

  const probeRefs = VIEWS.filter((view) => view.count === 'probe').map((view): ViewRef => ({ kind: 'view', id: view.id }));
  const probed = await Promise.allSettled(probeRefs.map((ref) => probe(api, ref)));
  if (endedSession(probed)) throw endedSession(probed);
  const counts: Record<string, ViewCount> = {};
  probed.forEach((result, index) => {
    if (result.status === 'fulfilled') counts[viewKey(probeRefs[index]!)] = result.value;
  });
  return { counts, exact: false };
}
