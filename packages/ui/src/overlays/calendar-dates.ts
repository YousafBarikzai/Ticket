/**
 * Calendar dates, for the date pickers.
 *
 * Everything is computed in UTC and exchanged as an ISO calendar date
 * (`yyyy-mm-dd`). A local-time `Date` shifts by a day either side of midnight
 * for people east or west of the server, which is how "due tomorrow" tickets
 * end up breaching a day early.
 *
 * Typed dates are read the way the person's locale writes them — `14/03/2026`
 * in en-GB, `3/14/2026` in en-US, `14 Mar 2026` or `Mar 14, 2026` in either —
 * and ISO always works. No date library: `Intl` knows the order of the parts
 * and the month names, which is all parsing needs (SPEC §2 rejects date
 * libraries).
 */

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return makeDate(Number(year), Number(month), Number(day));
}

export function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** A UTC date from calendar parts, or null when they are not a real day (31 April). */
export function makeDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  return a !== null && b !== null && a.getTime() === b.getTime();
}

type Part = 'day' | 'month' | 'year';

const orderCache = new Map<string, readonly Part[]>();

/** The order a locale writes day, month and year in: en-GB day-month-year, en-US month-day-year, ISO-style year first. */
export function dateOrder(locale: string): readonly Part[] {
  const cached = orderCache.get(locale);
  if (cached) return cached;
  let order: Part[] = ['day', 'month', 'year'];
  try {
    order = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2026, 10, 23)))
      .map((part) => part.type)
      .filter((type): type is Part => type === 'day' || type === 'month' || type === 'year');
  } catch {
    // An unknown locale reads as day-month-year.
  }
  if (order.length !== 3) order = ['day', 'month', 'year'];
  orderCache.set(locale, order);
  return order;
}

/** "dd/mm/yyyy" for en-GB, "mm/dd/yyyy" for en-US: the shape to type, as a placeholder. */
export function datePattern(locale: string): string {
  const names: Record<Part, string> = { day: 'dd', month: 'mm', year: 'yyyy' };
  return dateOrder(locale)
    .map((part) => names[part])
    .join('/');
}

const monthCache = new Map<string, ReadonlyMap<string, number>>();

/** Month names and abbreviations in the locale and in English, lower-cased and without full stops, to month numbers. */
function monthNames(locale: string): ReadonlyMap<string, number> {
  const cached = monthCache.get(locale);
  if (cached) return cached;
  const names = new Map<string, number>();
  for (const tag of [locale, 'en-GB']) {
    for (const style of ['long', 'short'] as const) {
      try {
        const format = new Intl.DateTimeFormat(tag, { month: style, timeZone: 'UTC' });
        for (let month = 1; month <= 12; month += 1) {
          const name = format.format(new Date(Date.UTC(2026, month - 1, 1))).toLowerCase().replace(/\./g, '');
          if (name && !names.has(name)) names.set(name, month);
        }
      } catch {
        // Skip a locale the runtime does not know.
      }
    }
  }
  // "Sept" as well as "Sep".
  if (!names.has('sept')) names.set('sept', 9);
  monthCache.set(locale, names);
  return names;
}

function fullYear(text: string, reference: Date): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(text)) return null;
  const value = Number(text);
  if (text.length === 4) return value;
  // Two digits: the nearest such year within a century window around today.
  const century = Math.floor(reference.getUTCFullYear() / 100) * 100;
  const candidate = century + value;
  return candidate > reference.getUTCFullYear() + 50 ? candidate - 100 : candidate;
}

/**
 * Reads a typed date in the locale's way of writing one, or ISO. A day and
 * month without a year mean this year. Returns null for anything that is
 * not one real calendar day — never a guess.
 */
export function parseLocaleDate(text: string, locale: string, reference: Date = todayUtc()): Date | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const iso = parseIsoDate(trimmed);
  if (iso) return iso;

  const tokens = trimmed
    .toLowerCase()
    .replace(/\./g, ' ')
    .split(/[\s/,\-]+/)
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;

  const names = monthNames(locale);
  const named = tokens.findIndex((token) => !/^\d+$/.test(token));
  if (named === -1) {
    // A four-digit first part is year-first whatever the locale ("2026/03/14").
    const order: readonly Part[] =
      tokens.length === 3 && tokens[0]!.length === 4 ? ['year', 'month', 'day'] : dateOrder(locale).filter((part) => tokens.length === 3 || part !== 'year');
    const parts: Partial<Record<Part, string>> = {};
    order.forEach((part, index) => {
      parts[part] = tokens[index];
    });
    const year = parts.year === undefined ? reference.getUTCFullYear() : fullYear(parts.year, reference);
    if (year === null || !/^\d{1,2}$/.test(parts.day ?? '') || !/^\d{1,2}$/.test(parts.month ?? '')) return null;
    return makeDate(year, Number(parts.month), Number(parts.day));
  }

  // A month name, a day and perhaps a year, in whatever order they came.
  if (tokens.filter((token) => !/^\d+$/.test(token)).length !== 1) return null;
  const month = names.get(tokens[named]!);
  if (month === undefined) return null;
  const numbers = tokens.filter((_, index) => index !== named);
  let day: string | undefined;
  let year: string | undefined;
  for (const number of numbers) {
    if (number.length === 4 || (day !== undefined && year === undefined)) year = number;
    else day = number;
  }
  if (day === undefined || !/^\d{1,2}$/.test(day)) return null;
  const resolvedYear = year === undefined ? reference.getUTCFullYear() : fullYear(year, reference);
  if (resolvedYear === null) return null;
  return makeDate(resolvedYear, month, Number(day));
}

/** How a date is shown in a field: the locale's medium style, "14 Mar 2026" or "Mar 14, 2026". */
export function formatLocaleDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  } catch {
    return formatIsoDate(date);
  }
}

/** An ISO value as field text; the empty string for none. */
export function displayIsoDate(value: string | null | undefined, locale: string): string {
  const date = parseIsoDate(value);
  return date ? formatLocaleDate(date, locale) : '';
}
