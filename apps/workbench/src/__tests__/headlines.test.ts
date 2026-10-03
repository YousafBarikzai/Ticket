import { describe, expect, it } from 'vitest';
import {
  MAX_HEADLINE,
  NOT_ENOUGH,
  NO_TICKETS,
  finish,
  myWorkByPriority,
  needsYou,
  queueNarrative,
  raisedVsResolved,
  slaMet,
  teamQueueByStatus,
  timeLeft,
  trendLine,
} from '../overview/headlines.js';

/**
 * The Overview's sentences (A6 §3.5; SPEC §7.0.4): each template, its empty
 * and too-short forms, whole percentages with sub-point gaps, the reader's
 * locale, and the two rules every one keeps — at most 110 characters and no
 * full stop at the end.
 */

const LONDON = 'Europe/London';
const now = new Date('2026-10-02T09:00:00Z');

/** Every headline the module can write for a spread of inputs, for the two universal rules. */
function everyHeadline(): string[] {
  const out: string[] = [];
  const series = (n: number, value: number | null) => Array.from({ length: n }, () => value);
  for (const locale of ['en-GB', 'de-DE', 'fr-FR']) {
    for (const days of [7, 30, 90]) {
      for (const [raised, resolved] of [
        [series(days, 0), series(days, 0)],
        [series(2, 4), series(2, 5)],
        [series(days, 13), series(days, 14)],
        [series(days, 4_000), series(days, 3_200)],
        [series(days, 7), series(days, 7)],
      ] as const) {
        out.push(raisedVsResolved({ raised, resolved, days, locale }));
      }
      for (const attainment of [null, 100, 99.97, 92.4, 90, 89.4, 85.4, 12.3]) {
        out.push(
          slaMet({
            attainment,
            target: 90,
            days,
            byTarget: [
              { key: 'response', value: 92 },
              { key: 'update', value: 80 },
              { key: 'resolution', value: 84 },
              { key: 'a_target_with_an_extraordinarily_long_and_unusual_configured_name', value: 1 },
            ],
            locale,
          }),
        );
      }
    }
    for (const used of [[], [0.2], [0.2, 0.9], [1.4, 0.95, 0.3, 0.1, 0.2, 0.3]]) out.push(timeLeft({ used, warnAt: 0.8, locale }));
    for (const [total, breached] of [[0, 0], [1, 0], [6, 1], [12_345, 6_789]]) out.push(needsYou({ total: total!, breached: breached!, locale }));
    for (const counts of [new Map(), new Map([['P1', 1]]), new Map([['P2', 2], ['P3', 7]]), new Map([['P3', 3], ['P4', 1]])]) {
      const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
      out.push(myWorkByPriority({ counts, total, whose: { kind: 'mine' }, locale }));
      out.push(myWorkByPriority({ counts, total, whose: { kind: 'team', words: 'across all teams' }, locale }));
    }
    out.push(teamQueueByStatus({ fresh: 9, progress: 26, waiting: 6, words: 'in your teams', locale }));
    out.push(teamQueueByStatus({ fresh: 9_999, progress: 26_000, waiting: 6_000, other: 12_000, words: 'across all teams', locale }));
    out.push(teamQueueByStatus({ fresh: 0, progress: 0, waiting: 0, words: 'in your teams', locale }));
    const breach = { number: 'INC-004503', at: new Date('2026-09-28T14:10:00Z'), target: 'resolution' };
    const next = { number: 'INC-004521', at: new Date('2026-10-05T08:00:00Z') };
    for (const input of [
      { breached: breach, breachedCount: 1, next },
      { breached: breach, breachedCount: 12_345, next },
      { breached: null, breachedCount: 0, next },
      { breached: null, breachedCount: 0, next: null },
    ]) {
      out.push(queueNarrative({ ...input, now, locale, timeZone: LONDON }));
      out.push(trendLine({ next: input.next, breachedCount: input.breachedCount, now, locale, timeZone: LONDON }));
    }
  }
  return out;
}

describe('every headline', () => {
  const all = everyHeadline();

  it('is at most 110 characters', () => {
    expect(all.length).toBeGreaterThan(100);
    for (const line of all) expect(line.length, line).toBeLessThanOrEqual(MAX_HEADLINE);
  });

  it('ends without a full stop and is never empty', () => {
    for (const line of all) {
      expect(line, line).not.toMatch(/\.\s*$/);
      expect(line.trim()).not.toBe('');
    }
  });

  it('drops a closing full stop and takes the shorter form when the long one would not fit', () => {
    expect(finish('Done.')).toBe('Done');
    expect(finish('x'.repeat(200), 'short.')).toBe('short');
  });
});

describe('Raised vs resolved', () => {
  it('says what changed, then by how much', () => {
    const raised = [130, 130, 138];
    const resolved = [140, 130, 142];
    expect(raisedVsResolved({ raised, resolved, days: 30, locale: 'en-GB' })).toBe('Resolved 412, raised 398 in 30 days: the queue fell by 14');
    expect(raisedVsResolved({ raised: resolved, resolved: raised, days: 30, locale: 'en-GB' })).toBe('Resolved 398, raised 412 in 30 days: the queue grew by 14');
    expect(raisedVsResolved({ raised: [1, 1, 1], resolved: [1, 1, 1], days: 7, locale: 'en-GB' })).toBe('Resolved 3, raised 3 in 7 days: the queue held steady');
  });

  it('says there was nothing, or too little to say anything', () => {
    expect(raisedVsResolved({ raised: [0, 0, 0], resolved: [0, 0, 0], days: 7, locale: 'en-GB' })).toBe(NO_TICKETS);
    expect(raisedVsResolved({ raised: [], resolved: [], days: 7, locale: 'en-GB' })).toBe(NO_TICKETS);
    expect(raisedVsResolved({ raised: [3, null, 2], resolved: [1, 2, null], days: 7, locale: 'en-GB' })).toBe(NOT_ENOUGH);
    expect(NO_TICKETS).toBe('No tickets in this period');
    expect(NOT_ENOUGH).toBe('Not enough history yet');
  });

  it('writes numbers in the reader’s locale', () => {
    const big = Array.from({ length: 30 }, () => 100);
    const bigger = Array.from({ length: 30 }, () => 150);
    expect(raisedVsResolved({ raised: big, resolved: bigger, days: 30, locale: 'en-GB' })).toBe('Resolved 4,500, raised 3,000 in 30 days: the queue fell by 1,500');
    expect(raisedVsResolved({ raised: big, resolved: bigger, days: 30, locale: 'de-DE' })).toBe('Resolved 4.500, raised 3.000 in 30 days: the queue fell by 1.500');
  });
});

describe('SLA met', () => {
  it('reads whole percentages against the API’s target, naming the weakest target when short', () => {
    expect(
      slaMet({
        attainment: 85.4,
        target: 90,
        days: 30,
        byTarget: [
          { key: 'response', value: 92 },
          { key: 'update', value: 80 },
          { key: 'resolution', value: 84 },
        ],
        locale: 'en-GB',
      }),
    ).toBe('85% of targets met in 30 days, 5 points under the 90% target; updates fell furthest short');
    expect(slaMet({ attainment: 93.4, target: 90, days: 30, locale: 'en-GB' })).toBe('93% of targets met in 30 days, 3 points above the 90% target');
    expect(slaMet({ attainment: 90, target: 90, days: 7, locale: 'en-GB' })).toBe('90% of targets met in 7 days, on the 90% target');
    expect(slaMet({ attainment: 95, target: 95, days: 7, locale: 'en-GB' })).toContain('the 95% target');
  });

  it('keeps one decimal for a gap under a point, and says "1 point" in the singular', () => {
    expect(slaMet({ attainment: 89.4, target: 90, days: 30, locale: 'en-GB' })).toBe('89% of targets met in 30 days, 0.6 points under the 90% target');
    expect(slaMet({ attainment: 91, target: 90, days: 30, locale: 'en-GB' })).toBe('91% of targets met in 30 days, 1 point above the 90% target');
    expect(slaMet({ attainment: 89.4, target: 90, days: 30, locale: 'de-DE' })).toContain('0,6 points');
  });

  it('says there was nothing when no target finished in the period', () => {
    expect(slaMet({ attainment: null, target: 90, days: 30, locale: 'en-GB' })).toBe(NO_TICKETS);
  });
});

describe('the cards’ other sentences', () => {
  it('Time left: past the target first, then past 80% used, else time to spare', () => {
    expect(timeLeft({ used: [1.2, 0.85, 0.1], warnAt: 0.8, locale: 'en-GB' })).toBe('1 of 3 running clocks is past its target');
    expect(timeLeft({ used: [1.2, 1.1], warnAt: 0.8, locale: 'en-GB' })).toBe('2 of 2 running clocks are past their target');
    expect(timeLeft({ used: [0.92, 0.1, 0.2, 0.3, 0.4, 0.5], warnAt: 0.8, locale: 'en-GB' })).toBe('1 of 6 running clocks is past 80% used');
    expect(timeLeft({ used: [0.1, 0.2], warnAt: 0.8, locale: 'en-GB' })).toBe('All 2 running clocks have time to spare');
    expect(timeLeft({ used: [0.1], warnAt: 0.8, locale: 'en-GB' })).toBe('The one running clock has time to spare');
    expect(timeLeft({ used: [], warnAt: 0.8, locale: 'en-GB' })).toBe('No clocks are running');
  });

  it('Needs you: how many, and how many breached', () => {
    expect(needsYou({ total: 6, breached: 1, locale: 'en-GB' })).toBe('6 things need you · 1 breached');
    expect(needsYou({ total: 1, breached: 0, locale: 'en-GB' })).toBe('1 thing needs you');
    expect(needsYou({ total: 0, breached: 0, locale: 'en-GB' })).toBe('Nothing needs you right now');
  });

  it('My work by priority: the most urgent priority present, and that nothing is more urgent', () => {
    const counts = new Map<string | null, number>([
      ['P2', 2],
      ['P3', 4],
      ['P4', 3],
    ]);
    expect(myWorkByPriority({ counts, total: 9, whose: { kind: 'mine' }, locale: 'en-GB' })).toBe('2 of your 9 are P2; none is P1');
    expect(myWorkByPriority({ counts, total: 9, whose: { kind: 'team', words: 'in your teams' }, locale: 'en-GB' })).toBe('2 of 9 in your teams are P2; none is P1');
    expect(myWorkByPriority({ counts: new Map([['P1', 1]]), total: 5, whose: { kind: 'mine' }, locale: 'en-GB' })).toBe('1 of your 5 is P1');
    expect(myWorkByPriority({ counts: new Map([['P4', 2]]), total: 2, whose: { kind: 'mine' }, locale: 'en-GB' })).toBe('None of your 2 is P1 or P2');
    expect(myWorkByPriority({ counts: new Map(), total: 0, whose: { kind: 'mine' }, locale: 'en-GB' })).toBe('Nothing open is yours');
  });

  it('Team queue by status: the total, then each part', () => {
    expect(teamQueueByStatus({ fresh: 9, progress: 26, waiting: 6, words: 'in your teams', locale: 'en-GB' })).toBe('41 open in your teams: 9 new, 26 in progress, 6 waiting');
    expect(teamQueueByStatus({ fresh: 1, progress: 1, waiting: 1, other: 2, words: 'across all teams', locale: 'en-GB' })).toBe(
      '5 open across all teams: 1 new, 1 in progress, 1 waiting, 2 other',
    );
    expect(teamQueueByStatus({ fresh: 0, progress: 0, waiting: 0, words: 'in your teams', locale: 'en-GB' })).toBe('Nothing open in your teams');
  });
});

describe('the hero’s sentence and trend line (A6 §5.2.3, X-M4)', () => {
  const breach = { number: 'INC-004503', at: new Date('2026-10-01T14:10:00Z'), target: 'resolution' };
  const soon = { number: 'INC-004521', at: new Date('2026-10-02T09:40:00Z') };
  const tomorrow = { number: 'INC-004540', at: new Date('2026-10-03T08:00:00Z') };
  const base = { now, locale: 'en-GB', timeZone: LONDON };

  it('says what broke and when, then what is next', () => {
    expect(queueNarrative({ ...base, breached: breach, breachedCount: 1, next: soon })).toBe(
      'INC-004503 passed its resolution target yesterday at 15:10; INC-004521 is due in 40 min',
    );
    expect(queueNarrative({ ...base, breached: breach, breachedCount: 3, next: null })).toBe('3 tickets are past their targets, the oldest INC-004503 since yesterday at 15:10');
    expect(queueNarrative({ ...base, breached: null, breachedCount: 0, next: tomorrow })).toBe('Nothing is past its target; INC-004540 is due tomorrow at 09:00');
    expect(queueNarrative({ ...base, breached: null, breachedCount: 0, next: null })).toBe('Nothing is past its target and nothing has a deadline');
  });

  it('reads "Next breach in 40 min" or "Nothing due today", never "As at"', () => {
    expect(trendLine({ ...base, next: soon, breachedCount: 1 })).toBe('Next breach in 40 min');
    expect(trendLine({ ...base, next: tomorrow, breachedCount: 0 })).toBe('Nothing due today');
    expect(trendLine({ ...base, next: null, breachedCount: 2 })).toBe('Nothing else due today');
    for (const line of [trendLine({ ...base, next: soon, breachedCount: 0 }), trendLine({ ...base, next: null, breachedCount: 0 })]) expect(line).not.toMatch(/As at/);
  });
});
