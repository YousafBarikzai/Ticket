import type { Weekday } from './content-types.js';

/**
 * UK wall-clock arithmetic for the planner (A4 §1.15).
 *
 * The story is told in Europe/London local time — the 09:00 surge, month-end,
 * a P1 at 02:14 — and stored as UTC instants. Every placement goes through
 * `ukInstant`, so a ticket raised "at 09:40" is 09:40 on the 25 October clock
 * change and on the 28 March one alike.
 *
 * Calendar dates are `YYYY-MM-DD` strings (`DateKey`); date arithmetic is done
 * on day numbers since 1970-01-01, where every day has 24 hours.
 */

export type DateKey = string;
/** An instant, as epoch milliseconds (UTC). */
export type Instant = number;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const match = DATE_KEY.exec(key);
  if (!match) throw new RangeError(`not a date key: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new RangeError(`not a calendar date: ${key}`);
  return { year, month, day };
}

/** Days since 1970-01-01 for a calendar date. */
export function dayNumber(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** The calendar date `n` days after 1970-01-01. */
export function dateKeyOfDay(n: number): DateKey {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(key: DateKey, days: number): DateKey {
  return dateKeyOfDay(dayNumber(key) + days);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DateKey, to: DateKey): number {
  return dayNumber(to) - dayNumber(from);
}

export function weekdayOf(key: DateKey): Weekday {
  return WEEKDAYS[new Date(dayNumber(key) * DAY_MS).getUTCDay()] as Weekday;
}

/** The UK calendar date of an instant: it flips at midnight in London, not UTC (`ukDateKey` in `@itsm/contracts/demo`). */
export function ukDateKeyOf(instant: Instant): DateKey {
  return londonWall(instant).dateKey;
}

/**
 * When British Summer Time starts and ends in a year: 01:00 UTC on the last
 * Sundays of March and October (the rule since 1996). Worked out rather than
 * asked of `Intl`, because the planner asks for London's wall clock a few
 * hundred thousand times a plan; `time.test.ts` holds it to `Intl` across
 * every year the content covers.
 */
const summerCache = new Map<number, { start: Instant; end: Instant }>();

function lastSundayAt0100Utc(year: number, monthIndex: number): Instant {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const back = lastDay.getUTCDay();
  return Date.UTC(year, monthIndex, lastDay.getUTCDate() - back, 1);
}

function summerTime(year: number): { start: Instant; end: Instant } {
  let found = summerCache.get(year);
  if (!found) {
    found = { start: lastSundayAt0100Utc(year, 2), end: lastSundayAt0100Utc(year, 9) };
    summerCache.set(year, found);
  }
  return found;
}

/** London's offset from UTC at an instant: one hour in summer time, none otherwise. */
export function londonOffsetMs(instant: Instant): number {
  const { start, end } = summerTime(new Date(instant).getUTCFullYear());
  return instant >= start && instant < end ? HOUR_MS : 0;
}

/** The London wall clock at an instant. */
export function londonWall(instant: Instant): { dateKey: DateKey; minutes: number } {
  const local = new Date(instant + londonOffsetMs(instant));
  return {
    dateKey: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Minutes after local midnight, in London. */
export function ukMinutesOf(instant: Instant): number {
  return londonWall(instant).minutes;
}

/**
 * The instant at which London's wall clock reads `minutesAfterMidnight` on
 * `dateKey`, exact across daylight saving (A4 §1.15):
 *
 * - on 25 Oct 2026, 09:40 is 09:40 UTC; on 28 Mar 2027, 09:40 is 08:40 UTC;
 * - a time that does not exist (01:30 on 28 Mar 2027, inside the spring-forward
 *   gap) maps forward by the gap: 02:30 BST, which is 01:30 UTC;
 * - a time that happens twice (01:30 on 25 Oct 2026) maps to the first
 *   occurrence, in BST: 00:30 UTC.
 *
 * London is only ever UTC+0 or UTC+1, so the two candidates are tried in turn
 * rather than solved for: the earlier one (BST) wins when both are real.
 */
export function ukInstant(dateKey: DateKey, minutesAfterMidnight: number): Instant {
  if (!Number.isInteger(minutesAfterMidnight) || minutesAfterMidnight < 0 || minutesAfterMidnight >= 24 * 60) {
    throw new RangeError(`minutes after midnight must be a whole number in [0, 1440): ${minutesAfterMidnight}`);
  }
  const naive = dayNumber(dateKey) * DAY_MS + minutesAfterMidnight * MINUTE_MS;
  const summer = naive - HOUR_MS;
  for (const candidate of [summer, naive]) {
    const wall = londonWall(candidate);
    if (wall.dateKey === dateKey && wall.minutes === minutesAfterMidnight) return candidate;
  }
  // The gap: read with the offset in force before the change (GMT).
  return naive;
}

/** Day or night mode for the live major incident (A4 §1.9.4): 07:00–19:00 UK on a business day. */
export function storyModeAt(t0: Instant, isBusinessDay: (key: DateKey) => boolean): 'day' | 'night' {
  const wall = londonWall(t0);
  if (!isBusinessDay(wall.dateKey)) return 'night';
  return wall.minutes >= 7 * 60 && wall.minutes < 19 * 60 ? 'day' : 'night';
}

/** `HH:MM` as minutes after midnight. */
export function wallMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`not a wall time: ${value}`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes >= 24 * 60 || Number(match[2]) > 59) throw new RangeError(`not a wall time: ${value}`);
  return minutes;
}

/** T0 floored to the minute (A4 §1.15). */
export function floorToMinute(instant: Instant): Instant {
  return Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}
