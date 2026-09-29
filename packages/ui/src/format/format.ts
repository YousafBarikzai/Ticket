/**
 * `Intl` formatting for dates, numbers, counts and lists.
 *
 * Server-safe and pure: a server component calls these with the signed-in
 * person's `locale` and `timeZone` passed explicitly, because the server's own
 * zone is not the reader's. Nothing here reads the clock except where the
 * caller passes `now`, so a server render and the hydrating client agree.
 *
 * Stub (SPEC §4.1): the signatures are the contract; the bodies are plain
 * first versions that the foundations package replaces and tests (locale,
 * time zone, counts). They never throw — an unparseable date comes back as
 * the text it was given, which is better on a page than an error boundary.
 */
import type { Plural } from '../types.js';

export type DateTimeStyle = 'date' | 'datetime' | 'time' | 'weekdayTime';

export interface FormatDateTimeOptions {
  readonly locale: string;
  readonly timeZone: string;
  readonly style?: DateTimeStyle;
}

const dateTimeStyles: Record<DateTimeStyle, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: 'medium' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
  weekdayTime: { weekday: 'short', hour: '2-digit', minute: '2-digit' },
};

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(iso: string, { locale, timeZone, style = 'datetime' }: FormatDateTimeOptions): string {
  const date = toDate(iso);
  if (!date) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { ...dateTimeStyles[style], timeZone }).format(date);
  } catch {
    return iso;
  }
}

const relativeUnits: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/** "3 minutes ago", "in 2 days". `now` is the caller's, so it can be the provider's shared clock. */
export function formatRelative(iso: string, now: number | Date, locale: string): string {
  const date = toDate(iso);
  if (!date) return iso;
  const seconds = Math.round((date.getTime() - (typeof now === 'number' ? now : now.getTime())) / 1000);
  const [unit, size] = relativeUnits.find(([, span]) => Math.abs(seconds) >= span) ?? ['second', 1];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
  } catch {
    return iso;
  }
}

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  readonly locale?: string;
}

function numberFormat(value: number, { locale, ...options }: FormatNumberOptions = {}): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

export function formatNumber(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, options);
}

/** "1.2K". For stat cards and chart axes, never for a count someone acts on. */
export function formatCompact(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, { maximumFractionDigits: 1, ...options, notation: 'compact' });
}

/** A ratio (0..1) as a percentage. */
export function formatPercent(value: number, options?: FormatNumberOptions): string {
  return numberFormat(value, { maximumFractionDigits: 0, ...options, style: 'percent' });
}

/**
 * A list caption. List endpoints have no totals (D13), so a page that has
 * more says so rather than inventing a number: "Showing 100 · more available".
 */
export function formatCount(n: number, hasMore: boolean, noun: Plural, locale?: string): string {
  const shown = numberFormat(n, { locale });
  if (hasMore) return `Showing ${shown} · more available`;
  return `${shown} ${n === 1 ? noun.one : noun.other}`;
}

/** A badge count: "99+" past 99, and "12+" when the source itself was capped at 12. */
export function formatBadgeCount(n: number, capped = false): string {
  if (n > 99) return '99+';
  return capped ? `${n}+` : String(n);
}

export interface FormatListOptions {
  readonly locale?: string;
  readonly type?: 'conjunction' | 'disjunction' | 'unit';
}

/** "Open, Paused and Resolved". */
export function formatList(items: readonly string[], { locale, type = 'conjunction' }: FormatListOptions = {}): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
  } catch {
    return items.join(', ');
  }
}

const byteUnits = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** "1.4 MB". Decimal units, as file managers on every platform the product runs on show them. */
export function formatBytes(bytes: number, options: { readonly locale?: string } = {}): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < byteUnits.length - 1) {
    value /= 1000;
    unit++;
  }
  return numberFormat(value, {
    locale: options.locale,
    style: 'unit',
    unit: byteUnits[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });
}
