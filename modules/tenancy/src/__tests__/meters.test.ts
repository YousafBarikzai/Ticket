import { describe, expect, it } from 'vitest';
import { METERS, METER_CATALOGUE, crossings, describe as readable, isMeter, periodFor, refusalMessage, stateFor } from '../domain/meters.js';

/**
 * The arithmetic a plan limit is made of. Each test names the way a limit
 * goes wrong without the rule: a warning nobody sees, a line announced
 * every night, a figure that reads as a wall of digits, a live meter that
 * duplicates itself.
 */

describe('what a figure means against its lines', () => {
  it('is ok below both, warned at the soft line, blocked at the hard one', () => {
    const lines = { soft: 8n, hard: 10n };
    expect(stateFor(7n, lines)).toBe('ok');
    expect(stateFor(8n, lines)).toBe('warned');
    expect(stateFor(9n, lines)).toBe('warned');
    expect(stateFor(10n, lines)).toBe('blocked');
    expect(stateFor(500n, lines)).toBe('blocked');
  });

  it('treats the line as reached, not passed: at the limit is over it', () => {
    // A plan that says five agents means five, and the sixth is refused.
    // Off by one here is a customer with six agents on a five-agent plan.
    expect(stateFor(5n, { soft: null, hard: 5n })).toBe('blocked');
  });

  it('is never blocked by a plan with no hard line', () => {
    expect(stateFor(10_000n, { soft: 400n, hard: null })).toBe('warned');
    expect(stateFor(10_000n, { soft: null, hard: null })).toBe('ok');
  });
});

describe('which lines get announced', () => {
  it('announces both when one step passes both', () => {
    expect(crossings(500n, { soft: 8n, hard: 10n }, { warned: false, blocked: false })).toEqual(['warned', 'blocked']);
  });

  it('says nothing a second time in the same period', () => {
    // The nightly recompute finds the same figure every night. A limit that
    // emailed the administrator each time would be a limit they filter out.
    expect(crossings(500n, { soft: 8n, hard: 10n }, { warned: true, blocked: true })).toEqual([]);
    expect(crossings(9n, { soft: 8n, hard: 10n }, { warned: true, blocked: false })).toEqual([]);
  });

  it('announces the hard line even when the warning was already sent', () => {
    expect(crossings(10n, { soft: 8n, hard: 10n }, { warned: true, blocked: false })).toEqual(['blocked']);
  });

  it('says nothing about a line the plan does not draw', () => {
    expect(crossings(10_000n, { soft: null, hard: null }, { warned: false, blocked: false })).toEqual([]);
  });
});

describe('the period a meter belongs to', () => {
  it('spells out a live meter rather than leaving it null', () => {
    // A unique index over a nullable column does not enforce uniqueness:
    // `live` is a value, and two rows for it conflict as they should.
    expect(periodFor('agents', new Date('2026-09-15T00:00:00Z'))).toEqual({ key: 'live', start: null, end: null });
    expect(periodFor('storage', new Date('2026-09-15T00:00:00Z')).key).toBe('live');
  });

  it('gives a counted meter the calendar month it fell in, ending on the last day', () => {
    const period = periodFor('tickets', new Date('2026-09-15T23:59:59Z'));
    expect(period.key).toBe('2026-09');
    expect(period.start!.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(period.end!.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('puts the first instant of a month in that month and not the one before', () => {
    expect(periodFor('tickets', new Date('2026-10-01T00:00:00Z')).key).toBe('2026-10');
    expect(periodFor('tickets', new Date('2026-09-30T23:59:59Z')).key).toBe('2026-09');
  });

  it('handles February and a leap year without a special case', () => {
    expect(periodFor('tickets', new Date('2028-02-10T00:00:00Z')).end!.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(periodFor('tickets', new Date('2026-02-10T00:00:00Z')).end!.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('what a person reads', () => {
  it('shows bytes as bytes until they are worth scaling', () => {
    expect(readable('storage', 512n)).toBe('512 bytes');
    expect(readable('storage', 2n * 1024n * 1024n * 1024n)).toBe('2.0 GB');
    expect(readable('storage', 1536n * 1024n * 1024n)).toBe('1.5 GB');
  });

  it('groups a large count so it can be read at a glance', () => {
    expect(readable('tickets', 10_000n)).toBe('10,000 tickets');
    expect(readable('agents', 5n)).toBe('5 people');
  });

  it('names the plan, the limit and the way out in a refusal', () => {
    const message = refusalMessage('agents', 5n, 5n, 'trial');
    expect(message).toContain('trial');
    expect(message).toContain('5 people');
    expect(message).toContain('larger plan');
    // The reassurance matters as much as the refusal: nothing already here
    // stops working.
    expect(message).toContain('keeps working');
  });
});

describe('the catalogue', () => {
  it('describes every meter it names, and nothing it does not', () => {
    for (const meter of METERS) {
      expect(METER_CATALOGUE[meter].description.length).toBeGreaterThan(20);
      expect(isMeter(meter)).toBe(true);
    }
    expect(isMeter('seats')).toBe(false);
  });

  it('keeps the two shapes apart, because only one can be rebuilt', () => {
    expect(METER_CATALOGUE.agents.shape).toBe('live');
    expect(METER_CATALOGUE.storage.shape).toBe('live');
    expect(METER_CATALOGUE.tickets.shape).toBe('counted');
    expect(METER_CATALOGUE.api_calls.shape).toBe('counted');
  });
});
