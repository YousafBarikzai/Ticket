import { describe, expect, it } from 'vitest';
import { BANK_HOLIDAYS } from '../content/holidays.js';

/**
 * The bank holiday table (A4 §1.10.4) against an independent computation of
 * the England and Wales rules, and against the windows the generator reads:
 * 121 days of history behind T0 and 150 days of SLA clocks and change
 * schedules ahead of it.
 */

const DAY_MS = 86_400_000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (key: string) => Date.parse(`${key}T00:00:00Z`);
const weekdayOf = (key: string) => new Date(msOf(key)).getUTCDay(); // 0 Sunday … 6 Saturday
const addDays = (key: string, days: number) => keyOf(msOf(key) + days * DAY_MS);

/** Easter Sunday (the anonymous Gregorian algorithm). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first Monday on or after a date. */
const mondayOnOrAfter = (key: string) => addDays(key, (8 - weekdayOf(key)) % 7);
/** The last Monday on or before a date. */
const mondayOnOrBefore = (key: string) => addDays(key, -((weekdayOf(key) + 6) % 7));

/**
 * The England and Wales bank holidays of a year by the standing rules: a
 * fixed-date holiday at a weekend moves to the next free weekday.
 */
function englandAndWales(year: number): string[] {
  const easter = easterSunday(year);
  const days = [
    addDays(easter, -2),
    addDays(easter, 1),
    mondayOnOrAfter(`${year}-05-01`),
    mondayOnOrBefore(`${year}-05-31`),
    mondayOnOrBefore(`${year}-08-31`),
  ];
  const newYear = `${year}-01-01`;
  days.push(weekdayOf(newYear) === 6 ? addDays(newYear, 2) : weekdayOf(newYear) === 0 ? addDays(newYear, 1) : newYear);
  // Christmas and Boxing Day: each takes the next weekday the other has not taken.
  const taken = new Set<string>();
  for (const date of [`${year}-12-25`, `${year}-12-26`]) {
    let day = date;
    while (weekdayOf(day) === 0 || weekdayOf(day) === 6 || taken.has(day)) day = addDays(day, 1);
    taken.add(day);
    days.push(day);
  }
  return days.sort();
}

describe('England and Wales bank holidays', () => {
  it('lists real dates in order, once each, all of them weekdays', () => {
    const dates = BANK_HOLIDAYS.map((holiday) => holiday.date);
    for (const holiday of BANK_HOLIDAYS) {
      expect(holiday.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(keyOf(msOf(holiday.date)), 'a real calendar date').toBe(holiday.date);
      expect([1, 2, 3, 4, 5], `${holiday.date} ${holiday.name}`).toContain(weekdayOf(holiday.date));
      expect(holiday.name.length).toBeGreaterThan(0);
    }
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('matches the standing rules for 2026, 2027 and 2028, eight days a year', () => {
    for (const year of [2026, 2027, 2028]) {
      const listed = BANK_HOLIDAYS.filter((holiday) => holiday.date.startsWith(`${year}-`)).map((holiday) => holiday.date);
      expect(listed, String(year)).toEqual(englandAndWales(year));
      expect(listed).toHaveLength(8);
    }
  });

  it('names the substitute days as GOV.UK does', () => {
    const substitutes = BANK_HOLIDAYS.filter((holiday) => holiday.name.endsWith('(substitute day)')).map((holiday) => holiday.date);
    expect(substitutes).toEqual(['2026-12-28', '2027-12-27', '2027-12-28', '2028-01-03']);
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('covers 150 days ahead of any T0 in 2026 or 2027', () => {
    const last = BANK_HOLIDAYS.at(-1)?.date as string;
    // Every holiday the rules give up to the last T0's horizon is listed.
    const horizon = addDays('2027-12-31', 150);
    expect(horizon <= last).toBe(true);
    const ruled = [2026, 2027, 2028].flatMap(englandAndWales).filter((date) => date <= horizon);
    const listed = new Set(BANK_HOLIDAYS.map((holiday) => holiday.date));
    for (const date of ruled) expect(listed.has(date), date).toBe(true);
  });

  it('covers every demo window from the first build on: 121 days of history and 150 ahead', () => {
    const first = BANK_HOLIDAYS[0]?.date as string;
    const last = BANK_HOLIDAYS.at(-1)?.date as string;
    // The demo ships in October 2026 (SPEC §5.1's window starts 4 June 2026).
    for (let t0 = '2026-10-02'; t0 <= '2027-12-31'; t0 = addDays(t0, 1)) {
      expect(addDays(t0, -121) >= first, t0).toBe(true);
      expect(addDays(t0, 150) <= last, t0).toBe(true);
    }
  });

  it('still covers today + 150 days, so the table is extended before the demo outruns it (A4 §7.2)', () => {
    // Deliberately reads the real clock: this failing is the reminder to add
    // the next year's holidays to content/holidays.ts.
    const last = BANK_HOLIDAYS.at(-1)?.date as string;
    expect(keyOf(Date.now() + 150 * DAY_MS) <= last, `add the bank holidays after ${last}`).toBe(true);
  });
});
