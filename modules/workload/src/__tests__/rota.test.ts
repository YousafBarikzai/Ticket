import { describe, expect, it } from 'vitest';
import {
  RotaError,
  isOnShift,
  onCallAt,
  periodIndex,
  upcomingHandovers,
  validateShiftPattern,
  type RotationDefinition,
  type ShiftPattern,
} from '../domain/rota.js';

/**
 * A rota is only worth having if it is right on the nights nobody is watching
 * it. Each test below names a way it could quietly be wrong: an hour lost to
 * the clocks, a turn skipped, a night shift that does not exist.
 *
 * The dates are real. UK clocks go forward on 30 March 2025 and back on
 * 26 October 2025, and both weekends appear here on purpose.
 */

const weekly: RotationDefinition = {
  timeZone: 'Europe/London',
  cadence: 'weekly',
  // Monday 3 March 2025, 09:00 GMT.
  startsAt: new Date('2025-03-03T09:00:00Z'),
  members: ['alice', 'bob', 'carol'],
  handoverAt: '09:00',
};

const at = (iso: string): Date => new Date(iso);

describe('periodIndex', () => {
  it('counts period 0 from the handover on the start date', () => {
    expect(periodIndex(weekly, at('2025-03-03T09:00:00Z'))).toBe(0);
    expect(periodIndex(weekly, at('2025-03-09T23:59:59Z'))).toBe(0);
  });

  it('holds the previous period until the handover time', () => {
    // 09:00 is the handover; a minute earlier is still last week's turn.
    expect(periodIndex(weekly, at('2025-03-10T08:59:00Z'))).toBe(0);
    expect(periodIndex(weekly, at('2025-03-10T09:00:00Z'))).toBe(1);
  });

  it('goes negative before the rota started rather than throwing', () => {
    expect(periodIndex(weekly, at('2025-02-24T12:00:00Z'))).toBe(-1);
    expect(periodIndex(weekly, at('2025-02-17T12:00:00Z'))).toBe(-2);
  });

  it('counts in local days, so the clocks changing does not skip a turn', () => {
    // 09:00 local on 31 March is 08:00Z, because the clocks went forward on
    // the 30th. Counted in milliseconds the handover would still be an hour
    // away and alice would hold the pager into bob's week.
    expect(periodIndex(weekly, at('2025-03-31T07:59:00Z'))).toBe(3);
    expect(periodIndex(weekly, at('2025-03-31T08:00:00Z'))).toBe(4);
  });
});

describe('onCallAt', () => {
  it('walks the members in order, one week each', () => {
    expect(onCallAt(weekly, [], at('2025-03-05T12:00:00Z'))).toEqual({ userId: 'alice', via: 'rotation' });
    expect(onCallAt(weekly, [], at('2025-03-12T12:00:00Z'))).toEqual({ userId: 'bob', via: 'rotation' });
    expect(onCallAt(weekly, [], at('2025-03-19T12:00:00Z'))).toEqual({ userId: 'carol', via: 'rotation' });
    expect(onCallAt(weekly, [], at('2025-03-26T12:00:00Z'))).toEqual({ userId: 'alice', via: 'rotation' });
  });

  it('wraps backwards for a question about a time before the rota began', () => {
    // `%` keeps the sign of its left operand in JavaScript, so the unguarded
    // version reads off the front of the list and answers `undefined`.
    expect(onCallAt(weekly, [], at('2025-02-24T12:00:00Z'))).toEqual({ userId: 'carol', via: 'rotation' });
  });

  it('lets an override win outright, and only for its own window', () => {
    const overrides = [{ userId: 'dave', startsAt: at('2025-03-12T00:00:00Z'), endsAt: at('2025-03-14T00:00:00Z') }];
    expect(onCallAt(weekly, overrides, at('2025-03-13T03:00:00Z'))).toEqual({ userId: 'dave', via: 'override' });
    // The end is exclusive: at the moment it lapses the rotation has it back,
    // still on bob's week rather than having been shifted by the cover.
    expect(onCallAt(weekly, overrides, at('2025-03-14T00:00:00Z'))).toEqual({ userId: 'bob', via: 'rotation' });
    expect(onCallAt(weekly, overrides, at('2025-03-11T23:59:00Z'))).toEqual({ userId: 'bob', via: 'rotation' });
  });

  it('says nobody when the rotation has no members, rather than picking one', () => {
    expect(onCallAt({ ...weekly, members: [] }, [], at('2025-03-05T12:00:00Z'))).toEqual({
      userId: null,
      via: 'nobody',
    });
  });

  it('still answers from an override when the rotation is empty', () => {
    const overrides = [{ userId: 'dave', startsAt: at('2025-03-01T00:00:00Z'), endsAt: at('2025-04-01T00:00:00Z') }];
    expect(onCallAt({ ...weekly, members: [] }, overrides, at('2025-03-05T12:00:00Z'))).toEqual({
      userId: 'dave',
      via: 'override',
    });
  });

  it('hands over daily when the cadence says so', () => {
    const daily: RotationDefinition = { ...weekly, cadence: 'daily', members: ['alice', 'bob'] };
    expect(onCallAt(daily, [], at('2025-03-03T12:00:00Z')).userId).toBe('alice');
    expect(onCallAt(daily, [], at('2025-03-04T12:00:00Z')).userId).toBe('bob');
    expect(onCallAt(daily, [], at('2025-03-05T12:00:00Z')).userId).toBe('alice');
  });

  it('refuses a handover time it cannot read', () => {
    expect(() => onCallAt({ ...weekly, handoverAt: '25:00' }, [], at('2025-03-05T12:00:00Z'))).toThrow(RotaError);
    expect(() => onCallAt({ ...weekly, handoverAt: 'morning' }, [], at('2025-03-05T12:00:00Z'))).toThrow(RotaError);
  });
});

describe('upcomingHandovers', () => {
  it('keeps the handover at 09:00 local across the spring change', () => {
    const [next] = upcomingHandovers(weekly, at('2025-03-25T12:00:00Z'), 1);
    // 09:00 BST, not the 09:00Z that seven times twenty-four hours would give.
    expect(next!.at.toISOString()).toBe('2025-03-31T08:00:00.000Z');
    expect(next!.userId).toBe('bob');
  });

  it('keeps it at 09:00 local across the autumn change too', () => {
    // 27 October 2025 is the Monday after the clocks went back.
    const handovers = upcomingHandovers({ ...weekly, startsAt: at('2025-10-06T09:00:00Z') }, at('2025-10-22T12:00:00Z'), 1);
    expect(handovers[0]!.at.toISOString()).toBe('2025-10-27T09:00:00.000Z');
  });

  it('agrees with onCallAt at every boundary it predicts', () => {
    // The two functions are the ones that have to match: a rota that shows one
    // person and pages another is worse than no rota.
    for (const handover of upcomingHandovers(weekly, at('2025-03-05T12:00:00Z'), 10)) {
      expect(onCallAt(weekly, [], handover.at).userId).toBe(handover.userId);
      const momentBefore = new Date(handover.at.getTime() - 1);
      expect(onCallAt(weekly, [], momentBefore).userId).not.toBe(handover.userId);
    }
  });

  it('returns nothing to show when there is nobody to show', () => {
    expect(upcomingHandovers({ ...weekly, members: [] }, at('2025-03-05T12:00:00Z'))).toEqual([]);
    expect(upcomingHandovers(weekly, at('2025-03-05T12:00:00Z'), 0)).toEqual([]);
  });
});

const nights: ShiftPattern = {
  timeZone: 'Europe/London',
  pattern: { mon: [{ from: '22:00', to: '06:00' }] },
};

const days: ShiftPattern = {
  timeZone: 'Europe/London',
  pattern: { mon: [{ from: '09:00', to: '17:00' }], tue: [{ from: '09:00', to: '17:00' }] },
};

describe('isOnShift', () => {
  it('runs a day shift between its ends, the start inclusive and the end not', () => {
    expect(isOnShift(days, at('2025-03-03T09:00:00Z'))).toBe(true);
    expect(isOnShift(days, at('2025-03-03T16:59:00Z'))).toBe(true);
    expect(isOnShift(days, at('2025-03-03T17:00:00Z'))).toBe(false);
    expect(isOnShift(days, at('2025-03-03T08:59:00Z'))).toBe(false);
  });

  it('is closed on a day with no pattern', () => {
    // Wednesday.
    expect(isOnShift(days, at('2025-03-05T12:00:00Z'))).toBe(false);
  });

  it('runs a night shift past midnight into the next day', () => {
    // Monday night.
    expect(isOnShift(nights, at('2025-03-03T23:00:00Z'))).toBe(true);
    // Tuesday morning: still Monday's shift, which the naive `from < to`
    // comparison says never happens.
    expect(isOnShift(nights, at('2025-03-04T02:00:00Z'))).toBe(true);
    expect(isOnShift(nights, at('2025-03-04T05:59:00Z'))).toBe(true);
    expect(isOnShift(nights, at('2025-03-04T06:00:00Z'))).toBe(false);
  });

  it('does not let the night shift leak backwards into Monday morning', () => {
    // Sunday night into Monday: there is no Sunday pattern, so 05:00 on Monday
    // is nobody's shift even though 05:00 falls inside 22:00-06:00.
    expect(isOnShift(nights, at('2025-03-03T05:00:00Z'))).toBe(false);
    expect(isOnShift(nights, at('2025-03-03T21:59:00Z'))).toBe(false);
  });

  it('ends a night shift at 06:00 local when the clocks go forward', () => {
    const saturdays: ShiftPattern = { timeZone: 'Europe/London', pattern: { sat: [{ from: '22:00', to: '06:00' }] } };
    // Saturday 29 March into Sunday 30 March, the night the clocks go forward.
    // The shift is seven hours long, not eight: 22:00 GMT to 06:00 BST.
    expect(isOnShift(saturdays, at('2025-03-30T04:59:00Z'))).toBe(true);
    expect(isOnShift(saturdays, at('2025-03-30T05:00:00Z'))).toBe(false);
  });

  it('ends it at 06:00 local when the clocks go back, an hour later in UTC', () => {
    const saturdays: ShiftPattern = { timeZone: 'Europe/London', pattern: { sat: [{ from: '22:00', to: '06:00' }] } };
    // Saturday 25 October into Sunday 26 October: nine hours, 22:00 BST to
    // 06:00 GMT. Adding a fixed twenty-four hours would send everybody home an
    // hour early.
    expect(isOnShift(saturdays, at('2025-10-26T05:59:00Z'))).toBe(true);
    expect(isOnShift(saturdays, at('2025-10-26T06:00:00Z'))).toBe(false);
  });

  it('handles a split shift on one day', () => {
    const split: ShiftPattern = {
      timeZone: 'Europe/London',
      pattern: { mon: [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }] },
    };
    expect(isOnShift(split, at('2025-03-03T09:00:00Z'))).toBe(true);
    expect(isOnShift(split, at('2025-03-03T12:30:00Z'))).toBe(false);
    expect(isOnShift(split, at('2025-03-03T14:00:00Z'))).toBe(true);
  });

  it('treats a zero-length period as no shift rather than as an overnight one', () => {
    const broken: ShiftPattern = { timeZone: 'Europe/London', pattern: { mon: [{ from: '09:00', to: '09:00' }] } };
    expect(isOnShift(broken, at('2025-03-03T12:00:00Z'))).toBe(false);
  });

  it('reads a pattern in its own time zone, not the one the server runs in', () => {
    const sydney: ShiftPattern = { timeZone: 'Australia/Sydney', pattern: { mon: [{ from: '09:00', to: '17:00' }] } };
    // Monday 09:00 in Sydney is Sunday 22:00 UTC in March (AEDT, UTC+11).
    expect(isOnShift(sydney, at('2025-03-02T22:00:00Z'))).toBe(true);
    expect(isOnShift(sydney, at('2025-03-03T12:00:00Z'))).toBe(false);
  });
});

describe('validateShiftPattern', () => {
  it('passes a pattern that makes sense', () => {
    expect(validateShiftPattern(days)).toEqual([]);
    expect(validateShiftPattern(nights)).toEqual([]);
  });

  it('names the day and the period it could not read', () => {
    const problems = validateShiftPattern({
      timeZone: 'Europe/London',
      pattern: { mon: [{ from: '9am', to: '17:00' }], tue: [{ from: '09:00', to: '09:00' }] },
    });
    expect(problems).toEqual([
      'mon: invalid time of day: 9am',
      'tue: period 09:00-09:00 is zero length',
    ]);
  });
});
