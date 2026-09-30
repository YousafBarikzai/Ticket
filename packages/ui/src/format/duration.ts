/**
 * Durations in minutes: shown as "4 h 15 min", typed as "4h", "2d 3h", "90m"
 * or "90".
 *
 * Minutes because that is the unit every SLA target and business-time
 * calculation in the API already uses. Hand-rolled from
 * `Intl.NumberFormat({ style: 'unit' })` and `Intl.ListFormat` rather than
 * `Intl.DurationFormat`, which Node 22 (the server renderer) and some of the
 * browsers the product supports do not have.
 *
 * Server-safe and pure, like `format.ts`.
 */

export type DurationUnit = 'd' | 'h' | 'm';

export interface FormatDurationOptions {
  /** `short` "4 h 15 min" (default) · `long` "4 hours 15 minutes". */
  readonly style?: 'short' | 'long';
  readonly locale?: string;
  /**
   * The units to write in, largest first. `['h', 'm']` writes a day and a
   * half as "36 h", which is how an SLA target in business hours reads.
   */
  readonly units?: readonly DurationUnit[];
  /**
   * At most this many adjacent units, the last one rounded: 2 writes 2 days,
   * 4 hours and 13 minutes as "2 d 4 h". Unlimited by default.
   */
  readonly maxParts?: number;
}

const MINUTES: Readonly<Record<DurationUnit, number>> = { d: 24 * 60, h: 60, m: 1 };
const ORDER: readonly DurationUnit[] = ['d', 'h', 'm'];
const INTL_UNIT: Readonly<Record<DurationUnit, string>> = { d: 'day', h: 'hour', m: 'minute' };

/**
 * The compact English symbols SPEC §4.1 writes durations in ("4 h 15 min").
 * `Intl`'s own short English units ("4 hr", "15 mins") differ between en-GB
 * and en-US and read heavier in a dense table, so English is spelled here and
 * every other language gets its own short units from `Intl`.
 */
const ENGLISH_SHORT: Readonly<Record<DurationUnit, string>> = { d: 'd', h: 'h', m: 'min' };

function isEnglish(locale: string | undefined): boolean {
  return locale === undefined || /^en(?:-|$)/i.test(locale);
}

const cache = new Map<string, Intl.NumberFormat | Intl.ListFormat | null>();

function cached<T extends Intl.NumberFormat | Intl.ListFormat>(key: string, create: () => T): T | null {
  if (!cache.has(key)) {
    let value: T | null = null;
    try {
      value = create();
    } catch {
      value = null;
    }
    if (cache.size > 64) cache.clear();
    cache.set(key, value);
  }
  return cache.get(key) as T | null;
}

function part(amount: number, unit: DurationUnit, style: 'short' | 'long', locale: string | undefined): string {
  if (style === 'short' && isEnglish(locale)) {
    const number = cached(`n|${locale ?? ''}`, () => new Intl.NumberFormat(locale));
    return `${number ? number.format(amount) : amount} ${ENGLISH_SHORT[unit]}`;
  }
  const format = cached(
    `u|${locale ?? ''}|${unit}|${style}`,
    () => new Intl.NumberFormat(locale, { style: 'unit', unit: INTL_UNIT[unit], unitDisplay: style }),
  );
  if (format) return format.format(amount);
  return `${amount} ${style === 'long' ? `${INTL_UNIT[unit]}${amount === 1 ? '' : 's'}` : ENGLISH_SHORT[unit]}`;
}

/**
 * Minutes as words: `255` → "4 h 15 min", `1500` → "1 d 1 h", `0` → "0 min".
 * Zero parts are left out, so an hour is "1 h", not "1 h 0 min". Negative
 * input reads as zero — an overdue SLA says "overdue by" and passes the
 * magnitude.
 */
export function formatDuration(minutes: number, options: FormatDurationOptions = {}): string {
  const { style = 'short', locale, maxParts } = options;
  const allowed = ORDER.filter((unit) => (options.units ?? ORDER).includes(unit));
  const units = allowed.length > 0 ? allowed : ORDER;
  let total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;

  // The window of units to write in: from the largest that the total reaches,
  // at most `maxParts` of them. The total is rounded to the window's smallest
  // unit first, so a carry ("1 d 23 h 50 min" at two parts) lands as "2 d".
  let first = units.findIndex((unit) => total >= MINUTES[unit]);
  if (first < 0) first = units.length - 1;
  const window = units.slice(first, maxParts && maxParts > 0 ? first + maxParts : undefined);
  const smallest = MINUTES[window[window.length - 1]!];
  total = Math.round(total / smallest) * smallest;

  const parts: string[] = [];
  let remaining = total;
  for (const unit of window) {
    const amount = Math.floor(remaining / MINUTES[unit]);
    remaining -= amount * MINUTES[unit];
    if (amount > 0) parts.push(part(amount, unit, style, locale));
  }
  if (parts.length === 0) parts.push(part(0, window[window.length - 1]!, style, locale));

  // `unit` lists join without "and" in English ("4 h 15 min"); other languages
  // get their own joiner.
  const list = cached(`l|${locale ?? ''}`, () => new Intl.ListFormat(locale, { type: 'unit', style: 'narrow' })) as
    | Intl.ListFormat
    | null;
  return list ? list.format(parts) : parts.join(' ');
}

export interface ParseDurationOptions {
  /** What a bare number means. Minutes by default, as SPEC §4.1 has it: "90" is 90 minutes. */
  readonly defaultUnit?: DurationUnit;
}

const UNIT_WORDS: Readonly<Record<string, DurationUnit>> = {
  d: 'd',
  day: 'd',
  days: 'd',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
};

/** A number with `.` or `,` as its decimal mark (people type "1,5h" in much of Europe). */
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
/** One `<number><unit>` term, and whatever separates it from the next: spaces, a comma, "and". */
const TERM = new RegExp(String.raw`(${NUMBER})\s*([a-z]+)\s*(?:,\s*|and\s+)?`, 'y');

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

/**
 * Minutes from what a person typed, or `null` when it is not a duration.
 *
 * Reads "90" (minutes, or `defaultUnit`), "90m", "4h", "4 hours", "1.5h",
 * "1,5 h", "2d 3h", "2d3h", "1 day, 2 hours and 30 minutes" and "1:30" (hours
 * and minutes). Each unit at most once. Refuses anything else rather than
 * guessing — "3 months" and "2d3" are `null`.
 *
 * Zero and negative values are not refused here: "that is not a duration"
 * and "a duration must be at least a minute" are different messages, and the
 * field gives the second in words.
 */
export function parseDuration(text: string, options: ParseDurationOptions = {}): number | null {
  let input = text.trim().toLowerCase();
  if (input === '') return null;
  let sign = 1;
  if (/^[-−]/.test(input)) {
    sign = -1;
    input = input.slice(1).trim();
  }

  if (new RegExp(`^${NUMBER}$`).test(input)) {
    return sign * Math.round(toNumber(input) * MINUTES[options.defaultUnit ?? 'm']);
  }

  const clock = /^(\d+):([0-5]\d)$/.exec(input);
  if (clock) return sign * (Number(clock[1]) * 60 + Number(clock[2]));

  const seen = new Set<DurationUnit>();
  let total = 0;
  let index = 0;
  while (index < input.length) {
    TERM.lastIndex = index;
    const match = TERM.exec(input);
    if (!match) return null;
    const unit = UNIT_WORDS[match[2]!];
    if (!unit || seen.has(unit)) return null;
    seen.add(unit);
    total += toNumber(match[1]!) * MINUTES[unit];
    index = TERM.lastIndex;
  }
  return seen.size === 0 ? null : sign * Math.round(total);
}
