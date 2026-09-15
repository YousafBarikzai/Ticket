import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { isProblemState } from '../domain/lifecycle.js';
import { retireWorkaround } from './problem-service.js';

/**
 * The workaround.
 *
 * The most valuable thing problem management produces, and the reason this
 * module does not make it wait for a root cause. Publishing one moves the
 * problem to `known_error` in the same call, because the two are the same
 * event: there is no useful moment at which a workaround exists and the problem
 * is not a known error.
 *
 * The symptom is written from the reporter's side, not the engineer's. It is
 * matched against what a person describes at the service desk — "the export
 * button does nothing" — and a symptom written as "NullPointerException in
 * ExportController" is invisible to the person who needs it.
 */

export const publishSchema = z.object({
  symptom: z.string().min(1).max(2000),
  workaround: z.string().min(1).max(20_000),
  /** The knowledge article carrying the same words, if one exists (MOD-09). */
  articleKey: z.string().max(200).optional(),
});

export async function publishKnownError(ctx: TenantContext, number: string, input: z.input<typeof publishSchema>) {
  authz.require(ctx, 'problem.publish');
  const parsed = publishSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const problem = await tx.problem.findFirst({ where: { number } });
    if (!problem) throw new NotFoundError('problem', number);

    const status = isProblemState(problem.status) ? problem.status : 'investigating';
    if (status === 'resolved' || status === 'closed') {
      // Publishing a workaround for something already fixed is the trap this
      // module exists to close, arriving from the other direction.
      throw new ValidationError(
        `this problem is ${status}; a workaround for something already fixed costs the reader their time twice`,
      );
    }

    const existing = await tx.knownError.findFirst({ where: { problemId: problem.id } });
    const knownError = existing
      ? await tx.knownError.update({
          where: { id: existing.id },
          data: {
            symptom: parsed.symptom,
            workaround: parsed.workaround,
            articleKey: parsed.articleKey ?? null,
            status: 'published',
            publishedAt: new Date(),
            publishedBy: ctx.actor.id,
            retiredAt: null,
            retiredReason: null,
          },
        })
      : await tx.knownError.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            problemId: problem.id,
            symptom: parsed.symptom,
            workaround: parsed.workaround,
            articleKey: parsed.articleKey ?? null,
            status: 'published',
            publishedBy: ctx.actor.id,
          },
        });

    // Publishing and becoming a known error are the same event: there is no
    // useful moment at which a workaround exists and the problem is not one.
    if (status === 'investigating') {
      await tx.problem.update({ where: { id: problem.id }, data: { status: 'known_error', version: { increment: 1 } } });
    }

    const linkedTickets = await tx.problemTicket.count({ where: { problemId: problem.id } });

    await recordAudit(tx, ctx, {
      action: 'knownerror.published',
      targetType: 'problem',
      targetId: problem.id,
      after: { symptom: parsed.symptom, articleKey: parsed.articleKey ?? null },
    });
    await publish(tx, ctx, {
      definition: events.knownErrorPublished,
      aggregateId: problem.id,
      payload: {
        problemId: problem.id,
        number: problem.number,
        symptom: parsed.symptom,
        workaround: parsed.workaround,
        articleKey: parsed.articleKey ?? null,
        linkedTickets,
      },
    });

    metrics.increment('known_error_published_total');
    return knownError;
  });
}

export async function retireKnownError(ctx: TenantContext, number: string, reason: string) {
  authz.require(ctx, 'problem.publish');
  if (!reason.trim()) throw new ValidationError('say why the workaround is being withdrawn');

  return transaction(ctx, async (tx) => {
    const problem = await tx.problem.findFirst({ where: { number } });
    if (!problem) throw new NotFoundError('problem', number);

    const retired = await retireWorkaround(tx, ctx, problem.id, reason);
    if (retired === null) throw new NotFoundError('published known error', number);

    // Back to investigating: without a workaround it is not a known error, and
    // leaving the state would show agents a list entry with nothing behind it.
    if (problem.status === 'known_error') {
      await tx.problem.update({
        where: { id: problem.id },
        data: { status: 'investigating', version: { increment: 1 } },
      });
    }
    await recordAudit(tx, ctx, {
      action: 'knownerror.retired',
      targetType: 'problem',
      targetId: problem.id,
      reason,
    });
    return { retired: true, articleKey: retired || null };
  });
}

/**
 * The known errors an agent should be shown, newest first.
 *
 * Only those whose problem still has them live. A retired workaround is not
 * merely hidden from this list — the point is that it is never the answer to
 * "has anybody seen this before?".
 */
export async function listKnownErrors(ctx: TenantContext, search?: string) {
  authz.require(ctx, 'problem.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.knownError.findMany({
      where: {
        status: 'published',
        ...(search ? { OR: [{ symptom: { contains: search, mode: 'insensitive' } }, { workaround: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { problem: { select: { number: true, title: true, status: true, priority: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
    return rows;
  });
}
