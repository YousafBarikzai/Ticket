import { describe, expect, it } from 'vitest';
import { HEALTH_VERDICT_LABELS, HEALTH_VERDICT_LOOK } from '@itsm/contracts/health';
import type { SlaTimer, Ticket } from '@itsm/sdk';
import {
  addDays,
  ageBuckets,
  asAtLabel,
  attentionFrom,
  change,
  clockFrom,
  compactDuration,
  countBy,
  dailyCounts,
  dayAndTime,
  deriveOpenSeries,
  dueLabel,
  dueToday,
  exact,
  fromCount,
  fromProbe,
  headlineTimer,
  isBreached,
  isDueSoon,
  kpisFrom,
  localDayKey,
  localDays,
  localMidnight,
  longDuration,
  nextDue,
  oldestBreach,
  overviewHref,
  overviewQuery,
  periods,
  prioritySplit,
  queueVerdict,
  slip,
  timeUsed,
  todayWindow,
  verdictLook,
  UNKNOWN,
  type OverviewQuery,
} from '../overview/derive.js';

/**
 * The Overview's pure core (A6 §5.2, §9.1; SPEC §7.1.1): the verdict in the
 * shared vocabulary, the reader's own days across both of London's clock
 * changes, the estimated open series, the day counts, the age buckets and
 * the honest figures ("200+", "999+", "—").
 */

const LONDON = 'Europe/London';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ticket(number: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id: `id-${number}`,
    number,
    type: 'incident',
    title: `Title of ${number}`,
    description: null,
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    impact: 'medium',
    urgency: 'medium',
    requesterId: null,
    affectedUserId: null,
    assigneeId: null,
    groupId: null,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'portal',
    parentId: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    custom: {},
    version: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...extra,
  };
}

function timer(extra: Partial<SlaTimer> = {}): SlaTimer {
  return {
    id: 't',
    targetType: 'resolution',
    state: 'running',
    startedAt: '2026-10-02T08:00:00.000Z',
    dueAt: '2026-10-02T09:40:00.000Z',
    remainingMs: 40 * MIN,
    elapsedMs: 8 * 60 * MIN,
    warningsFired: 0,
    metAt: null,
    breachedAt: null,
    ...extra,
  };
}

describe('the verdict (A6 §5.2.3, X-M3)', () => {
  const calm = { breached: 0, dueWithinHour: 0, unassignedUrgent: 0, majorIncident: false, dueToday: 0 };

  it('speaks only the shared words: On track, At risk, Off track', () => {
    expect(verdictLook(queueVerdict(calm).verdict).label).toBe(HEALTH_VERDICT_LABELS.on_track);
    expect(verdictLook(queueVerdict({ ...calm, dueWithinHour: 1 }).verdict).label).toBe(HEALTH_VERDICT_LABELS.at_risk);
    expect(verdictLook(queueVerdict({ ...calm, breached: 1 }).verdict).label).toBe(HEALTH_VERDICT_LABELS.off_track);
    expect(verdictLook('off_track')).toBe(HEALTH_VERDICT_LOOK.off_track);
    expect(verdictLook('off_track').icon).toBe('circle-x');
  });

  it('is Off track for anything breached, whatever else is true', () => {
    expect(queueVerdict({ ...calm, breached: 1 }).verdict).toBe('off_track');
    expect(queueVerdict({ breached: 2, dueWithinHour: 3, unassignedUrgent: 1, majorIncident: true, dueToday: 9 }).verdict).toBe('off_track');
  });

  it('is At risk for a clock due within the hour, an unassigned P1/P2, a live major incident or three due today', () => {
    expect(queueVerdict({ ...calm, dueWithinHour: 1 }).verdict).toBe('at_risk');
    expect(queueVerdict({ ...calm, unassignedUrgent: 1 }).verdict).toBe('at_risk');
    expect(queueVerdict({ ...calm, majorIncident: true }).verdict).toBe('at_risk');
    expect(queueVerdict({ ...calm, dueToday: 3 }).verdict).toBe('at_risk');
    expect(queueVerdict({ ...calm, dueToday: 2 }).verdict).toBe('on_track');
  });

  it('lists every contributor, most pressing first: breached > due in the hour > unassigned P1/P2 > MI > due today', () => {
    expect(queueVerdict({ breached: 1, dueWithinHour: 1, unassignedUrgent: 1, majorIncident: true, dueToday: 3 }).reasons).toEqual([
      'breached',
      'due-within-hour',
      'unassigned-urgent',
      'major-incident',
      'due-today',
    ]);
    expect(queueVerdict({ ...calm, majorIncident: true, dueToday: 4 }).reasons).toEqual(['major-incident', 'due-today']);
    expect(queueVerdict(calm).reasons).toEqual([]);
  });
});

describe('days in the reader’s zone, across the clock changes', () => {
  it('starts each local day at its own midnight', () => {
    // BST: midnight on 2 Oct is 23:00 UTC on 1 Oct.
    expect(localMidnight('2026-10-02', LONDON).toISOString()).toBe('2026-10-01T23:00:00.000Z');
    // GMT: midnight is midnight.
    expect(localMidnight('2026-12-02', LONDON).toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(localMidnight('2026-10-02', 'UTC').toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(localDayKey(new Date('2026-10-01T23:30:00Z'), LONDON)).toBe('2026-10-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('gives 25 Oct 2026 its 25 hours: due today is midnight BST to midnight GMT', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    const { start, end } = todayWindow(now, LONDON);
    expect(start.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
    const rows = [
      ticket('A', { dueAt: '2026-10-24T22:59:00Z' }), // 23:59 BST on the 24th
      ticket('B', { dueAt: '2026-10-24T23:30:00Z' }), // 00:30 BST on the 25th
      ticket('C', { dueAt: '2026-10-25T23:30:00Z' }), // 23:30 GMT on the 25th
      ticket('D', { dueAt: '2026-10-26T00:00:00Z' }), // midnight: tomorrow
      ticket('E', { dueAt: '2026-10-25T10:00:00Z', statusCategory: 'paused' }), // a stopped clock is not due
    ];
    expect(dueToday(rows, now, LONDON).map((row) => row.number)).toEqual(['B', 'C']);
  });

  it('gives 28 Mar 2027 its 23 hours', () => {
    const now = new Date('2027-03-28T12:00:00Z');
    const { start, end } = todayWindow(now, LONDON);
    expect(start.toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-03-28T23:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
    const rows = [ticket('A', { dueAt: '2027-03-28T22:59:00Z' }), ticket('B', { dueAt: '2027-03-28T23:00:00Z' })];
    expect(dueToday(rows, now, LONDON).map((row) => row.number)).toEqual(['A']);
  });

  it('counts n local days back to today, oldest first, through a change of clocks', () => {
    const days = localDays(new Date('2026-10-26T09:00:00Z'), LONDON, 3);
    expect(days.map((day) => day.key)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(days.map((day) => (day.end.getTime() - day.start.getTime()) / HOUR)).toEqual([24, 25, 24]);
    const { start, previousStart } = periods(new Date('2026-10-02T09:00:00Z'), LONDON, 7);
    expect(start.toISOString()).toBe('2026-09-25T23:00:00.000Z');
    expect(previousStart.toISOString()).toBe('2026-09-18T23:00:00.000Z');
  });

  it('writes "As at Fri 2 Oct, 14:32" in the reader’s zone', () => {
    expect(asAtLabel(new Date('2026-10-02T13:32:00Z'), 'en-GB', LONDON)).toBe('As at Fri 2 Oct, 14:32');
    const now = new Date('2026-10-02T09:00:00Z');
    expect(dayAndTime(new Date('2026-10-01T14:10:00Z'), now, 'en-GB', LONDON)).toBe('yesterday at 15:10');
    expect(dayAndTime(new Date('2026-10-02T14:10:00Z'), now, 'en-GB', LONDON)).toBe('today at 15:10');
    expect(dayAndTime(new Date('2026-10-03T08:00:00Z'), now, 'en-GB', LONDON)).toBe('tomorrow at 09:00');
    expect(dayAndTime(new Date('2026-09-28T14:10:00Z'), now, 'en-GB', LONDON)).toBe('on 28 Sept at 15:10');
    expect(dueLabel(new Date('2026-10-02T15:00:00Z'), now, 'en-GB', LONDON)).toBe('16:00');
    expect(dueLabel(new Date('2026-10-03T08:00:00Z'), now, 'en-GB', LONDON)).toBe('Tomorrow 09:00');
  });
});

describe('spans in words, floored and never rounded up', () => {
  it('writes the largest whole unit', () => {
    expect(compactDuration(40 * MIN + 59_000)).toBe('40 min');
    expect(compactDuration(20_000)).toBe('1 min');
    expect(compactDuration(2 * HOUR + 59 * MIN)).toBe('2 h');
    expect(compactDuration(DAY + 23 * HOUR)).toBe('1 d');
    expect(longDuration(DAY)).toBe('1 day');
    expect(longDuration(4 * DAY + HOUR)).toBe('4 days');
    expect(longDuration(HOUR)).toBe('1 hour');
    expect(longDuration(5 * MIN)).toBe('5 minutes');
    expect(slip(3 * HOUR)).toBe('+3h');
    expect(slip(2 * DAY)).toBe('+2d');
    expect(slip(30 * 1000)).toBe('+1m');
  });
});

describe('the queue’s tickets', () => {
  const now = new Date('2026-10-02T09:00:00Z');

  it('tells breached, due soon and the next due apart; paused work is neither', () => {
    const breached = ticket('A', { dueAt: '2026-10-01T14:10:00Z' });
    const soon = ticket('B', { dueAt: '2026-10-02T09:40:00Z' });
    const later = ticket('C', { dueAt: '2026-10-02T14:00:00Z' });
    const paused = ticket('D', { dueAt: '2026-10-01T09:00:00Z', statusCategory: 'paused', status: 'pending_requester' });
    expect([breached, soon, later, paused].map((row) => isBreached(row, now))).toEqual([true, false, false, false]);
    expect([breached, soon, later, paused].map((row) => isDueSoon(row, now))).toEqual([false, true, false, false]);
    expect(nextDue([later, breached, soon, paused], now)?.number).toBe('B');
    expect(oldestBreach([soon, breached, ticket('E', { dueAt: '2026-10-02T08:00:00Z' })], now)?.number).toBe('A');
    // Exactly now is breached: due_at <= now (R2).
    expect(isBreached(ticket('F', { dueAt: now.toISOString() }), now)).toBe(true);
  });

  it('counts by key and writes the priority split with zeros left out', () => {
    const counts = countBy([ticket('A', { priority: 'P2' }), ticket('B', { priority: 'P2' }), ticket('C', { priority: 'P4' })], (row) => row.priority);
    expect(prioritySplit(counts)).toBe('2 P2 · 1 P4');
    expect(prioritySplit(new Map())).toBe('None open');
    expect(prioritySplit({ P1: 0, P2: 2, P3: 4, P4: 3 })).toBe('2 P2 · 4 P3 · 3 P4');
  });
});

describe('honest figures (A6 §3.2 rule 3)', () => {
  it('marks a full probe "200+" and a capped count "999+"; a gap is "—", never 0', () => {
    expect(fromProbe(200, true)).toEqual({ value: 200, atLeast: true, probe: true });
    expect(fromProbe(12, false)).toEqual({ value: 12, atLeast: false, probe: true });
    expect(fromCount({ count: 1000, capped: true })).toEqual({ value: 999, atLeast: true, probe: false });
    expect(fromCount({ count: 41, capped: false })).toEqual(exact(41));
    expect(change(exact(10), exact(7))).toBe(3);
    expect(change(fromProbe(200, true), exact(7))).toBeNull();
    expect(change({ value: null, atLeast: false, probe: false }, exact(7))).toBeNull();
  });
});

describe('the KPI figures (A6 §5.2.4)', () => {
  const now = new Date('2026-10-02T09:00:00Z');
  const open = {
    rows: [
      ticket('A', { dueAt: '2026-10-01T14:10:00Z' }),
      ticket('B', { dueAt: '2026-10-02T09:40:00Z' }),
      ticket('C', { dueAt: '2026-10-02T22:59:00Z' }), // 23:59 BST: still today
      ticket('D', { dueAt: '2026-10-02T23:00:00Z' }), // midnight: tomorrow
      ticket('W', { status: 'pending_requester', statusCategory: 'paused' }),
    ],
    capped: false,
  };
  const none = {
    open: null,
    waiting: null,
    openTotal: null,
    dueTodayTotal: null,
    breachedTotal: null,
    waitingTotal: null,
    unassigned: null,
    resolved: null,
    resolvedRows: null,
    periodStart: '2026-09-02T23:00:00Z',
    now,
    timeZone: LONDON,
  };

  it('prefers a grouped count’s exact total, then a count, over the probe', () => {
    const figures = kpisFrom({ ...none, open, openTotal: 41, dueTodayTotal: 7, breachedTotal: 3, waitingTotal: 6, unassigned: fromCount({ count: 1000, capped: true }), resolved: exact(412) });
    expect(figures).toEqual({ open: exact(41), dueToday: exact(7), breached: exact(3), waiting: exact(6), unassigned: { value: 999, atLeast: true, probe: false }, resolved: exact(412) });
  });

  it('counts from the probe when the API cannot say, "200+" when the page was full', () => {
    const figures = kpisFrom({ ...none, open, waiting: { rows: open.rows.slice(4), capped: true } });
    expect(figures.open).toEqual(fromProbe(5, false));
    expect(figures.dueToday).toEqual(fromProbe(2, false));
    expect(figures.breached).toEqual(fromProbe(1, false));
    expect(figures.waiting).toEqual(fromProbe(1, true));
  });

  it('says "—" for what nothing could read, never 0', () => {
    expect(kpisFrom(none)).toEqual({ open: UNKNOWN, dueToday: UNKNOWN, breached: UNKNOWN, waiting: UNKNOWN, unassigned: UNKNOWN, resolved: UNKNOWN });
  });

  it('counts resolved from the rows read when the count could not apply its window: exact only when every row was read', () => {
    const rows = [
      ticket('R1', { resolvedAt: '2026-09-10T10:00:00Z' }),
      ticket('R2', { resolvedAt: '2026-10-01T10:00:00Z' }),
      ticket('R0', { resolvedAt: '2026-08-10T10:00:00Z' }), // before the period
    ];
    expect(kpisFrom({ ...none, resolvedRows: { rows, complete: true } }).resolved).toEqual(exact(2));
    expect(kpisFrom({ ...none, resolvedRows: { rows, complete: false } }).resolved).toEqual(fromProbe(2, true));
  });
});

describe('the series behind the sparklines', () => {
  const now = new Date('2026-10-02T09:00:00Z');

  it('estimates the open work at the end of each of the last 14 days, today at now', () => {
    const open = [
      ticket('OLD', { createdAt: '2026-08-01T09:00:00Z' }), // open before and throughout
      ticket('NEW', { createdAt: '2026-10-01T10:00:00Z' }), // raised yesterday (BST)
    ];
    const finished = [
      ticket('DONE', { createdAt: '2026-09-01T09:00:00Z', resolvedAt: '2026-09-30T10:00:00Z', statusCategory: 'resolved' }), // open until 30 Sep
      ticket('QUICK', { createdAt: '2026-09-28T09:00:00Z', resolvedAt: '2026-09-28T11:00:00Z', statusCategory: 'resolved' }), // never open at a day's end
      ticket('CANCELLED', { createdAt: '2026-09-25T09:00:00Z', closedAt: '2026-09-29T09:00:00Z', statusCategory: 'closed' }),
    ];
    const series = deriveOpenSeries(open, finished, now, LONDON);
    expect(series).toHaveLength(14);
    // 19 Sep … 2 Oct. OLD and DONE throughout until 30 Sep; CANCELLED from 25 to 28 Sep; NEW from 1 Oct.
    expect(series).toEqual([2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 2, 1, 2, 2]);
  });

  it('counts tickets a day by local day, leaving out what falls outside', () => {
    const days = localDays(now, LONDON, 3);
    const counts = dailyCounts(['2026-09-30T00:30:00Z', '2026-09-30T22:59:00Z', '2026-09-30T23:00:00Z', '2026-10-02T08:00:00Z', '2026-09-01T00:00:00Z', null], days);
    // 30 Sep (BST) runs 29 Sep 23:00Z – 30 Sep 23:00Z.
    expect(counts).toEqual([2, 1, 1]);
  });

  it('puts ages in R2g’s buckets, each [lower, upper)', () => {
    const at = (ms: number): string => new Date(now.getTime() - ms).toISOString();
    expect(ageBuckets([at(HOUR), at(DAY), at(3 * DAY - 1), at(3 * DAY), at(29 * DAY), at(30 * DAY), null], now)).toEqual({
      under_1d: 1,
      '1d_3d': 2,
      '3d_7d': 1,
      '7d_30d': 1,
      over_30d: 1,
    });
  });
});

describe('clocks', () => {
  it('reads the running or breached timer due first, as the share of its business time used', () => {
    const response = timer({ targetType: 'response', state: 'met', metAt: '2026-10-02T08:10:00Z', dueAt: null });
    const resolution = timer();
    const update = timer({ targetType: 'update', dueAt: '2026-10-02T12:00:00Z' });
    expect(headlineTimer([update, response, resolution])?.targetType).toBe('resolution');
    expect(headlineTimer([timer({ state: 'paused' })])).toBeNull();
    expect(timeUsed(resolution)).toBeCloseTo(480 / 520);
    expect(timeUsed(timer({ state: 'breached', remainingMs: -60 * MIN, elapsedMs: 9 * 60 * MIN, breachedAt: '2026-10-01T14:10:00Z' }))).toBeGreaterThan(1);
    expect(timeUsed(timer({ state: 'breached', remainingMs: 0, elapsedMs: 0, breachedAt: 'x' }))).toBeGreaterThan(1);
    const clock = clockFrom({ id: 'i', number: 'INC-1', title: 'T' }, [resolution]);
    expect(clock).toMatchObject({ targetType: 'resolution', breached: false, dueAt: '2026-10-02T09:40:00.000Z' });
    expect(clockFrom({ id: 'i', number: 'INC-1', title: 'T' }, [])).toBeNull();
  });
});

describe('Needs you', () => {
  const now = new Date('2026-10-02T09:00:00Z');
  const breached = ticket('INC-1', { dueAt: '2026-10-01T14:10:00Z' });
  const soon = ticket('INC-2', { dueAt: '2026-10-02T09:40:00Z' });
  const replied = ticket('INC-3', { dueAt: '2026-10-02T14:00:00Z' });
  const fresh = ticket('INC-4', { status: 'new' });
  const waiting = ticket('INC-5', { status: 'pending_requester', statusCategory: 'paused', updatedAt: '2026-09-27T09:00:00Z' });
  const waitingShort = ticket('INC-6', { status: 'pending_third_party', statusCategory: 'paused', updatedAt: '2026-10-01T09:00:00Z' });
  const urgent = ticket('INC-7', { priority: 'P1' });

  const tabs = attentionFrom({
    open: [breached, soon, replied, fresh, waiting, waitingShort],
    mine: [fresh, replied],
    waiting: [waiting, waitingShort],
    unassignedUrgent: [urgent],
    // The breached ticket has a reply too: "All" keeps it once, as breached.
    replies: new Map([
      [replied.id, '2026-10-02T07:00:00Z'],
      [breached.id, '2026-10-02T08:00:00Z'],
    ]),
    now,
  });

  it('fills each tab by its own rule', () => {
    expect(tabs.breached.map((entry) => entry.ticket.number)).toEqual(['INC-1']);
    expect(tabs['due-soon'].map((entry) => entry.ticket.number)).toEqual(['INC-2']);
    expect(tabs.replied.map((entry) => entry.ticket.number)).toEqual(['INC-1', 'INC-3']);
    expect(tabs.new.map((entry) => entry.ticket.number)).toEqual(['INC-4']);
    expect(tabs['waiting-long'].map((entry) => entry.ticket.number)).toEqual(['INC-5']);
    expect(tabs['unassigned-urgent'].map((entry) => entry.ticket.number)).toEqual(['INC-7']);
  });

  it('lists each ticket once in All, under its most pressing reason', () => {
    expect(tabs.all.map((entry) => [entry.ticket.number, entry.tab])).toEqual([
      ['INC-1', 'breached'],
      ['INC-2', 'due-soon'],
      ['INC-7', 'unassigned-urgent'],
      ['INC-3', 'replied'],
      ['INC-4', 'new'],
      ['INC-5', 'waiting-long'],
    ]);
  });
});

describe('the URL', () => {
  it('reads the scope only for a reader with teams, and a known range and tab, else the defaults', () => {
    expect(overviewQuery({ scope: 'team', range: '90d', attention: 'breached' }, { teamScope: true })).toEqual({ scope: 'team', range: '90d', attention: 'breached' });
    expect(overviewQuery({ scope: 'team' }, { teamScope: false }).scope).toBe('mine');
    expect(overviewQuery({ range: '12m', attention: 'everything' }, { teamScope: true })).toEqual({ scope: 'mine', range: '30d', attention: 'all' });
    expect(overviewQuery({ range: ['7d', '90d'] }, { teamScope: true }).range).toBe('7d');
  });

  it('writes the plain page as /overview and keeps only what differs, with the card to land on', () => {
    const query: OverviewQuery = { scope: 'mine', range: '30d', attention: 'all' };
    expect(overviewHref(query)).toBe('/overview');
    expect(overviewHref(query, { range: '90d' })).toBe('/overview?range=90d');
    expect(overviewHref({ ...query, scope: 'team' }, { attention: 'breached' }, 'needs-you')).toBe('/overview?scope=team&attention=breached#needs-you');
  });
});
