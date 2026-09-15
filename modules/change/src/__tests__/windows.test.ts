import { describe, expect, it } from 'vitest';
import { appliesTo, checkSchedule, covers, overlaps, type Window } from '../domain/windows.js';

/**
 * Windows are where change control is either enforced or decorative. A blackout
 * that fails to overlap by an hour is a blackout that let a deployment through
 * on year-end close, and nobody finds out until afterwards.
 *
 * The dates are real. UK clocks go forward on 30 March 2025 and back on
 * 26 October 2025, and both appear here for the same reason they do in MOD-20:
 * "Saturday at ten" has to stay Saturday at ten.
 */

const weekly = (over: Partial<Window> = {}): Window => ({
  kind: 'change',
  name: 'Saturday night',
  timeZone: 'Europe/London',
  weekday: 'sat',
  startTime: '22:00',
  endTime: '02:00',
  status: 'active',
  serviceIds: [],
  ...over,
});

const absolute = (over: Partial<Window> = {}): Window => ({
  kind: 'blackout',
  name: 'Year-end close',
  reason: 'Finance cannot reconcile during a change.',
  timeZone: 'Europe/London',
  startsAt: new Date('2025-12-24T00:00:00Z'),
  endsAt: new Date('2026-01-05T00:00:00Z'),
  status: 'active',
  serviceIds: [],
  ...over,
});

const at = (iso: string) => new Date(iso);

describe('a weekly window', () => {
  it('runs past midnight into Sunday, which is what a change window looks like', () => {
    // Saturday 22:00 to 02:00. A straight start-before-end comparison says this
    // window never opens, which is the same bug the night shift had in MOD-20.
    expect(covers(weekly(), at('2025-03-01T23:00:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-03-02T01:00:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-03-02T02:00:00Z'))).toBe(false);
    expect(covers(weekly(), at('2025-03-01T21:59:00Z'))).toBe(false);
  });

  it('stays at 22:00 local when the clocks change', () => {
    // 29 March 2025 is the Saturday the clocks go forward overnight. The window
    // opens at 22:00 GMT and closes at 02:00 BST — three hours, not four.
    expect(covers(weekly(), at('2025-03-29T22:00:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-03-30T00:59:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-03-30T01:00:00Z'))).toBe(false);
  });

  it('is five hours long on the night the clocks go back', () => {
    // 25 October 2025: 22:00 BST to 02:00 GMT.
    expect(covers(weekly(), at('2025-10-25T21:00:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-10-26T01:59:00Z'))).toBe(true);
    expect(covers(weekly(), at('2025-10-26T02:00:00Z'))).toBe(false);
  });

  it('is closed on every other night', () => {
    expect(covers(weekly(), at('2025-03-04T23:00:00Z'))).toBe(false);
  });

  it('is closed once retired', () => {
    expect(covers(weekly({ status: 'retired' }), at('2025-03-01T23:00:00Z'))).toBe(false);
  });
});

describe('an absolute window', () => {
  it('covers its range, the start inclusive and the end not', () => {
    expect(covers(absolute(), at('2025-12-31T12:00:00Z'))).toBe(true);
    expect(covers(absolute(), at('2025-12-24T00:00:00Z'))).toBe(true);
    expect(covers(absolute(), at('2026-01-05T00:00:00Z'))).toBe(false);
    expect(covers(absolute(), at('2025-12-23T23:59:00Z'))).toBe(false);
  });
});

describe('overlap, which is what scheduling actually asks', () => {
  it('catches a change that starts before a blackout and runs into it', () => {
    // "It only overlaps by twenty minutes" is not an argument anybody wants to
    // be making during a year-end freeze.
    expect(
      overlaps(absolute(), { start: at('2025-12-23T20:00:00Z'), end: at('2025-12-24T02:00:00Z') }),
    ).toBe(true);
  });

  it('catches a change that starts inside a blackout and runs out of it', () => {
    expect(
      overlaps(absolute(), { start: at('2026-01-04T20:00:00Z'), end: at('2026-01-06T02:00:00Z') }),
    ).toBe(true);
  });

  it('catches a change that swallows the whole blackout', () => {
    expect(
      overlaps(absolute(), { start: at('2025-12-01T00:00:00Z'), end: at('2026-02-01T00:00:00Z') }),
    ).toBe(true);
  });

  it('leaves a change entirely outside it alone', () => {
    expect(
      overlaps(absolute(), { start: at('2025-12-01T00:00:00Z'), end: at('2025-12-01T04:00:00Z') }),
    ).toBe(false);
  });

  it('catches a weekly window a change touches at either end', () => {
    // A deployment from 01:00 to 04:00 on Sunday is inside the Saturday window
    // for its first hour.
    expect(overlaps(weekly(), { start: at('2025-03-02T01:00:00Z'), end: at('2025-03-02T04:00:00Z') })).toBe(true);
    expect(overlaps(weekly(), { start: at('2025-03-01T20:00:00Z'), end: at('2025-03-01T23:00:00Z') })).toBe(true);
    expect(overlaps(weekly(), { start: at('2025-03-04T09:00:00Z'), end: at('2025-03-04T17:00:00Z') })).toBe(false);
  });
});

describe('scope', () => {
  it('applies an unscoped window to every service', () => {
    expect(appliesTo(weekly(), null)).toBe(true);
    expect(appliesTo(weekly(), 'any-service')).toBe(true);
  });

  it('keeps a scoped window off other services', () => {
    // A blackout on payroll does not restrain a change to the wiki.
    const scoped = weekly({ serviceIds: ['payroll'] });
    expect(appliesTo(scoped, 'payroll')).toBe(true);
    expect(appliesTo(scoped, 'wiki')).toBe(false);
    expect(appliesTo(scoped, null)).toBe(false);
  });
});

describe('the verdict a schedule gets', () => {
  const period = { start: at('2025-12-28T22:00:00Z'), end: at('2025-12-29T02:00:00Z') };

  it('refuses a period inside a blackout, and names it', () => {
    // Refused, not warned about. A warning is a thing people click through, and
    // a control everybody clicks through exists only in the audit report.
    const verdict = checkSchedule([absolute()], period, null);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toMatchObject({ name: 'Year-end close' });
    expect(verdict.blockedBy!.reason).toMatch(/reconcile/);
  });

  it('lets a blackout on another service through', () => {
    const verdict = checkSchedule([absolute({ serviceIds: ['payroll'] })], period, 'wiki');
    expect(verdict.allowed).toBe(true);
  });

  it('allows a period outside every window when a tenant has defined none', () => {
    // A tenant that has not described its change windows is not asking for
    // every change to be flagged.
    const verdict = checkSchedule([], period, null);
    expect(verdict).toMatchObject({ allowed: true, inWindows: [], outsideWindows: false });
  });

  it('advises rather than refuses when a change falls outside the defined windows', () => {
    // A hard refusal here would push people to raise changes as emergencies —
    // trading a small governance win for a large hole in the record.
    const monday = { start: at('2025-03-03T09:00:00Z'), end: at('2025-03-03T11:00:00Z') };
    const verdict = checkSchedule([weekly()], monday, null);
    expect(verdict).toMatchObject({ allowed: true, inWindows: [], outsideWindows: true });
  });

  it('names the windows a change does fall inside', () => {
    const saturday = { start: at('2025-03-01T23:00:00Z'), end: at('2025-03-02T01:00:00Z') };
    const verdict = checkSchedule([weekly()], saturday, null);
    expect(verdict).toMatchObject({ allowed: true, inWindows: ['Saturday night'], outsideWindows: false });
  });

  it('lets a blackout beat a change window they both cover', () => {
    // The combination that matters: an emergency freeze declared over the
    // ordinary Saturday window.
    const saturday = { start: at('2025-03-01T23:00:00Z'), end: at('2025-03-02T01:00:00Z') };
    const freeze = absolute({
      name: 'Datacentre move',
      startsAt: at('2025-03-01T00:00:00Z'),
      endsAt: at('2025-03-03T00:00:00Z'),
    });
    const verdict = checkSchedule([weekly(), freeze], saturday, null);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toMatchObject({ name: 'Datacentre move' });
  });
});
