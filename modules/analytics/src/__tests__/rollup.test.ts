import { describe, expect, it } from 'vitest';
import {
  addDelta,
  contributions,
  emptyDelta,
  groupingKey,
  groupingsFor,
  isEmptyDelta,
  mean,
  negate,
  rollupDiff,
  type TicketFactShape,
} from '../domain/rollup.js';

/**
 * The rollup is the part of MOD-12 that can be wrong without anybody noticing,
 * so these tests are mostly about arithmetic that has to balance rather than
 * about behaviour anyone will observe directly.
 */

const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';

function fact(overrides: Partial<TicketFactShape> = {}): TicketFactShape {
  return {
    teamId: TEAM,
    serviceId: SERVICE,
    priority: 'P2',
    createdDate: new Date(Date.UTC(2026, 2, 3)),
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    timeToFirstResponseMinutes: null,
    timeToResolveMinutes: null,
    reopenCount: 0,
    breached: false,
    ...overrides,
  };
}

describe('grouping keys', () => {
  it('names the total row', () => {
    expect(groupingKey({ teamId: null, serviceId: null, priority: null })).toBe('all');
  });

  it('is stable regardless of how the grouping was built', () => {
    const a = groupingKey({ teamId: TEAM, serviceId: null, priority: 'P1' });
    const b = groupingKey({ priority: 'P1', teamId: TEAM, serviceId: null } as never);
    expect(a).toBe(b);
  });

  it('distinguishes a team row from a priority row with the same value', () => {
    expect(groupingKey({ teamId: TEAM, serviceId: null, priority: null })).not.toBe(
      groupingKey({ teamId: null, serviceId: null, priority: TEAM }),
    );
  });
});

describe('which slices a ticket lands in', () => {
  it('produces the six stored slices for a fully-dimensioned ticket', () => {
    const slices = groupingsFor(fact()).map(groupingKey);
    expect(slices).toEqual([
      'all',
      `team:${TEAM}`,
      `service:${SERVICE}`,
      'priority:P2',
      `team:${TEAM}|priority:P2`,
      `service:${SERVICE}|priority:P2`,
    ]);
  });

  it('skips slices whose dimension the ticket does not have', () => {
    // An unrouted ticket must not create a bar on a chart broken down by team,
    // but it must still be in the total.
    const slices = groupingsFor(fact({ teamId: null })).map(groupingKey);
    expect(slices).toContain('all');
    expect(slices.some((key) => key.startsWith('team:'))).toBe(false);
  });

  it('gives an entirely undimensioned ticket exactly one slice', () => {
    expect(groupingsFor(fact({ teamId: null, serviceId: null, priority: null }))).toHaveLength(1);
  });
});

describe('what a ticket contributes', () => {
  it('counts the creation on the day it was raised', () => {
    const [entry] = contributions(fact());
    expect(entry?.date).toEqual(new Date(Date.UTC(2026, 2, 3)));
    expect(entry?.delta.created).toBe(1);
  });

  it('counts the resolution on the day it resolved, not the day it was raised', () => {
    const rows = contributions(
      fact({ resolvedAt: new Date(Date.UTC(2026, 2, 6, 9)), timeToResolveMinutes: 240 }),
    );
    const raised = rows.find((row) => row.date.getUTCDate() === 3);
    const resolved = rows.find((row) => row.date.getUTCDate() === 6);
    expect(raised?.delta.resolved).toBe(0);
    expect(resolved?.delta.resolved).toBe(1);
    expect(resolved?.delta.resolveMinutesSum).toBe(240);
    expect(resolved?.delta.resolveMinutesCount).toBe(1);
  });

  it('counts reopens and breaches against the day the ticket was raised', () => {
    // The cohort reading: "of the tickets raised on the 3rd, two were reopened".
    const rows = contributions(fact({ reopenCount: 2, breached: true }));
    const raised = rows.find((row) => row.date.getUTCDate() === 3);
    expect(raised?.delta.reopened).toBe(2);
    expect(raised?.delta.breached).toBe(1);
  });

  it('does not record a resolution time it does not have', () => {
    const rows = contributions(fact({ resolvedAt: new Date(Date.UTC(2026, 2, 6)) }));
    const resolved = rows.find((row) => row.date.getUTCDate() === 6);
    expect(resolved?.delta.resolved).toBe(1);
    // A count of one with a sum of zero would drag every average towards zero.
    expect(resolved?.delta.resolveMinutesCount).toBe(0);
  });
});

describe('moving the rollup', () => {
  it('adds a new ticket to every slice it belongs to', () => {
    const entries = rollupDiff(null, fact());
    expect(entries).toHaveLength(6);
    for (const entry of entries) expect(entry.delta.created).toBe(1);
  });

  it('takes a ticket out of the old team and puts it in the new one', () => {
    const before = fact();
    const after = fact({ teamId: OTHER_TEAM });
    const entries = rollupDiff(before, after);

    const removed = entries.find((entry) => groupingKey(entry.grouping) === `team:${TEAM}`);
    const added = entries.find((entry) => groupingKey(entry.grouping) === `team:${OTHER_TEAM}`);
    expect(removed?.delta.created).toBe(-1);
    expect(added?.delta.created).toBe(1);
  });

  it('leaves the total alone when only the team changes', () => {
    const entries = rollupDiff(fact(), fact({ teamId: OTHER_TEAM }));
    const total = entries.find((entry) => groupingKey(entry.grouping) === 'all');
    // The ticket did not stop existing, so the headline number must not move.
    expect(total).toBeUndefined();
  });

  it('produces nothing at all when nothing changed', () => {
    expect(rollupDiff(fact(), fact())).toEqual([]);
  });

  it('sums to zero over a create-then-withdraw cycle', () => {
    const row = fact({ resolvedAt: new Date(Date.UTC(2026, 2, 6)), timeToResolveMinutes: 120 });
    const forward = rollupDiff(null, row);
    const backward = rollupDiff(row, null);

    const totals = [...forward, ...backward].reduce((sum, entry) => addDelta(sum, entry.delta), emptyDelta());
    expect(isEmptyDelta(totals)).toBe(true);
  });

  it('withdraws a whole day when a resolution date moves', () => {
    const before = fact({ resolvedAt: new Date(Date.UTC(2026, 2, 6)), timeToResolveMinutes: 120 });
    const after = fact({ resolvedAt: new Date(Date.UTC(2026, 2, 9)), timeToResolveMinutes: 400 });
    const entries = rollupDiff(before, after);

    const sixth = entries.filter((entry) => entry.date.getUTCDate() === 6);
    const ninth = entries.filter((entry) => entry.date.getUTCDate() === 9);
    expect(sixth.every((entry) => entry.delta.resolved === -1)).toBe(true);
    expect(ninth.every((entry) => entry.delta.resolved === 1)).toBe(true);
  });
});

describe('means', () => {
  it('is null rather than a division by zero', () => {
    expect(mean(0, 0)).toBeNull();
  });

  it('is the sum over the count, which is why both are stored', () => {
    // Two days: 10 minutes over 1 ticket, and 100 over 9. Averaging the two
    // daily means (10 and 11.1) gives 10.6; the real mean is 11. Storing sums
    // and counts rather than means is what keeps the weekly figure right.
    expect(mean(10 + 100, 1 + 9)).toBe(11);
  });

  it('negates every field', () => {
    const delta = addDelta(emptyDelta(), { created: 1, resolveMinutesSum: 30, resolveMinutesCount: 1 });
    expect(negate(delta)).toMatchObject({ created: -1, resolveMinutesSum: -30, resolveMinutesCount: -1 });
  });
});
