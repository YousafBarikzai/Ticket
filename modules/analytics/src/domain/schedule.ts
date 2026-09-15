import { localParts, wallToUtc } from '@itsm/business-time';
import { ValidationError } from '@itsm/platform';
import { z } from 'zod';

/**
 * When a scheduled report next runs.
 *
 * A structured schedule — frequency, a wall-clock time and a zone — rather than
 * a cron expression. "Every Monday at 08:00 London time" is what a person
 * means; a cron string in UTC is what they would have to work out, and would
 * be an hour wrong for half the year. The zone maths is `wallToUtc`, which
 * already settles both daylight-saving transitions correctly and is tested for
 * them, so the same 08:00 arrives at 08:00 whatever the month.
 */

export const scheduleSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
    /** 0 = Sunday … 6 = Saturday. */
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    /** 1–28, so every month has the day and nothing is silently skipped. */
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    timeZone: z.string().min(1).max(60),
  })
  .superRefine((value, issues) => {
    if (value.frequency === 'weekly' && value.dayOfWeek === undefined) {
      issues.addIssue({ code: 'custom', path: ['dayOfWeek'], message: 'a weekly schedule needs a day of the week' });
    }
    if (value.frequency === 'monthly' && value.dayOfMonth === undefined) {
      issues.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'a monthly schedule needs a day of the month' });
    }
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: value.timeZone });
    } catch {
      issues.addIssue({ code: 'custom', path: ['timeZone'], message: `unknown time zone ${value.timeZone}` });
    }
  });

export type Schedule = z.infer<typeof scheduleSchema>;

const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * The first firing strictly after `after`.
 *
 * Walks forward a day at a time in the schedule's own zone and returns the
 * first local date that matches, converted to the instant. Bounded: a schedule
 * that could never match is a bug in this file, not a loop for the worker.
 */
export function nextRunAfter(schedule: Schedule, after: Date): Date {
  const start = localParts(after, schedule.timeZone);
  let year = start.year;
  let month = start.month;
  let day = start.day;

  for (let step = 0; step < 62; step += 1) {
    if (matchesDay(schedule, year, month, day)) {
      const candidate = wallToUtc(year, month, day, schedule.hour, schedule.minute, schedule.timeZone);
      if (candidate > after) return candidate;
    }
    ({ year, month, day } = nextDay(year, month, day));
  }

  throw new ValidationError('the schedule never fires');
}

function matchesDay(schedule: Schedule, year: number, month: number, day: number): boolean {
  switch (schedule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === schedule.dayOfWeek;
    case 'monthly':
      return day === schedule.dayOfMonth;
  }
}

function nextDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/**
 * What a run covers: the whole of the previous period, in the schedule's zone.
 *
 * A daily report at 08:00 covers yesterday, not "the 24 hours before 08:00" —
 * the numbers must line up with the calendar people look at. Weekly covers
 * the previous seven days ending at midnight; monthly the previous calendar
 * month.
 */
export function periodFor(schedule: Schedule, firedAt: Date): { from: Date; to: Date } {
  const local = localParts(firedAt, schedule.timeZone);
  const midnight = wallToUtc(local.year, local.month, local.day, 0, 0, schedule.timeZone);

  switch (schedule.frequency) {
    case 'daily': {
      const previous = nextDayBack(local.year, local.month, local.day, 1);
      return { from: wallToUtc(previous.year, previous.month, previous.day, 0, 0, schedule.timeZone), to: midnight };
    }
    case 'weekly': {
      const previous = nextDayBack(local.year, local.month, local.day, 7);
      return { from: wallToUtc(previous.year, previous.month, previous.day, 0, 0, schedule.timeZone), to: midnight };
    }
    case 'monthly': {
      const thisMonth = wallToUtc(local.year, local.month, 1, 0, 0, schedule.timeZone);
      const lastMonth = local.month === 1 ? { year: local.year - 1, month: 12 } : { year: local.year, month: local.month - 1 };
      return { from: wallToUtc(lastMonth.year, lastMonth.month, 1, 0, 0, schedule.timeZone), to: thisMonth };
    }
  }
}

function nextDayBack(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const back = new Date(Date.UTC(year, month - 1, day - days));
  return { year: back.getUTCFullYear(), month: back.getUTCMonth() + 1, day: back.getUTCDate() };
}

export { WEEKDAY_INDEX };
