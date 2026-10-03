import type { CanonicalState, Priority } from '@itsm/contracts';
import { DEMO_COMPANY, demoHeroRef } from '@itsm/contracts/demo';
import { NORTHWIND_CALENDAR_KEY, StoryCalendar, type BusinessClock } from './calendar.js';
import type { DemoContent, RequestItemKey, SubcategoryKey, TeamKey, TicketChannel } from './content-types.js';
import { CATEGORY_KEYS, SUBCATEGORIES, TEAM_KEYS, TICKET_CHANNELS, categoryOfSubcategory } from './content-types.js';
import { buildLife, type TicketDraw, type TicketLife } from './lifecycle.js';
import {
  APPROVAL_VARIANT_SHARE,
  STAR_SHARES,
  BREACH_ODDS,
  ATTAINMENT_TARGETS,
  BASE_TICKETS_AT_FULL_SCALE,
  PRIORITY_TARGET_P2,
  BREACH_ODDS_SCALE,
  BREACH_STAR_PENALTY,
  CANCELLED_SHARE,
  CATALOGUE_SHARE,
  CATEGORIES,
  DAILY_NOISE_CV,
  HOLIDAY_LAMBDA,
  OFF_HOURS_CHANNELS,
  REOPENED_SHARE,
  REQUEST_ITEMS,
  SUBCATEGORY_MODELS,
  SURVEY_INVITE_SHARE,
  SURVEY_PORTAL_SHARE,
  SURVEY_RESPONSE_SHARE,
  TARGET_TYPES,
  TREND_AMPLITUDE,
  TREND_EPOCH,
  WAIT_SHARES,
  WEEKDAY_FACTORS,
  WEEKDAY_HOURS,
  WEEKDAY_LAMBDA,
  WEEKEND_LAMBDA,
  WORKING_HOURS_CHANNELS,
  type TargetType,
} from './model.js';
import { planHero } from './heroes.js';
import { planObjects } from './objects.js';
import { planPeople, workersOf } from './people.js';
import { poissonAt, quantile, streamFor, weightedPick, type Stream } from './rng.js';
import { attainment, evaluateSla, targetMs } from './sla-plan.js';
import { majorIncidentAcknowledgement, majorIncidentReportCounts, planMajorIncidents, planWorkforce, type MajorIncidentTicketSpec } from './story.js';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  addDays,
  dateKeyOfDay,
  dayNumber,
  floorToMinute,
  storyModeAt,
  ukDateKeyOf,
  ukInstant,
  weekdayOf,
  type DateKey,
  type Instant,
} from './time.js';
import type {
  DemoPlan,
  PlannedApproval,
  PlannedComment,
  PlannedEvent,
  PlannedPerson,
  PlannedSurvey,
  PlannedTicket,
  PlannedTimeEntry,
} from './types.js';
import { Words } from './words.js';

/**
 * `planGeneration`'s engine, given the content library (A4 §1.10–§1.15).
 *
 * Three kinds of ticket make a history:
 *
 * 1. **Days** (`demo:t:<UK date>:<nn>`): the arrivals of each calendar day,
 *    keyed on the date and built for their whole life without looking at T0.
 *    Tonight's build and next week's tell the same story about 28 September;
 *    only where T0 cuts it differs.
 * 2. **Overlays** keyed on T0 (`demo:o:…`, `demo:mi:…`): the Windows 11
 *    rollout, the four major incidents and their reports, the approvals on
 *    Emma's desk, and the three fresh tickets in the Service Desk's queue.
 * 3. **Heroes** (`demo:hero:<key>`): the presenter's script, re-timed against
 *    every T0 (`heroes.ts`).
 *
 * Then a few touches tie the days to T0 without changing what they say:
 * Alex's queue holds only his heroes, six of the tickets resolved in the last
 * two business days were his, no pending approval sits outside §1.9.5's list,
 * and no running clock falls due within ten minutes of T0 (V8).
 */

export interface DemoPlanInput {
  readonly seed: number;
  /** T0: the build instant; floored to the minute. */
  readonly anchor: Date | number;
  /** 0.1–1. */
  readonly scale: number;
  /** 60–150. */
  readonly historyDays: number;
  readonly generatorVersion: string;
}

const ALEX = 'alex-morgan';
const JORDAN = 'jordan-lee';
const EMMA = 'emma-clarke';

export class PlanInputError extends RangeError {}

function validate(input: DemoPlanInput): void {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) throw new PlanInputError(`seed must be a 32-bit whole number: ${input.seed}`);
  if (!(input.scale >= 0.1 && input.scale <= 1)) throw new PlanInputError(`scale must be in 0.1–1: ${input.scale}`);
  if (!Number.isInteger(input.historyDays) || input.historyDays < 60 || input.historyDays > 150) {
    throw new PlanInputError(`history days must be a whole number in 60–150: ${input.historyDays}`);
  }
  const anchor = typeof input.anchor === 'number' ? input.anchor : input.anchor.getTime();
  if (!Number.isFinite(anchor)) throw new PlanInputError('the anchor must be a real instant');
}

function trend(date: DateKey): number {
  const phase = (2 * Math.PI * (dayNumber(date) - dayNumber(TREND_EPOCH))) / 365 - Math.PI / 2;
  return 1 + TREND_AMPLITUDE * Math.sin(phase);
}

interface Slot {
  readonly ref: string;
  readonly date: DateKey;
  readonly day: number;
  readonly position: number;
  readonly createdAt: Instant;
  readonly offHours: boolean;
  readonly monthEnd: boolean;
  /** Overlay rules: a fixed subcategory, doubled breach odds. */
  readonly subcategory?: SubcategoryKey;
  readonly doubled?: boolean;
  readonly priority?: Priority;
}

/** A drawn ticket, before its breaches are assigned. */
interface Drawn {
  draw: TicketDraw;
  variant?: 'standard' | 'approved';
  /** Each target's odds of breaching. */
  odds: Record<TargetType, number>;
  /** Its breaches are part of the story (none for the early VPN reports), not drawn. */
  fixedBreach?: boolean;
}

/** Built in `planWithContent`; a ticket's draw, life and plan row together. */
interface Built {
  draw: TicketDraw;
  life: TicketLife;
  ticket: PlannedTicket;
  slot: Slot;
  variant?: 'standard' | 'approved';
}

export function planWithContent(input: DemoPlanInput, content: DemoContent): DemoPlan {
  validate(input);
  Words.assertTemplates(content);
  const seed = input.seed;
  const t0 = floorToMinute(typeof input.anchor === 'number' ? input.anchor : input.anchor.getTime());
  const t0Date = ukDateKeyOf(t0);
  const calendar = new StoryCalendar(content.holidays);
  const office = calendar.businessClock;
  const mode = storyModeAt(t0, (key) => calendar.isBusinessDay(key));

  /* -------------------------------------------------- People */
  const org = planPeople(content, seed);
  const person = new Map(org.people.map((p) => [p.key, p]));
  const firstNameOf = (key: string): string => person.get(key)?.firstName ?? 'there';
  const team = new Map(org.teams.map((t) => [t.key, t]));
  const notWorkers = new Set([ALEX, JORDAN]);
  const workers = Object.fromEntries(TEAM_KEYS.map((key) => [key, workersOf(team.get(key)!, notWorkers)])) as Record<TeamKey, string[]>;
  const leadOf = (key: TeamKey): string => team.get(key)!.lead;
  const personas = new Set(org.people.filter((p) => p.persona).map((p) => p.key));
  const requesters = org.people.filter((p) => p.kind !== 'monitoring' && !p.team && !personas.has(p.key)).map((p) => p.key);
  const leedsRequesters = org.people.filter((p) => p.site === 'leeds' && !p.team).map((p) => p.key);
  const remoteRequesters = org.people.filter((p) => (p.site === 'field' || p.function === 'sales') && !p.team && !personas.has(p.key)).map((p) => p.key);

  /* -------------------------------------------------- Assets */
  const laptopTags = Array.from({ length: 245 }, (_, i) => `NW-LT-${String(i + 1).padStart(4, '0')}`);
  const words = new Words(
    content,
    laptopTags,
    org.people.filter((p) => p.kind === 'generated').map((p) => p.firstName),
  );

  const clockFor = (priority: Priority): BusinessClock => calendar.clockFor(priority);
  const tools = (priority: Priority) => ({ clock: clockFor(priority), office, words });

  /*
   * A4's priority mix (P2 10 %) is the whole history's, the story's own P2
   * reports included: the major incidents' (fixed for the live one) and the
   * P2 heroes. At a small scale those are a larger share of fewer tickets, so
   * the days' own P2 share gives way by just enough. It depends on the scale
   * and the mode, never on the date, so a day's tickets keep their story.
   */
  const reportCounts = majorIncidentReportCounts(input.scale, mode);
  const storyP2 = reportCounts[1] + reportCounts[2] + reportCounts[3] + reportCounts[4] + content.heroes.filter((hero) => hero.priority === 'P2').length;
  const storyTotal = storyP2 + 2 + 6 + content.heroes.filter((hero) => hero.priority !== 'P2').length;
  const expectedDays = BASE_TICKETS_AT_FULL_SCALE * input.scale;
  const p2Factor = Math.min(1.25, Math.max(0.2, (PRIORITY_TARGET_P2 * (expectedDays + storyTotal) - storyP2) / (expectedDays * baseP2Share())));

  /* -------------------------------------------------- Drawing a ticket */
  const drawTicket = (slot: Slot, overrides: Partial<TicketDraw> = {}): Drawn => {
    const rng = streamFor(seed, 'ticket', slot.ref);
    const q = (channel: string) => quantile(seed, channel, slot.day, slot.position);
    const channel: TicketChannel = weightedPick(slot.offHours ? OFF_HOURS_CHANNELS : WORKING_HOURS_CHANNELS, q('channel'));
    let subcategory: SubcategoryKey;
    if (slot.subcategory) subcategory = slot.subcategory;
    else if (channel === 'system') {
      const monitored = Object.entries(SUBCATEGORY_MODELS).filter(([, model]) => model.monitored);
      subcategory = rng.weighted(
        Object.fromEntries(monitored.map(([key, model]) => [key, CATEGORIES[model.category].share * model.weight])),
      ) as SubcategoryKey;
    } else {
      const category = rng.weighted(Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORIES[key].share])));
      const subs = SUBCATEGORIES[category as keyof typeof SUBCATEGORIES] as readonly SubcategoryKey[];
      subcategory = rng.weighted(Object.fromEntries(subs.map((key) => [key, SUBCATEGORY_MODELS[key].weight]))) as SubcategoryKey;
    }
    const model = SUBCATEGORY_MODELS[subcategory];
    const category = model.category;
    const type = channel === 'system' ? 'incident' : rng.weighted(model.types);
    const mix = { ...CATEGORIES[category].priorities };
    if (slot.monthEnd && category === 'business-apps') mix.P2 *= 2;
    // What P2 gives way, P4 takes: A4's P3 share stays where the categories put it.
    mix.P4 += mix.P2 * (1 - p2Factor);
    mix.P2 *= p2Factor;
    const priority: Priority = slot.priority ?? weightedPick(mix, q('priority'));

    let requester: string;
    if (channel === 'system') requester = 'monitoring';
    else if ((subcategory === 'wms' || subcategory === 'site-connectivity') && rng.chance(0.75) && leedsRequesters.length > 0) requester = rng.pick(leedsRequesters);
    else if (subcategory === 'vpn' && rng.chance(0.6) && remoteRequesters.length > 0) requester = rng.pick(remoteRequesters);
    else requester = rng.pick(requesters);

    const teamKey = model.team;
    const agent = rng.pick(workers[teamKey]);
    const routed = teamKey === 'service-desk' || channel === 'system' || rng.chance(0.7);
    const loggedBy = channel === 'voice' ? (teamKey === 'service-desk' ? agent : rng.pick(workers['service-desk'])) : null;

    // Catalogue and approvals.
    let requestItem: RequestItemKey | undefined;
    let variant: 'standard' | 'approved' | undefined;
    const catalogueDraw = rng.float();
    const itemDraw = rng.float();
    const variantDraw = rng.float();
    if (type === 'request' && channel === 'portal' && model.items && catalogueDraw < CATALOGUE_SHARE) {
      requestItem = subcategory === 'joiners-leavers' ? (itemDraw < 0.55 ? 'new-starter' : 'leaver') : (model.items[Math.floor(itemDraw * model.items.length)] as RequestItemKey);
      if (REQUEST_ITEMS[requestItem].approval === 'variant') variant = variantDraw < APPROVAL_VARIANT_SHARE ? 'approved' : 'standard';
    }
    const needsApproval = requestItem !== undefined && (REQUEST_ITEMS[requestItem].approval === 'always' || variant === 'approved');
    const approverDraw = rng.float();
    const turnaround = Math.min(40, Math.max(0.25, 3.4 * Math.exp(1.08 * rng.normal()))) * HOUR_MS;
    const approval = needsApproval
      ? { approver: person.get(requester)?.managerKey ?? 'richard-hale', outcome: approverDraw < 0.9 ? ('approved' as const) : ('rejected' as const), turnaroundMs: turnaround }
      : null;

    const taskItem = subcategory === 'joiners-leavers' ? (requestItem ?? (itemDraw < 0.55 ? 'new-starter' : 'leaver')) : requestItem;
    const tasks = taskItem ? [...(REQUEST_ITEMS[taskItem].tasks ?? [])] : [];

    const waitDraw = rng.float();
    const outcomeDraw = rng.float();
    const reopenDraw = rng.float();
    const thirdPartyAllowed = category === 'hardware' || category === 'business-apps' || category === 'network';
    const wait = approval ? null : waitDraw < WAIT_SHARES.pending_requester ? 'pending_requester' : waitDraw < WAIT_SHARES.pending_requester + WAIT_SHARES.pending_third_party ? (thirdPartyAllowed ? 'pending_third_party' : 'pending_requester') : null;
    const cancelled = !approval && channel !== 'system' && outcomeDraw < CANCELLED_SHARE;
    // The odds of each target breaching; which tickets do is decided for the
    // whole day at once (`assignBreaches`).
    const doubling = slot.monthEnd || slot.doubled ? 2 : 1;
    const odds = Object.fromEntries(TARGET_TYPES.map((target) => [target, BREACH_ODDS[priority][target] * doubling * BREACH_ODDS_SCALE[target]])) as Record<TargetType, number>;

    const draw: TicketDraw = {
      ref: slot.ref,
      createdAt: slot.createdAt,
      type,
      priority,
      channel,
      category,
      subcategory,
      service: requestItem ? REQUEST_ITEMS[requestItem].service : model.service,
      team: teamKey,
      requester,
      requesterFirstName: firstNameOf(requester),
      agent,
      agentFirstName: firstNameOf(agent),
      lead: leadOf(teamKey),
      routed,
      loggedBy,
      breach: { response: false, update: false, resolution: false },
      outcome: cancelled ? 'cancelled' : 'resolved',
      reopen: !cancelled && reopenDraw < REOPENED_SHARE / (1 - CANCELLED_SHARE),
      wait,
      approval,
      tasks,
      ...(requestItem ? { requestItem } : {}),
      invited: type !== 'question' && q('invite') < SURVEY_INVITE_SHARE,
      ...overrides,
    };
    return variant ? { draw, variant, odds } : { draw, odds };
  };

  /**
   * Which of a group's tickets breach each target: systematic sampling over
   * the group in its fixed order, so a day's breaches number within one of
   * their expectation and any 30 days land on A4's split (§1.11) to a
   * fraction of a point. Independent draws would miss the build's 30-day band
   * by chance about one night in ten, and the build would refuse to swap.
   * The group's start is a low-discrepancy quantile of its day, so the
   * rounding of consecutive days cancels out rather than adding up.
   */
  const assignBreaches = (group: { slot: Slot; drawn: Drawn }[], day: number, key: string): void => {
    for (const target of TARGET_TYPES) {
      if (group.every((entry) => entry.drawn.fixedBreach)) continue;
      let cumulative = quantile(seed, `breach-${key}-${target}`, day, 0);
      for (const entry of group) {
        if (entry.drawn.fixedBreach) continue;
        const before = Math.floor(cumulative);
        cumulative += entry.drawn.odds[target];
        if (Math.floor(cumulative) > before) {
          entry.drawn.draw = { ...entry.drawn.draw, breach: { ...entry.drawn.draw.breach, [target]: true } };
        }
      }
    }
  };

  const textFor = (slot: Slot, draw: TicketDraw) => {
    const rng = streamFor(seed, 'text', slot.ref);
    const text = words.ticketText(draw.subcategory, rng, draw.channel === 'voice');
    const requesterSite = person.get(draw.requester)?.site;
    const custom: PlannedTicket['custom'] = {
      ...(requesterSite ? { site: SITE_LABEL[requesterSite] } : {}),
      ...(draw.category === 'hardware' ? { assetTag: rng.pick(laptopTags) } : {}),
      ...(draw.type === 'incident' && (draw.priority === 'P1' || draw.priority === 'P2') ? { affectedUsers: draw.priority === 'P1' ? rng.int(20, 250) : rng.int(2, 40) } : {}),
    };
    return { ...text, custom };
  };

  /** Cuts a life at T0 and evaluates its clocks there. */
  const cut = (slot: Slot, draw: TicketDraw, life: TicketLife, variant?: 'standard' | 'approved', extra: Partial<PlannedTicket> = {}): PlannedTicket => {
    const events = life.events.filter((event) => event.at < t0);
    const comments = life.comments.filter((comment) => comment.at < t0);
    const lastStatus = [...events].reverse().find((event): event is Extract<PlannedEvent, { kind: 'status' }> => event.kind === 'status');
    const status: CanonicalState = lastStatus?.to ?? 'new';
    const lastAssigned = [...events].reverse().find((event): event is Extract<PlannedEvent, { kind: 'assigned' }> => event.kind === 'assigned');
    const resolvedEvent = [...events].reverse().find((event) => event.kind === 'status' && event.to === 'resolved');
    const finished = status === 'resolved' || status === 'closed';
    const text = textFor(slot, draw);
    const verdicts = evaluateSla(
      {
        priority: draw.priority,
        createdAt: draw.createdAt,
        requester: draw.requester,
        statusChanges: events.flatMap((event) => (event.kind === 'status' ? [{ at: event.at, to: event.to }] : [])),
        publicComments: comments.filter((comment) => comment.visibility === 'public').map((comment) => ({ at: comment.at, author: comment.author })),
      },
      t0,
      clockFor(draw.priority),
    );
    return {
      ref: slot.ref,
      type: draw.type,
      title: text.title,
      description: text.description,
      priority: draw.priority,
      channel: draw.channel,
      category: draw.category,
      subcategory: draw.subcategory,
      service: draw.service,
      team: draw.team,
      requester: draw.requester,
      createdBy: draw.loggedBy,
      assignee: lastAssigned?.assignee ?? null,
      status,
      createdAt: draw.createdAt,
      resolvedAt: finished ? (resolvedEvent?.at ?? null) : null,
      closedAt: status === 'closed' || status === 'cancelled' ? (lastStatus?.at ?? null) : null,
      events,
      comments,
      tasks: life.tasks
        .filter((task) => task.createdAt < t0)
        .map((task) => ({ ...task, completedAt: task.completedAt !== null && task.completedAt < t0 ? task.completedAt : null })),
      ...(draw.requestItem ? { requestItem: draw.requestItem } : {}),
      ...(variant ? { variant } : {}),
      custom: text.custom,
      sla: {
        verdicts: { response: verdicts.response.verdict, update: verdicts.update.verdict, resolution: verdicts.resolution.verdict },
        dueAt: Object.fromEntries(
          TARGET_TYPES.flatMap((target) => {
            const due = verdicts[target].dueAt;
            return due === null ? [] : [[target, due]];
          }),
        ),
      },
      ...extra,
    };
  };

  /** Whether a running clock falls due in [T0, T0 + 10 min] (V8). */
  const nearDue = (ticket: PlannedTicket): boolean =>
    Object.values(ticket.sla.dueAt).some((due) => due !== undefined && due >= t0 && due <= t0 + 10 * MINUTE_MS);

  /**
   * Builds a slot's ticket, and makes the touches that tie a day to T0: an
   * approval still pending at T0 is decided before it (or dropped, when the
   * request is minutes old), and a clock due within ten minutes of T0 is moved
   * by shifting the ticket a few minutes.
   */
  const build = (slot: Slot, drawn: Drawn): Built | null => {
    let draw = drawn.draw;
    let variant = drawn.variant;
    const life = (d: TicketDraw) => buildLife(d, tools(d.priority), streamFor(seed, 'life', slot.ref));
    let lived = life(draw);
    if (lived.approval && lived.approval.requestedAt < t0 && lived.approval.decidedAt >= t0 - MINUTE_MS && draw.approval) {
      const room = t0 - lived.approval.requestedAt;
      if (room >= 20 * MINUTE_MS) {
        const decideBy = lived.approval.requestedAt + 0.6 * room;
        draw = { ...draw, approval: { ...draw.approval, turnaroundMs: Math.max(MINUTE_MS, office.elapsed(lived.approval.requestedAt, decideBy)) } };
        lived = life(draw);
      }
      if (!lived.approval || lived.approval.decidedAt >= t0 - MINUTE_MS) {
        // Minutes old: raised as a plain request instead.
        const { requestItem: _dropped, ...rest } = draw;
        draw = { ...rest, approval: null };
        if (variant) variant = 'standard';
        lived = life(draw);
      }
    }
    let ticket = cut(slot, draw, lived, variant && draw.requestItem ? variant : undefined);
    if (ticket.status !== 'closed' && ticket.status !== 'cancelled' && nearDue(ticket)) {
      for (const shift of [12, -13, 25, -26, 40]) {
        const moved = slot.createdAt + shift * MINUTE_MS;
        if (moved >= t0 - 2 * MINUTE_MS) continue;
        const movedSlot = { ...slot, createdAt: moved };
        const movedDraw = { ...draw, createdAt: moved };
        const movedLife = life(movedDraw);
        const movedTicket = cut(movedSlot, movedDraw, movedLife, variant && draw.requestItem ? variant : undefined);
        if (!nearDue(movedTicket)) return { draw: movedDraw, life: movedLife, ticket: movedTicket, slot: movedSlot, ...(variant ? { variant } : {}) };
      }
      return null;
    }
    if (lived.approval && lived.approval.requestedAt < t0 && lived.approval.decidedAt >= t0) return null;
    return { draw, life: lived, ticket, slot, ...(variant ? { variant } : {}) };
  };

  /* -------------------------------------------------- 1. The days */
  const firstDay = addDays(t0Date, -input.historyDays);
  const windowFrom = ukInstant(firstDay, 0);
  const built: Built[] = [];
  const sageShare = (CATEGORIES['business-apps'].share / 100) * (SUBCATEGORY_MODELS['sage-intacct'].weight / 100);
  for (let day = dayNumber(firstDay); day <= dayNumber(t0Date); day += 1) {
    const date = dateKeyOfDay(day);
    const business = calendar.isBusinessDay(date);
    const weekday = weekdayOf(date);
    const base = business
      ? WEEKDAY_LAMBDA * (WEEKDAY_FACTORS[weekday as keyof typeof WEEKDAY_FACTORS] ?? 1) * trend(date)
      : calendar.isHoliday(date)
        ? HOLIDAY_LAMBDA
        : WEEKEND_LAMBDA;
    const dayRng = streamFor(seed, 'day', date);
    const countDraw = dayRng.float();
    const extraDraw = dayRng.float();
    const shape = 1 / (DAILY_NOISE_CV * DAILY_NOISE_CV);
    const noise = dayRng.gamma(shape) / shape;
    const lambda = base * noise * input.scale;
    const monthEnd = business && calendar.isMonthEnd(date);
    const count = poissonAt(lambda, countDraw);
    const extra = monthEnd ? poissonAt(0.6 * sageShare * lambda, extraDraw) : 0;
    const group: { slot: Slot; drawn: Drawn }[] = [];
    for (let j = 0; j < count + extra; j += 1) {
      const isExtra = j >= count;
      const index = isExtra ? j - count : j;
      const ref = `demo:t:${date}:${isExtra ? 'm' : ''}${String(index).padStart(2, '0')}`;
      const arrival = streamFor(seed, 'arrival', ref);
      const minute = minuteOfDay(arrival, business);
      const createdAt = ukInstant(date, minute) + arrival.int(0, 59) * 1000;
      const offHours = !business || minute < 7 * 60 || minute >= 18 * 60;
      const slot: Slot = {
        ref,
        date,
        day,
        position: isExtra ? 100 + index : index,
        createdAt,
        offHours,
        monthEnd,
        ...(isExtra ? { subcategory: 'sage-intacct' as const } : {}),
      };
      group.push({ slot, drawn: drawTicket(slot) });
    }
    // Breaches are spread over the whole day, including tickets raised after
    // T0 that this build leaves out: the day's story does not depend on T0.
    assignBreaches(group, day, 'day');
    for (const { slot, drawn } of group) {
      if (slot.createdAt >= t0 || slot.createdAt < windowFrom) continue;
      const done = build(slot, drawn);
      if (done) built.push(done);
    }
  }

  /* -------------------------------------------------- 2. Overlays keyed on T0 */
  // The Windows 11 24H2 rollout, D−49 … D−36: +35 % in Hardware and Software.
  const hardwareSoftwareShare = (CATEGORIES.hardware.share + CATEGORIES['software-m365'].share) / 100;
  const rollout: { slot: Slot; drawn: Drawn }[] = [];
  for (let offset = 49; offset >= 36; offset -= 1) {
    const date = addDays(t0Date, -offset);
    if (!calendar.isBusinessDay(date)) continue;
    const weekday = weekdayOf(date);
    const lambda = 0.35 * hardwareSoftwareShare * WEEKDAY_LAMBDA * (WEEKDAY_FACTORS[weekday as keyof typeof WEEKDAY_FACTORS] ?? 1) * input.scale;
    const rng = streamFor(seed, 'rollout', t0Date, offset);
    const count = poissonAt(lambda, rng.float());
    for (let j = 0; j < count; j += 1) {
      const ref = `demo:o:rollout:${offset}:${j}`;
      const arrival = streamFor(seed, 'arrival', t0Date, ref);
      const minute = minuteOfDay(arrival, true);
      const subcategory = arrival.weighted({ 'monitor-dock': 30, laptop: 25, 'office-apps': 20, outlook: 15, teams: 10 }) as SubcategoryKey;
      const slot: Slot = {
        ref,
        date,
        day: dayNumber(date),
        position: 200 + j,
        createdAt: ukInstant(date, minute) + arrival.int(0, 59) * 1000,
        offHours: false,
        monthEnd: calendar.isMonthEnd(date),
        subcategory,
        doubled: true,
      };
      rollout.push({ slot, drawn: drawTicket(slot) });
    }
  }
  assignBreaches(rollout, dayNumber(t0Date), 'rollout');
  for (const { slot, drawn } of rollout) {
    const done = build(slot, drawn);
    if (done) built.push(done);
  }

  // Two early VPN authentication incidents on D−9 (later linked to PRB-0418).
  const d9 = calendar.businessDaysBefore(addDays(t0Date, -8), 1);
  ['08:40', '09:25'].forEach((time, j) => {
    const [h, m] = time.split(':').map(Number) as [number, number];
    const slot: Slot = {
      ref: `demo:o:vpn:${j + 1}`,
      date: d9,
      day: dayNumber(d9),
      position: 300 + j,
      createdAt: ukInstant(d9, h * 60 + m),
      offHours: false,
      monthEnd: false,
      subcategory: 'vpn',
      priority: 'P3',
    };
    const done = build(slot, { ...drawTicket(slot, { outcome: 'resolved', reopen: false, wait: null, approval: null }), fixedBreach: true });
    if (done) built.push(done);
  });

  /* -------------------------------------------------- 3. The major incidents and their reports */
  const story = planMajorIncidents(t0, mode, calendar, input.scale);
  const reportTickets: PlannedTicket[] = [];
  const reportsByIncident = new Map<number, string[]>();
  for (const spec of story.reports) {
    const refs = planReports(spec).map((ticket) => {
      reportTickets.push(ticket);
      return ticket.ref;
    });
    reportsByIncident.set(spec.majorIncident, refs);
  }

  function planReports(spec: MajorIncidentTicketSpec): PlannedTicket[] {
    const rng = streamFor(seed, 'mi', t0Date, spec.majorIncident);
    const channels = Object.entries(spec.channels).flatMap(([channel, n]) => Array.from({ length: n ?? 0 }, () => channel as TicketChannel));
    const out: PlannedTicket[] = [];
    const mi = story.incidents.find((incident) => incident.number === spec.majorIncident)!;
    for (let k = 0; k < spec.count; k += 1) {
      const channel = channels[k % channels.length] ?? 'email';
      const createdAt = Math.round(spec.from + ((k + rng.range(0.1, 0.9)) / spec.count) * (spec.to - spec.from));
      const priority: Priority = 'P2';
      const live = spec.resolvedAt === null;
      const withAisha = k < spec.withAisha;
      const teamKey: TeamKey = live ? (withAisha ? 'network' : 'service-desk') : SUBCATEGORY_MODELS[spec.subcategory].team;
      const requester =
        channel === 'system'
          ? 'monitoring'
          : spec.subcategory === 'site-connectivity' && leedsRequesters.length > 0
            ? rng.pick(leedsRequesters)
            : rng.pick(remoteRequesters.length > 0 ? remoteRequesters : requesters);
      const agent = live ? (withAisha ? 'aisha-rahman' : null) : spec.subcategory === 'site-connectivity' ? rng.pick(['aisha-rahman', 'daniel-hughes']) : rng.pick(workers[teamKey]);
      const ref = `demo:mi:${spec.majorIncident}:${String(k + 1).padStart(2, '0')}`;
      const text = words.ticketText(spec.subcategory, streamFor(seed, 'text', ref), channel === 'voice');
      const loggedBy = channel === 'voice' ? rng.pick(workers['service-desk']) : null;
      const events: PlannedEvent[] = [{ kind: 'created', at: createdAt, actor: channel === 'system' ? null : (loggedBy ?? requester), channel }];
      const comments: PlannedComment[] = [
        { at: createdAt + MINUTE_MS, author: null, visibility: 'public', body: majorIncidentAcknowledgement(spec.majorIncident), channel: 'api' },
      ];
      let status: CanonicalState = 'new';
      let resolvedAt: Instant | null = null;
      let closedAt: Instant | null = null;
      if (agent) {
        events.push({ kind: 'assigned', at: createdAt + 2 * MINUTE_MS, actor: 'daniel-hughes', team: teamKey, assignee: agent, method: 'manual' });
        const workingAt = createdAt + rng.range(4, 12) * MINUTE_MS;
        if (workingAt < t0) {
          comments.push({ at: workingAt, author: agent, visibility: 'public', body: words.reply('firstResponse', spec.subcategory, { first: firstNameOf(requester), agent: firstNameOf(agent) }, rng), channel: 'api' });
          events.push({ kind: 'status', at: workingAt, actor: agent, from: 'new', to: 'in_progress' });
          status = 'in_progress';
        }
        if (spec.resolvedAt !== null) {
          const fixedAt = spec.resolvedAt + rng.range(3, 30) * MINUTE_MS;
          comments.push({ at: fixedAt, author: agent, visibility: 'public', body: words.reply('isItFixed', spec.subcategory, { first: firstNameOf(requester), agent: firstNameOf(agent) }, rng), channel: 'api' });
          events.push({ kind: 'status', at: fixedAt, actor: agent, from: status, to: 'resolved' });
          resolvedAt = fixedAt;
          status = 'resolved';
          const closeAt = fixedAt + 7 * DAY_MS + rng.range(0, 60) * MINUTE_MS;
          if (closeAt < t0) {
            events.push({ kind: 'status', at: closeAt, actor: null, from: 'resolved', to: 'closed', reason: 'Closed automatically after 7 days' });
            status = 'closed';
            closedAt = closeAt;
          }
        }
      }
      const verdicts = evaluateSla(
        {
          priority,
          createdAt,
          requester,
          statusChanges: events.flatMap((event) => (event.kind === 'status' ? [{ at: event.at, to: event.to }] : [])),
          publicComments: comments.map((comment) => ({ at: comment.at, author: comment.author })),
        },
        t0,
        clockFor(priority),
      );
      out.push({
        ref,
        type: 'incident',
        title: text.title,
        description: text.description,
        priority,
        channel,
        category: categoryOfSubcategory(spec.subcategory),
        subcategory: spec.subcategory,
        service: SUBCATEGORY_MODELS[spec.subcategory].service,
        team: teamKey,
        requester,
        createdBy: loggedBy,
        assignee: agent,
        status,
        createdAt,
        resolvedAt,
        closedAt,
        events: events.sort((a, b) => a.at - b.at),
        comments: comments.sort((a, b) => a.at - b.at),
        tasks: [],
        custom: { affectedUsers: rng.int(1, 3) },
        sla: {
          verdicts: { response: verdicts.response.verdict, update: verdicts.update.verdict, resolution: verdicts.resolution.verdict },
          dueAt: Object.fromEntries(TARGET_TYPES.flatMap((target) => (verdicts[target].dueAt === null ? [] : [[target, verdicts[target].dueAt as number]]))),
        },
        majorIncident: spec.majorIncident,
        ...(mi.problem ? { problem: mi.problem } : {}),
      });
    }
    return out;
  }

  /* -------------------------------------------------- 4. Emma's approvals and the Service Desk's fresh queue */
  const storyApprovals: PlannedApproval[] = [];
  const storyTickets: PlannedTicket[] = [];
  const emmaApprovals: readonly { ref: string; requester: string; item: RequestItemKey; title: string; description: string; agoMinutes: number; agent: string; subcategory: SubcategoryKey; priority: Priority }[] = [
    { ref: 'demo:o:approval:1', requester: 'olivia-bennett', item: 'software-install', title: 'Install software: Tableau Creator', description: 'Tableau Creator (paid licence) for the new board pack dashboards. Cost centre FIN-200.', agoMinutes: 180, agent: 'priya-shah', subcategory: 'install-request', priority: 'P4' },
    { ref: 'demo:o:approval:2', requester: 'ravi-patel', item: 'shared-mailbox', title: 'Access to a shared mailbox: finance@northwind.example', description: 'I have moved to accounts payable and need to pick up supplier remittances from finance@northwind.example.', agoMinutes: 600, agent: 'grace-okafor', subcategory: 'mailbox-drive-access', priority: 'P4' },
    { ref: 'demo:o:approval:3', requester: 'hamza-ali', item: 'laptop', title: 'Laptop: performance (Dell Precision 3591)', description: 'A performance laptop for the Power BI models; the current one runs out of memory on the monthly refresh.', agoMinutes: 630, agent: 'ben-carter', subcategory: 'laptop', priority: 'P3' },
  ];
  for (const story_ of emmaApprovals) {
    const requestedAt = office.before(t0, story_.agoMinutes * MINUTE_MS);
    const createdAt = requestedAt - 2 * MINUTE_MS;
    const tr = targetMs(story_.priority, 'response');
    const answeredAt = Math.min(office.add(createdAt, 0.2 * tr), t0 - 5 * MINUTE_MS);
    const teamKey = REQUEST_ITEMS[story_.item].team;
    const rng = streamFor(seed, 'story-approval', story_.ref);
    const events: PlannedEvent[] = [
      { kind: 'created', at: createdAt, actor: story_.requester, channel: 'portal' },
      { kind: 'assigned', at: createdAt + 20_000, actor: null, team: teamKey, assignee: story_.agent, method: 'least_loaded' },
      { kind: 'status', at: requestedAt, actor: null, from: 'new', to: 'pending_approval', reason: 'Waiting for approval' },
    ];
    const comments: PlannedComment[] = [
      { at: Math.max(answeredAt, requestedAt + MINUTE_MS), author: story_.agent, visibility: 'public', body: words.reply('firstResponse', story_.subcategory, { first: firstNameOf(story_.requester), agent: firstNameOf(story_.agent) }, rng), channel: 'api' },
    ];
    const verdicts = evaluateSla(
      { priority: story_.priority, createdAt, requester: story_.requester, statusChanges: [{ at: requestedAt, to: 'pending_approval' }], publicComments: comments.map((c) => ({ at: c.at, author: c.author })) },
      t0,
      clockFor(story_.priority),
    );
    storyTickets.push({
      ref: story_.ref,
      type: 'request',
      title: story_.title,
      description: story_.description,
      priority: story_.priority,
      channel: 'portal',
      category: categoryOfSubcategory(story_.subcategory),
      subcategory: story_.subcategory,
      service: REQUEST_ITEMS[story_.item].service,
      team: teamKey,
      requester: story_.requester,
      createdBy: null,
      assignee: story_.agent,
      status: 'pending_approval',
      createdAt,
      resolvedAt: null,
      closedAt: null,
      events,
      comments,
      tasks: [],
      requestItem: story_.item,
      ...(REQUEST_ITEMS[story_.item].approval === 'variant' ? { variant: 'approved' as const } : {}),
      custom: { site: 'London HQ' },
      sla: {
        verdicts: { response: verdicts.response.verdict, update: verdicts.update.verdict, resolution: verdicts.resolution.verdict },
        dueAt: Object.fromEntries(TARGET_TYPES.flatMap((target) => (verdicts[target].dueAt === null ? [] : [[target, verdicts[target].dueAt as number]]))),
      },
    });
    storyApprovals.push({ subject: { kind: 'ticket', ref: story_.ref }, policy: 'manager-approval', requestedBy: story_.requester, approver: EMMA, requestedAt, outcome: 'pending', decidedAt: null });
  }

  // Three fresh, unassigned tickets in the Service Desk's queue (A4 §1.12: 6 = H8, H9, H10 + 3).
  const fills: readonly { subcategory: SubcategoryKey; priority: Priority; channel: TicketChannel; agoMinutes: number }[] = [
    { subcategory: 'password-sign-in', priority: 'P3', channel: 'portal', agoMinutes: 20 },
    { subcategory: 'outlook', priority: 'P4', channel: 'email', agoMinutes: 45 },
    { subcategory: 'teams', priority: 'P4', channel: 'portal', agoMinutes: 75 },
  ];
  fills.forEach((fillSpec, index) => {
    const ref = `demo:fill:${index + 1}`;
    const rng = streamFor(seed, 'fill', ref);
    const createdAt = office.before(t0, fillSpec.agoMinutes * MINUTE_MS);
    const requester = rng.pick(requesters);
    const text = words.ticketText(fillSpec.subcategory, streamFor(seed, 'text', ref), false);
    const verdicts = evaluateSla({ priority: fillSpec.priority, createdAt, requester, statusChanges: [], publicComments: [] }, t0, clockFor(fillSpec.priority));
    storyTickets.push({
      ref,
      type: 'incident',
      title: text.title,
      description: text.description,
      priority: fillSpec.priority,
      channel: fillSpec.channel,
      category: categoryOfSubcategory(fillSpec.subcategory),
      subcategory: fillSpec.subcategory,
      service: SUBCATEGORY_MODELS[fillSpec.subcategory].service,
      team: 'service-desk',
      requester,
      createdBy: null,
      assignee: null,
      status: 'new',
      createdAt,
      resolvedAt: null,
      closedAt: null,
      events: [{ kind: 'created', at: createdAt, actor: requester, channel: fillSpec.channel }],
      comments: [],
      tasks: [],
      custom: {},
      sla: {
        verdicts: { response: verdicts.response.verdict, update: verdicts.update.verdict, resolution: verdicts.resolution.verdict },
        dueAt: Object.fromEntries(TARGET_TYPES.flatMap((target) => (verdicts[target].dueAt === null ? [] : [[target, verdicts[target].dueAt as number]]))),
      },
    });
  });

  /* -------------------------------------------------- 5. The heroes */
  const heroApprovals: PlannedApproval[] = [];
  const heroTickets = content.heroes.map((hero) => {
    const planned = planHero(hero, t0, mode, { calendar, words, firstNameOf, managerOf: (key) => person.get(key)?.managerKey ?? null }, streamFor(seed, 'hero', hero.key));
    if (planned.approval) {
      heroApprovals.push({
        subject: { kind: 'ticket', ref: planned.ticket.ref },
        policy: 'manager-approval',
        requestedBy: hero.requester,
        approver: planned.approval.approver,
        requestedAt: planned.approval.requestedAt,
        outcome: planned.approval.outcome,
        decidedAt: planned.approval.decidedAt,
      });
    }
    return planned.ticket;
  });

  /* -------------------------------------------------- 6. Alex's recent work */
  // Six of the Service Desk's tickets resolved in the last two business days
  // were Alex's (A4 §1.12: "recently resolved by Alex: 7", H12 the seventh).
  const recentFrom = ukInstant(calendar.businessDaysBefore(t0Date, 2), 0);
  const recent = built
    .filter((b) => b.draw.team === 'service-desk' && (b.ticket.status === 'resolved' || b.ticket.status === 'closed') && b.ticket.resolvedAt !== null && b.ticket.resolvedAt >= recentFrom)
    .sort((a, b) => a.ticket.createdAt - b.ticket.createdAt || a.slot.ref.localeCompare(b.slot.ref))
    .slice(-6);
  for (const entry of recent) {
    const draw = { ...entry.draw, agent: ALEX, agentFirstName: firstNameOf(ALEX) };
    const life = buildLife(draw, tools(draw.priority), streamFor(seed, 'life', entry.slot.ref));
    entry.draw = draw;
    entry.life = life;
    entry.ticket = cut(entry.slot, draw, life, entry.variant && draw.requestItem ? entry.variant : undefined);
  }


  /* -------------------------------------------------- 7. Keeping the bands */
  // The build refuses to swap outside A4 §1.11's bands (V3), so the plan
  // keeps them by construction: when the 30 days before T0 drift more than a
  // point from a target — a window with one month-end in it rather than
  // three, Easter, Christmas — a few finished tickets of those days are
  // re-told with one breach more or fewer, until the figure is back. Their
  // words and requesters stay; only how their clocks went changes.
  steerAttainment();

  function steerAttainment(): void {
    const last30 = t0 - 30 * DAY_MS;
    const others = [...reportTickets, ...storyTickets, ...heroTickets].filter((ticket) => ticket.createdAt >= last30);
    const candidates = built
      .filter((entry) => entry.slot.ref.startsWith('demo:t:') && entry.ticket.createdAt >= last30)
      .map((entry) => ({ entry, order: streamFor(seed, 'steer', entry.slot.ref).float() }))
      .sort((a, b) => a.order - b.order)
      .map(({ entry }) => entry);
    const windowed = built.filter((entry) => entry.ticket.createdAt >= last30);
    const counts = (target: TargetType) => {
      let met = 0;
      let breached = 0;
      for (const ticket of [...windowed.map((entry) => entry.ticket), ...others]) {
        if (ticket.sla.verdicts[target] === 'met') met += 1;
        else if (ticket.sla.verdicts[target] === 'breached') breached += 1;
      }
      return { met, breached, rate: met + breached === 0 ? 100 : (100 * met) / (met + breached) };
    };
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (const target of ['resolution', 'update', 'response'] as const) {
        let { met, breached, rate } = counts(target);
        const tolerance = Math.max(0.6, 100 / Math.max(1, met + breached));
        const centre = ATTAINMENT_TARGETS[target];
        for (const entry of candidates) {
          if (Math.abs(rate - centre) <= tolerance) break;
          const wantMore = rate > centre;
          const finishedTicket = entry.ticket.status === 'resolved' || entry.ticket.status === 'closed';
          if (!finishedTicket || entry.draw.breach[target] === wantMore) continue;
          if (entry.ticket.sla.verdicts[target] !== (wantMore ? 'met' : 'breached')) continue;
          const draw = { ...entry.draw, breach: { ...entry.draw.breach, [target]: wantMore } };
          const life = buildLife(draw, tools(draw.priority), streamFor(seed, 'life', entry.slot.ref));
          const ticket = cut(entry.slot, draw, life, entry.variant && draw.requestItem ? entry.variant : undefined);
          if (nearDue(ticket) || (life.approval && life.approval.decidedAt >= t0)) continue;
          entry.draw = draw;
          entry.life = life;
          entry.ticket = ticket;
          changed = true;
          ({ met, breached, rate } = counts(target));
        }
      }
      if (!changed) break;
    }
  }

  /* -------------------------------------------------- Tickets, approvals, time and surveys */
  const tickets = [...built.map((b) => b.ticket), ...reportTickets, ...storyTickets, ...heroTickets].sort((a, b) => a.createdAt - b.createdAt || a.ref.localeCompare(b.ref));

  const approvals: PlannedApproval[] = [...storyApprovals, ...heroApprovals];
  const timeEntries: PlannedTimeEntry[] = [];
  const surveys: PlannedSurvey[] = [];
  const answered: { survey: PlannedSurvey; propensity: number; agentFirstName: string }[] = [];
  for (const entry of built) {
    const { draw, life, slot } = entry;
    if (life.approval && life.approval.requestedAt < t0 && draw.approval) {
      approvals.push({
        subject: { kind: 'ticket', ref: slot.ref },
        policy: 'manager-approval',
        requestedBy: draw.requester,
        approver: draw.approval.approver,
        requestedAt: life.approval.requestedAt,
        outcome: life.approval.decidedAt < t0 ? life.approval.outcome : 'pending',
        decidedAt: life.approval.decidedAt < t0 ? life.approval.decidedAt : null,
      });
    }
    for (const time of life.timeEntries) if (time.loggedAt < t0) timeEntries.push(time);
    if (life.invitedAt !== null && life.invitedAt < t0) planSurvey(entry, life.invitedAt);
  }

  /**
   * One invitation, and its answer if one came before T0. Who answers is a
   * low-discrepancy draw per ticket (30 %); how many stars is decided below,
   * for all the answers at once.
   */
  function planSurvey(entry: Built, invitedAt: Instant): void {
    const { draw, slot } = entry;
    const rng = streamFor(seed, 'survey', slot.ref);
    const channel = rng.chance(SURVEY_PORTAL_SHARE) ? ('portal' as const) : ('email' as const);
    const responds = quantile(seed, 'respond', slot.day, slot.position) < SURVEY_RESPONSE_SHARE;
    // Most answers come within a day; the newest days carry fewer (A4 §1.11).
    const delay = (0.2 + 47.8 * Math.pow(rng.float(), 2.2)) * HOUR_MS;
    const respondedAt = invitedAt + delay;
    if (!responds || respondedAt >= t0) {
      surveys.push({ ticketRef: slot.ref, recipient: draw.requester, channel, invitedAt, response: null, expired: invitedAt < t0 - 14 * DAY_MS });
      return;
    }
    // How pleased they are likely to be: a breach makes a low mark likelier
    // (A4: a breached ticket loses a star with p = 0.45), a fast P1 or P2 fix
    // a high one.
    let propensity = rng.float();
    if (draw.breach.resolution || draw.breach.response) propensity -= BREACH_STAR_PENALTY * 0.8;
    const firstResolved = entry.life.firstResolvedAt;
    if ((draw.priority === 'P1' || draw.priority === 'P2') && firstResolved !== null) {
      if (clockFor(draw.priority).elapsed(draw.createdAt, firstResolved) < 0.5 * targetMs(draw.priority, 'resolution')) propensity += 0.2;
    }
    const survey: PlannedSurvey = { ticketRef: slot.ref, recipient: draw.requester, channel, invitedAt, response: { at: respondedAt, stars: 5, comment: null }, expired: false };
    surveys.push(survey);
    answered.push({ survey, propensity, agentFirstName: draw.agentFirstName });
  }

  /*
   * The marks: A4's star shares, dealt out in order of propensity — the least
   * pleased get the lowest marks. Dealt separately for the 30 days the build
   * checks (V4) and for the months before, so the 30-day score is the story's
   * 4.4 to within rounding at every T0, rather than within chance.
   */
  const dealStars = (group: typeof answered) => {
    const counts = starCounts(group.length);
    const ordered = [...group].sort((a, b) => a.propensity - b.propensity || a.survey.ticketRef.localeCompare(b.survey.ticketRef));
    let index = 0;
    for (const stars of [1, 2, 3, 4, 5] as const) {
      for (let n = 0; n < counts[stars]; n += 1) {
        const entry = ordered[index++]!;
        const rng = streamFor(seed, 'csat-comment', entry.survey.ticketRef);
        const comment = rng.chance(0.45) ? words.csatComment(stars, entry.agentFirstName, rng) : null;
        (entry.survey as { response: PlannedSurvey['response'] }).response = { at: entry.survey.response!.at, stars, comment };
      }
    }
  };
  const csatFrom = t0 - 30 * DAY_MS;
  dealStars(answered.filter((entry) => entry.survey.response!.at >= csatFrom));
  dealStars(answered.filter((entry) => entry.survey.response!.at < csatFrom));

  // The major incidents' reports to Leeds dragged the network team's mark down that week.
  for (const ticket of reportTickets) {
    if (ticket.majorIncident !== 1 || ticket.resolvedAt === null || ticket.resolvedAt >= t0) continue;
    const rng = streamFor(seed, 'survey', ticket.ref);
    if (!rng.chance(0.5)) continue;
    const invitedAt = ticket.resolvedAt + MINUTE_MS;
    const respondedAt = invitedAt + rng.range(1, 20) * HOUR_MS;
    if (respondedAt >= t0) continue;
    const stars = rng.weighted({ 5: 25, 4: 30, 3: 25, 2: 12, 1: 8 }) as unknown as string;
    const star = Number(stars) as 1 | 2 | 3 | 4 | 5;
    surveys.push({
      ticketRef: ticket.ref,
      recipient: ticket.requester,
      channel: 'email',
      invitedAt,
      response: { at: respondedAt, stars: star, comment: rng.chance(0.45) ? words.csatComment(star, firstNameOf(ticket.assignee ?? 'aisha-rahman'), rng) : null },
      expired: false,
    });
  }

  /* -------------------------------------------------- Problems, changes, knowledge, AI, notifications */
  const objects = planObjects({
    content,
    seed,
    t0,
    t0Date,
    mode,
    calendar,
    tickets,
    story,
    reportsByIncident,
    words,
    firstNameOf,
  });
  approvals.push(...objects.approvals);

  const majorIncidents = story.incidents.map((incident) => ({ ...incident, tickets: reportsByIncident.get(incident.number) ?? [] }));

  /* -------------------------------------------------- Assets and workforce */
  const expiringWarranties = Array.from({ length: 23 }, (_, i) => ({
    tag: `NW-LT-${String(101 + i).padStart(4, '0')}`,
    endsOn: addDays(t0Date, 2 + Math.floor((i * 27) / 23)),
  }));

  /* -------------------------------------------------- What S10 checks */
  const last30 = t0 - 30 * DAY_MS;
  const recentTickets = tickets.filter((ticket) => ticket.createdAt >= last30);
  const verdictsOf = (target: TargetType) => recentTickets.map((ticket) => ticket.sla.verdicts[target]);
  const attainment30d = {
    response: attainment(verdictsOf('response')) ?? 100,
    update: attainment(verdictsOf('update')) ?? 100,
    resolution: attainment(verdictsOf('resolution')) ?? 100,
    overall: attainment([...verdictsOf('response'), ...verdictsOf('update'), ...verdictsOf('resolution')]) ?? 100,
  };
  const responses30 = surveys.flatMap((survey) => (survey.response && survey.response.at >= last30 ? [survey.response.stars] : []));
  const csat30d = responses30.length === 0 ? 0 : responses30.reduce((sum, stars) => sum + ((stars - 1) / 4) * 100, 0) / responses30.length;
  const share = <K extends string>(keys: readonly K[], value: (ticket: PlannedTicket) => K) =>
    Object.fromEntries(keys.map((key) => [key, (tickets.filter((ticket) => value(ticket) === key).length / Math.max(1, tickets.length)) * 100])) as Record<K, number>;

  const pendingApprovals = approvals
    .filter((approval) => approval.outcome === 'pending')
    .map((approval) => ({ subject: approval.subject.kind === 'ticket' ? approval.subject.ref : `CHG-${approval.subject.number}`, approver: approval.approver }));

  const plan: DemoPlan = {
    version: 1,
    generatorVersion: input.generatorVersion,
    seed,
    anchor: t0,
    scale: input.scale,
    historyDays: input.historyDays,
    mode,
    window: { from: windowFrom, to: t0, firstDay, lastDay: t0Date },
    company: { name: DEMO_COMPANY.name, emailDomain: DEMO_COMPANY.emailDomain, plan: DEMO_COMPANY.plan },
    calendars: {
      business: { key: NORTHWIND_CALENDAR_KEY, name: 'Northwind UK office hours', ...calendar.business },
      holidays: content.holidays.map((holiday) => ({ date: holiday.date, name: holiday.name })),
    },
    teams: org.teams,
    people: org.people as PlannedPerson[],
    tickets,
    links: objects.links,
    approvals: approvals.sort((a, b) => a.requestedAt - b.requestedAt),
    surveys: surveys.sort((a, b) => a.invitedAt - b.invitedAt || a.ticketRef.localeCompare(b.ticketRef)),
    timeEntries: timeEntries.sort((a, b) => a.loggedAt - b.loggedAt || a.ticketRef.localeCompare(b.ticketRef)),
    knowledge: objects.knowledge,
    problems: objects.problems,
    changes: objects.changes,
    majorIncidents,
    statusPage: { ...story.statusPage, maintenance: objects.maintenance },
    aiSamples: objects.aiSamples,
    notifications: objects.notifications,
    assets: { expiringWarranties, laptopTags, salesforceRenewal: addDays(t0Date, 45) },
    workforce: planWorkforce(t0, calendar),
    expectations: {
      liveIncidentState: story.liveState,
      pendingApprovals,
      heroes: heroTickets.map((ticket) => ({ ref: ticket.ref, key: ticket.hero!, status: ticket.status, team: ticket.team })),
      warrantiesWithin30Days: expiringWarranties.filter((w) => dayNumber(w.endsOn) - dayNumber(t0Date) <= 30).length,
      attainment30d,
      csat30d,
      channelMix: share(TICKET_CHANNELS, (ticket) => ticket.channel),
      priorityMix: share(['P1', 'P2', 'P3', 'P4'] as const, (ticket) => ticket.priority),
    },
    totals: {
      tickets: tickets.length,
      ticketsLast30Days: recentTickets.length,
      ticketsLast90Days: tickets.filter((ticket) => ticket.createdAt >= t0 - 90 * DAY_MS).length,
      openAtT0: tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled' && ticket.status !== 'resolved').length,
      comments: tickets.reduce((sum, ticket) => sum + ticket.comments.length, 0),
      events: tickets.reduce((sum, ticket) => sum + ticket.events.length, 0),
      tasks: tickets.reduce((sum, ticket) => sum + ticket.tasks.length, 0),
      approvals: approvals.length,
      submissions: tickets.filter((ticket) => ticket.requestItem !== undefined).length,
      surveyInvitations: surveys.length,
      surveyResponses: surveys.filter((survey) => survey.response !== null).length,
      timeEntries: timeEntries.length,
      people: org.people.length,
    },
  };
  return plan;
}

const SITE_LABEL = { london: 'London HQ', leeds: 'Leeds DC', bristol: 'Bristol hub', field: 'Remote' } as const;

/** A weekday arrival's minute of the day, by A4 §1.10.1's hour shares; nights, weekends and holidays thinly. */
function minuteOfDay(rng: Stream, business: boolean): number {
  if (!business) {
    // Mostly daytime, some overnight monitoring alerts.
    return rng.chance(0.7) ? rng.int(8 * 60, 20 * 60 - 1) : rng.int(0, 24 * 60 - 1);
  }
  const bucket = weightedPick(Object.fromEntries(WEEKDAY_HOURS.map((hours, index) => [String(index), hours.share])), rng.float());
  const hours = WEEKDAY_HOURS[Number(bucket)]!;
  if (hours.to <= 24) return rng.int(hours.from * 60, hours.to * 60 - 1);
  // 18:00–07:00: the evening, or the small hours of the same date.
  const offset = rng.int(0, 13 * 60 - 1);
  return offset < 6 * 60 ? 18 * 60 + offset : offset - 6 * 60;
}

/** The days' own P2 share before the story's reports are allowed for: the categories' mixes, plus month-end's doubling in business applications. */
function baseP2Share(): number {
  let share = 0;
  for (const key of CATEGORY_KEYS) {
    const category = CATEGORIES[key];
    const total = category.priorities.P1 + category.priorities.P2 + category.priorities.P3 + category.priorities.P4;
    share += (category.share / 100) * (category.priorities.P2 / total);
  }
  const bizapps = CATEGORIES['business-apps'];
  return share + (bizapps.share / 100) * (bizapps.priorities.P2 / 100) * (3 / 21.7);
}

/** How many of `n` answers get each mark: `STAR_SHARES`, by largest remainder. */
export function starCounts(n: number): Record<1 | 2 | 3 | 4 | 5, number> {
  const stars = [5, 4, 3, 2, 1] as const;
  const total = stars.reduce((sum, star) => sum + STAR_SHARES[star], 0);
  const exact = stars.map((star) => ({ star, value: (n * STAR_SHARES[star]) / total }));
  const counts = Object.fromEntries(exact.map(({ star, value }) => [star, Math.floor(value)])) as Record<1 | 2 | 3 | 4 | 5, number>;
  let left = n - exact.reduce((sum, { value }) => sum + Math.floor(value), 0);
  for (const { star } of [...exact].sort((a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) || b.star - a.star)) {
    if (left <= 0) break;
    counts[star] += 1;
    left -= 1;
  }
  return counts;
}

export { demoHeroRef, JORDAN, ALEX, EMMA };
