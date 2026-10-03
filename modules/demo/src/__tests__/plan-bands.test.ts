import { describe, expect, it } from 'vitest';
import { DEMO_GENERATOR_VERSION } from '../config.js';
import { FIXTURE_CONTENT } from '../plan/__fixtures__/content.js';
import { StoryCalendar } from '../plan/calendar.js';
import { planWithContent } from '../plan/generate.js';
import { evaluateSla } from '../plan/sla-plan.js';
import { addDays, ukInstant } from '../plan/time.js';
import type { DemoPlan } from '../plan/types.js';
import { planFacts, verifyGeneration, type CheckId } from '../verify/verify.js';

/**
 * The bands hold at every T0 (Y-M7, A4 §1.11, §7.2).
 *
 * The build refuses to swap a generation outside the bands, so a plan that
 * misses one on some night is a night the demo silently stays a day old. This
 * plans at full scale against 40 anchors — every weekday, by day and at night,
 * both daylight-saving days, Christmas Day, New Year's Day, Easter Monday 2027,
 * and month-ends and the 07:00 and 19:00 boundaries through the winter — and
 * holds each plan to V3 (attainment), V4 (CSAT), V5 (mix), V8 (invariants) and
 * V10 (no unfilled slot), with every ticket's stored timeline replayed through
 * MOD-07's maths to the verdicts the plan promised (V2 in memory).
 */

const local = (date: string, hours: number, minutes = 0, seconds = 30) => ukInstant(date, hours * 60 + minutes) + seconds * 1000;

const ANCHORS: readonly { readonly label: string; readonly at: number }[] = [
  { label: 'A4 build 1: Friday 10:40 BST, day', at: Date.parse('2026-10-02T09:40:00Z') },
  { label: 'A4 build 2: Sunday 00:00:30 BST, night', at: Date.parse('2026-10-03T23:00:30Z') },
  ...['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].flatMap((date) => [
    { label: `${date} 10:00`, at: local(date, 10) },
    { label: `${date} 00:00`, at: local(date, 0) },
  ]),
  { label: 'autumn change day 00:00', at: local('2026-10-25', 0) },
  { label: 'autumn change day 10:00', at: local('2026-10-25', 10) },
  { label: 'the Monday after the autumn change', at: local('2026-10-26', 9, 15) },
  { label: 'spring change day 00:00', at: local('2027-03-28', 0) },
  { label: 'spring change day 12:00', at: local('2027-03-28', 12) },
  { label: 'Easter Monday 2027 00:00', at: local('2027-03-29', 0) },
  { label: 'Easter Monday 2027 10:00', at: local('2027-03-29', 10) },
  { label: 'Christmas Day 00:00', at: local('2026-12-25', 0) },
  { label: 'Christmas Day 11:00', at: local('2026-12-25', 11) },
  { label: "New Year's Day 00:00", at: local('2027-01-01', 0) },
  { label: "New Year's Day 14:00", at: local('2027-01-01', 14) },
  ...Array.from({ length: 17 }, (_, i) => {
    const date = addDays('2026-11-02', i * 11);
    const [hours, minutes] = ([[7, 0], [19, 0], [18, 59], [6, 59], [12, 30], [23, 0]] as const)[i % 6]!;
    return { label: `${date} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, at: local(date, hours, minutes) };
  }),
];

const CHECKED: readonly CheckId[] = ['V3', 'V4', 'V5', 'V8', 'V10'];
const calendar = new StoryCalendar(FIXTURE_CONTENT.holidays);

function replaysToPlan(plan: DemoPlan): string[] {
  const disagreements: string[] = [];
  for (const ticket of plan.tickets) {
    const replayed = evaluateSla(
      {
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        requester: ticket.requester,
        statusChanges: ticket.events.flatMap((event) => (event.kind === 'status' ? [{ at: event.at, to: event.to }] : [])),
        publicComments: ticket.comments.filter((c) => c.visibility === 'public').map((c) => ({ at: c.at, author: c.author })),
      },
      plan.anchor,
      calendar.clockFor(ticket.priority),
    );
    for (const target of ['response', 'update', 'resolution'] as const) {
      if (replayed[target].verdict !== ticket.sla.verdicts[target]) disagreements.push(`${ticket.ref} ${target}`);
    }
  }
  return disagreements;
}

describe('the plan holds A4 §1.11’s bands at every T0', () => {
  it('has forty anchors, every weekday among them', () => {
    expect(ANCHORS).toHaveLength(40);
    const weekdays = new Set(ANCHORS.map((anchor) => new Date(anchor.at).getUTCDay()));
    for (const weekday of [1, 2, 3, 4, 5]) expect(weekdays.has(weekday)).toBe(true);
  });

  it.each(ANCHORS)('$label', ({ at }) => {
    const plan = planWithContent({ seed: 20261002, anchor: at, scale: 1, historyDays: 120, generatorVersion: DEMO_GENERATOR_VERSION }, FIXTURE_CONTENT);
    const report = verifyGeneration(planFacts(plan), plan, { scale: 1 });
    for (const id of CHECKED) {
      const check = report.checks.find((candidate) => candidate.id === id)!;
      expect(check.outcome, `${id}: ${check.summary}`).toBe('pass');
    }
    expect(replaysToPlan(plan)).toEqual([]);
  }, 60_000);

  it.each(ANCHORS.filter((_, index) => index % 8 === 0))('at scale 0.2, with the bands widened by three points: $label', ({ at }) => {
    const plan = planWithContent({ seed: 20261002, anchor: at, scale: 0.2, historyDays: 120, generatorVersion: DEMO_GENERATOR_VERSION }, FIXTURE_CONTENT);
    const report = verifyGeneration(planFacts(plan), plan, { scale: 0.2 });
    for (const id of CHECKED) {
      const check = report.checks.find((candidate) => candidate.id === id)!;
      expect(check.outcome, `${id}: ${check.summary}`).toBe('pass');
    }
    expect(replaysToPlan(plan)).toEqual([]);
  }, 60_000);
});

/*
 * The same promise with the real content library (`content/**`, written by
 * its own package against `plan/content-types.ts`). It runs wherever the
 * library is present — the wave's joint check — and is skipped where it is
 * not yet, so the planner's own tests never wait on another package.
 */
const library = await import('../plan/plan.js').catch(() => null);

describe.skipIf(library === null)('with the content library', () => {
  it.each(ANCHORS.filter((_, index) => index % 5 === 0))('$label', ({ at }) => {
    const plan = library!.planGeneration({ seed: 20261002, anchor: at, scale: 1, historyDays: 120 });
    const report = verifyGeneration(planFacts(plan), plan, { scale: 1 });
    for (const id of [...CHECKED, 'V7'] as const) {
      const check = report.checks.find((candidate) => candidate.id === id)!;
      expect(check.outcome, `${id}: ${check.summary}`).toBe('pass');
    }
    // Alex's nine, and only his heroes, whatever the library's words.
    const open = new Set(['new', 'in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'reopened']);
    const mine = plan.tickets.filter((ticket) => ticket.assignee === 'alex-morgan' && open.has(ticket.status));
    expect(mine.map((ticket) => ticket.hero).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'H1', 'H2', 'H3', 'H4', 'H5'].sort());
    expect(library!.planHash(plan)).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
