/**
 * The arithmetic of time and money, kept pure so it can be pinned.
 */

export const ENTRY_KINDS = ['manual', 'timer', 'automatic'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const PERIOD_KINDS = ['month', 'quarter', 'year'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** The cost of some minutes at an hourly rate, to the penny. */
export function costOf(minutes: number, ratePerHour: number): number {
  if (minutes <= 0 || ratePerHour <= 0) return 0;
  return Math.round((minutes / 60) * ratePerHour * 100) / 100;
}

/** Whole minutes between two instants, never negative, never zero for a real interval. */
export function minutesBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * A timer left running is not that many hours of work. Twelve hours is the
 * longest a stop is believed; beyond that the entry is capped and says so.
 */
export const TIMER_CAP_MINUTES = 12 * 60;

export interface Period {
  start: Date;
  end: Date;
}

/** The calendar period an instant falls in, UTC, end exclusive. */
export function periodFor(kind: PeriodKind, at: Date): Period {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  switch (kind) {
    case 'month':
      return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
    case 'quarter': {
      const first = Math.floor(month / 3) * 3;
      return { start: new Date(Date.UTC(year, first, 1)), end: new Date(Date.UTC(year, first + 3, 1)) };
    }
    case 'year':
      return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
}

/**
 * Which lines a change in spend crosses, upwards. Called with the totals
 * before and after, so a single entry that jumps from 70 % to 105 % reports
 * both — and a decrement reports none, because crossing back down is not news.
 */
export function thresholdsCrossed(before: number, after: number, amount: number, warnAt: number): (80 | 100)[] {
  if (amount <= 0 || after <= before) return [];
  const crossed: (80 | 100)[] = [];
  const warnLine = (amount * warnAt) / 100;
  if (before < warnLine && after >= warnLine) crossed.push(80);
  if (before < amount && after >= amount) crossed.push(100);
  return crossed;
}
