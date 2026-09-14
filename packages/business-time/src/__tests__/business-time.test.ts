import { describe, expect, it } from 'vitest';
import {
  BusinessTimeError,
  TWENTY_FOUR_SEVEN,
  addBusinessMs,
  dayIntervals,
  elapsedBusinessMs,
  isOpen,
  localParts,
  nextOpening,
  validateCalendar,
  wallToUtc,
  type BusinessCalendar,
} from '../index.js';

const HOUR = 3_600_000;

const londonOffice: BusinessCalendar = {
  timeZone: 'Europe/London',
  hours: {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
  },
  exceptions: [{ date: '2026-12-25', type: 'holiday' }],
};

const istanbulOffice: BusinessCalendar = {
  timeZone: 'Europe/Istanbul',
  hours: { mon: [{ start: '09:00', end: '18:00' }], tue: [{ start: '09:00', end: '18:00' }] },
};

describe('addBusinessMs', () => {
  it('stays inside the working day', () => {
    // Tuesday 10:00 London (BST, so 09:00 UTC) + 4 h = 14:00 local.
    const from = new Date('2026-09-15T09:00:00.000Z');
    expect(addBusinessMs(from, 4 * HOUR, londonOffice).toISOString()).toBe('2026-09-15T13:00:00.000Z');
  });

  it('rolls over the end of the day', () => {
    // Tuesday 15:00 local + 4 h = 2 h left today, 2 h on Wednesday morning = 11:00.
    const from = new Date('2026-09-15T14:00:00.000Z');
    expect(addBusinessMs(from, 4 * HOUR, londonOffice).toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });

  it('skips the weekend', () => {
    // Friday 15:00 local + 4 h lands on Monday 11:00 local.
    const from = new Date('2026-09-18T14:00:00.000Z');
    expect(addBusinessMs(from, 4 * HOUR, londonOffice).toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });

  it('starts the clock at the next opening when raised out of hours', () => {
    // Saturday: the timer starts Monday 09:00 local (08:00 UTC in BST).
    const from = new Date('2026-09-19T22:00:00.000Z');
    expect(addBusinessMs(from, 1 * HOUR, londonOffice).toISOString()).toBe('2026-09-21T09:00:00.000Z');
    expect(nextOpening(from, londonOffice).toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });

  it('skips a holiday exception', () => {
    // Christmas Day 2026 is a Friday and is closed, so Thursday 16:00 + 4 h runs to Monday.
    const from = new Date('2026-12-24T16:00:00.000Z');
    expect(addBusinessMs(from, 4 * HOUR, londonOffice).toISOString()).toBe('2026-12-28T12:00:00.000Z');
  });

  it('uses extended hours when an exception provides them', () => {
    const calendar: BusinessCalendar = {
      ...londonOffice,
      exceptions: [{ date: '2026-09-19', type: 'extended', hours: [{ start: '10:00', end: '14:00' }] }],
    };
    // Saturday is normally closed; the exception opens 10:00–14:00 local.
    const from = new Date('2026-09-19T00:00:00.000Z');
    expect(addBusinessMs(from, 1 * HOUR, calendar).toISOString()).toBe('2026-09-19T10:00:00.000Z');
  });

  it('treats a 24/7 calendar as wall-clock time', () => {
    const from = new Date('2026-09-19T22:00:00.000Z');
    expect(addBusinessMs(from, 6 * HOUR, TWENTY_FOUR_SEVEN).toISOString()).toBe('2026-09-20T04:00:00.000Z');
  });

  it('rejects a negative duration', () => {
    expect(() => addBusinessMs(new Date(), -1, londonOffice)).toThrow(BusinessTimeError);
  });

  it('gives up rather than looping when a calendar never opens', () => {
    const closed: BusinessCalendar = { timeZone: 'UTC', hours: {} };
    expect(() => addBusinessMs(new Date(), HOUR, closed)).toThrow(/scan horizon/);
  });
});

describe('daylight saving', () => {
  // An overnight shift spanning the transition is the case that exposes offset bugs.
  const nightShift: BusinessCalendar = {
    timeZone: 'Europe/London',
    hours: { sun: [{ start: '00:00', end: '06:00' }] },
  };

  it('loses an hour when the clocks spring forward', () => {
    // 2026-03-29: 01:00 becomes 02:00, so 00:00–06:00 local is five real hours.
    const intervals = dayIntervals(nightShift, localParts(new Date('2026-03-29T03:00:00.000Z'), 'Europe/London'));
    expect(intervals).toHaveLength(1);
    const [only] = intervals;
    expect(only!.end.getTime() - only!.start.getTime()).toBe(5 * HOUR);
  });

  it('gains an hour when the clocks fall back', () => {
    // 2026-10-25: 02:00 becomes 01:00, so 00:00–06:00 local is seven real hours.
    const intervals = dayIntervals(nightShift, localParts(new Date('2026-10-25T03:00:00.000Z'), 'Europe/London'));
    expect(intervals).toHaveLength(1);
    const [only] = intervals;
    expect(only!.end.getTime() - only!.start.getTime()).toBe(7 * HOUR);
  });

  it('keeps an office day eight hours long across both transitions', () => {
    for (const date of ['2026-03-30T12:00:00.000Z', '2026-10-26T12:00:00.000Z']) {
      const intervals = dayIntervals(londonOffice, localParts(new Date(date), 'Europe/London'));
      const [only] = intervals;
      expect(only!.end.getTime() - only!.start.getTime()).toBe(8 * HOUR);
    }
  });

  it('shifts a wall-clock time that does not exist forward past the gap', () => {
    // 01:30 on 2026-03-29 never happens in London; it resolves into the new offset.
    const resolved = wallToUtc(2026, 3, 29, 1, 30, 'Europe/London');
    expect(localParts(resolved, 'Europe/London').hour).toBe(2);
  });

  it('resolves a repeated wall-clock time to the later occurrence', () => {
    // 01:30 happens twice on 2026-10-25; the second (GMT) instant is chosen.
    const resolved = wallToUtc(2026, 10, 25, 1, 30, 'Europe/London');
    expect(resolved.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  it('handles a zone without daylight saving', () => {
    // Istanbul is UTC+3 all year: Monday 09:00 local is 06:00 UTC in both seasons.
    for (const date of ['2026-01-05', '2026-07-06']) {
      const from = new Date(`${date}T00:00:00.000Z`);
      expect(localParts(nextOpening(from, istanbulOffice), 'Europe/Istanbul').hour).toBe(9);
    }
  });
});

describe('elapsedBusinessMs', () => {
  it('counts only open time', () => {
    // Friday 15:00 local to Monday 11:00 local is 2 h + 2 h of opening time.
    const from = new Date('2026-09-18T14:00:00.000Z');
    const to = new Date('2026-09-21T10:00:00.000Z');
    expect(elapsedBusinessMs(from, to, londonOffice)).toBe(4 * HOUR);
  });

  it('returns zero when the range is empty or reversed', () => {
    const t = new Date('2026-09-15T10:00:00.000Z');
    expect(elapsedBusinessMs(t, t, londonOffice)).toBe(0);
    expect(elapsedBusinessMs(t, new Date(t.getTime() - HOUR), londonOffice)).toBe(0);
  });

  it('round-trips with addBusinessMs', () => {
    const from = new Date('2026-09-15T09:30:00.000Z');
    for (const hours of [1, 5, 9, 26, 40]) {
      const due = addBusinessMs(from, hours * HOUR, londonOffice);
      expect(elapsedBusinessMs(from, due, londonOffice)).toBe(hours * HOUR);
    }
  });
});

describe('isOpen', () => {
  it('knows whether the desk is open', () => {
    expect(isOpen(new Date('2026-09-15T09:00:00.000Z'), londonOffice)).toBe(true);
    expect(isOpen(new Date('2026-09-15T17:00:00.000Z'), londonOffice)).toBe(false);
    expect(isOpen(new Date('2026-09-19T12:00:00.000Z'), londonOffice)).toBe(false);
    expect(isOpen(new Date('2026-12-25T10:00:00.000Z'), londonOffice)).toBe(false);
  });

  it('sees an interval that started on the previous local day', () => {
    const overnight: BusinessCalendar = {
      timeZone: 'UTC',
      hours: { mon: [{ start: '22:00', end: '24:00' }], tue: [{ start: '00:00', end: '06:00' }] },
    };
    expect(isOpen(new Date('2026-09-14T23:00:00.000Z'), overnight)).toBe(true);
    expect(isOpen(new Date('2026-09-15T02:00:00.000Z'), overnight)).toBe(true);
    expect(isOpen(new Date('2026-09-15T07:00:00.000Z'), overnight)).toBe(false);
  });
});

describe('validateCalendar', () => {
  it('accepts a sound calendar', () => {
    expect(validateCalendar(londonOffice)).toEqual([]);
    expect(validateCalendar(TWENTY_FOUR_SEVEN)).toEqual([]);
  });

  it('reports every problem it finds', () => {
    const broken: BusinessCalendar = {
      timeZone: 'Mars/Olympus',
      hours: { mon: [{ start: '17:00', end: '09:00' }], tue: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '15:00' }] },
      exceptions: [{ date: '25/12/2026', type: 'holiday' }],
    };
    const problems = validateCalendar(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown time zone'),
        expect.stringContaining('ends before it starts'),
        expect.stringContaining('overlaps'),
        expect.stringContaining('YYYY-MM-DD'),
      ]),
    );
  });

  it('rejects a calendar with no opening hours', () => {
    expect(validateCalendar({ timeZone: 'UTC', hours: {} })).toContain('calendar has no opening hours');
  });

  it('reports a malformed time', () => {
    const problems = validateCalendar({ timeZone: 'UTC', hours: { mon: [{ start: '9am', end: '17:00' }] } });
    expect(problems.some((p) => p.includes('invalid start time'))).toBe(true);
  });
});
