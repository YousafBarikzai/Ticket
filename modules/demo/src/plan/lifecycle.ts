import type { CanonicalState, Priority } from '@itsm/contracts';
import type { BusinessClock } from './calendar.js';
import type {
  CategoryKey,
  DemoTicketType,
  ReplyKind,
  RequestItemKey,
  ServiceKey,
  SubcategoryKey,
  TeamKey,
  TicketChannel,
} from './content-types.js';
import type { TargetType } from './model.js';
import type { Stream } from './rng.js';
import { SlaSim, targetMs } from './sla-plan.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, type Instant } from './time.js';
import type { PlannedComment, PlannedEvent, PlannedTask, PlannedTimeEntry } from './types.js';
import type { Words } from './words.js';

/**
 * One ticket's whole life, from the moment it was raised to the moment it
 * closed — independent of T0 (A4 §1.15).
 *
 * A ticket keyed on its calendar day is built in full here, then cut at T0
 * (`cutAt`): the same ticket is open in tonight's build and resolved in next
 * week's, with the same words and the same instants in both.
 *
 * Its SLA verdicts are drawn first (§1.11) and then realised: the builder
 * steps an `SlaSim` forward and places each reply where the verdict needs it
 * — inside the target for a met one, past it for a breached one — using the
 * same business-time maths and calendar MOD-07 will replay.
 */

export interface TicketDraw {
  readonly ref: string;
  readonly createdAt: Instant;
  readonly type: DemoTicketType;
  readonly priority: Priority;
  readonly channel: TicketChannel;
  readonly category: CategoryKey;
  readonly subcategory: SubcategoryKey;
  readonly service: ServiceKey;
  readonly team: TeamKey;
  readonly requester: string;
  readonly requesterFirstName: string;
  /** The agent who works it. */
  readonly agent: string;
  readonly agentFirstName: string;
  /** Who assigns it by hand, when routing does not (a team lead). */
  readonly lead: string;
  /** Assigned by routing the moment it was raised, or by hand a little later. */
  readonly routed: boolean;
  /** For a voice ticket: the agent who logged the call. */
  readonly loggedBy: string | null;
  readonly breach: Readonly<Record<TargetType, boolean>>;
  readonly outcome: 'resolved' | 'cancelled';
  readonly reopen: boolean;
  readonly wait: 'pending_requester' | 'pending_third_party' | null;
  readonly approval: {
    readonly approver: string;
    readonly outcome: 'approved' | 'rejected';
    /** Business time from the request to the decision. */
    readonly turnaroundMs: number;
  } | null;
  readonly tasks: readonly { readonly title: string; readonly team: TeamKey }[];
  readonly requestItem?: RequestItemKey;
  readonly invited: boolean;
}

export interface TicketLife {
  readonly events: readonly PlannedEvent[];
  readonly comments: readonly PlannedComment[];
  readonly tasks: readonly PlannedTask[];
  readonly approval: { readonly requestedAt: Instant; readonly decidedAt: Instant; readonly outcome: 'approved' | 'rejected' } | null;
  /** The first resolution: when the verdicts were settled. */
  readonly firstResolvedAt: Instant | null;
  /** The last resolution (after a reopen), which the survey follows. */
  readonly finalResolvedAt: Instant | null;
  readonly closedAt: Instant | null;
  readonly cancelledAt: Instant | null;
  readonly firstReplyAt: Instant | null;
  readonly timeEntries: readonly PlannedTimeEntry[];
  /** The survey invitation's instant, when the ticket earned one. */
  readonly invitedAt: Instant | null;
}

export interface LifeTools {
  /** The SLA policy's clock for this ticket's priority. */
  readonly clock: BusinessClock;
  /** Office hours, for when people act (approvers, agents on a non-P1). */
  readonly office: BusinessClock;
  readonly words: Words;
}

const AUTO_CLOSE_MS = 7 * DAY_MS;

/** Builds a ticket's whole life from its draw. Pure: the same draw and stream give the same life. */
export function buildLife(draw: TicketDraw, tools: LifeTools, rng: Stream): TicketLife {
  const { clock, office, words } = tools;
  const c = draw.createdAt;
  const sim = new SlaSim(draw.priority, c, clock);
  const events: PlannedEvent[] = [];
  const comments: PlannedComment[] = [];
  const timeEntries: PlannedTimeEntry[] = [];
  let status: CanonicalState = 'new';
  let now = c;
  let assignee: string | null = null;
  // When fulfilment starts: the first answer, or the approval after it.
  let taskStart: Instant | null = null;

  const tr = targetMs(draw.priority, 'response');
  const tu = targetMs(draw.priority, 'update');
  const tres = targetMs(draw.priority, 'resolution');
  const names = { first: draw.requesterFirstName, agent: draw.agentFirstName };
  const requesterChannel: TicketChannel = draw.channel === 'system' || draw.channel === 'voice' ? 'email' : draw.channel;

  const at = (instant: Instant): Instant => {
    // Never step back: two milestones that round to one instant keep their order.
    now = Math.max(now, instant);
    return now;
  };
  const setStatus = (instant: Instant, to: CanonicalState, actor: string | null, reason?: string): void => {
    const when = at(instant);
    events.push({ kind: 'status', at: when, actor, from: status, to, ...(reason ? { reason } : {}) });
    sim.changeStatus(when, to);
    status = to;
  };
  const agentSays = (instant: Instant, kind: ReplyKind, visibility: 'public' | 'internal' = 'public'): Instant => {
    const when = at(instant);
    comments.push({ at: when, author: draw.agent, visibility, body: words.reply(kind, draw.subcategory, names, rng), channel: 'api' });
    if (visibility === 'public') sim.reply(when, true);
    return when;
  };
  const requesterSays = (instant: Instant, kind: ReplyKind): Instant => {
    const when = at(instant);
    comments.push({ at: when, author: draw.requester, visibility: 'public', body: words.reply(kind, draw.subcategory, names, rng), channel: requesterChannel });
    return when;
  };
  const assign = (instant: Instant, actor: string | null, method: 'least_loaded' | 'manual' | 'rule'): void => {
    if (assignee === draw.agent) return;
    const when = at(instant);
    events.push({ kind: 'assigned', at: when, actor, team: draw.team, assignee: draw.agent, method });
    assignee = draw.agent;
  };

  /* -------------------------------------------------- Raised */
  const createdActor = draw.channel === 'system' ? null : (draw.loggedBy ?? draw.requester);
  events.push({ kind: 'created', at: c, actor: createdActor, channel: draw.channel });
  if (draw.routed) assign(c + 20_000, null, draw.channel === 'system' ? 'rule' : 'least_loaded');

  /* -------------------------------------------------- Draws, all up front so the stream's order never depends on branches */
  const fResponse = draw.breach.response ? rng.range(1.08, Math.min(2.4, (0.85 * tu) / tr)) : 0.05 + 0.85 * Math.pow(rng.float(), 4);
  const manualAssignShare = rng.range(0.15, 0.6);
  const lateUpdateShare = rng.range(0.08, 0.22);
  const updateShares = Array.from({ length: 40 }, () => rng.range(0.5, 0.88));
  let fResolution = draw.breach.resolution ? rng.range(1.08, 1.6) : 0.12 + 0.8 * Math.pow(rng.float(), 0.85);
  const waitShare = rng.range(0.25, 0.7);
  const waitWallMs =
    draw.wait === 'pending_third_party' ? rng.range(1, 6) * DAY_MS : Math.exp(rng.range(Math.log(HOUR_MS), Math.log(3 * DAY_MS)));
  const cancelEarly = rng.chance(0.5);
  const cancelShare = rng.range(0.1, 0.7);
  const thanks = rng.chance(0.25);
  const reopenAfterMs = rng.range(4 * HOUR_MS, 3 * DAY_MS);
  const reopenReplyMs = rng.range(20, 120) * MINUTE_MS;
  const reopenWorkMs = rng.range(1, 6) * HOUR_MS;
  const closeJitterMs = rng.range(0, 60) * MINUTE_MS;
  const noteShare = rng.chance(0.3) ? rng.range(0.2, 0.8) : null;
  const logsTime = rng.chance(0.6);
  const loggedMinutes = Math.round(Math.min(240, Math.max(5, 15 * Math.exp(1.08 * rng.normal()))));

  /* -------------------------------------------------- Approval (requests whose item needs one) */
  let approval: TicketLife['approval'] = null;
  if (draw.approval) {
    const requestedAt = c + rng.int(1, 3) * MINUTE_MS;
    setStatus(requestedAt, 'pending_approval', null, 'Waiting for approval');
    const decidedAt = office.add(requestedAt, draw.approval.turnaroundMs);
    approval = { requestedAt, decidedAt, outcome: draw.approval.outcome };
  }

  /* -------------------------------------------------- First response */
  const firstReplyAt = clock.add(c, fResponse * tr);
  if (!draw.routed) assign(clock.add(c, manualAssignShare * fResponse * tr), draw.lead, 'manual');

  // A cancellation before anyone answered: the requester withdraws it.
  if (draw.outcome === 'cancelled' && !draw.approval && cancelEarly) {
    const cancelAt = clock.add(c, cancelShare * fResponse * tr);
    requesterSays(cancelAt, 'cancelled');
    setStatus(cancelAt, 'cancelled', draw.requester, 'No longer needed');
    return finish({ cancelledAt: cancelAt, firstReplyAt: null, firstResolvedAt: null, finalResolvedAt: null, closedAt: cancelAt });
  }

  // The approval may be decided before or after the first answer; take them in order.
  let decided = false;
  const decide = (): boolean => {
    if (!approval || decided) return false;
    decided = true;
    if (approval.outcome === 'approved') {
      setStatus(approval.decidedAt, 'in_progress', null, 'Approved');
      return false;
    }
    // Declined: the agent closes the request with the reason. Never cancelled:
    // no cancelled ticket carries an approval (V8).
    const declinedAt = clock.add(approval.decidedAt, rng.range(5, 40) * MINUTE_MS);
    agentSays(declinedAt, 'resolution');
    setStatus(declinedAt, 'resolved', draw.agent, 'Request declined');
    return true;
  };

  let declined = false;
  if (approval && approval.decidedAt <= firstReplyAt) declined = decide();
  if (declined) {
    const resolvedAt = now;
    const closedAt = resolvedAt + AUTO_CLOSE_MS + closeJitterMs;
    setStatus(closedAt, 'closed', null, 'Closed automatically after 7 days');
    return finish({ cancelledAt: null, firstReplyAt: null, firstResolvedAt: resolvedAt, finalResolvedAt: resolvedAt, closedAt });
  }

  agentSays(firstReplyAt, 'firstResponse');
  if (status === 'new') setStatus(firstReplyAt, 'in_progress', draw.agent);
  if (approval && !decided && approval.outcome === 'approved') decide();
  if (approval && !decided) {
    declined = decide();
    if (declined) {
      const resolvedAt = now;
      const closedAt = resolvedAt + AUTO_CLOSE_MS + closeJitterMs;
      setStatus(closedAt, 'closed', null, 'Closed automatically after 7 days');
      return finish({ cancelledAt: null, firstReplyAt, firstResolvedAt: resolvedAt, finalResolvedAt: resolvedAt, closedAt });
    }
  }

  /* -------------------------------------------------- Tasks (joiners and leavers) */
  taskStart = now;

  /* -------------------------------------------------- The work, until resolution */
  // Room for one late update before resolving, when the update target breaches.
  let breachUpdate = draw.breach.update;
  if (breachUpdate) {
    const needed = (sim.workUsed(now) + (1 + lateUpdateShare) * tu + 0.05 * tres) / tres;
    if (needed > fResolution) {
      if (draw.breach.resolution || needed <= 0.94) fResolution = Math.max(fResolution, needed);
      else breachUpdate = false;
    }
  }
  // A cancellation part-way through.
  const cancelLate = draw.outcome === 'cancelled' && !draw.approval;
  const cancelAtShare = cancelShare * fResolution;
  let waitPending = draw.wait !== null && !cancelLate;
  const waitAtShare = waitShare * fResolution;
  let noteDone = noteShare === null;
  let updateIndex = 0;
  let resolvedAt: Instant | null = null;

  for (let guard = 0; guard < 400 && resolvedAt === null; guard += 1) {
    type Next = { kind: 'resolve' | 'cancel' | 'wait' | 'update' | 'late-update' | 'note'; at: Instant };
    const candidates: Next[] = [];
    const resolveAt = sim.instantAtWork(fResolution * tres);
    if (resolveAt !== null) candidates.push({ kind: cancelLate ? 'cancel' : 'resolve', at: cancelLate ? (sim.instantAtWork(cancelAtShare * tres) ?? resolveAt) : resolveAt });
    if (waitPending) {
      const waitAt = sim.instantAtWork(waitAtShare * tres);
      if (waitAt !== null) candidates.push({ kind: 'wait', at: waitAt });
    }
    if (!noteDone && noteShare !== null) {
      const noteAt = sim.instantAtWork(noteShare * fResolution * tres);
      if (noteAt !== null) candidates.push({ kind: 'note', at: noteAt });
    }
    const updateDue = sim.dueAt('update');
    if (updateDue !== null) {
      if (breachUpdate) candidates.push({ kind: 'late-update', at: clock.add(updateDue, lateUpdateShare * tu) });
      else {
        const share = updateShares[updateIndex % updateShares.length] ?? 0.7;
        candidates.push({ kind: 'update', at: clock.add(now, share * clock.elapsed(now, updateDue)) });
      }
    }
    if (candidates.length === 0) {
      // Nothing is running: the ticket waits on someone (handled where the wait began).
      break;
    }
    candidates.sort((a, b) => a.at - b.at);
    const next = candidates[0] as Next;

    switch (next.kind) {
      case 'resolve': {
        const resolutionAt = agentSays(next.at, draw.type === 'incident' && rng.chance(0.5) ? 'isItFixed' : 'resolution');
        setStatus(resolutionAt, 'resolved', draw.agent);
        resolvedAt = resolutionAt;
        break;
      }
      case 'cancel': {
        requesterSays(next.at, 'cancelled');
        setStatus(next.at, 'cancelled', draw.requester, 'No longer needed');
        return finish({ cancelledAt: now, firstReplyAt, firstResolvedAt: null, finalResolvedAt: null, closedAt: now });
      }
      case 'wait': {
        waitPending = false;
        const kind: ReplyKind = draw.wait === 'pending_third_party' ? 'thirdParty' : 'clarifying';
        const askedAt = agentSays(next.at, kind);
        setStatus(askedAt, draw.wait as CanonicalState, draw.agent);
        const backAt = askedAt + waitWallMs;
        if (draw.wait === 'pending_requester') {
          requesterSays(backAt, rng.chance(0.15) ? 'requesterFrustrated' : 'requesterMoreInfo');
          setStatus(backAt, 'in_progress', null);
        } else {
          agentSays(backAt, 'update');
          setStatus(backAt, 'in_progress', draw.agent);
        }
        break;
      }
      case 'note':
        noteDone = true;
        agentSays(next.at, 'internalNote', 'internal');
        break;
      case 'update':
        updateIndex += 1;
        agentSays(next.at, 'update');
        break;
      case 'late-update':
        breachUpdate = false;
        agentSays(next.at, 'update');
        break;
    }
  }

  const firstResolvedAt = resolvedAt;
  if (firstResolvedAt === null) {
    // Unreachable for a well-formed draw; a ticket left open for ever would
    // still be a valid history, so it is kept rather than thrown away.
    return finish({ cancelledAt: null, firstReplyAt, firstResolvedAt: null, finalResolvedAt: null, closedAt: null });
  }

  /* -------------------------------------------------- After resolution */
  let finalResolvedAt = firstResolvedAt;
  if (thanks && !draw.reopen) requesterSays(firstResolvedAt + rng.range(10, 360) * MINUTE_MS, 'requesterPositive');
  if (draw.reopen) {
    const reopenedAt = requesterSays(firstResolvedAt + reopenAfterMs, 'reopen');
    setStatus(reopenedAt, 'reopened', draw.requester, 'It came back');
    const answeredAt = agentSays(office.add(reopenedAt, reopenReplyMs), 'update');
    setStatus(answeredAt, 'in_progress', draw.agent);
    const againAt = agentSays(office.add(answeredAt, reopenWorkMs), 'resolution');
    setStatus(againAt, 'resolved', draw.agent);
    finalResolvedAt = againAt;
  }
  const closedAt = finalResolvedAt + AUTO_CLOSE_MS + closeJitterMs;
  setStatus(closedAt, 'closed', null, 'Closed automatically after 7 days');

  if (logsTime) {
    timeEntries.push({ ticketRef: draw.ref, person: draw.agent, minutes: loggedMinutes, loggedAt: Math.max(firstReplyAt, firstResolvedAt - 5 * MINUTE_MS) });
  }

  return finish({ cancelledAt: null, firstReplyAt, firstResolvedAt, finalResolvedAt, closedAt });

  function finish(end: {
    cancelledAt: Instant | null;
    firstReplyAt: Instant | null;
    firstResolvedAt: Instant | null;
    finalResolvedAt: Instant | null;
    closedAt: Instant | null;
  }): TicketLife {
    // Fulfilment tasks, spread between the first answer and the resolution.
    const tasks: PlannedTask[] = [];
    if (draw.tasks.length > 0 && end.firstReplyAt !== null) {
      const startAt = taskStartOr(end.firstReplyAt);
      const endAt = end.firstResolvedAt;
      const span = endAt !== null ? office.elapsed(startAt, endAt) : 0;
      draw.tasks.forEach((task, index) => {
        const completedAt = endAt !== null ? office.add(startAt, ((index + 1) / (draw.tasks.length + 1)) * span) : null;
        tasks.push({ title: task.title, team: task.team, assignee: null, createdAt: startAt, completedAt });
        events.push({ kind: 'task.created', at: startAt, actor: draw.agent, title: task.title });
        if (completedAt !== null) events.push({ kind: 'task.completed', at: completedAt, actor: draw.agent, title: task.title });
      });
    }
    const ordered = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at - b.event.at || a.index - b.index);
    const resolvedForSurvey = end.finalResolvedAt !== null && draw.invited && draw.type !== 'question' ? end.finalResolvedAt : null;
    return {
      events: ordered.map(({ event }) => event),
      comments,
      tasks,
      approval,
      firstResolvedAt: end.firstResolvedAt,
      finalResolvedAt: end.finalResolvedAt,
      closedAt: end.closedAt,
      cancelledAt: end.cancelledAt,
      firstReplyAt: end.firstReplyAt,
      timeEntries,
      invitedAt: resolvedForSurvey === null ? null : resolvedForSurvey + MINUTE_MS,
    };
  }

  function taskStartOr(fallback: Instant): Instant {
    return Math.max(fallback, taskStart ?? fallback);
  }
}
