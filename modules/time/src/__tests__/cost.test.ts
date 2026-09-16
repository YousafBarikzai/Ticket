import { describe, expect, it } from 'vitest';
import { TIMER_CAP_MINUTES, costOf, minutesBetween, periodFor, thresholdsCrossed } from '../domain/cost.js';

describe('pricing', () => {
  it('prices minutes at an hourly rate, to the penny', () => {
    expect(costOf(60, 50)).toBe(50);
    expect(costOf(45, 50)).toBe(37.5);
    expect(costOf(7, 50)).toBe(5.83);
  });

  it('prices nothing at no rate, and nothing for no time', () => {
    expect(costOf(60, 0)).toBe(0);
    expect(costOf(0, 50)).toBe(0);
  });
});

describe('minutes', () => {
  it('rounds to whole minutes and never reports zero for a real interval', () => {
    expect(minutesBetween(new Date('2026-03-01T09:00:00Z'), new Date('2026-03-01T09:30:20Z'))).toBe(30);
    // Ten seconds of work is a minute, not nothing: a zero would vanish from every total.
    expect(minutesBetween(new Date('2026-03-01T09:00:00Z'), new Date('2026-03-01T09:00:10Z'))).toBe(1);
  });

  it('is zero for an interval that runs backwards', () => {
    expect(minutesBetween(new Date('2026-03-01T10:00:00Z'), new Date('2026-03-01T09:00:00Z'))).toBe(0);
  });

  it('caps a forgotten timer at twelve hours', () => {
    expect(TIMER_CAP_MINUTES).toBe(720);
  });
});

describe('periods', () => {
  const at = new Date('2026-05-17T13:00:00Z');

  it('starts on the calendar boundary and ends exclusively', () => {
    expect(periodFor('month', at)).toEqual({ start: new Date('2026-05-01T00:00:00Z'), end: new Date('2026-06-01T00:00:00Z') });
    expect(periodFor('quarter', at)).toEqual({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-07-01T00:00:00Z') });
    expect(periodFor('year', at)).toEqual({ start: new Date('2026-01-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') });
  });

  it('rolls December into the next year', () => {
    expect(periodFor('month', new Date('2026-12-31T23:59:59Z')).end).toEqual(new Date('2027-01-01T00:00:00Z'));
  });
});

describe('thresholds', () => {
  it('reports the warning line when spend crosses it', () => {
    expect(thresholdsCrossed(700, 850, 1000, 80)).toEqual([80]);
  });

  it('reports both lines when one entry jumps past both', () => {
    expect(thresholdsCrossed(700, 1050, 1000, 80)).toEqual([80, 100]);
  });

  it('reports nothing for a decrement, or for staying above a line already crossed', () => {
    // Crossing back down is not news, and sitting above the line is not a new crossing.
    expect(thresholdsCrossed(900, 850, 1000, 80)).toEqual([]);
    expect(thresholdsCrossed(850, 900, 1000, 80)).toEqual([]);
  });

  it('reports nothing against an empty budget', () => {
    expect(thresholdsCrossed(0, 10, 0, 80)).toEqual([]);
  });
});
