import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from '@itsm/business-time';
import { dateKey, durationsBetween, isoWeek, marginMinutes } from '../domain/durations.js';

const NINE_TO_FIVE: BusinessCalendar = {
  timeZone: 'Europe/London',
  hours: {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
  },
  exceptions: [],
};

describe('durations', () => {
  it('reports both the working time and the time the requester waited', () => {
    // Friday 16:00 to Monday 10:00 UTC in March, when London is on GMT.
    const from = new Date('2026-03-06T16:00:00Z');
    const to = new Date('2026-03-09T10:00:00Z');
    const result = durationsBetween(from, to, NINE_TO_FIVE);

    // One hour on Friday plus one on Monday.
    expect(result.businessMinutes).toBe(120);
    // Sixty-six hours, which is what the person who raised it experienced.
    expect(result.elapsedMinutes).toBe(66 * 60);
  });

  it('treats a negative interval as zero rather than reporting negative time', () => {
    // Clocks and corrections do produce these; "resolved in minus four minutes"
    // in a chart is a support ticket about the reporting module.
    const result = durationsBetween(new Date('2026-03-09T10:00:00Z'), new Date('2026-03-09T09:00:00Z'));
    expect(result).toEqual({ businessMinutes: 0, elapsedMinutes: 0 });
  });

  it('counts every minute when the calendar is always open', () => {
    const result = durationsBetween(new Date('2026-03-06T16:00:00Z'), new Date('2026-03-09T10:00:00Z'));
    expect(result.businessMinutes).toBe(result.elapsedMinutes);
  });
});

describe('margins', () => {
  it('is negative when a target was met early', () => {
    expect(marginMinutes(new Date('2026-03-09T12:00:00Z'), new Date('2026-03-09T11:30:00Z'))).toBe(-30);
  });

  it('is positive by how much a target was missed', () => {
    // "Breached" and "breached by six minutes" are different conversations, and
    // only one of them is about the target being wrong.
    expect(marginMinutes(new Date('2026-03-09T12:00:00Z'), new Date('2026-03-09T12:06:00Z'))).toBe(6);
  });

  it('is null while the timer is still running', () => {
    expect(marginMinutes(new Date('2026-03-09T12:00:00Z'), null)).toBeNull();
  });
});

describe('the date a fact belongs to', () => {
  it('is the UTC day, with the time removed', () => {
    expect(dateKey(new Date('2026-03-09T23:45:00Z'))).toEqual(new Date(Date.UTC(2026, 2, 9)));
  });
});

describe('ISO weeks', () => {
  it('puts 1 January 2027 in the last week of 2026', () => {
    // The trap this function exists for: a "last 12 weeks" report keyed on the
    // calendar year loses a week whenever these disagree.
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toEqual({ week: 53, year: 2026 });
  });

  it('puts 31 December 2029 in the first week of 2030', () => {
    expect(isoWeek(new Date(Date.UTC(2029, 11, 31)))).toEqual({ week: 1, year: 2030 });
  });

  it('numbers the first Monday of a normal year as week one', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 0, 5)))).toEqual({ week: 2, year: 2026 });
  });
});
