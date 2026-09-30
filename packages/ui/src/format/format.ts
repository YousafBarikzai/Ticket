/**
 * `Intl` formatting for dates, numbers, counts and lists.
 *
 * Server-safe and pure: a server component calls these with the signed-in
 * person's `locale` and `timeZone` passed explicitly, because the server's own
 * zone is not the reader's. Nothing here reads the clock — relative times take
 * the caller's `now` — so a server render and the hydrating client agree.
 *
 * They never throw. An unparseable date comes back as the text it was given
 * and an unknown locale or time zone falls back to a plain rendering: a wrong
 * format on a page is a smaller failure than an error boundary where the
 * ticket list should be.
 *
 * Formatters are cached. Building an `Intl.DateTimeFormat` costs far more than
 * using one, and a table of a hundred rows with three dates each would
 * otherwise build three hundred.
 */
import type { Plural } from '../types.js';

/* -------------------------------------------------------------------------
 * Formatter cache
 * ---------------------------------------------------------------------- */

const formatters = new Map<string, unknown>();
/** Enough for every locale × option set a session uses; cleared wholesale past it rather than tracked. */
const MAX_FORMATTERS = 256;

/** A cached `Intl` formatter, or `null` where the locale or options are invalid. */
function formatter<T>(kind: string, locale: string | undefined, options: object, create: () => T): T | null {
  const key = `${kind}|${locale ?? ''}|${JSON.stringify(options)}`;
  if (formatters.has(key)) return formatters.get(key) as T | null;
  let value: T | null;
  try {
    value = create();
  } catch {
    // A RangeError for an unknown time zone or locale tag. Remembered as a
    // miss, so a bad value costs one exception, not one per row.
    value = null;
  }
  if (formatters.size >= MAX_FORMATTERS) formatters.clear();
  formatters.set(key, value);
  return value;
}

function dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  return formatter('dt', locale, options, () => new Intl.DateTimeFormat(locale, options));
}

function numberFormatter(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat | null {
  return formatter('nf', locale, options, () => new Intl.NumberFormat(locale, options));
}

/* -------------------------------------------------------------------------
 * Dates and times
 * ---------------------------------------------------------------------- */

/**
 * `date` "29 Sept 2026" · `datetime` "29 Sept 2026, 14:30" · `time` "14:30" ·
 * `weekdayTime` "Tue 14:30" · `monthDay` "29 Sept" (this year's dates in a
 * dense list) · `full` "Tuesday 29 September 2026 at 14:30" (a tooltip that
 * spells everything out). The words and order are the locale's.
 */
export type DateTimeStyle = 'date' | 'datetime' | 'time' | 'weekdayTime' | 'monthDay' | 'full';

export interface FormatDateTimeOptions {
  readonly locale: string;
  readonly timeZone: string;
  readonly style?: DateTimeStyle;
}

const dateTimeStyles: Record<DateTimeStyle, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
  weekdayTime: { weekday: 'short', hour: 'numeric', minute: '2-digit' },
  monthDay: { month: 'short', day: 'numeric' },
  full: { dateStyle: 'full', timeStyle: 'short' },
};

/** A timestamp as the API sends it (ISO 8601), or already a `Date` or epoch milliseconds. */
export type DateInput = string | number | Date;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asText(value: DateInput): string {
  return String(value);
}

export function formatDateTime(value: DateInput, { locale, timeZone, style = 'datetime' }: FormatDateTimeOptions): string {
  const date = toDate(value);
  if (!date) return asText(value);
  const format =
    dateTimeFormat(locale, { ...dateTimeStyles[style], timeZone }) ??
    // An unknown zone: the reader's zone is lost, but the moment is not — say it in UTC.
    dateTimeFormat(locale, { ...dateTimeStyles[style], timeZone: 'UTC' }) ??
    dateTimeFormat(undefined, { ...dateTimeStyles[style], timeZone: 'UTC' });
  return format ? format.format(date) : date.toISOString();
}

/** A moment's calendar date where the reader is (UTC without a zone): year, month (1–12), day. */
function calendarDate(date: Date, timeZone: string | undefined): { year: number; month: number; day: number } | null {
  if (!timeZone) return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  const format = dateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  if (!format) return null;
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const result = { year: part('year'), month: part('month'), day: part('day') };
  return Number.isFinite(result.year + result.month + result.day) ? result : null;
}

/** Whole calendar days from `from` to `to` in a zone. */
function calendarDays(from: Date, to: Date, timeZone: string): number | null {
  const a = calendarDate(from, timeZone);
  const b = calendarDate(to, timeZone);
  if (!a || !b) return null;
  return (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000;
}

/** Whole calendar months from `from` to `to`: a month is complete when the day of the month comes round again. */
function calendarMonths(from: Date, to: Date, timeZone: string | undefined): number | null {
  const a = calendarDate(from, timeZone);
  const b = calendarDate(to, timeZone);
  if (!a || !b) return null;
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months > 0 && b.day < a.day) months -= 1;
  if (months < 0 && b.day > a.day) months += 1;
  return months;
}

export interface FormatRelativeOptions {
  /**
   * The reader's zone. With it, "yesterday" means the calendar day before
   * today where the reader is, not "24 to 48 hours ago" — at half past
   * midnight, eleven o'clock last night is yesterday, and 25 hours ago is
   * two days ago.
   */
  readonly timeZone?: string;
  /** `long` "3 minutes ago" (default) · `short` "3 min ago" · `narrow`. */
  readonly style?: Intl.RelativeTimeFormatStyle;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 minutes ago", "in 2 days", "yesterday", "now". `now` is the caller's, so
 * it can be the provider's shared clock, and so a server render (which should
 * not show relative time at all) cannot drift from the client's.
 *
 * Whole units, rounded towards zero: 59 minutes is "59 minutes ago", never
 * "1 hour ago", and 23 hours is never "24 hours ago". Under a minute is "now".
 */
export function formatRelative(value: DateInput, now: number | Date, locale: string, options: FormatRelativeOptions = {}): string {
  const date = toDate(value);
  if (!date) return asText(value);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const seconds = (date.getTime() - nowMs) / 1000;
  const span = Math.abs(seconds);
  const sign = seconds < 0 ? -1 : 1;

  let amount: number;
  let unit: Intl.RelativeTimeFormatUnit;
  if (span < MINUTE) {
    amount = 0;
    unit = 'second';
  } else if (span < HOUR) {
    amount = sign * Math.floor(span / MINUTE);
    unit = 'minute';
  } else if (span < DAY) {
    amount = sign * Math.floor(span / HOUR);
    unit = 'hour';
  } else {
    const nowDate = new Date(nowMs);
    const days = (options.timeZone ? calendarDays(nowDate, date, options.timeZone) : null) ?? sign * Math.floor(span / DAY);
    const absDays = Math.abs(days);
    const months = absDays < 28 ? 0 : (calendarMonths(nowDate, date, options.timeZone) ?? Math.trunc(days / 30.44));
    if (absDays < 7) {
      amount = days;
      unit = 'day';
    } else if (absDays < 28 || months === 0) {
      amount = Math.trunc(days / 7);
      unit = 'week';
    } else if (Math.abs(months) < 12) {
      amount = months;
      unit = 'month';
    } else {
      amount = Math.trunc(months / 12);
      unit = 'year';
    }
  }
  const style = options.style ?? 'long';
  const format = formatter('rt', locale, { style }, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style }));
  // `-0` would read "0 seconds ago" in some locales; plain zero is "now".
  return format ? format.format(amount === 0 ? 0 : amount, unit) : date.toISOString();
}

/* -------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------- */

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  readonly locale?: string;
}

function numberFormat(value: number, { locale, ...options }: FormatNumberOptions = {}): string {
  const format = numberFormatter(locale, options) ?? numberFormatter(undefined, options);
  return format ? format.format(value) : String(value);
}

export function formatNumber(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, options);
}

/** "1.2k" (the locale's abbreviation). For stat cards and chart axes, never for a count someone acts on. */
export function formatCompact(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, { maximumFractionDigits: 1, ...options, notation: 'compact' });
}

/** A ratio (0..1) as a percentage: `0.42` → "42%". */
export function formatPercent(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, { maximumFractionDigits: 0, ...options, style: 'percent' });
}

/** Which form of a noun a count takes in the locale ("1 ticket", "0 tickets"). */
function pluralOf(n: number, noun: Plural, locale: string | undefined): string {
  const rules = formatter('pr', locale, {}, () => new Intl.PluralRules(locale));
  return (rules?.select(n) ?? (n === 1 ? 'one' : 'other')) === 'one' ? noun.one : noun.other;
}

/**
 * A list caption. List endpoints have no totals (D13), so a page that has
 * more says so rather than inventing a number: "Showing 100 · more available".
 * A complete list states its size: "3 tickets", "1 ticket".
 */
export function formatCount(n: number, hasMore: boolean, noun: Plural, locale?: string): string {
  const shown = numberFormat(n, { locale });
  if (hasMore) return `Showing ${shown} · more available`;
  return `${shown} ${pluralOf(n, noun, locale)}`;
}

/**
 * A badge count: "99+" past 99, and "12+" when the source itself was capped
 * at 12 (a list that said "more available"). Badges never show a guess.
 */
export function formatBadgeCount(n: number, capped = false, locale?: string): string {
  if (n > 99) return '99+';
  const shown = numberFormat(Math.max(0, Math.trunc(n)), { locale });
  return capped ? `${shown}+` : shown;
}

export interface FormatListOptions {
  readonly locale?: string;
  readonly type?: 'conjunction' | 'disjunction' | 'unit';
  readonly style?: 'long' | 'short' | 'narrow';
}

/** "Open, Paused and Resolved" (en-GB has no serial comma). */
export function formatList(items: readonly string[], { locale, type = 'conjunction', style = 'long' }: FormatListOptions = {}): string {
  const format = formatter('lf', locale, { type, style }, () => new Intl.ListFormat(locale, { type, style }));
  return format ? format.format(items) : items.join(', ');
}

const byteUnits = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** "1.4 MB". Decimal units, as file managers on every platform the product runs on show them. */
export function formatBytes(bytes: number, options: { readonly locale?: string } = {}): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  let unit = 0;
  while (value >= 1000 && unit < byteUnits.length - 1) {
    value /= 1000;
    unit++;
  }
  return numberFormat(value, {
    locale: options.locale,
    style: 'unit',
    unit: byteUnits[unit],
    // "999 bytes", not the abbreviation-less "999 byte" the short form gives.
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });
}
