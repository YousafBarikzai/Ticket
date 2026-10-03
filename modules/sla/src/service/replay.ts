import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  transaction,
} from '@itsm/platform';
import { STATES } from '@itsm/module-ticket';
import {
  breachDue,
  meetTimer,
  pauseTimers,
  restartUpdateCycle,
  resumeTimers,
  startTimersForTicket,
  stopTimers,
} from './timer-service.js';

/**
 * SLA history for an imported ticket (A4 §2.6, W4).
 *
 * An imported ticket arrives with its whole life already lived — raised,
 * answered, put on hold, resolved — and none of the events that would have
 * run the SLA engine at the time. Its clocks are rebuilt here, by MOD-07,
 * from the ticket's own rows, by calling the very functions the live handlers
 * call, each with the clock of the moment it stands for. A second
 * implementation of business time in the demo generator would drift from this
 * module; this way there is one, and the replay inherits its gaps along with
 * its rules (a reopened ticket restarts nothing, exactly as live).
 *
 * The steps, oldest first:
 * - raised: `startTimersForTicket` at `createdAt`;
 * - before each step, `breachDue` up to that instant, so a deadline that fell
 *   before the step is missed before the step can meet it;
 * - a public reply from anyone but the requester: `meetTimer('response')`,
 *   then, when a person wrote it, `restartUpdateCycle` (F1);
 * - a status change: pause, resume, stop as met or stop as cancelled, by what
 *   the state machine says the new state does to the resolution clock;
 * - finally `breachDue` up to `upTo`, for clocks still running then.
 */

/** One thing the live handlers would have reacted to. */
export type ReplayStep =
  | { kind: 'status'; at: Date; from: string | null; to: string }
  | { kind: 'reply'; at: Date; authorId: string | null };

/** The rows a replay reads, as plain values, so the step order is testable on its own. */
export interface ReplaySource {
  requesterId: string | null;
  /** The ticket's state now, after its whole history. */
  status: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
  /** `status.changed` timeline entries, any order. */
  statusChanges: { at: Date; from: string | null; to: string }[];
  /** Public comments, any order. */
  publicComments: { at: Date; authorId: string | null }[];
}

/**
 * The steps the live handlers would have run, in the order they would have
 * run them.
 *
 * A reply counts exactly when the live comment handler would count it: public,
 * and not by the requester (`modules/sla/src/handlers/index.ts`; a comment
 * with no author on a ticket with no requester is the requester's own, as
 * there). That includes system replies, which meet the response target and
 * restart nothing.
 *
 * A ticket imported with no `status.changed` entries (a MOD-24 migration
 * carries only where it ended) is given the steps its columns prove: resolved
 * at `resolvedAt`, closed or cancelled at `closedAt`. When it waited on
 * somebody along the way, nothing records when, so nothing is invented.
 *
 * Steps at the same instant keep a fixed order, replies first: an agent who
 * answers and resolves in one go has answered before the clock stops.
 */
export function replaySteps(source: ReplaySource): ReplayStep[] {
  const replies: ReplayStep[] = source.publicComments
    .filter((comment) => comment.authorId !== source.requesterId)
    .map((comment) => ({ kind: 'reply', at: comment.at, authorId: comment.authorId }));

  let changes: ReplayStep[] = source.statusChanges.map((change) => ({ kind: 'status', at: change.at, from: change.from, to: change.to }));
  if (changes.length === 0) {
    changes = [];
    if (source.resolvedAt) changes.push({ kind: 'status', at: source.resolvedAt, from: null, to: 'resolved' });
    if (source.closedAt && (source.status === 'closed' || source.status === 'cancelled')) {
      changes.push({ kind: 'status', at: source.closedAt, from: null, to: source.status });
    }
  }

  const rank = (step: ReplayStep) => (step.kind === 'reply' ? 0 : 1);
  return [...replies, ...changes]
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.at.getTime() - b.step.at.getTime() || rank(a.step) - rank(b.step) || a.index - b.index)
    .map(({ step }) => step);
}

/** One target's verdict after the replay. */
export interface ReplayedTimer {
  timerId: string;
  targetType: string;
  /** cancelled > breached > met > running, the precedence reporting uses (F1 U7). */
  verdict: 'cancelled' | 'breached' | 'met' | 'running';
  state: string;
  dueAt: Date | null;
  metAt: Date | null;
  breachedAt: Date | null;
  cycle: number;
}

export interface ReplayResult {
  ticketId: string;
  /** Every timer the replay left, one per target, for the build's per-target check (A4 §1.11). */
  timers: ReplayedTimer[];
  met: number;
  breached: number;
  cancelled: number;
  /** Still running or paused at `upTo`: the live tick takes them from here. */
  running: number;
  /** History steps replayed. */
  steps: number;
  /** History steps after `upTo`, left out. */
  skipped: number;
}

export type ReplayRefusal = 'not-imported' | 'has-timers';

/**
 * A replay that would touch a live ticket's clocks. Only an imported ticket
 * with no timers can be replayed, so a replay can never rewrite the SLA of
 * work somebody is doing.
 */
export class ReplayRefusedError extends ConflictError {
  constructor(public readonly refusal: ReplayRefusal, ticket: string) {
    super(
      refusal === 'not-imported'
        ? `ticket ${ticket} was not imported; only an imported ticket's SLA can be replayed`
        : `ticket ${ticket} already has SLA timers; a replay only builds clocks that do not exist`,
    );
  }
}

function verdictOf(timer: { state: string; metAt: Date | null; breachedAt: Date | null }): ReplayedTimer['verdict'] {
  if (timer.state === 'cancelled') return 'cancelled';
  if (timer.breachedAt) return 'breached';
  if (timer.metAt) return 'met';
  return 'running';
}

function requireReplayer(ctx: TenantContext): void {
  authz.require(ctx, 'sla.override');
  if (!ctx.permissions.has('sla.override', 'any')) {
    throw new ForbiddenError('sla.override', 'replaying a ticket’s SLA needs tenant-wide permission');
  }
}

/**
 * The replay on the caller's transaction. `replayTimers` is the one to call;
 * this is it without the transaction, for a caller that already holds one.
 */
export async function replayTimersIn(ctx: TenantContext, tx: Tx, ticketId: string, options: { upTo: Date }): Promise<ReplayResult> {
  requireReplayer(ctx);
  const { upTo } = options;
  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId, deletedAt: null },
    select: {
      id: true,
      number: true,
      origin: true,
      status: true,
      requesterId: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      closedAt: true,
    },
  });
  if (!ticket) throw new NotFoundError('ticket', ticketId);
  if (ticket.origin !== 'import') throw new ReplayRefusedError('not-imported', ticket.number);
  if ((await tx.slaTimer.count({ where: { ticketId } })) > 0) throw new ReplayRefusedError('has-timers', ticket.number);
  if (upTo < ticket.createdAt) {
    throw new ValidationError('a replay cannot stop before the ticket was raised', [
      { field: 'upTo', code: 'before_created', message: 'a replay cannot stop before the ticket was raised' },
    ]);
  }

  const changes = await tx.ticketEvent.findMany({
    where: { ticketId, type: 'status.changed' },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { occurredAt: true, payload: true },
  });
  const comments = await tx.ticketComment.findMany({
    where: { ticketId, visibility: 'public', deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { createdAt: true, authorId: true },
  });

  const steps = replaySteps({
    requesterId: ticket.requesterId,
    status: ticket.status,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    statusChanges: changes.map((change) => {
      const payload = (change.payload ?? {}) as { from?: unknown; to?: unknown };
      return { at: change.occurredAt, from: typeof payload.from === 'string' ? payload.from : null, to: String(payload.to) };
    }),
    publicComments: comments.map((comment) => ({ at: comment.createdAt, authorId: comment.authorId })),
  });

  // The state each reply found, which decides whether its update cycle
  // restarts running or paused (F1 U3). Every ticket starts `new`.
  const firstChange = steps.find((step): step is Extract<ReplayStep, { kind: 'status' }> => step.kind === 'status');
  let status = firstChange?.from ?? 'new';
  // The SLA writes stamp the ticket row's `updatedAt` with the present; the
  // history's own last touch is put back at the end, or every imported ticket
  // would read as updated during the import.
  let lastWrite = ticket.createdAt;

  await startTimersForTicket(ctx, tx, ticketId, ticket.createdAt);
  let replayed = 0;
  let skipped = 0;

  for (const step of steps) {
    if (step.at > upTo) {
      skipped += 1;
      continue;
    }
    await breachDue(ctx, tx, ticketId, step.at, { escalate: false });

    if (step.kind === 'reply') {
      await meetTimer(ctx, tx, ticketId, 'response', step.at);
      if (step.authorId !== null) await restartUpdateCycle(ctx, tx, ticketId, step.at, { status });
    } else {
      const definition = STATES[step.to as keyof typeof STATES];
      if (!definition) {
        throw new ValidationError(`ticket ${ticket.number} has a status change to an unknown state: ${step.to}`);
      }
      status = step.to;
      switch (definition.sla.resolutionTimer) {
        case 'paused':
          await pauseTimers(ctx, tx, ticketId, definition.sla.pauseReason ?? 'pending_requester', step.at);
          lastWrite = step.at;
          break;
        case 'running':
          await resumeTimers(ctx, tx, ticketId, step.at);
          lastWrite = step.at;
          break;
        case 'stopped':
          await stopTimers(ctx, tx, ticketId, 'met', step.at);
          break;
        case 'cancelled':
          await stopTimers(ctx, tx, ticketId, 'cancelled', step.at);
          break;
      }
    }
    replayed += 1;
  }
  await breachDue(ctx, tx, ticketId, upTo, { escalate: false });

  await tx.ticket.updateMany({
    where: { id: ticketId },
    data: { updatedAt: lastWrite > ticket.updatedAt ? lastWrite : ticket.updatedAt },
  });

  const timers = await tx.slaTimer.findMany({ where: { ticketId }, orderBy: [{ targetType: 'asc' }, { id: 'asc' }] });
  const result: ReplayResult = { ticketId, timers: [], met: 0, breached: 0, cancelled: 0, running: 0, steps: replayed, skipped };
  for (const timer of timers) {
    const verdict = verdictOf(timer);
    result[verdict] += 1;
    result.timers.push({
      timerId: timer.id,
      targetType: timer.targetType,
      verdict,
      state: timer.state,
      dueAt: timer.dueAt,
      metAt: timer.metAt,
      breachedAt: timer.breachedAt,
      cycle: timer.cycle,
    });
  }
  return result;
}

/**
 * Rebuilds an imported ticket's SLA timers from its own history, in one
 * transaction (A4 §2.6): its clocks as they stood at `upTo`, with their
 * pauses, cycles, warnings and breaches, each dated when it happened.
 *
 * Refused (`ReplayRefusedError`) unless the ticket is imported and has no
 * timers yet. Nothing is escalated and nobody is notified; the events the
 * engine publishes along the way are the build's to discard (A4 §2.4 Q3).
 * Needs `sla.override` at tenant scope, which the system context holds.
 */
export async function replayTimers(ctx: TenantContext, ticketId: string, options: { upTo: Date }): Promise<ReplayResult> {
  requireReplayer(ctx);
  return transaction(ctx, (tx) => replayTimersIn(ctx, tx, ticketId, options));
}
