import type { MetricQuery } from '@itsm/sdk';

/**
 * The periods Administration's numbers are read over (A7 §2.3, §2.4 rule 6).
 *
 * One place decides which periods a page offers, how `?range=` is read, what
 * "the previous period" is for a delta, and which bucket a series uses, so
 * the toolbar's `RangeControl` (WP-45a), the cards and the deltas agree.
 *
 * Pure and import-free at runtime (the SDK import is a type), so the page kit
 * may import its types from a client component and the tests need no server.
 *
 * - **D17, the demo's 120 days.** A shared-demo session (`me.demo`) is never
 *   offered 12 months, year to date or 180 days, and a custom period cannot
 *   start more than 120 days back: the demo holds 120 days of history, so a
 *   longer view would be mostly empty and read as broken.
 * - **Periods end at tomorrow's UTC midnight**, as the API resolves a named
 *   range (`modules/analytics/src/repo/query-repo.ts`): buckets are UTC days,
 *   and only their labels are the reader's (ADR-0064).
 */

/** The periods a page can offer. A subset of the page kit's `PageRangeKey`. */
export type RangeKey = '7d' | '30d' | '90d' | '180d' | '12m' | 'custom';

/** The pages that carry a range control, each with its own set of periods (A7 §2.4 rule 6). */
export type RangePage = 'command-centre' | 'insights' | 'sla-performance' | 'teams' | 'ai-triage';

/** Who is asking: only whether this is a shared-demo visit matters here. */
export interface PeriodReader {
  readonly demo?: unknown;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the shared demo's data reaches (D17). */
export const DEMO_HISTORY_DAYS = 120;

/** The periods a shared demo never offers (D17). */
export const DEMO_HIDDEN: ReadonlySet<RangeKey> = new Set<RangeKey>(['12m', '180d']);

const OFFERS: Readonly<Record<RangePage, readonly RangeKey[]>> = Object.freeze({
  'command-centre': ['7d', '30d', '90d'],
  insights: ['7d', '30d', '90d', '12m', 'custom'],
  'sla-performance': ['7d', '30d', '90d', '12m', 'custom'],
  teams: ['7d', '30d', '90d'],
  'ai-triage': ['30d', '90d', '180d'],
});

/** The default period of each page: 30 days everywhere (A7 §4.1 "default 30 days"). */
export const DEFAULT_RANGE: RangeKey = '30d';

/** The length of a named period in days; `null` for `custom` (its dates decide). */
export function rangeDays(range: RangeKey): number | null {
  switch (range) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '180d':
      return 180;
    case '12m':
      return 365;
    default:
      return null;
  }
}

export function isDemoReader(me: PeriodReader | null | undefined): boolean {
  return me?.demo !== undefined && me?.demo !== null;
}

/** The periods this person is offered on this page, in order: the demo's hidden ones dropped (D17). */
export function rangesFor(me: PeriodReader | null | undefined, page: RangePage): readonly RangeKey[] {
  const offered = OFFERS[page];
  return isDemoReader(me) ? offered.filter((range) => !DEMO_HIDDEN.has(range)) : offered;
}

/** A period as the page shows it: the key, and for `custom` the two UTC days it spans. */
export interface Period {
  readonly range: RangeKey;
  /** For `custom` only: `YYYY-MM-DD`, inclusive. */
  readonly from?: string;
  readonly to?: string;
}

type Params = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

function param(params: Params, name: string): string | null {
  if (params instanceof URLSearchParams) return params.get(name);
  const value = params[name];
  if (Array.isArray(value)) return (value[0] as string | undefined) ?? null;
  return typeof value === 'string' ? value : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(date: string): number | null {
  if (!DATE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date ? null : ms;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The earliest day a custom period may start for this person: `YYYY-MM-DD` in the demo, otherwise `null`. */
export function customFloor(me: PeriodReader | null | undefined, now: Date): string | null {
  if (!isDemoReader(me)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return isoDay(today - DEMO_HISTORY_DAYS * DAY_MS);
}

/**
 * The period a page was asked for, read defensively.
 *
 * An unknown `?range=`, one this page does not offer, or one the demo hides
 * reads as `fallback`; a custom period without two valid dates, or with them
 * the wrong way round, does too. In the demo a custom start before the
 * 120-day floor is raised to it, and an end in the future is brought back to
 * today: a period is about what has happened.
 */
export function parseRange(
  params: Params,
  me: PeriodReader | null | undefined,
  page: RangePage,
  fallback: RangeKey = DEFAULT_RANGE,
  now: Date = new Date(),
): Period {
  const offered = rangesFor(me, page);
  const safeFallback: Period = { range: offered.includes(fallback) ? fallback : (offered[0] ?? DEFAULT_RANGE) };
  const asked = param(params, 'range');
  if (!asked || !(offered as readonly string[]).includes(asked)) return safeFallback;
  const range = asked as RangeKey;
  if (range !== 'custom') return { range };

  const from = dayStart(param(params, 'from') ?? '');
  const to = dayStart(param(params, 'to') ?? '');
  if (from === null || to === null || from > to) return safeFallback;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const floor = customFloor(me, now);
  const start = floor !== null ? Math.max(from, dayStart(floor)!) : from;
  const end = Math.min(to, today);
  if (start > end) return safeFallback;
  return { range: 'custom', from: isoDay(start), to: isoDay(end) };
}

/**
 * The previous period of the same length, for a delta (A7 §2.4 rule 3): the
 * API resolves a named period as ending at tomorrow's UTC midnight, so the one
 * before it ends where that one starts. Moved from the Command centre's
 * `data.ts` with its meaning unchanged; a custom period's predecessor is the
 * same number of days just before it.
 */
export function previousPeriod(period: RangeKey | Period, now: Date): { from: string; to: string } {
  const value: Period = typeof period === 'string' ? { range: period } : period;
  if (value.range === 'custom' && value.from && value.to) {
    const start = dayStart(value.from)!;
    const end = dayStart(value.to)! + DAY_MS;
    const length = end - start;
    return { from: new Date(start - length).toISOString(), to: new Date(start).toISOString() };
  }
  const days = rangeDays(value.range) ?? 30;
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  const to = tomorrow - days * DAY_MS;
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString() };
}

/** The series bucket for a period: days up to 30 days, weeks up to 180 days, months beyond (A7 §2.3). */
export function bucketFor(period: RangeKey | Period): 'day' | 'week' | 'month' {
  const value: Period = typeof period === 'string' ? { range: period } : period;
  let days = rangeDays(value.range);
  if (days === null && value.from && value.to) days = Math.round((dayStart(value.to)! - dayStart(value.from)!) / DAY_MS) + 1;
  if (days === null || days <= 31) return 'day';
  return days <= 180 ? 'week' : 'month';
}

/** How many days a period covers: the named length, or a custom period's days inclusive. */
export function periodDays(period: RangeKey | Period): number {
  const value: Period = typeof period === 'string' ? { range: period } : period;
  const named = rangeDays(value.range);
  if (named !== null) return named;
  if (value.from && value.to) return Math.round((dayStart(value.to)! - dayStart(value.from)!) / DAY_MS) + 1;
  return 30;
}

/**
 * The part of a metric question that says "over this period": `range` for a
 * period the API names, `custom` with its instants otherwise (180 days and a
 * custom period are not API range names).
 */
export function metricPeriod(period: RangeKey | Period, now: Date = new Date()): Pick<MetricQuery, 'range' | 'from' | 'to'> {
  const value: Period = typeof period === 'string' ? { range: period } : period;
  if (value.range === '7d' || value.range === '30d' || value.range === '90d' || value.range === '12m') return { range: value.range };
  if (value.range === 'custom' && value.from && value.to) {
    return { range: 'custom', from: `${value.from}T00:00:00.000Z`, to: new Date(dayStart(value.to)! + DAY_MS).toISOString() };
  }
  const days = rangeDays(value.range) ?? 30;
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS;
  return { range: 'custom', from: new Date(tomorrow - days * DAY_MS).toISOString(), to: new Date(tomorrow).toISOString() };
}

/** "the last 30 days", "the last 12 months", "1–14 Sep": the period as a sentence ends with it. */
export function periodPhrase(period: RangeKey | Period, locale = 'en-GB'): string {
  const value: Period = typeof period === 'string' ? { range: period } : period;
  if (value.range === '12m') return 'the last 12 months';
  if (value.range === 'custom' && value.from && value.to) {
    const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${format.format(dayStart(value.from)!)} to ${format.format(dayStart(value.to)!)}`;
  }
  return `the last ${rangeDays(value.range) ?? 30} days`;
}
