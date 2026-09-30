import { formatDateTime } from '../format/format.js';

/**
 * Day grouping for the timeline and the activity feed. Server-safe.
 *
 * Days are the reader's days: a comment at 23:30 in London and one at 00:10
 * belong under different headings even though they are forty minutes apart,
 * and which calendar day an instant falls on depends on the zone. So both the
 * key and the heading take the provider's time zone, never the machine's.
 */

const keyFormats = new Map<string, Intl.DateTimeFormat | null>();

function keyFormat(timeZone: string): Intl.DateTimeFormat | null {
  let format = keyFormats.get(timeZone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      // An unknown zone: the caller falls back to UTC.
      format = null;
    }
    keyFormats.set(timeZone, format);
  }
  return format;
}

/**
 * The calendar day an instant falls on in `timeZone`, as `YYYY-MM-DD`
 * (`en-CA` spells dates that way), or `null` for a value that is not a date.
 */
export function dayKey(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const format = keyFormat(timeZone) ?? keyFormat('UTC');
  return format ? format.format(date) : date.toISOString().slice(0, 10);
}

/** Whole days from the day `a` to the day `b` (both `YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function capitalise(text: string, locale: string): string {
  const [first = ''] = Array.from(text);
  return first.toLocaleUpperCase(locale) + text.slice(first.length);
}

const relativeDays = new Map<string, Intl.RelativeTimeFormat | null>();

function relativeDay(locale: string, days: number): string | null {
  let format = relativeDays.get(locale);
  if (format === undefined) {
    try {
      format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    } catch {
      format = null;
    }
    relativeDays.set(locale, format);
  }
  return format ? capitalise(format.format(days, 'day'), locale) : null;
}

function formatted(value: string, locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(value));
  } catch {
    return formatDateTime(value, { locale, timeZone, style: 'date' });
  }
}

/**
 * The heading for a day group.
 *
 * With no clock — on the server, and during hydration — it is the date with
 * its weekday and year ("Mon, 28 Sept 2026" in en-GB): the HTML cannot know what
 * "today" is for the reader, and the first client render must match it. Once
 * the clock is known it reads the way a conversation does: "Today",
 * "Yesterday", then "Mon, 28 Sept" within the year and the full date before
 * it. The words and their order are the locale's.
 */
export function dayHeading(value: string, now: number | null, locale: string, timeZone: string): string {
  const withYear: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  if (now === null) return formatted(value, locale, timeZone, withYear);
  const day = dayKey(value, timeZone);
  const today = dayKey(new Date(now).toISOString(), timeZone);
  if (!day || !today) return formatted(value, locale, timeZone, withYear);
  const offset = daysBetween(today, day);
  if (offset === 0 || offset === -1) {
    const words = relativeDay(locale, offset);
    if (words) return words;
  }
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatted(value, locale, timeZone, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : withYear);
}
