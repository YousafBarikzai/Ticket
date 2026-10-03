/**
 * "Today" for charts, in the reader's time zone (SPEC-v3 §8.4, A8 §3.5,
 * ADR-0064).
 *
 * Series buckets are UTC days, weeks and months; what a person reads is
 * local. For most of the day the two agree, but not around midnight: at
 * 00:30 in London in summer the UTC date is still yesterday, so a chart that
 * asked "which bucket is today?" in UTC would put the "As at" marker a day
 * behind the words beside it. These functions answer in the reader's zone.
 *
 * **The kit never reads a clock.** "Now" is the `asAt` instant a page passes
 * in, read once per request, so every chart on a page agrees about which day
 * it is and the same props always render the same markup — on the server, in
 * the browser, and in a test.
 *
 * Server-safe and pure. A zone `Intl` does not know falls back to UTC rather
 * than throwing: a chart with a slightly wrong "today" is better than a page
 * that fails to render.
 */
import type { TimeBucket } from './common.js';
import { DEFAULT_LOCALE } from './scale.js';

export type { TimeBucket } from './common.js';

const DAY = 86_400_000;

/** A whole date (`2026-10-02`): a day in no time zone, read as written wherever the reader is. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Formatters are costly to build and pure to reuse: one per locale, zone and style. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}\u0000${timeZone}\u0000${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, found);
  }
  return found;
}

/** The zone itself when `Intl` knows it, else UTC. */
export function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    formatter(DEFAULT_LOCALE, timeZone, { year: 'numeric' });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** An instant as epoch milliseconds, or `null` when it is not one. */
export function toInstant(instant: string | number): number | null {
  const time = typeof instant === 'number' ? instant : Date.parse(instant);
  return Number.isFinite(time) ? time : null;
}

/**
 * The calendar date of an instant in a zone, as `YYYY-MM-DD`: the key a day
 * bucket is named by. A whole date is returned as it is (it is already a day,
 * in no zone). `null` for something that is not an instant.
 *
 * Built from `formatToParts` rather than a locale that happens to print
 * year-month-day, so the answer cannot change with an ICU update.
 */
export function localDateKey(instant: string | number, timeZone: string | undefined): string | null {
  if (typeof instant === 'string' && DATE_ONLY.test(instant)) return instant;
  const time = toInstant(instant);
  if (time === null) return null;
  const parts = formatter('en-GB', safeTimeZone(timeZone), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((one) => one.type === type)?.value ?? '';
  const year = part('year').padStart(4, '0');
  return `${year}-${part('month')}-${part('day')}`;
}

/**
 * An instant as a short date in the reader's zone and language: "2 Oct".
 * Empty for something that is not an instant. A whole date is read as
 * written, never shifted by a zone.
 */
export function formatShortDate(instant: string | number, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
  const time = toInstant(instant);
  if (time === null) return '';
  const zone = typeof instant === 'string' && DATE_ONLY.test(instant) ? 'UTC' : safeTimeZone(timeZone);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  try {
    return formatter(locale, zone, options).format(time);
  } catch {
    return formatter(DEFAULT_LOCALE, zone, options).format(time);
  }
}

/** The words on the "today" pill: "As at 2 Oct" (D8). */
export function asAtLabel(asAt: string | number, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
  const date = formatShortDate(asAt, locale, timeZone);
  return date ? `As at ${date}` : '';
}

/** A `YYYY-MM-DD` key as the UTC midnight that starts it, so dates compare as numbers. */
function keyTime(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

/** The UTC midnight a bucket starts at (the 1st of the month for a month bucket). */
function bucketStart(time: number, bucket: TimeBucket): number {
  const date = new Date(time);
  if (bucket === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Where a bucket that starts at `start` ends: the start of the next one. */
function bucketEnd(start: number, bucket: TimeBucket): number {
  if (bucket === 'day') return start + DAY;
  if (bucket === 'week') return start + 7 * DAY;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * The bucket a series is in, from the spacing of its points: the smallest
 * gap between two of them, so a missing day does not turn a daily series
 * into a weekly one. One point, or none, is read as daily.
 */
export function inferBucket(times: readonly number[]): TimeBucket {
  const sorted = [...times].filter((time) => Number.isFinite(time)).sort((a, b) => a - b);
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index]! - sorted[index - 1]!;
    if (gap > 0 && gap < smallest) smallest = gap;
  }
  if (smallest >= 27.5 * DAY && Number.isFinite(smallest)) return 'month';
  if (smallest >= 6.5 * DAY && Number.isFinite(smallest)) return 'week';
  return 'day';
}

/** Where the "today" marker goes: an index into the chart's x values. */
export interface TodayPlacement {
  /** The bucket the marker stands on. */
  readonly index: number;
  /** That bucket's x value. */
  readonly x: string;
  /** "Today" in the reader's zone, `YYYY-MM-DD`. */
  readonly dateKey: string;
  /**
   * The bucket holds the date only by the rule below, not by containing it:
   * the reader's date is just past the last bucket, or falls in a gap.
   */
  readonly clamped: boolean;
}

/**
 * Which bucket of a time series is "today" for a reader in `timeZone` at
 * `asAt` (A8 §3.5 rule 4). Buckets are UTC; the date is the reader's.
 *
 * - The bucket that contains the reader's date: the day itself, the week
 *   whose Monday is on or before it, the month it is in.
 * - Just past the last bucket — within one bucket of its end, as between
 *   00:00 and 01:00 in London in summer, when the UTC day is still yesterday —
 *   the **last** bucket, so the marker sits at the end of the line rather
 *   than vanishing for an hour.
 * - Inside the domain but in a gap (a missing day), the bucket before the gap.
 * - **No marker** (`null`) when the date is before the first bucket or more
 *   than one bucket after the last: a past custom range never shows "today".
 *   Also `null` with no `asAt`, an instant that does not parse, or a category
 *   axis (`times` is `null`).
 *
 * `times` are the parsed x values, in the same order as `xs`; `bucket`
 * defaults to the one their spacing implies.
 */
export function markerPosition(
  xs: readonly string[],
  times: readonly number[] | null | undefined,
  asAt: string | number | undefined,
  timeZone: string | undefined,
  bucket?: TimeBucket,
): TodayPlacement | null {
  if (asAt === undefined || !times || times.length === 0 || times.length !== xs.length) return null;
  const dateKey = localDateKey(asAt, timeZone);
  if (dateKey === null) return null;
  const today = keyTime(dateKey);
  const size = bucket ?? inferBucket(times);

  let containing = -1;
  let before = -1;
  let first = Number.POSITIVE_INFINITY;
  let last = -1;
  for (let index = 0; index < times.length; index++) {
    const time = times[index]!;
    if (!Number.isFinite(time)) continue;
    const start = bucketStart(time, size);
    first = Math.min(first, start);
    if (last < 0 || start >= bucketStart(times[last]!, size)) last = index;
    if (start <= today) {
      // Later buckets win ties, so a series with two points on one day marks the later one.
      if (before < 0 || start >= bucketStart(times[before]!, size)) before = index;
      if (today < bucketEnd(start, size) && (containing < 0 || start >= bucketStart(times[containing]!, size))) containing = index;
    }
  }
  if (last < 0 || today < first) return null;
  if (containing >= 0) return { index: containing, x: xs[containing]!, dateKey, clamped: false };

  const lastEnd = bucketEnd(bucketStart(times[last]!, size), size);
  if (today >= lastEnd) {
    // One bucket of grace after the end, never more.
    return today < bucketEnd(lastEnd, size) ? { index: last, x: xs[last]!, dateKey, clamped: true } : null;
  }
  return before >= 0 ? { index: before, x: xs[before]!, dateKey, clamped: true } : null;
}
