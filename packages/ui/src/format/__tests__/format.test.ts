import { describe, expect, it } from 'vitest';
import {
  formatBadgeCount,
  formatBytes,
  formatCompact,
  formatCount,
  formatDateTime,
  formatDuration,
  formatList,
  formatNumber,
  formatPercent,
  formatRelative,
  parseDuration,
} from '../index.js';

/*
 * The first versions of the helpers. What is pinned here is what the spec
 * fixes (D13's captions, the "99+" cap, the duration syntax people type);
 * the foundations package adds the locale and time-zone matrix.
 */

describe('formatDateTime', () => {
  it('formats in the reader’s time zone, not the server’s', () => {
    const iso = '2026-09-29T23:30:00Z';
    expect(formatDateTime(iso, { locale: 'en-GB', timeZone: 'Europe/London', style: 'time' })).toBe('00:30');
    expect(formatDateTime(iso, { locale: 'en-GB', timeZone: 'UTC', style: 'time' })).toBe('23:30');
  });

  it('returns unparseable input as written instead of throwing', () => {
    expect(formatDateTime('not a date', { locale: 'en-GB', timeZone: 'UTC' })).toBe('not a date');
  });
});

describe('formatRelative', () => {
  it('reads recent times relative to the caller’s clock', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(formatRelative('2026-09-29T11:57:00Z', now, 'en-GB')).toBe('3 minutes ago');
    expect(formatRelative('2026-09-30T12:00:00Z', now, 'en-GB')).toBe('tomorrow');
  });
});

describe('counts', () => {
  it('never invents a total for a list that has more (D13)', () => {
    expect(formatCount(100, true, { one: 'ticket', other: 'tickets' })).toBe('Showing 100 · more available');
    expect(formatCount(1, false, { one: 'ticket', other: 'tickets' })).toBe('1 ticket');
    expect(formatCount(3, false, { one: 'ticket', other: 'tickets' })).toBe('3 tickets');
  });

  it('caps badges at 99+', () => {
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(12, true)).toBe('12+');
  });

  it('joins lists in words', () => {
    expect(formatList(['Open', 'Paused', 'Resolved'], { locale: 'en-GB' })).toBe('Open, Paused and Resolved');
  });
});

describe('durations', () => {
  it('reads what people type', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('4h')).toBe(240);
    expect(parseDuration('4 hours')).toBe(240);
    expect(parseDuration('2d 3h')).toBe(2 * 1440 + 180);
    expect(parseDuration('1.5h')).toBe(90);
  });

  it('refuses what is not a duration rather than guessing', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('3 months')).toBeNull();
    expect(parseDuration('2d3')).toBeNull();
  });

  it('leaves zero to the field to reject in words', () => {
    expect(parseDuration('0')).toBe(0);
  });

  it('writes durations back in their largest units', () => {
    expect(formatDuration(255)).toBe('4 h 15 min');
    expect(formatDuration(1500)).toBe('1 d 1 h');
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(61, { style: 'long' })).toBe('1 hour 1 minute');
  });
});

/*
 * The locale and time-zone matrix (SPEC §3.8): the reader's zone across a
 * daylight-saving change, the reader's locale for order and words, and
 * relative time that counts calendar days where the reader is.
 */

describe('formatDateTime across zones and locales', () => {
  it('follows the reader’s zone across the clocks going forward', () => {
    // British Summer Time starts at 01:00 UTC on 29 March 2026.
    expect(formatDateTime('2026-03-29T00:30:00Z', { locale: 'en-GB', timeZone: 'Europe/London', style: 'time' })).toBe('00:30');
    expect(formatDateTime('2026-03-29T01:30:00Z', { locale: 'en-GB', timeZone: 'Europe/London', style: 'time' })).toBe('02:30');
  });

  it('writes the date the reader’s way', () => {
    const iso = '2026-09-29T14:30:00Z';
    expect(formatDateTime(iso, { locale: 'en-GB', timeZone: 'UTC', style: 'date' })).toMatch(/^29 Sept? 2026$/);
    expect(formatDateTime(iso, { locale: 'en-US', timeZone: 'UTC', style: 'date' })).toBe('Sep 29, 2026');
    expect(formatDateTime(iso, { locale: 'de-DE', timeZone: 'UTC', style: 'datetime' })).toBe('29.09.2026, 14:30');
    expect(formatDateTime(iso, { locale: 'en-GB', timeZone: 'UTC', style: 'weekdayTime' })).toBe('Tue 14:30');
    expect(formatDateTime(iso, { locale: 'en-US', timeZone: 'UTC', style: 'weekdayTime' })).toBe('Tue 2:30 PM');
    expect(formatDateTime(iso, { locale: 'en-GB', timeZone: 'UTC', style: 'full' })).toContain('29 September 2026');
  });

  it('accepts a Date or epoch milliseconds as well as ISO text', () => {
    const at = Date.parse('2026-09-29T14:30:00Z');
    expect(formatDateTime(at, { locale: 'en-GB', timeZone: 'UTC', style: 'time' })).toBe('14:30');
    expect(formatDateTime(new Date(at), { locale: 'en-GB', timeZone: 'UTC', style: 'time' })).toBe('14:30');
  });

  it('falls back to UTC for a zone it does not know, rather than throwing', () => {
    expect(formatDateTime('2026-09-29T14:30:00Z', { locale: 'en-GB', timeZone: 'Mars/Olympus', style: 'time' })).toBe('14:30');
    expect(formatDateTime('2026-09-29T14:30:00Z', { locale: 'not a locale!', timeZone: 'UTC', style: 'time' })).toMatch(/14:30|2:30/);
  });
});

describe('formatRelative in whole units', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');

  it('reads under a minute as now, and never rounds up to the next unit', () => {
    expect(formatRelative('2026-09-29T11:59:30Z', now, 'en-GB')).toBe('now');
    expect(formatRelative('2026-09-29T11:01:00Z', now, 'en-GB')).toBe('59 minutes ago');
    expect(formatRelative('2026-09-28T12:01:00Z', now, 'en-GB')).toBe('23 hours ago');
  });

  it('goes on to weeks, months and years, forwards and back', () => {
    expect(formatRelative('2026-10-01T12:00:00Z', now, 'en-GB')).toBe('in 2 days');
    expect(formatRelative('2026-09-15T12:00:00Z', now, 'en-GB')).toBe('2 weeks ago');
    expect(formatRelative('2026-07-29T12:00:00Z', now, 'en-GB')).toBe('2 months ago');
    expect(formatRelative('2024-09-29T12:00:00Z', now, 'en-GB')).toBe('2 years ago');
    expect(formatRelative('2025-09-30T12:00:00Z', now, 'en-GB')).toBe('11 months ago');
    expect(formatRelative('2026-08-30T12:00:00Z', now, 'en-GB')).toBe('4 weeks ago');
  });

  it('counts days on the reader’s calendar when given their zone', () => {
    // 25½ hours before half past midnight in London is two calendar days back.
    const halfPastMidnight = Date.parse('2026-09-29T23:30:00Z');
    expect(formatRelative('2026-09-28T22:00:00Z', halfPastMidnight, 'en-GB', { timeZone: 'Europe/London' })).toBe('2 days ago');
    // 25 hours before nine in the morning is yesterday.
    expect(formatRelative('2026-09-28T07:00:00Z', Date.parse('2026-09-29T08:00:00Z'), 'en-GB', { timeZone: 'Europe/London' })).toBe(
      'yesterday',
    );
  });

  it('has a short form for dense lists', () => {
    expect(formatRelative('2026-09-29T11:57:00Z', now, 'en-GB', { style: 'short' })).toBe('3 min ago');
  });
});

describe('numbers and counts in the reader’s locale', () => {
  it('formats numbers, compact numbers and percentages', () => {
    expect(formatNumber(1234.5, { locale: 'de-DE' })).toBe('1.234,5');
    expect(formatNumber(1234.5, { locale: 'en-GB' })).toBe('1,234.5');
    expect(formatCompact(1234, { locale: 'en-GB' })).toBe('1.2k');
    expect(formatPercent(0.42, { locale: 'en-GB' })).toBe('42%');
  });

  it('groups the digits of a caption and picks the noun by the locale’s plural rules', () => {
    expect(formatCount(1000, false, { one: 'ticket', other: 'tickets' }, 'en-GB')).toBe('1,000 tickets');
    expect(formatCount(0, false, { one: 'ticket', other: 'tickets' }, 'en-GB')).toBe('0 tickets');
    expect(formatCount(1000, true, { one: 'ticket', other: 'tickets' }, 'en-GB')).toBe('Showing 1,000 · more available');
  });

  it('never shows a negative or fractional badge', () => {
    expect(formatBadgeCount(-3)).toBe('0');
    expect(formatBadgeCount(4.7)).toBe('4');
  });

  it('writes sizes in decimal units', () => {
    expect(formatBytes(999, { locale: 'en-GB' })).toBe('999 bytes');
    expect(formatBytes(1500, { locale: 'en-GB' })).toBe('1.5 kB');
    expect(formatBytes(1_400_000, { locale: 'en-GB' })).toBe('1.4 MB');
    expect(formatBytes(Number.NaN, { locale: 'en-GB' })).toBe('0 bytes');
  });
});

describe('durations, further', () => {
  it('writes words in the long form, and other languages’ own units', () => {
    expect(formatDuration(255, { style: 'long', locale: 'en-GB' })).toBe('4 hours 15 minutes');
    expect(formatDuration(1500, { style: 'long', locale: 'en-US' })).toBe('1 day 1 hour');
    // French puts a narrow no-break space between the number and the unit.
    expect(formatDuration(255, { locale: 'fr-FR' })).toMatch(/^4\sh 15\smin$/);
    expect(formatDuration(255, { locale: 'de-DE' })).toMatch(/^4 Std\.,? 15 Min\.$/);
  });

  it('writes in the units asked for, rounding into the smallest', () => {
    expect(formatDuration(2160, { units: ['h', 'm'] })).toBe('36 h');
    expect(formatDuration(59, { units: ['h'] })).toBe('1 h');
  });

  it('keeps to at most so many parts, carrying a rounded-up remainder', () => {
    expect(formatDuration(3133, { maxParts: 2 })).toBe('2 d 4 h');
    // 1 d 23 h 50 min at two parts is 2 d, not "1 d 24 h".
    expect(formatDuration(1440 + 23 * 60 + 50, { maxParts: 2 })).toBe('2 d');
  });

  it('reads more of what people type, and still refuses what is ambiguous', () => {
    expect(parseDuration('1,5h')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1 day, 2 hours and 30 minutes')).toBe(1440 + 150);
    expect(parseDuration('2d3h')).toBe(2 * 1440 + 180);
    expect(parseDuration('4', { defaultUnit: 'h' })).toBe(240);
    expect(parseDuration('-5')).toBe(-5);
    expect(parseDuration('2h 2h')).toBeNull();
    expect(parseDuration('4h15')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
  });

  it('never needs Intl.DurationFormat, which the server renderer does not have', () => {
    const intl = Intl as unknown as Record<string, unknown>;
    const original = intl.DurationFormat;
    intl.DurationFormat = class {
      constructor() {
        throw new Error('Intl.DurationFormat is not available here');
      }
    };
    try {
      expect(formatDuration(255)).toBe('4 h 15 min');
      expect(formatDuration(255, { style: 'long', locale: 'en-GB' })).toBe('4 hours 15 minutes');
    } finally {
      if (original === undefined) delete intl.DurationFormat;
      else intl.DurationFormat = original;
    }
  });
});
