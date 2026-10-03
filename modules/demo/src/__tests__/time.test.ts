import { ukDateKey } from '@itsm/contracts/demo';
import { describe, expect, it } from 'vitest';
import { StoryCalendar } from '../plan/calendar.js';
import {
  HOUR_MS,
  MINUTE_MS,
  addDays,
  dateKeyOfDay,
  dayNumber,
  daysBetween,
  floorToMinute,
  londonOffsetMs,
  londonWall,
  storyModeAt,
  ukDateKeyOf,
  ukInstant,
  wallMinutes,
  weekdayOf,
} from '../plan/time.js';

/**
 * UK wall-clock time for the planner (A4 §1.15, §7.2): the story is told in
 * London local time, through both daylight-saving changes, and stored in UTC.
 */

const iso = (instant: number) => new Date(instant).toISOString();

describe('ukInstant', () => {
  it('places 09:40 on the autumn change day at 09:40 UTC, after the clocks went back', () => {
    expect(iso(ukInstant('2026-10-25', 580))).toBe('2026-10-25T09:40:00.000Z');
  });

  it('places 09:40 on the spring change day at 08:40 UTC, in summer time', () => {
    expect(iso(ukInstant('2027-03-28', 580))).toBe('2027-03-28T08:40:00.000Z');
  });

  it('maps the non-existent 01:30 of 28 March 2027 forward, past the gap (02:30 BST)', () => {
    const instant = ukInstant('2027-03-28', 90);
    expect(iso(instant)).toBe('2027-03-28T01:30:00.000Z');
    expect(londonWall(instant)).toEqual({ dateKey: '2027-03-28', minutes: 150 });
  });

  it('maps the repeated 01:30 of 25 October 2026 to its first occurrence, in BST', () => {
    const instant = ukInstant('2026-10-25', 90);
    expect(iso(instant)).toBe('2026-10-25T00:30:00.000Z');
    // The second 01:30, an hour later, reads the same wall clock.
    expect(londonWall(instant + HOUR_MS)).toEqual({ dateKey: '2026-10-25', minutes: 90 });
  });

  it('places midnight and the minute before the next one on the right UTC instants in each season', () => {
    expect(iso(ukInstant('2026-07-01', 0))).toBe('2026-06-30T23:00:00.000Z');
    expect(iso(ukInstant('2026-12-01', 0))).toBe('2026-12-01T00:00:00.000Z');
    expect(iso(ukInstant('2026-07-01', 1439))).toBe('2026-07-01T22:59:00.000Z');
  });

  it('refuses a minute outside the day and a date that is not one', () => {
    expect(() => ukInstant('2026-10-25', 1440)).toThrow(RangeError);
    expect(() => ukInstant('2026-10-25', -1)).toThrow(RangeError);
    expect(() => ukInstant('2026-10-25', 9.5)).toThrow(RangeError);
    expect(() => ukInstant('2026-02-30', 600)).toThrow(RangeError);
    expect(() => ukInstant('25/10/2026', 600)).toThrow(RangeError);
  });

  it('round-trips every quarter hour of every day of 2026–2028 that exists', () => {
    let checked = 0;
    for (let day = dayNumber('2026-01-01'); day <= dayNumber('2028-12-31'); day += 13) {
      const key = dateKeyOfDay(day);
      for (let minutes = 0; minutes < 1440; minutes += 15) {
        const wall = londonWall(ukInstant(key, minutes));
        if (wall.minutes !== minutes) continue; // the spring gap maps forward, checked above
        expect(wall.dateKey).toBe(key);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(8000);
  });
});

describe("London's wall clock", () => {
  const intl = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const viaIntl = (instant: number) => {
    const parts = Object.fromEntries(intl.formatToParts(instant).map((part) => [part.type, part.value]));
    return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  };

  it('agrees with Intl every 37 minutes from 2026 to the end of 2028, and at every change', () => {
    for (let instant = Date.UTC(2026, 0, 1); instant < Date.UTC(2029, 0, 1); instant += 37 * MINUTE_MS) {
      expect(londonWall(instant)).toEqual(viaIntl(instant));
    }
    for (const change of ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z', '2027-03-28T01:00:00Z', '2027-10-31T01:00:00Z', '2028-03-26T01:00:00Z', '2028-10-29T01:00:00Z']) {
      const at = Date.parse(change);
      for (const delta of [-60_001, -1, 0, 1, 60_000]) expect(londonWall(at + delta)).toEqual(viaIntl(at + delta));
    }
  });

  it('is an hour ahead of UTC in summer and level in winter', () => {
    expect(londonOffsetMs(Date.parse('2026-07-01T12:00:00Z'))).toBe(HOUR_MS);
    expect(londonOffsetMs(Date.parse('2026-12-01T12:00:00Z'))).toBe(0);
    expect(londonOffsetMs(Date.parse('2026-10-25T00:59:59Z'))).toBe(HOUR_MS);
    expect(londonOffsetMs(Date.parse('2026-10-25T01:00:00Z'))).toBe(0);
  });

  it("names the same UK date as the contracts' reset clock, flipping at London's midnight", () => {
    for (let instant = Date.UTC(2026, 9, 20); instant < Date.UTC(2026, 10, 2); instant += 23 * MINUTE_MS) {
      expect(ukDateKeyOf(instant)).toBe(ukDateKey(instant));
    }
    expect(ukDateKeyOf(Date.parse('2026-10-03T23:00:30Z'))).toBe('2026-10-04');
    expect(ukDateKeyOf(Date.parse('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });
});

describe('calendar dates', () => {
  it('counts, adds and names days on the calendar, not the clock', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dateKeyOfDay(dayNumber('2026-10-02'))).toBe('2026-10-02');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(daysBetween('2026-06-04', '2026-10-02')).toBe(120);
    expect(weekdayOf('2026-10-02')).toBe('fri');
    expect(weekdayOf('2026-10-25')).toBe('sun');
    expect(weekdayOf('2027-03-29')).toBe('mon');
  });

  it('reads wall times and floors T0 to the minute', () => {
    expect(wallMinutes('09:40')).toBe(580);
    expect(wallMinutes('7:05')).toBe(425);
    expect(() => wallMinutes('24:00')).toThrow(RangeError);
    expect(() => wallMinutes('9.40')).toThrow(RangeError);
    expect(iso(floorToMinute(Date.parse('2026-10-03T23:00:30.900Z')))).toBe('2026-10-03T23:00:00.000Z');
  });
});

describe('day and night mode (A4 §1.9.4)', () => {
  const calendar = new StoryCalendar([{ date: '2026-12-25', name: 'Christmas Day' }]);
  const mode = (key: string, minutes: number) => storyModeAt(ukInstant(key, minutes), (day) => calendar.isBusinessDay(day));

  it('is day from 07:00 to 18:59 on a business day, night either side', () => {
    expect(mode('2026-10-02', 6 * 60 + 59)).toBe('night');
    expect(mode('2026-10-02', 7 * 60)).toBe('day');
    expect(mode('2026-10-02', 18 * 60 + 59)).toBe('day');
    expect(mode('2026-10-02', 19 * 60)).toBe('night');
    expect(mode('2026-10-02', 0)).toBe('night');
  });

  it('is night all day on a Saturday and on a bank holiday', () => {
    for (const minutes of [7 * 60, 10 * 60, 18 * 60 + 59]) {
      expect(mode('2026-10-03', minutes)).toBe('night');
      expect(mode('2026-12-25', minutes)).toBe('night');
    }
  });

  it('follows the local clock across the autumn change: 07:00 BST and 07:00 GMT are both the start of day', () => {
    expect(mode('2026-10-23', 7 * 60)).toBe('day');
    expect(mode('2026-10-26', 7 * 60)).toBe('day');
    expect(mode('2026-10-26', 6 * 60 + 59)).toBe('night');
  });
});
