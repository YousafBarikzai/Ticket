import { describe, expect, it } from 'vitest';
import {
  formatBadgeCount,
  formatCount,
  formatDateTime,
  formatDuration,
  formatList,
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
