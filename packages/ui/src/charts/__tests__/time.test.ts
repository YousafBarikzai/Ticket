import { describe, expect, it } from 'vitest';
import { parseTimes } from '../scale.js';
import { asAtLabel, formatShortDate, inferBucket, localDateKey, markerPosition, safeTimeZone } from '../time.js';

/**
 * "Today" in the reader's zone (A8 §3.5, ADR-0064). Buckets are UTC; the date
 * a person reads is local, and the two disagree for an hour or more around
 * midnight — most visibly on the two nights a year the clocks change. Each
 * case is one of those hours, and where the "As at" marker must stand in it.
 */

const LONDON = 'Europe/London';

/** Consecutive UTC days from `first`, as the API's day buckets name them. */
function days(first: string, count: number): string[] {
  const start = Date.parse(first);
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function place(xs: readonly string[], asAt: string | undefined, timeZone: string | undefined = LONDON) {
  return markerPosition(xs, parseTimes(xs), asAt, timeZone);
}

describe('the reader’s date', () => {
  it('is tomorrow in London at 23:30 UTC in summer, and today in winter', () => {
    expect(localDateKey('2026-10-01T23:30:00Z', LONDON)).toBe('2026-10-02');
    expect(localDateKey('2026-12-01T23:30:00Z', LONDON)).toBe('2026-12-01');
  });

  it('is still yesterday in New York after midnight UTC', () => {
    expect(localDateKey('2026-10-02T02:00:00Z', 'America/New_York')).toBe('2026-10-01');
  });

  it('follows both clock changes in London (29 Mar and 25 Oct 2026)', () => {
    // Spring forward at 01:00 UTC on 29 March: 23:30 UTC is 23:30 GMT before, 00:30 BST after.
    expect(localDateKey('2026-03-28T23:30:00Z', LONDON)).toBe('2026-03-28');
    expect(localDateKey('2026-03-29T23:30:00Z', LONDON)).toBe('2026-03-30');
    // Fall back at 01:00 UTC on 25 October: 23:30 UTC is 00:30 BST before, 23:30 GMT after.
    expect(localDateKey('2026-10-24T23:30:00Z', LONDON)).toBe('2026-10-25');
    expect(localDateKey('2026-10-25T23:30:00Z', LONDON)).toBe('2026-10-25');
  });

  it('reads a whole date as written, in no zone', () => {
    expect(localDateKey('2026-10-02', 'Pacific/Honolulu')).toBe('2026-10-02');
    expect(formatShortDate('2026-10-02', 'en-GB', 'Pacific/Honolulu')).toBe('2 Oct');
  });

  it('takes epoch milliseconds as well as ISO strings', () => {
    expect(localDateKey(Date.UTC(2026, 9, 1, 23, 30), LONDON)).toBe('2026-10-02');
  });

  it('is nothing for something that is not an instant', () => {
    expect(localDateKey('not a date', LONDON)).toBeNull();
    expect(formatShortDate('not a date')).toBe('');
    expect(asAtLabel('not a date')).toBe('');
  });

  it('falls back to UTC for a zone Intl does not know, rather than failing the page', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
    expect(safeTimeZone(LONDON)).toBe(LONDON);
    expect(localDateKey('2026-10-01T23:30:00Z', 'Mars/Olympus_Mons')).toBe('2026-10-01');
  });
});

describe('the pill', () => {
  it('reads "As at 2 Oct" in the reader’s zone', () => {
    expect(formatShortDate('2026-10-01T23:30:00Z', 'en-GB', LONDON)).toBe('2 Oct');
    expect(asAtLabel('2026-10-01T23:30:00Z', 'en-GB', LONDON)).toBe('As at 2 Oct');
    expect(asAtLabel('2026-10-01T23:30:00Z', 'en-GB', 'UTC')).toBe('As at 1 Oct');
  });

  it('falls back to the product’s language for a locale Intl rejects', () => {
    expect(formatShortDate('2026-10-02T12:00:00Z', '!!', LONDON)).toBe('2 Oct');
  });
});

describe('where "today" stands among day buckets', () => {
  const week = days('2026-09-25', 7); // 25 Sep … 1 Oct

  it('stands on the last bucket at 23:30 UTC on 1 Oct, when it is already 2 Oct in London', () => {
    expect(place(week, '2026-10-01T23:30:00Z')).toEqual({ index: 6, x: '2026-10-01', dateKey: '2026-10-02', clamped: true });
  });

  it('stands on 26 Oct at 00:30 UTC on 26 Oct, once London is back on GMT', () => {
    const xs = days('2026-10-20', 7); // 20 … 26 Oct
    expect(place(xs, '2026-10-26T00:30:00Z')).toMatchObject({ x: '2026-10-26', clamped: false });
  });

  it('stands on the same day either side of the autumn change', () => {
    const xs = days('2026-10-22', 5); // 22 … 26 Oct
    expect(place(xs, '2026-10-24T23:30:00Z')?.x).toBe('2026-10-25');
    expect(place(xs, '2026-10-25T23:30:00Z')?.x).toBe('2026-10-25');
  });

  it('moves a day on at 23:30 UTC once London is on summer time', () => {
    const xs = days('2026-03-26', 6); // 26 … 31 Mar
    expect(place(xs, '2026-03-28T23:30:00Z')?.x).toBe('2026-03-28');
    expect(place(xs, '2026-03-29T23:30:00Z')?.x).toBe('2026-03-30');
  });

  it('stays on yesterday’s bucket in New York while UTC has moved on', () => {
    const xs = days('2026-09-28', 5); // 28 Sep … 2 Oct
    expect(place(xs, '2026-10-02T02:00:00Z', 'America/New_York')).toMatchObject({ x: '2026-10-01', clamped: false });
  });

  it('stands on the bucket before a missing day', () => {
    expect(place(['2026-09-28', '2026-09-29', '2026-10-01'], '2026-09-30T12:00:00Z')).toMatchObject({ index: 1, clamped: true });
  });

  it('draws no marker before the series, or more than a bucket after it: a past range has no "today"', () => {
    expect(place(week, '2026-09-20T12:00:00Z')).toBeNull();
    expect(place(week, '2026-10-03T12:00:00Z')).toBeNull();
  });

  it('draws no marker without an instant, on a category axis, or for an instant that does not parse', () => {
    expect(place(week, undefined)).toBeNull();
    expect(markerPosition(['P1', 'P2'], null, '2026-10-01T12:00:00Z', LONDON)).toBeNull();
    expect(place(week, 'soon')).toBeNull();
  });

  it('reads the reader’s date in UTC when the zone is unknown', () => {
    expect(place(week, '2026-10-01T23:30:00Z', 'Mars/Olympus_Mons')).toMatchObject({ x: '2026-10-01', clamped: false });
  });
});

describe('where "today" stands among week and month buckets', () => {
  const weeks = ['2026-09-14', '2026-09-21', '2026-09-28']; // ISO Mondays

  it('stands on the week that contains the date', () => {
    expect(place(weeks, '2026-10-02T12:00:00Z')).toMatchObject({ index: 2, clamped: false });
    expect(place(weeks, '2026-09-23T08:00:00Z')).toMatchObject({ index: 1, clamped: false });
    // Sunday evening UTC is already Monday in Tokyo: the next week.
    expect(markerPosition(weeks, parseTimes(weeks), '2026-09-20T18:00:00Z', 'Asia/Tokyo')).toMatchObject({ index: 1 });
  });

  it('keeps the last week for one week after it, and no longer', () => {
    expect(place(weeks, '2026-10-07T12:00:00Z')).toMatchObject({ index: 2, clamped: true });
    expect(place(weeks, '2026-10-13T12:00:00Z')).toBeNull();
  });

  it('stands on the month of the date, and on the last month for one month after it', () => {
    const months = ['2026-07-01', '2026-08-01', '2026-09-01'];
    expect(place(months, '2026-09-15T12:00:00Z')).toMatchObject({ index: 2, clamped: false });
    expect(place(months, '2026-10-31T23:30:00Z')).toMatchObject({ index: 2, clamped: true });
    expect(place(months, '2026-11-01T00:30:00Z')).toBeNull();
  });

  it('can be told the bucket when the spacing cannot say', () => {
    expect(markerPosition(['2026-09-28'], parseTimes(['2026-09-28']), '2026-10-02T12:00:00Z', LONDON, 'week')).toMatchObject({ index: 0, clamped: false });
    expect(markerPosition(['2026-09-28'], parseTimes(['2026-09-28']), '2026-10-02T12:00:00Z', LONDON)).toBeNull();
  });
});

describe('the bucket a series is in', () => {
  it('is read from the smallest gap, so a missing day stays daily', () => {
    expect(inferBucket(parseTimes(days('2026-09-01', 5))!)).toBe('day');
    expect(inferBucket(parseTimes(['2026-09-01', '2026-09-02', '2026-09-05'])!)).toBe('day');
    expect(inferBucket(parseTimes(['2026-09-14', '2026-09-21', '2026-10-05'])!)).toBe('week');
    expect(inferBucket(parseTimes(['2026-02-01', '2026-03-01', '2026-04-01'])!)).toBe('month');
    expect(inferBucket([])).toBe('day');
    expect(inferBucket([Date.UTC(2026, 8, 1)])).toBe('day');
  });
});
