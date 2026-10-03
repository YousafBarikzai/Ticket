import type { CanonicalState } from '@itsm/contracts';
import { demoHeroRef } from '@itsm/contracts/demo';
import type { BusinessClock, StoryCalendar } from './calendar.js';
import type { HeroContent, HeroKey, HeroMessage } from './content-types.js';
import { categoryOfSubcategory } from './content-types.js';
import { REQUEST_ITEMS, SUBCATEGORY_MODELS } from './model.js';
import type { Stream } from './rng.js';
import { evaluateSla, targetMs } from './sla-plan.js';
import { HOUR_MS, MINUTE_MS, addDays, londonWall, ukInstant, type Instant } from './time.js';
import type { PlannedComment, PlannedEvent, PlannedTask, PlannedTicket } from './types.js';
import { fill } from './words.js';
import type { Words } from './words.js';

/**
 * The hero tickets: the presenter's script (A4 §1.12, §1.13.3).
 *
 * Their words are the content library's; their timing is here, re-computed
 * against every T0 in business time, so A1 is always due within the next
 * business hour, A2 always breached yesterday at 15:10 and A3's first answer
 * always 25 business minutes away — on a Tuesday morning reset and on the
 * nightly build alike. `plan.test.ts` holds each of those sentences to the
 * SLA maths.
 */

export interface HeroTools {
  readonly calendar: StoryCalendar;
  readonly words: Words;
  readonly firstNameOf: (key: string) => string;
  readonly managerOf: (key: string) => string | null;
}

interface HeroTiming {
  readonly createdAt: Instant;
  /** The agent's first public answer, for a hero that has one. */
  readonly firstReplyAt?: Instant;
  /** When it began waiting (pending heroes). */
  readonly waitAt?: Instant;
  /** When it was resolved (resolved heroes). */
  readonly resolvedAt?: Instant;
  /** The requester's message that must be last ("customer replied 2 h ago"). */
  readonly requesterLastAt?: Instant;
  /** For a hero with an approval: when it was decided, or `null` while pending. */
  readonly approvalDecidedAt?: Instant | null;
}

/** The previous business day's `HH:MM`, strictly before T0's own day. */
function yesterdayAt(calendar: StoryCalendar, t0: Instant, minutes: number): Instant {
  const today = londonWall(t0).dateKey;
  return ukInstant(calendar.businessDaysBefore(today, 1), minutes);
}

/** The latest business-day `HH:MM` that is at least `gap` before T0. */
function latestBusinessAt(calendar: StoryCalendar, t0: Instant, minutes: number, gap: number): Instant {
  let day = londonWall(t0).dateKey;
  for (let guard = 0; guard < 30; guard += 1) {
    if (calendar.isBusinessDay(day)) {
      const instant = ukInstant(day, minutes);
      if (instant <= t0 - gap) return instant;
    }
    day = addDays(day, -1);
  }
  throw new RangeError('no business day in the last month');
}

function timingFor(hero: HeroContent, t0: Instant, calendar: StoryCalendar, mode: 'day' | 'night'): HeroTiming {
  const clock = calendar.clockFor(hero.priority);
  const office = calendar.businessClock;
  const tr = targetMs(hero.priority, 'response');
  const tres = targetMs(hero.priority, 'resolution');
  const before = (ms: number): Instant => clock.before(t0, ms);
  const generic = (): HeroTiming => {
    const createdAt = before(Math.min(0.4 * tres, 6 * HOUR_MS));
    return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr) };
  };

  switch (hero.key as HeroKey) {
    case 'H1': {
      // Resolution due in six business hours; the customer replied two hours ago.
      const createdAt = before(tres - 6 * HOUR_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.3 * tr), requesterLastAt: t0 - 2 * HOUR_MS };
    }
    case 'H2': {
      const createdAt = before(tres - 3 * HOUR_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr) };
    }
    case 'H3': {
      const createdAt = before(0.5 * tres);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.2 * tr), waitAt: office.before(t0, 90 * MINUTE_MS) };
    }
    case 'H4': {
      const createdAt = before(4 * HOUR_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.3 * tr), approvalDecidedAt: null };
    }
    case 'H5':
      return { createdAt: before(2 * HOUR_MS) };
    case 'H6': {
      // Due within the hour in day mode; first thing tomorrow at night.
      const createdAt = before(tres - 50 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.2 * tr) };
    }
    case 'H7': {
      const createdAt = before(tres - 200 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.2 * tr) };
    }
    case 'H8':
      return { createdAt: before(60 * MINUTE_MS) };
    case 'H9':
      // "Due soon": its first answer is due in 70 business minutes.
      return { createdAt: before(Math.max(10 * MINUTE_MS, tr - 70 * MINUTE_MS)) };
    case 'H10':
      return { createdAt: before(90 * MINUTE_MS) };
    case 'H11': {
      const createdAt = before(Math.min(0.75 * tres, 3 * 510 * MINUTE_MS));
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.2 * tr) };
    }
    case 'H12': {
      // Resolved two business days ago, by Alex.
      const resolvedAt = office.before(t0, 2 * 510 * MINUTE_MS);
      const createdAt = clock.before(resolvedAt, 0.4 * tres);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.3 * tr), resolvedAt };
    }
    case 'H13': {
      const resolvedAt = office.before(t0, 510 * MINUTE_MS);
      const createdAt = clock.before(resolvedAt, 0.3 * tres);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.2 * tr), resolvedAt };
    }
    case 'A1': {
      // Resolution due 40 business minutes after T0: T0 + 40 min by day, 09:40 at night.
      const createdAt = before(tres - 40 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr) };
    }
    case 'A2': {
      // Resolution breached yesterday at 15:10.
      const breachedAt = yesterdayAt(calendar, t0, 15 * 60 + 10);
      const createdAt = clock.before(breachedAt, tres);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr) };
    }
    case 'A3':
      // Its first answer is due in 25 business minutes.
      return { createdAt: before(Math.max(5 * MINUTE_MS, tr - 25 * MINUTE_MS)) };
    case 'A4': {
      const createdAt = before(2 * 510 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr), waitAt: office.before(t0, 510 * MINUTE_MS) };
    }
    case 'E1': {
      const createdAt = before(400 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.3 * tr), waitAt: office.before(t0, 120 * MINUTE_MS) };
    }
    case 'E2': {
      // Approved by Richard Hale yesterday afternoon, with EUC since.
      const decidedAt = yesterdayAt(calendar, t0, 14 * 60 + 5);
      const createdAt = office.before(decidedAt, 300 * MINUTE_MS);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.3 * tr), approvalDecidedAt: decidedAt };
    }
    case 'E3':
      // Raised 25 minutes ago by day; at 18:10 the evening before at night.
      return { createdAt: mode === 'day' ? t0 - 25 * MINUTE_MS : latestEvening(t0) };
    case 'E4': {
      // Resolved at 16:40 on the last business day, by Grace.
      const resolvedAt = latestBusinessAt(calendar, t0, 16 * 60 + 40, 30 * MINUTE_MS);
      const createdAt = clock.before(resolvedAt, 0.3 * tres);
      return { createdAt, firstReplyAt: clock.add(createdAt, 0.25 * tr), resolvedAt };
    }
    default:
      return generic();
  }
}

/** The latest 18:10 UK at least 20 minutes before T0. */
function latestEvening(t0: Instant): Instant {
  let day = londonWall(t0).dateKey;
  for (let guard = 0; guard < 3; guard += 1) {
    const instant = ukInstant(day, 18 * 60 + 10);
    if (instant <= t0 - 20 * MINUTE_MS) return instant;
    day = addDays(day, -1);
  }
  return t0 - 6 * HOUR_MS;
}

export interface PlannedHero {
  readonly ticket: PlannedTicket;
  readonly approval: {
    readonly approver: string;
    readonly requestedAt: Instant;
    readonly decidedAt: Instant | null;
    readonly outcome: 'pending' | 'approved';
  } | null;
}

/** Builds one hero against T0. */
export function planHero(hero: HeroContent, t0: Instant, mode: 'day' | 'night', tools: HeroTools, rng: Stream): PlannedHero {
  const { calendar, words } = tools;
  const clock: BusinessClock = calendar.clockFor(hero.priority);
  const timing = timingFor(hero, t0, calendar, mode);
  const tu = targetMs(hero.priority, 'update');
  const requester = hero.requester;
  const agent = hero.assignee;
  const names = { first: tools.firstNameOf(requester), agent: agent ? tools.firstNameOf(agent) : 'the Service Desk' };
  const events: PlannedEvent[] = [];
  const comments: PlannedComment[] = [];
  const tasks: PlannedTask[] = [];
  const requesterChannel = hero.channel === 'voice' ? 'email' : hero.channel;
  let status: CanonicalState = 'new';
  const createdAt = timing.createdAt;

  const setStatus = (at: Instant, to: CanonicalState, actor: string | null, reason?: string) => {
    events.push({ kind: 'status', at, actor, from: status, to, ...(reason ? { reason } : {}) });
    status = to;
  };
  const say = (at: Instant, message: HeroMessage) => {
    const author = message.author === 'requester' ? requester : message.author === 'assignee' ? agent : message.author;
    comments.push({
      at,
      author,
      visibility: message.visibility,
      body: fill(message.body, names),
      channel: author === requester ? requesterChannel : 'api',
    });
  };
  const agentUpdate = (at: Instant) =>
    comments.push({ at, author: agent, visibility: 'public', body: words.reply('update', hero.subcategory, names, rng), channel: 'api' });

  events.push({ kind: 'created', at: createdAt, actor: hero.channel === 'voice' ? agent : requester, channel: hero.channel });
  if (agent) {
    const assignedAt = hero.assignedBy ? clock.add(createdAt, 15 * MINUTE_MS) : createdAt + 20_000;
    events.push({
      kind: 'assigned',
      at: Math.min(assignedAt, t0 - MINUTE_MS),
      actor: hero.assignedBy ?? null,
      team: hero.team,
      assignee: agent,
      method: hero.assignedBy ? 'manual' : 'least_loaded',
    });
  }

  // The request's approval, raised with it.
  let approval: PlannedHero['approval'] = null;
  if (hero.approver && timing.approvalDecidedAt !== undefined) {
    const requestedAt = createdAt + 2 * MINUTE_MS;
    setStatus(requestedAt, 'pending_approval', null, 'Waiting for approval');
    approval = {
      approver: hero.approver,
      requestedAt,
      decidedAt: timing.approvalDecidedAt,
      outcome: timing.approvalDecidedAt === null ? 'pending' : 'approved',
    };
  }

  // The conversation: requester messages where they fall, agent messages on a
  // cadence that keeps the update promise.
  const thread = [...hero.thread];
  const agentMessages = thread.filter((m) => m.author !== 'requester' && m.visibility === 'public');
  const otherMessages = thread.filter((m) => !(m.author !== 'requester' && m.visibility === 'public'));
  const unanswered = hero.status === 'new';

  if (!unanswered && timing.firstReplyAt !== undefined) {
    const end = timing.resolvedAt ?? timing.waitAt ?? (timing.requesterLastAt !== undefined ? timing.requesterLastAt - 10 * MINUTE_MS : t0);
    // Agent slots: the first answer, then every 0.6 of the update target
    // until the last one sits within 0.6 of it of the end, so the promise is
    // kept now and the next update is not due within ten minutes of T0.
    const slots: Instant[] = [timing.firstReplyAt];
    const step = 0.6 * tu;
    while (clock.elapsed(slots[slots.length - 1] as Instant, end) > step) {
      slots.push(clock.add(slots[slots.length - 1] as Instant, step));
    }
    slots.forEach((at, index) => {
      if (at >= t0) return;
      const message = agentMessages[index];
      if (index === 0 && !message) {
        comments.push({ at, author: agent, visibility: 'public', body: words.reply('firstResponse', hero.subcategory, names, rng), channel: 'api' });
      } else if (message) say(at, message);
      else agentUpdate(at);
    });
    // Agent messages the cadence had no slot for go just before the end.
    agentMessages.slice(slots.length).forEach((message, index) => say(Math.max(timing.firstReplyAt as Instant, end - (index + 1) * MINUTE_MS * 7), message));
    if (status === 'new') setStatus(timing.firstReplyAt, 'in_progress', agent);
    if (approval?.decidedAt) setStatus(Math.max(approval.decidedAt, timing.firstReplyAt), 'in_progress', null, 'Approved');
  }

  // Requester messages and internal notes, spread through the life so far.
  const lastAt = timing.resolvedAt ?? timing.waitAt ?? t0 - 5 * MINUTE_MS;
  const span = Math.max(MINUTE_MS, lastAt - (timing.firstReplyAt ?? createdAt));
  otherMessages.forEach((message, index) => {
    const isLastRequester = timing.requesterLastAt !== undefined && message.author === 'requester' && index === otherMessages.length - 1;
    const at = isLastRequester
      ? (timing.requesterLastAt as Instant)
      : (timing.firstReplyAt ?? createdAt) + Math.round(((index + 1) / (otherMessages.length + 1)) * span);
    say(Math.min(at, t0 - MINUTE_MS), message);
  });
  if (timing.requesterLastAt !== undefined && otherMessages.at(-1)?.author !== 'requester') {
    comments.push({
      at: timing.requesterLastAt,
      author: requester,
      visibility: 'public',
      body: words.reply('requesterMoreInfo', hero.subcategory, names, rng),
      channel: requesterChannel,
    });
  }

  // Where it stands at T0.
  if (hero.status === 'pending_requester' || hero.status === 'pending_third_party') {
    const waitAt = timing.waitAt ?? t0 - HOUR_MS;
    comments.push({
      at: waitAt,
      author: agent,
      visibility: 'public',
      body: words.reply(hero.status === 'pending_third_party' ? 'thirdParty' : 'clarifying', hero.subcategory, names, rng),
      channel: 'api',
    });
    if (status === 'new') setStatus(waitAt, 'in_progress', agent);
    setStatus(waitAt, hero.status, agent);
  }
  if (hero.status === 'resolved' && timing.resolvedAt !== undefined) {
    comments.push({
      at: timing.resolvedAt,
      author: agent,
      visibility: 'public',
      body: hero.resolutionNote ? fill(hero.resolutionNote, names) : words.reply('isItFixed', hero.subcategory, names, rng),
      channel: 'api',
    });
    setStatus(timing.resolvedAt, 'resolved', agent);
  }

  // Fulfilment tasks: the first `done` ones completed, evenly, before T0.
  if (hero.tasks && hero.tasks.length > 0) {
    const startAt = timing.firstReplyAt ?? createdAt + MINUTE_MS;
    const endAt = timing.resolvedAt ?? t0 - 10 * MINUTE_MS;
    hero.tasks.forEach((task, index) => {
      const completedAt = task.done ? startAt + Math.round(((index + 1) / (hero.tasks!.length + 1)) * (endAt - startAt)) : null;
      tasks.push({ title: task.title, team: task.team, assignee: null, createdAt: startAt, completedAt });
      events.push({ kind: 'task.created', at: startAt, actor: agent ?? null, title: task.title });
      if (completedAt !== null) events.push({ kind: 'task.completed', at: completedAt, actor: agent ?? null, title: task.title });
    });
  }

  const orderedEvents = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at - b.event.at || a.index - b.index).map(({ event }) => event);
  const orderedComments = [...comments].sort((a, b) => a.at - b.at);
  const statusChanges = orderedEvents.flatMap((event) => (event.kind === 'status' ? [{ at: event.at, to: event.to }] : []));
  const verdicts = evaluateSla(
    {
      priority: hero.priority,
      createdAt,
      requester,
      statusChanges,
      publicComments: orderedComments.filter((comment) => comment.visibility === 'public').map((comment) => ({ at: comment.at, author: comment.author })),
    },
    t0,
    clock,
  );
  const model = SUBCATEGORY_MODELS[hero.subcategory];

  const ticket: PlannedTicket = {
    ref: demoHeroRef(hero.key),
    hero: hero.key,
    type: hero.type,
    title: hero.title,
    description: fill(hero.description, names),
    priority: hero.priority,
    channel: hero.channel,
    category: categoryOfSubcategory(hero.subcategory),
    subcategory: hero.subcategory,
    service: hero.requestItem ? REQUEST_ITEMS[hero.requestItem].service : model.service,
    team: hero.team,
    requester,
    createdBy: hero.channel === 'voice' ? agent : null,
    assignee: agent,
    status: hero.status,
    createdAt,
    resolvedAt: hero.status === 'resolved' ? (timing.resolvedAt ?? null) : null,
    closedAt: null,
    events: orderedEvents,
    comments: orderedComments,
    tasks,
    ...(hero.requestItem ? { requestItem: hero.requestItem } : {}),
    ...(hero.requestItem && REQUEST_ITEMS[hero.requestItem].approval === 'variant' ? { variant: hero.approver ? ('approved' as const) : ('standard' as const) } : {}),
    custom: { ...(hero.custom ?? {}) },
    sla: {
      verdicts: { response: verdicts.response.verdict, update: verdicts.update.verdict, resolution: verdicts.resolution.verdict },
      dueAt: Object.fromEntries(
        (['response', 'update', 'resolution'] as const).flatMap((target) => {
          const due = verdicts[target].dueAt;
          return due === null ? [] : [[target, due]];
        }),
      ),
    },
    ...(hero.problem ? { problem: hero.problem } : {}),
  };
  return { ticket, approval };
}
