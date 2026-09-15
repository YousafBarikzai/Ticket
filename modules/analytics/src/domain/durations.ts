import { TWENTY_FOUR_SEVEN, elapsedBusinessMs, type BusinessCalendar } from '@itsm/business-time';

/**
 * Durations, computed once at projection and stored.
 *
 * The rule doc 06 §6 sets, and the reason for it: a dashboard must never
 * recompute a calendar. Doing so would need every calendar and every exception
 * in scope for the whole period being charted, and — worse — the same figure
 * would change when somebody edited an opening hour last March. A resolution
 * time is a fact about what happened, so it is fixed when it happens.
 *
 * Both numbers are kept, because both get asked for and they answer different
 * questions. Business minutes are what an SLA was measured against. Elapsed
 * minutes are what the requester actually waited, and a report that only shows
 * the first is a report that quietly disagrees with everybody's experience.
 */

const MS_PER_MINUTE = 60_000;

export interface Durations {
  businessMinutes: number;
  elapsedMinutes: number;
}

/**
 * Minutes between two instants, both ways of counting.
 *
 * A negative interval returns zero rather than a negative duration. Clocks and
 * corrections do produce them — a resolution timestamped a second before the
 * creation it belongs to — and "resolved in minus four minutes" in a chart is
 * a support ticket about the reporting module.
 */
export function durationsBetween(from: Date, to: Date, calendar: BusinessCalendar = TWENTY_FOUR_SEVEN): Durations {
  const elapsedMs = to.getTime() - from.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return { businessMinutes: 0, elapsedMinutes: 0 };
  }

  return {
    businessMinutes: Math.round(elapsedBusinessMs(from, to, calendar) / MS_PER_MINUTE),
    elapsedMinutes: Math.round(elapsedMs / MS_PER_MINUTE),
  };
}

/**
 * The margin against a due time: negative early, positive late.
 *
 * Deliberately a signed number rather than a met/breached flag. "Breached" says
 * a target was missed; "breached by six minutes" and "breached by four days"
 * are different conversations, and only one of them is about the target being
 * wrong.
 */
export function marginMinutes(dueAt: Date | null, stoppedAt: Date | null): number | null {
  if (!dueAt || !stoppedAt) return null;
  return Math.round((stoppedAt.getTime() - dueAt.getTime()) / MS_PER_MINUTE);
}

/** The UTC calendar date a fact belongs to, for the date dimension. */
export function dateKey(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/**
 * ISO week and its year.
 *
 * Its own function because the year is the trap: 1 January can belong to week
 * 52 of the previous ISO year, so a "last 12 weeks" report keyed on the
 * calendar year loses a week every few years and nobody notices until a
 * year-end number is short.
 */
export function isoWeek(date: Date): { week: number; year: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks run Monday to Sunday and are numbered by the Thursday they
  // contain, which is what this shift finds.
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const isoYear = target.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { week, year: isoYear };
}
