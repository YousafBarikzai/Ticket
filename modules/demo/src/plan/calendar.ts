import {
  TWENTY_FOUR_SEVEN,
  dayIntervals,
  type BusinessCalendar,
  type Interval,
  type LocalParts,
  type WeeklyHours,
} from '@itsm/business-time';
import type { Priority } from '@itsm/contracts';
import type { BankHoliday } from './content-types.js';
import { DAY_MS, addDays, dateKeyOfDay, dayNumber, londonOffsetMs, type DateKey, type Instant, weekdayOf } from './time.js';

/**
 * The calendars the story runs on (A4 §1.7).
 *
 * `northwind-uk` is the product's UK office hours with England and Wales bank
 * holidays added; P1 runs around the clock on `24x7`. The planner realises
 * every SLA verdict with exactly the business-time maths MOD-07 uses
 * (`@itsm/business-time`), against exactly these calendars — which the
 * configuration parts create from `plan.calendars`, so the replay in the
 * database and the plan in memory read the same hours.
 */

/** The product's office hours (`modules/sla/src/seed/default-policy.ts` `OFFICE_HOURS`). */
export const OFFICE_HOURS: WeeklyHours = Object.freeze({
  mon: [{ start: '09:00', end: '17:30' }],
  tue: [{ start: '09:00', end: '17:30' }],
  wed: [{ start: '09:00', end: '17:30' }],
  thu: [{ start: '09:00', end: '17:30' }],
  fri: [{ start: '09:00', end: '17:00' }],
}) as WeeklyHours;

export const NORTHWIND_CALENDAR_KEY = 'northwind-uk';

/** The `northwind-uk` calendar: Europe/London office hours, bank holidays closed. */
export function northwindCalendar(holidays: readonly BankHoliday[]): BusinessCalendar {
  return {
    timeZone: 'Europe/London',
    hours: OFFICE_HOURS,
    exceptions: holidays.map((holiday) => ({ date: holiday.date, type: 'holiday' as const })),
  };
}

/** The demo's working calendar, with the date questions the planner asks of it. */
export class StoryCalendar {
  readonly business: BusinessCalendar;
  readonly allHours: BusinessCalendar = TWENTY_FOUR_SEVEN;
  private readonly holidays: ReadonlySet<DateKey>;
  private readonly monthEndCache = new Map<string, ReadonlySet<DateKey>>();

  readonly businessClock: BusinessClock;
  readonly allHoursClock: BusinessClock;

  constructor(holidays: readonly BankHoliday[]) {
    this.business = northwindCalendar(holidays);
    this.holidays = new Set(holidays.map((holiday) => holiday.date));
    this.businessClock = new BusinessClock(this.business);
    this.allHoursClock = new BusinessClock(TWENTY_FOUR_SEVEN);
  }

  /** The calendar a priority's SLA policy runs on: P1 around the clock, the rest office hours. */
  forPriority(priority: Priority): BusinessCalendar {
    return priority === 'P1' ? this.allHours : this.business;
  }

  isHoliday(key: DateKey): boolean {
    return this.holidays.has(key);
  }

  isBusinessDay(key: DateKey): boolean {
    const weekday = weekdayOf(key);
    return weekday !== 'sat' && weekday !== 'sun' && !this.holidays.has(key);
  }

  /** The last three business days of a date's month: month-end (A4 §1.10.2). */
  isMonthEnd(key: DateKey): boolean {
    const month = key.slice(0, 7);
    let days = this.monthEndCache.get(month);
    if (!days) {
      const found: DateKey[] = [];
      // Walk back from the month's last day.
      let cursor = lastDayOfMonth(key);
      while (found.length < 3 && cursor.slice(0, 7) === month) {
        if (this.isBusinessDay(cursor)) found.push(cursor);
        cursor = addDays(cursor, -1);
      }
      days = new Set(found);
      this.monthEndCache.set(month, days);
    }
    return days.has(key);
  }

  /** The `n`th business day before `key` (n ≥ 1). */
  businessDaysBefore(key: DateKey, n: number): DateKey {
    let cursor = key;
    let left = n;
    while (left > 0) {
      cursor = addDays(cursor, -1);
      if (this.isBusinessDay(cursor)) left -= 1;
    }
    return cursor;
  }

  /** The first business day on or after `key`. */
  businessDayOnOrAfter(key: DateKey): DateKey {
    let cursor = key;
    while (!this.isBusinessDay(cursor)) cursor = addDays(cursor, 1);
    return cursor;
  }

  /** The month-end blackout after `key`: the last two business days of the month (A4 §1.9.2). */
  nextBlackoutStart(key: DateKey): DateKey {
    let month = key.slice(0, 7);
    for (let guard = 0; guard < 3; guard += 1) {
      const last = lastDayOfMonth(`${month}-01`);
      let cursor = last;
      const days: DateKey[] = [];
      while (days.length < 2) {
        if (this.isBusinessDay(cursor)) days.push(cursor);
        cursor = addDays(cursor, -1);
      }
      const start = days[1] as DateKey;
      if (dayNumber(start) > dayNumber(key)) return start;
      month = addDays(last, 1).slice(0, 7);
    }
    throw new RangeError(`no blackout found after ${key}`);
  }

  /** The clock for a priority: business-time arithmetic on its calendar. */
  clockFor(priority: Priority): BusinessClock {
    return priority === 'P1' ? this.allHoursClock : this.businessClock;
  }
}

/**
 * `addBusinessMs` and `elapsedBusinessMs` from `@itsm/business-time`, with each
 * local day's open intervals worked out once. The planner asks a few hundred
 * thousand of these questions per plan, and recomputing every day's intervals
 * through `Intl` for each would make a plan take minutes. The answers are the
 * package's own: the intervals come from its `dayIntervals`, and the walk
 * below is its walk, step for step (`plan.test.ts` checks the two agree).
 */
export class BusinessClock {
  /** Each local day's open intervals as [start, end) epoch-millisecond pairs, by day number. */
  private readonly intervals = new Map<number, readonly (readonly [number, number])[]>();
  private readonly roundTheClock: boolean;
  private readonly london: boolean;

  constructor(readonly calendar: BusinessCalendar) {
    this.roundTheClock = calendar === TWENTY_FOUR_SEVEN;
    this.london = calendar.timeZone === 'Europe/London';
  }

  /** The open intervals of one local date (a day number) in the calendar's zone. */
  private day(dayNumber_: number): readonly (readonly [number, number])[] {
    let found = this.intervals.get(dayNumber_);
    if (!found) {
      const key = dateKeyOfDay(dayNumber_);
      const local: LocalParts = {
        year: Number(key.slice(0, 4)),
        month: Number(key.slice(5, 7)),
        day: Number(key.slice(8, 10)),
        hour: 12,
        minute: 0,
        second: 0,
        weekday: weekdayOf(key),
      };
      found = dayIntervals(this.calendar, local).map((interval: Interval) => [interval.start.getTime(), interval.end.getTime()] as const);
      this.intervals.set(dayNumber_, found);
    }
    return found;
  }

  /** The local day number of an instant in the calendar's zone. */
  private localDay(instant: Instant): number {
    const offset = this.london ? londonOffsetMs(instant) : 0;
    return Math.floor((instant + offset) / DAY_MS);
  }

  /** The instant `ms` business milliseconds after `from`; a closed `from` starts at the next opening. */
  add(from: Instant, ms: number): Instant {
    const duration = Math.max(0, ms);
    if (this.roundTheClock) return from + duration;
    let remaining = duration;
    let day = this.localDay(from - DAY_MS);
    for (let scanned = 0; scanned < 3650; scanned += 1, day += 1) {
      for (const [intervalStart, end] of this.day(day)) {
        if (end <= from) continue;
        const start = Math.max(intervalStart, from);
        const available = end - start;
        if (available <= 0) continue;
        if (remaining === 0) return start;
        if (available >= remaining) return start + remaining;
        remaining -= available;
      }
    }
    throw new RangeError('the calendar has no open time within ten years');
  }

  /**
   * The latest instant that lies `ms` business milliseconds before `to`: the
   * inverse of `add`, for placing a hero "due in 40 business minutes".
   */
  before(to: Instant, ms: number): Instant {
    const duration = Math.max(0, ms);
    if (duration === 0) return to;
    if (this.roundTheClock) return to - duration;
    let remaining = duration;
    let day = this.localDay(to + DAY_MS);
    for (let scanned = 0; scanned < 3650; scanned += 1, day -= 1) {
      const intervals = this.day(day);
      for (let i = intervals.length - 1; i >= 0; i -= 1) {
        const [start, intervalEnd] = intervals[i] as readonly [number, number];
        if (start >= to) continue;
        const end = Math.min(intervalEnd, to);
        const available = end - start;
        if (available <= 0) continue;
        if (available >= remaining) return end - remaining;
        remaining -= available;
      }
    }
    throw new RangeError('the calendar has no open time within ten years');
  }

  /** Business milliseconds between two instants; zero when `to` is not after `from`. */
  elapsed(from: Instant, to: Instant): number {
    if (to <= from) return 0;
    if (this.roundTheClock) return to - from;
    let total = 0;
    let day = this.localDay(from - DAY_MS);
    for (let scanned = 0; scanned < 3650; scanned += 1, day += 1) {
      for (const [start, intervalEnd] of this.day(day)) {
        if (start >= to) return total;
        const from_ = Math.max(start, from);
        const end = Math.min(intervalEnd, to);
        if (end > from_) total += end - from_;
      }
    }
    return total;
  }
}

function lastDayOfMonth(key: DateKey): DateKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
