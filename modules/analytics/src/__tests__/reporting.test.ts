import { describe, expect, it } from 'vitest';
import { bucketFor, bucketStarts, previousPeriod, resolveRange, truncateTo } from '../domain/ranges.js';
import { nextRunAfter, periodFor } from '../domain/schedule.js';
import { linearTrend } from '../domain/forecast.js';
import { csvCell, toCsv } from '../domain/csv.js';

describe('ranges', () => {
  const now = new Date('2026-03-15T14:30:00Z');

  it('ends at the start of tomorrow so today counts in full', () => {
    const { from, to } = resolveRange('7d', now);
    expect(to).toEqual(new Date('2026-03-16T00:00:00Z'));
    expect(from).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('starts the year on 1 January', () => {
    expect(resolveRange('ytd', now).from).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('refuses a custom range that runs backwards or is enormous', () => {
    expect(() => resolveRange('custom', now, { from: '2026-03-10', to: '2026-03-01' })).toThrow(/end after/);
    expect(() => resolveRange('custom', now, { from: '2020-01-01', to: '2026-03-01' })).toThrow(/three years/);
  });

  it('picks a bucket a chart can draw', () => {
    expect(bucketFor(resolveRange('30d', now))).toBe('day');
    expect(bucketFor(resolveRange('12m', now))).toBe('week');
    expect(bucketFor(resolveRange('custom', now, { from: '2024-01-01', to: '2026-01-01' }))).toBe('month');
  });

  it('starts a week on Monday', () => {
    // 15 March 2026 is a Sunday.
    expect(truncateTo(new Date('2026-03-15T10:00:00Z'), 'week')).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('has a point for every bucket, quiet ones included', () => {
    const starts = bucketStarts({ from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-08T00:00:00Z') }, 'day');
    expect(starts).toHaveLength(7);
  });

  it('gives the previous period the same length', () => {
    const period = resolveRange('30d', now);
    const previous = previousPeriod(period);
    expect(previous.to).toEqual(period.from);
    expect(period.from.getTime() - previous.from.getTime()).toBe(30 * 24 * 3600 * 1000);
  });
});

describe('schedules', () => {
  it('fires at the same wall-clock time on both sides of daylight saving', () => {
    // 08:00 London is 08:00 UTC in March and 07:00 UTC in April; a cron
    // string in UTC would be an hour wrong for half the year.
    const schedule = { frequency: 'daily' as const, hour: 8, minute: 0, timeZone: 'Europe/London' };
    expect(nextRunAfter(schedule, new Date('2026-03-27T09:00:00Z'))).toEqual(new Date('2026-03-28T08:00:00Z'));
    expect(nextRunAfter(schedule, new Date('2026-03-29T09:00:00Z'))).toEqual(new Date('2026-03-30T07:00:00Z'));
  });

  it('fires today if the time has not passed, tomorrow if it has', () => {
    const schedule = { frequency: 'daily' as const, hour: 8, minute: 0, timeZone: 'UTC' };
    expect(nextRunAfter(schedule, new Date('2026-03-15T07:59:00Z'))).toEqual(new Date('2026-03-15T08:00:00Z'));
    expect(nextRunAfter(schedule, new Date('2026-03-15T08:00:00Z'))).toEqual(new Date('2026-03-16T08:00:00Z'));
  });

  it('finds the next Monday', () => {
    const schedule = { frequency: 'weekly' as const, hour: 9, minute: 30, dayOfWeek: 1, timeZone: 'UTC' };
    expect(nextRunAfter(schedule, new Date('2026-03-15T00:00:00Z'))).toEqual(new Date('2026-03-16T09:30:00Z'));
  });

  it('finds the first of next month from the second', () => {
    const schedule = { frequency: 'monthly' as const, hour: 6, minute: 0, dayOfMonth: 1, timeZone: 'UTC' };
    expect(nextRunAfter(schedule, new Date('2026-03-02T00:00:00Z'))).toEqual(new Date('2026-04-01T06:00:00Z'));
  });

  it('covers yesterday for a daily run, in the schedule\'s zone', () => {
    const schedule = { frequency: 'daily' as const, hour: 8, minute: 0, timeZone: 'Europe/London' };
    const period = periodFor(schedule, new Date('2026-04-02T07:00:00Z'));
    expect(period.from).toEqual(new Date('2026-03-31T23:00:00Z'));
    expect(period.to).toEqual(new Date('2026-04-01T23:00:00Z'));
  });

  it('covers the previous calendar month for a monthly run', () => {
    const schedule = { frequency: 'monthly' as const, hour: 6, minute: 0, dayOfMonth: 1, timeZone: 'UTC' };
    const period = periodFor(schedule, new Date('2026-03-01T06:00:00Z'));
    expect(period).toEqual({ from: new Date('2026-02-01T00:00:00Z'), to: new Date('2026-03-01T00:00:00Z') });
  });
});

describe('the trend line', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 2, 1 + n));

  it('fits a perfect line perfectly', () => {
    const trend = linearTrend([0, 1, 2, 3, 4].map((n) => ({ at: day(n), value: 10 + 2 * n })), 3)!;
    expect(trend.slopePerDay).toBe(2);
    expect(trend.rSquared).toBe(1);
    expect(trend.projected.map((point) => point.value)).toEqual([20, 22, 24]);
  });

  it('refuses to guess from two points', () => {
    expect(linearTrend([{ at: day(0), value: 1 }, { at: day(1), value: 2 }], 7)).toBeNull();
  });

  it('never projects below zero', () => {
    const trend = linearTrend([0, 1, 2, 3].map((n) => ({ at: day(n), value: 6 - 2 * n })), 5)!;
    expect(trend.projected.every((point) => point.value >= 0)).toBe(true);
  });

  it('says so when the line explains nothing', () => {
    const trend = linearTrend([5, 1, 5, 1, 5, 1].map((value, n) => ({ at: day(n), value })), 2)!;
    expect(trend.rSquared).toBeLessThan(0.2);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Laptop, broken')).toBe('"Laptop, broken"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses a formula', () => {
    // `=HYPERLINK(...)` typed as a ticket title must open as text, not run.
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-5')).toBe(`"'-5"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
  });

  it('leaves a negative number alone when it is a number', () => {
    // A number is written by the platform, not typed by a person: a margin of
    // -30 minutes must stay a number in the spreadsheet.
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe(`"'-5"`);
  });

  it('writes a header and CRLF line endings', () => {
    const csv = toCsv([{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }], [{ a: 1, b: null }]);
    expect(csv).toBe('A,B\r\n1,\r\n');
  });
});
