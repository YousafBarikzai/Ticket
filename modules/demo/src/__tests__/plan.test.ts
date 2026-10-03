import { TWENTY_FOUR_SEVEN, addBusinessMs, elapsedBusinessMs } from '@itsm/business-time';
import { DEMO_BUILD_STEPS, DEMO_PERSONAS, DEMO_SD_HEROES, demoHeroRef } from '@itsm/contracts/demo';
import { isTenantModule } from '@itsm/platform';
import { STATES } from '@itsm/module-ticket';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_GENERATOR_VERSION, demoConfigFrom } from '../config.js';
import { DEMO_JOB_NAMES, demoManifest } from '../manifest.js';
import { CONFIG_PARTS } from '../parts/config/index.js';
import { HISTORY_PARTS } from '../parts/history/index.js';
import {
  PART_KEYS,
  PART_STEPS,
  PartContractError,
  PartNotBuiltError,
  demoBuildContext,
  emptyIds,
  mergeIds,
  runParts,
  type DemoPart,
  type PartInput,
} from '../parts/index.js';
import { FIXTURE_CONTENT } from '../plan/__fixtures__/content.js';
import { OFFICE_HOURS, StoryCalendar, northwindCalendar } from '../plan/calendar.js';
import type { DemoContent } from '../plan/content-types.js';
import { STORY_CAST_KEYS } from '../plan/content-types.js';
import { PlanInputError, planWithContent, starCounts, type DemoPlanInput } from '../plan/generate.js';
import { planHash } from '../plan/hash.js';
import { SLA_TARGET_MINUTES, STAR_SHARES } from '../plan/model.js';
import { ContentError } from '../plan/people.js';
import { RESOLUTION_CLOCK, SlaSim, evaluateSla } from '../plan/sla-plan.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, londonWall, ukInstant } from '../plan/time.js';
import type { DemoPlan, PlannedTicket } from '../plan/types.js';
import { TemplateError } from '../plan/words.js';
// The SLA seed is not part of MOD-07's public interface; the parity check reads it directly.
import { DEFAULT_TARGETS, OFFICE_HOURS as SLA_OFFICE_HOURS } from '../../../sla/src/seed/default-policy.js';

/**
 * The planner (A4 §1.10–§1.15, §7.2): deterministic, faithful to the story,
 * and doing MOD-07's maths exactly as the replay will. Built on the fixture
 * library, which follows `content-types.ts` (SPEC §15.0 rule 8); the bands over
 * many T0s are `plan-bands.test.ts`.
 */

const DAY_T0 = Date.parse('2026-10-02T09:40:00Z'); // Friday 10:40 BST: day mode
const NIGHT_T0 = Date.parse('2026-10-03T23:00:30Z'); // Sunday 00:00:30 BST: night mode
const input = (anchor: number, extra: Partial<DemoPlanInput> = {}): DemoPlanInput => ({
  seed: 20261002,
  anchor,
  scale: 1,
  historyDays: 120,
  generatorVersion: DEMO_GENERATOR_VERSION,
  ...extra,
});
const plan = (anchor: number, extra: Partial<DemoPlanInput> = {}, content: DemoContent = FIXTURE_CONTENT) => planWithContent(input(anchor, extra), content);
const OPEN = new Set(['new', 'in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'reopened']);
const within = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= tolerance * target;

let day: DemoPlan;
let night: DemoPlan;
beforeAll(() => {
  day = plan(DAY_T0);
  night = plan(NIGHT_T0);
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ Determinism (W8) */

describe('determinism', () => {
  it('gives an equal plan hash for equal inputs, T0 floored to the minute', () => {
    expect(planHash(plan(DAY_T0))).toBe(planHash(day));
    expect(planHash(plan(DAY_T0 + 59_000))).toBe(planHash(day));
  }, 60_000);

  it('gives a different hash for another T0, seed or scale', () => {
    const hash = planHash(day);
    expect(planHash(plan(DAY_T0 + MINUTE_MS))).not.toBe(hash);
    expect(planHash(plan(DAY_T0, { seed: 7 }))).not.toBe(hash);
    expect(planHash(plan(DAY_T0, { scale: 0.5 }))).not.toBe(hash);
  }, 60_000);

  it('reads no clock and no global randomness', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random was called');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now was called');
    });
    expect(() => plan(DAY_T0, { scale: 0.2 })).not.toThrow();
  }, 60_000);

  it('tells a ticket of a calendar day the same story in every plan whose window holds that day', () => {
    const later = plan(DAY_T0 + 7 * DAY_MS);
    const story = (ticket: PlannedTicket) => [ticket.title, ticket.description, ticket.requester, ticket.priority, ticket.channel, ticket.subcategory, ticket.type, ticket.createdAt].join('|');
    const before = new Map(day.tickets.filter((t) => t.ref.startsWith('demo:t:')).map((t) => [t.ref, story(t)]));
    const shared = later.tickets.filter((t) => before.has(t.ref));
    expect(shared.length).toBeGreaterThan(1500);
    const same = shared.filter((t) => before.get(t.ref) === story(t)).length;
    expect(same / shared.length).toBeGreaterThan(0.995);
    // The same day's tickets, with the same refs, in both.
    const refsOn = (p: DemoPlan, date: string) => p.tickets.filter((t) => t.ref.startsWith(`demo:t:${date}:`)).map((t) => t.ref).sort();
    expect(refsOn(later, '2026-09-28')).toEqual(refsOn(day, '2026-09-28'));
    expect(refsOn(day, '2026-09-28').length).toBeGreaterThan(10);
  }, 60_000);
});

/* ------------------------------------------------------------------ The numbers (A4 §1.10.3, §1.11) */

describe('a plan at full scale', () => {
  it('holds the totals of A4 §1.10.3', () => {
    expect(within(day.totals.tickets, 1850, 0.05)).toBe(true);
    expect(within(day.totals.ticketsLast90Days, 1400, 0.1)).toBe(true);
    // A4's ≈ 430 counts the arrivals; the 30 days also hold the heroes, the
    // reports of MI-0003 and MI-0004 and the queue's story tickets (≈ 55).
    expect(day.totals.ticketsLast30Days).toBeGreaterThan(430 * 0.95);
    expect(day.totals.ticketsLast30Days).toBeLessThan(430 * 1.3);
    expect(day.totals.people).toBe(249);
    expect(day.problems).toHaveLength(8);
    expect(day.changes).toHaveLength(42);
    expect(day.majorIncidents).toHaveLength(4);
    expect(day.knowledge).toHaveLength(26);
    expect(day.knowledge.filter((a) => a.state === 'published')).toHaveLength(24);
    expect(day.aiSamples).toHaveLength(60);
    expect(day.notifications).toHaveLength(12);
    expect(within(day.totals.comments, 7500, 0.25)).toBe(true);
    expect(within(day.totals.events, 9000, 0.25)).toBe(true);
    expect(within(day.totals.tasks, 240, 0.25)).toBe(true);
    expect(within(day.totals.timeEntries, 1000, 0.2)).toBe(true);
    expect(within(day.totals.surveyInvitations, 1250, 0.2)).toBe(true);
    const responseRate = day.totals.surveyResponses / day.totals.surveyInvitations;
    expect(responseRate).toBeGreaterThan(0.26);
    expect(responseRate).toBeLessThan(0.34);
  });

  it('has about 90 open tickets at T0, plus the live incident’s reports', () => {
    for (const p of [day, night]) {
      const open = p.tickets.filter((t) => OPEN.has(t.status));
      const reports = open.filter((t) => t.majorIncident === 4).length;
      expect(reports).toBe(p.mode === 'day' ? 18 : 9);
      expect(open.length - reports).toBeGreaterThan(70);
      expect(open.length - reports).toBeLessThan(115);
    }
  });

  it('plans the SLA split of A4 §1.11 over the 30 days before T0', () => {
    const { attainment30d } = day.expectations;
    expect(Math.abs(attainment30d.response - 92)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(attainment30d.update - 80)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(attainment30d.resolution - 84)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(attainment30d.overall - 85)).toBeLessThanOrEqual(1.5);
  });

  it('averages 4.35–4.45 stars over the 30 days, from A4’s star shares', () => {
    const from = day.anchor - 30 * DAY_MS;
    const stars = day.surveys.flatMap((s) => (s.response && s.response.at >= from ? [s.response.stars] : []));
    const mean = stars.reduce((sum, n) => sum + n, 0) / stars.length;
    expect(mean).toBeGreaterThanOrEqual(4.35);
    expect(mean).toBeLessThanOrEqual(4.45);
    expect(starCounts(100)).toEqual({ 5: 61, 4: 26, 3: 8, 2: 3, 1: 2 });
    expect(Object.values(starCounts(37)).reduce((a, b) => a + b, 0)).toBe(37);
    expect(Object.values(STAR_SHARES).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('never writes an import, api, slack or WhatsApp channel', () => {
    for (const ticket of day.tickets) expect(['portal', 'email', 'teams', 'voice', 'mobile', 'system']).toContain(ticket.channel);
  });

  it('keeps every invariant of V8 and leaves no brace in any description (V10)', () => {
    for (const p of [day, night]) {
      const byRef = new Map(p.tickets.map((t) => [t.ref, t]));
      for (const approval of p.approvals) {
        if (approval.subject.kind !== 'ticket') continue;
        const ticket = byRef.get(approval.subject.ref)!;
        expect(ticket, approval.subject.ref).toBeDefined();
        expect(ticket.status).not.toBe('cancelled');
        if (approval.outcome === 'pending') expect(ticket.status).toBe('pending_approval');
      }
      for (const ticket of p.tickets) {
        for (const due of Object.values(ticket.sla.dueAt)) {
          expect(due! < p.anchor || due! > p.anchor + 10 * MINUTE_MS, `${ticket.ref} due ${new Date(due!).toISOString()}`).toBe(true);
        }
        expect(ticket.description).not.toMatch(/[{}]/);
        expect(ticket.title).not.toMatch(/[{}]/);
      }
    }
  });

  it('stores timelines that replay to the planned verdicts', () => {
    const calendar = new StoryCalendar(FIXTURE_CONTENT.holidays);
    for (const ticket of day.tickets) {
      const replayed = evaluateSla(
        {
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          requester: ticket.requester,
          statusChanges: ticket.events.flatMap((event) => (event.kind === 'status' ? [{ at: event.at, to: event.to }] : [])),
          publicComments: ticket.comments.filter((c) => c.visibility === 'public').map((c) => ({ at: c.at, author: c.author })),
        },
        day.anchor,
        calendar.clockFor(ticket.priority),
      );
      expect({ response: replayed.response.verdict, update: replayed.update.verdict, resolution: replayed.resolution.verdict }, ticket.ref).toEqual(ticket.sla.verdicts);
    }
  });

  it('keeps every timeline in order, inside the ticket’s life and before T0', () => {
    for (const p of [day, night]) {
      for (const ticket of p.tickets) {
        let previous = ticket.createdAt;
        expect(ticket.events[0]?.kind, ticket.ref).toBe('created');
        for (const event of ticket.events) {
          expect(event.at, ticket.ref).toBeGreaterThanOrEqual(previous);
          previous = event.at;
        }
        expect(previous, ticket.ref).toBeLessThan(p.anchor);
        for (const comment of ticket.comments) {
          expect(comment.at, ticket.ref).toBeGreaterThanOrEqual(ticket.createdAt);
          expect(comment.at, ticket.ref).toBeLessThan(p.anchor);
        }
      }
    }
  });

  it('closes no cancelled ticket with an approval and leaves no approval undecided but the story’s', () => {
    expect(day.expectations.pendingApprovals.map((a) => `${a.subject} → ${a.approver}`).sort()).toEqual(
      [
        'CHG-1188 → jordan-lee',
        'CHG-1189 → jordan-lee',
        'demo:hero:H4 → mark-ellison',
        'demo:o:approval:1 → emma-clarke',
        'demo:o:approval:2 → emma-clarke',
        'demo:o:approval:3 → emma-clarke',
      ].sort(),
    );
  });
});

/* ------------------------------------------------------------------ What each persona sees first (A4 §1.12) */

describe('the personas’ first screens', () => {
  const heroes = (p: DemoPlan) => new Map(p.tickets.filter((t) => t.hero).map((t) => [t.hero!, t]));

  it('plans every hero, in its state, and routes every Service Desk hero through service-desk', () => {
    for (const p of [day, night]) {
      const planned = heroes(p);
      expect(planned.size).toBe(FIXTURE_CONTENT.heroes.length);
      for (const hero of FIXTURE_CONTENT.heroes) {
        const ticket = planned.get(hero.key)!;
        expect(ticket.ref).toBe(demoHeroRef(hero.key));
        expect(ticket.status, hero.key).toBe(hero.status);
        expect(ticket.team).toBe(hero.team);
        expect(ticket.assignee).toBe(hero.assignee);
      }
      for (const key of DEMO_SD_HEROES) expect(planned.get(key)!.team).toBe('service-desk');
    }
  });

  it('gives Alex exactly his nine: P2 2 · P3 4 · P4 3, three waiting, one breached, one due within the hour, one customer reply', () => {
    for (const p of [day, night]) {
      const mine = p.tickets.filter((t) => t.assignee === 'alex-morgan' && OPEN.has(t.status));
      expect(mine.map((t) => t.hero).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'H1', 'H2', 'H3', 'H4', 'H5'].sort());
      const byPriority = (priority: string) => mine.filter((t) => t.priority === priority).length;
      expect([byPriority('P2'), byPriority('P3'), byPriority('P4')]).toEqual([2, 4, 3]);
      expect(mine.filter((t) => t.status.startsWith('pending_')).length).toBe(3);
      expect(mine.filter((t) => Object.values(t.sla.verdicts).includes('breached')).map((t) => t.hero)).toEqual(['A2']);
      // "Due within an hour" is the next business hour: T0 + 40 min by day, 09:40 the next morning at night.
      const dueSoon = mine.filter((t) => t.sla.dueAt.resolution !== undefined && clockMinutes(p, t.sla.dueAt.resolution) <= 60);
      expect(dueSoon.map((t) => t.hero)).toEqual(['A1']);
      const replied = mine.filter((t) => {
        const last = t.comments.filter((c) => c.visibility === 'public').at(-1);
        return last?.author === t.requester;
      });
      expect(replied.map((t) => t.hero)).toEqual(['H1']);
    }
  });

  it('times the heroes against T0 in business time, by day and at night', () => {
    const minutesTo = (p: DemoPlan, key: string, target: 'response' | 'resolution') => clockMinutes(p, heroes(p).get(key as never)!.sla.dueAt[target]!);
    for (const p of [day, night]) {
      expect(minutesTo(p, 'A1', 'resolution')).toBe(40);
      expect(minutesTo(p, 'A3', 'response')).toBe(25);
      expect(minutesTo(p, 'H1', 'resolution')).toBe(360);
      expect(minutesTo(p, 'H2', 'resolution')).toBe(180);
      expect(minutesTo(p, 'H9', 'response')).toBe(70);
    }
    // A2 breached at 15:10 on the previous business day.
    const a2 = heroes(day).get('A2')!;
    expect(a2.sla.verdicts.resolution).toBe('breached');
    // H1's customer replied two hours ago; E3 was raised 25 minutes ago by day, at 18:10 the evening before at night.
    expect(day.anchor - heroes(day).get('H1')!.comments.at(-1)!.at).toBe(2 * HOUR_MS);
    expect(day.anchor - heroes(day).get('E3')!.createdAt).toBe(25 * MINUTE_MS);
    expect(londonWall(heroes(night).get('E3')!.createdAt).minutes).toBe(18 * 60 + 10);
    expect(londonWall(heroes(day).get('E4')!.resolvedAt!).minutes).toBe(16 * 60 + 40);
  });

  it('shows Emma her four open requests, one “Is it fixed?” and three approvals', () => {
    for (const p of [day, night]) {
      const emma = p.tickets.filter((t) => t.requester === 'emma-clarke');
      expect(emma.filter((t) => OPEN.has(t.status)).map((t) => t.hero).sort()).toEqual(['E1', 'E2', 'E3', 'H11']);
      expect(emma.filter((t) => t.status === 'resolved').map((t) => t.hero)).toEqual(['E4']);
      expect(p.approvals.filter((a) => a.approver === 'emma-clarke' && a.outcome === 'pending')).toHaveLength(3);
    }
  });

  it('leaves six unassigned in the Service Desk’s queue, plus the live incident’s unowned reports', () => {
    for (const p of [day, night]) {
      const unassigned = p.tickets.filter((t) => t.team === 'service-desk' && t.assignee === null && OPEN.has(t.status));
      const reports = unassigned.filter((t) => t.majorIncident === 4).length;
      expect(reports).toBe(p.mode === 'day' ? 11 : 5);
      expect(unassigned.filter((t) => t.majorIncident !== 4).map((t) => t.hero ?? 'generated').sort()).toEqual(
        ['H10', 'H8', 'H9', 'generated', 'generated', 'generated'].sort(),
      );
    }
  });

  it('credits Alex with seven resolutions in the last two business days, H12 among them', () => {
    const calendar = new StoryCalendar(FIXTURE_CONTENT.holidays);
    const from = ukInstant(calendar.businessDaysBefore(londonWall(day.anchor).dateKey, 2), 0);
    const resolved = day.tickets.filter((t) => t.assignee === 'alex-morgan' && t.resolvedAt !== null && t.resolvedAt >= from);
    expect(resolved).toHaveLength(7);
    expect(resolved.map((t) => t.hero).filter(Boolean)).toEqual(['H12']);
  });

  it('runs the live major incident in mitigating by day and monitoring at night, with Jordan’s two CAB approvals', () => {
    expect(day.expectations.liveIncidentState).toBe('mitigating');
    expect(night.expectations.liveIncidentState).toBe('monitoring');
    const live = night.majorIncidents.find((mi) => mi.number === 4)!;
    expect(londonWall(live.nextUpdateDueAt!).minutes).toBe(8 * 60 + 30);
    expect(live.updateIntervalMinutes).toBeLessThanOrEqual(1440);
    for (const p of [day, night]) {
      expect(p.approvals.filter((a) => a.approver === 'jordan-lee' && a.outcome === 'pending' && a.policy === 'cab')).toHaveLength(2);
      expect(p.expectations.warrantiesWithin30Days).toBe(23);
      expect(p.notifications.filter((n) => n.readAt === null)).toHaveLength(9);
      expect(p.aiSamples.filter((s) => s.response === 'untouched' && s.ticketRef.startsWith('demo:hero:')).map((s) => s.ticketRef).sort()).toEqual(['demo:hero:H5', 'demo:hero:H8']);
    }
  });

  it('builds the personas exactly as the persona table says', () => {
    for (const persona of DEMO_PERSONAS) {
      const person = day.people.find((p) => p.email === persona.email)!;
      expect(`${person.firstName} ${person.lastName}`).toBe(persona.name);
      expect([...person.roles].sort()).toEqual([...persona.roles].sort());
      expect(person.persona).toBe(persona.key);
    }
    expect(day.teams.find((t) => t.key === 'service-desk')!.lead).toBe('alex-morgan');
    expect(new Set(day.people.map((p) => p.email)).size).toBe(day.people.length);
    for (const person of day.people) expect(person.email.endsWith('@northwind.example')).toBe(true);
  });
});

/** Business minutes from T0 to `due` on the office calendar. */
function clockMinutes(p: DemoPlan, due: number): number {
  const calendar = new StoryCalendar(FIXTURE_CONTENT.holidays);
  return Math.round(calendar.businessClock.elapsed(p.anchor, due) / MINUTE_MS);
}

/* ------------------------------------------------------------------ MOD-07's maths */

describe('the SLA maths, as MOD-07 does them', () => {
  const calendar = new StoryCalendar(FIXTURE_CONTENT.holidays);
  const at = (iso: string) => Date.parse(iso);

  it('adds and counts business time exactly as @itsm/business-time does', () => {
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const business = northwindCalendar(FIXTURE_CONTENT.holidays);
    for (let i = 0; i < 1500; i += 1) {
      const from = Date.UTC(2026, 5, 1) + Math.floor(next() * 500 * DAY_MS);
      const ms = Math.floor(next() * 40 * HOUR_MS);
      expect(calendar.businessClock.add(from, ms)).toBe(addBusinessMs(new Date(from), ms, business).getTime());
      const to = from + Math.floor(next() * 20 * DAY_MS);
      expect(calendar.businessClock.elapsed(from, to)).toBe(elapsedBusinessMs(new Date(from), new Date(to), business));
      const back = calendar.businessClock.before(to, ms);
      expect(calendar.businessClock.elapsed(back, to)).toBe(ms);
      expect(calendar.allHoursClock.add(from, ms)).toBe(addBusinessMs(new Date(from), ms, TWENTY_FOUR_SEVEN).getTime());
    }
  });

  it('runs the product’s office hours and default targets', () => {
    expect(OFFICE_HOURS).toEqual(SLA_OFFICE_HOURS);
    for (const row of DEFAULT_TARGETS) {
      const priority = row.priority as keyof typeof SLA_TARGET_MINUTES;
      expect(SLA_TARGET_MINUTES[priority]).toEqual({ response: row.response, update: row.update, resolution: row.resolution });
    }
  });

  it('pauses, resumes, stops and cancels as the state machine says', () => {
    for (const [state, definition] of Object.entries(STATES)) {
      expect(RESOLUTION_CLOCK[state as keyof typeof RESOLUTION_CLOCK], state).toBe(definition.sla.resolutionTimer);
    }
  });

  it('meets response on the first reply by anyone but the requester; only a person restarts the update cycle', () => {
    const created = at('2026-10-05T08:00:00Z'); // Monday 09:00 BST
    const result = evaluateSla(
      {
        priority: 'P3',
        createdAt: created,
        requester: 'r',
        statusChanges: [],
        publicComments: [
          { at: created + 30 * MINUTE_MS, author: 'r' },
          { at: created + 60 * MINUTE_MS, author: null },
          { at: created + 7 * HOUR_MS, author: 'agent' },
        ],
      },
      created + 8 * HOUR_MS,
      calendar.businessClock,
    );
    // The requester's own message met nothing; the automated reply met response.
    expect(result.response.verdict).toBe('met');
    expect(result.response.metAt).toBe(created + 60 * MINUTE_MS);
    // It did not restart the update cycle: only the agent's reply at +7 h did,
    // inside the first cycle's 480 business minutes.
    expect(result.update.verdict).toBe('running');
    expect(result.update.dueAt).toBe(calendar.businessClock.add(created + 7 * HOUR_MS, 480 * MINUTE_MS));
  });

  it('breaches at the due instant, once, and keeps the update cadence after it (U4, U5)', () => {
    const created = at('2026-10-05T08:00:00Z');
    const sim = new SlaSim('P1', created, calendar.allHoursClock);
    sim.reply(created + 10 * MINUTE_MS, true); // response met; update cycle 2 due at +40
    sim.breachDue(created + 41 * MINUTE_MS);
    expect(sim.view('update').breachedAt).toBe(created + 40 * MINUTE_MS);
    sim.reply(created + 50 * MINUTE_MS, true); // the cadence carries on
    expect(sim.view('update').dueAt).toBe(created + 80 * MINUTE_MS);
    sim.breachDue(created + 90 * MINUTE_MS); // a second miss: still the first breach
    expect(sim.view('update').breachedAt).toBe(created + 40 * MINUTE_MS);
    sim.changeStatus(created + 100 * MINUTE_MS, 'resolved');
    expect(sim.view('update').verdict).toBe('breached');
    expect(sim.view('response').verdict).toBe('met');
    expect(sim.view('resolution').verdict).toBe('met');
  });

  it('treats a reply landing exactly on the due instant as late, as the replay does', () => {
    const created = at('2026-10-05T08:00:00Z');
    const sim = new SlaSim('P1', created, calendar.allHoursClock);
    sim.reply(created + 15 * MINUTE_MS, true);
    expect(sim.view('response').verdict).toBe('breached');
  });

  it('pauses everything but response while the ticket waits, and resumes with what was left', () => {
    const created = at('2026-10-05T08:00:00Z');
    const sim = new SlaSim('P2', created, calendar.businessClock);
    sim.reply(created + 30 * MINUTE_MS, true);
    sim.changeStatus(created + 30 * MINUTE_MS, 'in_progress');
    sim.changeStatus(created + 2 * HOUR_MS, 'pending_requester');
    expect(sim.view('resolution').dueAt).toBeNull();
    expect(sim.view('update').state).toBe('paused');
    sim.changeStatus(created + 2 * DAY_MS, 'in_progress');
    // 120 business minutes used of 480: 360 left from the resume.
    expect(sim.view('resolution').dueAt).toBe(calendar.businessClock.add(created + 2 * DAY_MS, 360 * MINUTE_MS));
  });

  it('cancels what is still running and leaves a breach a breach', () => {
    const created = at('2026-10-05T08:00:00Z');
    const sim = new SlaSim('P1', created, calendar.allHoursClock);
    sim.changeStatus(created + 20 * MINUTE_MS, 'cancelled');
    expect(sim.view('response').verdict).toBe('breached');
    expect(sim.view('update').verdict).toBe('cancelled');
    expect(sim.view('resolution').verdict).toBe('cancelled');
  });
});

/* ------------------------------------------------------------------ Guards */

describe('the planner’s guards', () => {
  it('refuses inputs outside the configuration’s ranges', () => {
    expect(() => plan(DAY_T0, { scale: 0.05 })).toThrow(PlanInputError);
    expect(() => plan(DAY_T0, { scale: 1.5 })).toThrow(PlanInputError);
    expect(() => plan(DAY_T0, { historyDays: 30 })).toThrow(PlanInputError);
    expect(() => plan(DAY_T0, { seed: -1 })).toThrow(PlanInputError);
    expect(() => plan(Number.NaN)).toThrow(PlanInputError);
  });

  it('refuses a template with a slot it may not use, before writing anything', () => {
    const broken: DemoContent = {
      ...FIXTURE_CONTENT,
      titles: { ...FIXTURE_CONTENT.titles, outlook: { ...FIXTURE_CONTENT.titles.outlook, titles: ['Outlook broken in {city}'] } },
    };
    expect(() => plan(DAY_T0, { scale: 0.2 }, broken)).toThrow(TemplateError);
  });

  it('refuses a cast without a person the story needs, or with a persona who is not the table’s', () => {
    const missing: DemoContent = { ...FIXTURE_CONTENT, people: { ...FIXTURE_CONTENT.people, cast: FIXTURE_CONTENT.people.cast.filter((m) => m.key !== STORY_CAST_KEYS[3]) } };
    expect(() => plan(DAY_T0, { scale: 0.2 }, missing)).toThrow(ContentError);
    const wrongRoles: DemoContent = {
      ...FIXTURE_CONTENT,
      people: { ...FIXTURE_CONTENT.people, cast: FIXTURE_CONTENT.people.cast.map((m) => (m.key === 'emma-clarke' ? { ...m, roles: ['agent'] } : m)) },
    };
    expect(() => plan(DAY_T0, { scale: 0.2 }, wrongRoles)).toThrow(ContentError);
  });
});

/* ------------------------------------------------------------------ The package (A4 §2.2, SPEC §5.2) */

describe('the demo module', () => {
  it('is a platform module with its three jobs on the demo queue and nothing for a tenant to see', () => {
    expect(demoManifest).toMatchObject({ id: 'MOD-25', key: 'demo', audience: 'platform', permissions: [], events: { publishes: [], consumes: [] }, optional: false, enabledByDefault: false });
    expect(isTenantModule(demoManifest)).toBe(false);
    expect(demoManifest.jobs).toEqual([
      expect.objectContaining({ name: DEMO_JOB_NAMES.check, queue: 'demo', schedule: '* * * * *' }),
      expect.objectContaining({ name: DEMO_JOB_NAMES.reset, queue: 'demo' }),
      expect.objectContaining({ name: DEMO_JOB_NAMES.purge, queue: 'demo' }),
    ]);
    expect(demoManifest.jobs.filter((job) => job.schedule)).toHaveLength(1);
  });

  it('reads its configuration from the platform’s, with A4’s defaults', () => {
    const config = demoConfigFrom({
      DEMO_MODE: 'on',
      DEMO_TENANT_SLUG: 'demo',
      BOOTSTRAP_TENANT_SLUG: 'acme',
      DEMO_SEED: 20261002,
      DEMO_SCALE: 0.2,
      DEMO_HISTORY_DAYS: 120,
      DEMO_BUILD_TIMEOUT_SECONDS: 900,
      DEMO_RESET_COOLDOWN_SECONDS: 1800,
      DEMO_BUILD_PARALLELISM: 2,
    } as never);
    expect(config).toEqual({
      mode: 'on',
      tenantSlug: 'demo',
      bootstrapSlug: 'acme',
      seed: 20261002,
      scale: 0.2,
      historyDays: 120,
      buildTimeoutSeconds: 900,
      cooldownSeconds: 1800,
      parallelism: 2,
      generatorVersion: DEMO_GENERATOR_VERSION,
    });
  });
});

describe('the parts contract', () => {
  const stubInput = (): Omit<PartInput, 'ids'> => ({
    ctx: demoBuildContext('00000000-0000-7000-8000-000000000001'),
    plan: {} as DemoPlan,
    build: { tenantId: '00000000-0000-7000-8000-000000000001', slug: 'demo-build-g1-abcdef', generation: 1, reason: 'initial', ledgerId: 'l', parallelism: 2 },
  });

  it('lists the nineteen parts in order, configuration then history, each reporting a build step that only moves forward', () => {
    const parts = [...CONFIG_PARTS, ...HISTORY_PARTS];
    expect(parts.map((part) => part.key)).toEqual([...PART_KEYS]);
    let last = 0;
    for (const part of parts) {
      expect(part.step).toBe(PART_STEPS[part.key]);
      const index = DEMO_BUILD_STEPS.indexOf(part.step);
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
  });

  it('refuses to run a part whose package has not landed', async () => {
    await expect(runParts(CONFIG_PARTS, stubInput())).rejects.toBeInstanceOf(PartNotBuiltError);
  });

  it('hands each part the ids the ones before it created, and refuses a part that re-creates one', async () => {
    const seen: string[][] = [];
    const part = (key: (typeof PART_KEYS)[number], users: Record<string, string>): DemoPart => ({
      key,
      step: PART_STEPS[key],
      run: async (input) => {
        seen.push(Object.keys(input.ids.users));
        return { users };
      },
    });
    const durations: string[] = [];
    const ids = await runParts([part('01-tenant', { a: '1' }), part('02-people', { b: '2' })], stubInput(), { afterPart: (p) => void durations.push(p.key) });
    expect(seen).toEqual([[], ['a']]);
    expect(ids.users).toEqual({ a: '1', b: '2' });
    expect(durations).toEqual(['01-tenant', '02-people']);
    expect(() => mergeIds(ids, { users: { a: '9' } }, '03-catalogue')).toThrow(PartContractError);
    expect(mergeIds(emptyIds(), { tickets: { 'demo:hero:H1': 't' } }, '08-tickets').tickets).toEqual({ 'demo:hero:H1': 't' });
  });

  it('stops between parts when the worker shuts down', async () => {
    const controller = new AbortController();
    const ran: string[] = [];
    const part = (key: (typeof PART_KEYS)[number]): DemoPart => ({
      key,
      step: PART_STEPS[key],
      run: async () => {
        ran.push(key);
        controller.abort(new Error('shutting down'));
        return {};
      },
    });
    await expect(runParts([part('01-tenant'), part('02-people')], { ...stubInput(), signal: controller.signal })).rejects.toThrow('shutting down');
    expect(ran).toEqual(['01-tenant']);
  });

  it('runs every part as the system actor demo-build, with no actor id for a uuid column to choke on', () => {
    const ctx = demoBuildContext('00000000-0000-7000-8000-000000000001', 'corr-1');
    expect(ctx.actor).toEqual({ type: 'system', id: null, displayName: 'demo-build' });
    expect(ctx.permissions.isSystem).toBe(true);
    expect(ctx.correlationId).toBe('corr-1');
  });
});
