import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  nextNumber,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import {
  STATES,
  assertTransition,
  isProblemState,
  retiresWorkaround,
  type ProblemState,
} from '../domain/lifecycle.js';

/**
 * Raising problems, linking what they caused, and moving them.
 *
 * The link is what makes a problem arguable. "This should be fixed" is an
 * opinion; "this has hit forty-one people since March" is a case, and it is the
 * only thing that gets a problem prioritised against feature work. So linking
 * is a first-class operation rather than a note in a description field.
 */

export const RAISED_FROM = ['major_incident', 'ticket_trend', 'manual'] as const;

export const createProblemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  categoryId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  raisedFrom: z.enum(RAISED_FROM).default('manual'),
  majorIncidentId: z.string().uuid().optional(),
  /** Tickets this problem is already known to have caused. */
  ticketIds: z.array(z.string().uuid()).max(200).default([]),
});

export async function createProblem(ctx: TenantContext, input: z.input<typeof createProblemSchema>) {
  authz.require(ctx, 'problem.manage');
  const parsed = createProblemSchema.parse(input);
  return transaction(ctx, (tx) => createProblemIn(ctx, tx, parsed));
}

/**
 * The same, on a transaction the caller already has.
 *
 * An event handler must use this one. Opening a transaction of its own inside
 * the consumer's would break the exactly-once guarantee the outbox and inbox
 * exist for: the problem would commit even when the handler's transaction rolls
 * back, and a replay would then find no inbox row and create a second.
 */
export async function createProblemIn(
  ctx: TenantContext,
  tx: Tx,
  input: z.input<typeof createProblemSchema>,
) {
  const parsed = createProblemSchema.parse(input);
  {
    const id = newId();
    const number = await nextNumber(tx, ctx, 'problem', 'PRB', 4);

    const problem = await tx.problem.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        number,
        title: parsed.title,
        description: parsed.description ?? null,
        status: 'investigating',
        priority: parsed.priority,
        categoryId: parsed.categoryId ?? null,
        serviceId: parsed.serviceId ?? null,
        ownerId: parsed.ownerId ?? null,
        raisedFrom: parsed.raisedFrom,
        majorIncidentId: parsed.majorIncidentId ?? null,
        createdBy: ctx.actor.id,
      },
    });

    for (const ticketId of parsed.ticketIds) await linkOne(tx, ctx, id, ticketId);

    await recordAudit(tx, ctx, {
      action: 'problem.created',
      targetType: 'problem',
      targetId: id,
      after: { number, title: parsed.title, raisedFrom: parsed.raisedFrom, priority: parsed.priority },
    });
    await publish(tx, ctx, {
      definition: events.problemCreated,
      aggregateId: id,
      payload: {
        problemId: id,
        number,
        title: parsed.title,
        priority: parsed.priority,
        raisedFrom: parsed.raisedFrom,
        majorIncidentId: parsed.majorIncidentId ?? null,
        serviceId: parsed.serviceId ?? null,
      },
    });

    metrics.increment('problem_created_total', { raisedFrom: parsed.raisedFrom });
    return problem;
  }
}

export async function listProblems(ctx: TenantContext, filter: { status?: string; serviceId?: string; open?: boolean } = {}) {
  authz.require(ctx, 'problem.read');
  return transaction(ctx, async (tx) => {
    const problems = await tx.problem.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
        ...(filter.open ? { status: { not: 'closed' } } : {}),
      },
      include: { knownError: true, _count: { select: { tickets: true } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return problems;
  });
}

export async function getProblem(ctx: TenantContext, number: string) {
  authz.require(ctx, 'problem.read');
  return transaction(ctx, async (tx) => {
    const problem = await loadByNumber(tx, number);
    const knownError = await tx.knownError.findFirst({ where: { problemId: problem.id } });
    const links = await tx.problemTicket.findMany({ where: { problemId: problem.id }, orderBy: { linkedAt: 'desc' }, take: 500 });
    return { problem, knownError, links };
  });
}

export const linkSchema = z.object({
  ticketIds: z.array(z.string().uuid()).min(1).max(200),
  /** Whether the published workaround was applied to these. */
  workaroundApplied: z.boolean().default(false),
});

/**
 * Links tickets to the problem.
 *
 * Idempotent per (problem, ticket): linking the same ticket twice is what
 * happens when two agents notice the same thing, and a duplicate would inflate
 * the only number anybody uses to argue for the fix.
 */
export async function linkTickets(ctx: TenantContext, number: string, input: z.input<typeof linkSchema>) {
  authz.require(ctx, 'problem.manage');
  const parsed = linkSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const problem = await loadByNumber(tx, number);
    let linked = 0;
    for (const ticketId of parsed.ticketIds) {
      if (await linkOne(tx, ctx, problem.id, ticketId, parsed.workaroundApplied)) linked += 1;
    }
    const total = await tx.problemTicket.count({ where: { problemId: problem.id } });
    return { linked, total };
  });
}

export async function unlinkTicket(ctx: TenantContext, number: string, ticketId: string) {
  authz.require(ctx, 'problem.manage');
  return transaction(ctx, async (tx) => {
    const problem = await loadByNumber(tx, number);
    const existing = await tx.problemTicket.findFirst({ where: { problemId: problem.id, ticketId } });
    if (!existing) throw new NotFoundError('problem ticket link', ticketId);
    await tx.problemTicket.delete({ where: { id: existing.id } });
  });
}

export const transitionSchema = z.object({
  to: z.string(),
  rootCause: z.string().max(10_000).optional(),
  /** Why, for the audit entry — and for retiring a workaround, what to tell people. */
  note: z.string().max(2000).optional(),
});

/**
 * Moves the problem, and retires its workaround when the move makes it obsolete.
 *
 * The retirement is the point. A problem is fixed, nobody remembers the known
 * error, and agents go on applying a workaround for a bug that no longer
 * exists — losing the time twice, once following it and once working out why it
 * did not help. Done here, in the same transaction, so it cannot be forgotten.
 */
export async function transition(ctx: TenantContext, number: string, input: z.input<typeof transitionSchema>) {
  authz.require(ctx, 'problem.manage');
  const parsed = transitionSchema.parse(input);
  if (!isProblemState(parsed.to)) throw new ValidationError(`unknown problem state: ${parsed.to}`);
  const to: ProblemState = parsed.to;

  return transaction(ctx, async (tx) => {
    const problem = await loadByNumber(tx, number);
    const from = stateOf(problem);
    assertTransition(from, to);
    if (from === to) return problem;

    if (to === 'known_error') {
      const knownError = await tx.knownError.findFirst({ where: { problemId: problem.id, status: 'published' } });
      if (!knownError) {
        throw new ValidationError(
          'publish a workaround before calling this a known error; the workaround is the whole point of the state',
        );
      }
    }

    const now = new Date();
    const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
    if (parsed.rootCause !== undefined) data.rootCause = parsed.rootCause;
    if (to === 'resolved') data.resolvedAt = now;
    // Reopening: it came back, so it is not resolved, and every figure measured
    // from the resolution would otherwise be wrong.
    if (to === 'investigating') data.resolvedAt = null;
    if (to === 'closed') data.closedAt = now;

    const moved = await tx.problem.update({ where: { id: problem.id }, data });

    let retired: string | null = null;
    if (retiresWorkaround(to)) {
      retired = await retireWorkaround(
        tx,
        ctx,
        problem.id,
        parsed.note ?? `The problem is ${to}, so this workaround no longer applies.`,
      );
    }

    await recordAudit(tx, ctx, {
      action: 'problem.status.changed',
      targetType: 'problem',
      targetId: problem.id,
      before: { status: from },
      after: { status: to, workaroundRetired: retired !== null },
      ...(parsed.note ? { reason: parsed.note } : {}),
    });

    if (to === 'resolved') {
      const linkedTickets = await tx.problemTicket.count({ where: { problemId: problem.id } });
      const openDays = Math.max(0, Math.round((now.getTime() - problem.createdAt.getTime()) / 86_400_000));
      await publish(tx, ctx, {
        definition: events.problemResolved,
        aggregateId: problem.id,
        payload: {
          problemId: problem.id,
          number: problem.number,
          rootCause: moved.rootCause,
          linkedTickets,
          openDays,
        },
      });
      metrics.observe('problem_open_days', openDays, {});
    }

    return moved;
  });
}

/**
 * Withdraws a published workaround, if there is one.
 *
 * Returns the article key it was published under so the caller can say what
 * else needs withdrawing. Shared with the resolve path rather than duplicated,
 * because a second copy of this would be the one that got forgotten.
 */
export async function retireWorkaround(
  tx: Tx,
  ctx: TenantContext,
  problemId: string,
  reason: string,
): Promise<string | null> {
  const knownError = await tx.knownError.findFirst({ where: { problemId, status: 'published' } });
  if (!knownError) return null;

  await tx.knownError.update({
    where: { id: knownError.id },
    data: { status: 'retired', retiredAt: new Date(), retiredReason: reason },
  });

  const problem = await tx.problem.findFirst({ where: { id: problemId }, select: { number: true } });
  await publish(tx, ctx, {
    definition: events.knownErrorRetired,
    aggregateId: problemId,
    payload: {
      problemId,
      number: problem?.number ?? '',
      reason,
      articleKey: knownError.articleKey,
    },
  });
  metrics.increment('known_error_retired_total');
  return knownError.articleKey ?? '';
}

// ---------------------------------------------------------------------------

async function linkOne(
  tx: Tx,
  ctx: TenantContext,
  problemId: string,
  ticketId: string,
  workaroundApplied = false,
): Promise<boolean> {
  const ticket = await tx.ticket.findFirst({ where: { id: ticketId }, select: { id: true } });
  if (!ticket) throw new NotFoundError('ticket', ticketId);

  const existing = await tx.problemTicket.findFirst({ where: { problemId, ticketId } });
  if (existing) {
    // Already linked. Recording that the workaround was applied is still new
    // information, so it is not simply skipped.
    if (workaroundApplied && !existing.workaroundApplied) {
      await tx.problemTicket.update({ where: { id: existing.id }, data: { workaroundApplied: true } });
    }
    return false;
  }

  await tx.problemTicket.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      problemId,
      ticketId,
      workaroundApplied,
      linkedBy: ctx.actor.id,
    },
  });
  return true;
}

async function loadByNumber(tx: Tx, number: string) {
  const problem = await tx.problem.findFirst({ where: { number } });
  if (!problem) throw new NotFoundError('problem', number);
  return problem;
}

function stateOf(problem: { status: string }): ProblemState {
  return isProblemState(problem.status) ? problem.status : 'investigating';
}

/** Whether a problem in this state should be showing its workaround to agents. */
export function workaroundLive(status: string): boolean {
  return isProblemState(status) ? STATES[status].workaroundLive : false;
}
