import { describe, expect, it } from 'vitest';
import { BACKLOG_ESTIMATE, backlogAtStart, deriveBacklog } from '../server/backlog.js';

/**
 * The backlog over time, derived from what is open now and the raised and
 * resolved series (A7 §2.3, §11.1): a worked example, never negative, and
 * always labelled an estimate.
 */

const day = (n: number): string => `2026-09-${String(n).padStart(2, '0')}T00:00:00.000Z`;

describe('deriving the backlog', () => {
  it('walks back from what is open now (five days, worked)', () => {
    // Open now: 100. Raised 10, 12, 8, 15, 9; resolved 9, 10, 10, 12, 11.
    const raised = [10, 12, 8, 15, 9].map((value, index) => ({ at: day(index + 1), value }));
    const resolved = [9, 10, 10, 12, 11].map((value, index) => ({ at: day(index + 1), value }));
    // End of day 5: 100. Day 4: 100 − 9 + 11 = 102. Day 3: 102 − 15 + 12 = 99.
    // Day 2: 99 − 8 + 10 = 101. Day 1: 101 − 12 + 10 = 99.
    expect(deriveBacklog(100, raised, resolved).map((point) => point.value)).toEqual([99, 101, 99, 102, 100]);
    // Before day 1: 99 − 10 + 9 = 98, which is also open now less the totals (54 raised, 52 resolved).
    expect(backlogAtStart(100, raised, resolved)).toBe(98);
  });

  it('treats a gap or a missing resolved bucket as nothing resolved', () => {
    const raised = [{ at: day(1), value: 5 }, { at: day(2), value: null }];
    expect(deriveBacklog(10, raised, [{ at: day(2), value: 3 }]).map((point) => point.value)).toEqual([13, 10]);
  });

  it('never goes below zero', () => {
    const raised = [{ at: day(1), value: 50 }, { at: day(2), value: 40 }];
    expect(deriveBacklog(5, raised, []).every((point) => point.value >= 0)).toBe(true);
    expect(backlogAtStart(5, raised, [])).toBe(0);
  });

  it('draws no line without buckets', () => {
    expect(deriveBacklog(10, [], [])).toEqual([]);
    expect(backlogAtStart(10, [], [])).toBeNull();
  });

  it('carries the words that say it is an estimate', () => {
    expect(BACKLOG_ESTIMATE).toBe('estimated from raised and resolved');
  });
});
