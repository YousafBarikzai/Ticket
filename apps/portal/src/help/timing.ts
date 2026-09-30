import { formatDateTime } from '@itsm/ui/format';

/**
 * "We aim to reply by 14:30 today" (SPEC §6.3): the first-response target as
 * a person reads a promise — the time, and the day in words while it is
 * close. Always in their own zone, never the server's.
 *
 * Kept out of `model.ts` because the formatter's module shares an entry with
 * a client component; this file is only imported by client code.
 */

/** A moment's calendar day in a zone, as a comparable number (days since the epoch). */
function dayNumber(date: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((entry) => entry.type === type)?.value);
    const value = Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * `14:30 today` · `09:00 tomorrow` · `Thu 14:00` within the week ·
 * `3 Oct 2026, 14:00` beyond it. A moment already past reads as its time
 * today (the flow shows it seconds after creation; a past target is the
 * desk's to explain, not this sentence's).
 */
export function replyByPhrase(dueAt: string, now: Date, locale: string, timeZone: string): string | null {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const from = dayNumber(now, timeZone);
  const to = dayNumber(due, timeZone);
  const days = from === null || to === null ? null : to - from;
  if (days !== null && days <= 0) return `${formatDateTime(due, { locale, timeZone, style: 'time' })} today`;
  if (days === 1) return `${formatDateTime(due, { locale, timeZone, style: 'time' })} tomorrow`;
  if (days !== null && days < 7) return formatDateTime(due, { locale, timeZone, style: 'weekdayTime' });
  return formatDateTime(due, { locale, timeZone, style: 'datetime' });
}
