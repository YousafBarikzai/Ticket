/**
 * The daily rollup cube.
 *
 * A dashboard asks the same six or seven questions about every day, and asking
 * them of `fact_ticket` means scanning a year of rows to draw one line. The
 * rollup answers them from a few thousand rows instead — but only for the
 * groupings it actually stores, which is the decision this file makes.
 */

/** The three things a ticket rollup can be broken down by. */
export interface Grouping {
  teamId: string | null;
  serviceId: string | null;
  priority: string | null;
}

/**
 * The stored slices of the cube.
 *
 * Not the full cross-product. Eight combinations of three dimensions would mean
 * eight rows written per ticket per day and two of them — service+team and
 * service+team+priority — answer questions nobody has asked in any service desk
 * I have seen, while costing the same to maintain as the ones people live in.
 * Six is the set that covers every chart MOD-12-E1b draws:
 *
 *   all                  the headline numbers
 *   team                 "how is the network team doing"
 *   service              "which service generates the work"
 *   priority             "how many P1s"
 *   team + priority      the team's own breakdown, the most-opened view
 *   service + priority   "are the P1s all coming from one service"
 *
 * A grouping that turns out to be needed is an added entry here plus a rebuild,
 * not a schema change, which is the point of keeping the list in one place.
 */
const SLICES: readonly (keyof Grouping)[][] = [
  [],
  ['teamId'],
  ['serviceId'],
  ['priority'],
  ['teamId', 'priority'],
  ['serviceId', 'priority'],
];

/**
 * The stable text form of a grouping.
 *
 * Fields appear in a fixed order and absent ones are omitted, so the same
 * grouping always produces the same key. It is the row's unique identity
 * because PostgreSQL considers two NULLs distinct in a unique index — without
 * it, the "all" row would insert a fresh duplicate on every upsert.
 */
export function groupingKey(grouping: Grouping): string {
  const parts: string[] = [];
  if (grouping.teamId) parts.push(`team:${grouping.teamId}`);
  if (grouping.serviceId) parts.push(`service:${grouping.serviceId}`);
  if (grouping.priority) parts.push(`priority:${grouping.priority}`);
  return parts.length === 0 ? 'all' : parts.join('|');
}

/**
 * Every grouping one fact belongs to.
 *
 * A slice whose dimension is missing on the fact — a ticket with no team — is
 * dropped rather than stored as an "unknown" row, because a chart broken down
 * by team should not grow a bar for the tickets that have not been routed yet.
 * Those tickets are still counted in the `all` row, which is where the total
 * has to stay honest.
 */
export function groupingsFor(fact: Grouping): Grouping[] {
  const seen = new Set<string>();
  const result: Grouping[] = [];

  for (const slice of SLICES) {
    if (slice.some((field) => fact[field] === null || fact[field] === undefined)) continue;
    const grouping: Grouping = {
      teamId: slice.includes('teamId') ? fact.teamId : null,
      serviceId: slice.includes('serviceId') ? fact.serviceId : null,
      priority: slice.includes('priority') ? fact.priority : null,
    };
    const key = groupingKey(grouping);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(grouping);
  }

  return result;
}

/**
 * What one event adds to a day's numbers.
 *
 * Sums and counts rather than means, because means do not add up: a week built
 * from seven daily averages is wrong whenever the days had different volumes,
 * and wrong in a way that looks plausible.
 */
export interface RollupDelta {
  created: number;
  resolved: number;
  closed: number;
  reopened: number;
  breached: number;
  resolveMinutesSum: number;
  resolveMinutesCount: number;
  firstResponseMinutesSum: number;
  firstResponseMinutesCount: number;
}

export function emptyDelta(): RollupDelta {
  return {
    created: 0,
    resolved: 0,
    closed: 0,
    reopened: 0,
    breached: 0,
    resolveMinutesSum: 0,
    resolveMinutesCount: 0,
    firstResponseMinutesSum: 0,
    firstResponseMinutesCount: 0,
  };
}

export function addDelta(a: RollupDelta, b: Partial<RollupDelta>): RollupDelta {
  return {
    created: a.created + (b.created ?? 0),
    resolved: a.resolved + (b.resolved ?? 0),
    closed: a.closed + (b.closed ?? 0),
    reopened: a.reopened + (b.reopened ?? 0),
    breached: a.breached + (b.breached ?? 0),
    resolveMinutesSum: a.resolveMinutesSum + (b.resolveMinutesSum ?? 0),
    resolveMinutesCount: a.resolveMinutesCount + (b.resolveMinutesCount ?? 0),
    firstResponseMinutesSum: a.firstResponseMinutesSum + (b.firstResponseMinutesSum ?? 0),
    firstResponseMinutesCount: a.firstResponseMinutesCount + (b.firstResponseMinutesCount ?? 0),
  };
}

export function isEmptyDelta(delta: RollupDelta): boolean {
  return Object.values(delta).every((value) => value === 0);
}

/** A mean, or null where there is nothing to average. Never a division by zero. */
export function mean(sum: number, count: number): number | null {
  return count > 0 ? Math.round(sum / count) : null;
}

/** Negates every counter, for withdrawing a contribution that has moved. */
export function negate(delta: RollupDelta): RollupDelta {
  return {
    created: -delta.created,
    resolved: -delta.resolved,
    closed: -delta.closed,
    reopened: -delta.reopened,
    breached: -delta.breached,
    resolveMinutesSum: -delta.resolveMinutesSum,
    resolveMinutesCount: -delta.resolveMinutesCount,
    firstResponseMinutesSum: -delta.firstResponseMinutesSum,
    firstResponseMinutesCount: -delta.firstResponseMinutesCount,
  };
}

/** The fields of a ticket fact the rollup is built from. */
export interface TicketFactShape extends Grouping {
  createdDate: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  timeToFirstResponseMinutes: number | null;
  timeToResolveMinutes: number | null;
  reopenCount: number;
  breached: boolean;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayOf(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/**
 * What one ticket contributes to which days — derived entirely from the fact
 * row, which is the property that makes the nightly rebuild and the incremental
 * maintenance agree.
 *
 * If any counter were attributed to "the day the event arrived", the rebuild
 * would have no way to reproduce it and the two would disagree by construction:
 * drift detection would then measure the design rather than any real problem.
 * So each counter is attributed to a date the fact itself records.
 *
 * `reopened` and `breached` are therefore counted against the day the ticket was
 * **raised**, not the day it was reopened or breached. That reads as "of the
 * tickets raised on the 3rd, four were reopened and two breached" — a cohort
 * measure, and the one a service desk actually acts on, since it is the day's
 * intake that a manager can change.
 */
export function contributions(fact: TicketFactShape): { date: Date; delta: RollupDelta }[] {
  const byDay = new Map<string, { date: Date; delta: RollupDelta }>();

  const at = (date: Date, part: Partial<RollupDelta>) => {
    const day = dayOf(date);
    const key = isoDate(day);
    const existing = byDay.get(key) ?? { date: day, delta: emptyDelta() };
    existing.delta = addDelta(existing.delta, part);
    byDay.set(key, existing);
  };

  at(fact.createdDate, {
    created: 1,
    reopened: fact.reopenCount,
    breached: fact.breached ? 1 : 0,
  });

  if (fact.resolvedAt) {
    at(fact.resolvedAt, {
      resolved: 1,
      ...(fact.timeToResolveMinutes !== null
        ? { resolveMinutesSum: fact.timeToResolveMinutes, resolveMinutesCount: 1 }
        : {}),
    });
  }

  if (fact.closedAt) at(fact.closedAt, { closed: 1 });

  if (fact.firstResponseAt && fact.timeToFirstResponseMinutes !== null) {
    at(fact.firstResponseAt, {
      firstResponseMinutesSum: fact.timeToFirstResponseMinutes,
      firstResponseMinutesCount: 1,
    });
  }

  return [...byDay.values()];
}

/** One cell of the rollup: a day, a grouping, and what to add to it. */
export interface RollupEntry {
  date: Date;
  grouping: Grouping;
  key: string;
  delta: RollupDelta;
}

function entriesFor(fact: TicketFactShape | null): Map<string, RollupEntry> {
  const entries = new Map<string, RollupEntry>();
  if (!fact) return entries;

  for (const { date, delta } of contributions(fact)) {
    for (const grouping of groupingsFor(fact)) {
      const key = `${isoDate(date)}|${groupingKey(grouping)}`;
      entries.set(key, { date, grouping, key, delta });
    }
  }
  return entries;
}

/**
 * The change to apply to the rollup when a ticket fact moves from one shape to
 * another. `before` is null for a ticket seen for the first time.
 *
 * Both sides are recomputed rather than the change being read off the event,
 * because a change of team or priority moves the ticket's whole history between
 * groupings — its creation, its resolution time, everything. An "add one to the
 * new team" update would leave the old team's chart permanently one too high.
 */
export function rollupDiff(before: TicketFactShape | null, after: TicketFactShape | null): RollupEntry[] {
  const previous = entriesFor(before);
  const next = entriesFor(after);
  const result: RollupEntry[] = [];

  for (const [key, entry] of next) {
    const old = previous.get(key);
    const delta = old ? addDelta(entry.delta, negate(old.delta)) : entry.delta;
    if (!isEmptyDelta(delta)) result.push({ ...entry, delta });
  }

  for (const [key, entry] of previous) {
    if (next.has(key)) continue;
    result.push({ ...entry, delta: negate(entry.delta) });
  }

  return result;
}
