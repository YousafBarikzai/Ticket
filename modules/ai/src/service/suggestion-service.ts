import { z } from 'zod';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  aiRegions,
  authz,
  createContext,
  enqueue,
  getSetting,
  isEnabled,
  logger,
  metrics,
  newId,
  platformDb,
  publish,
  publishNotice,
  recordAudit,
  topicForEntity,
  topicForUser,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { ticketService } from '@itsm/module-ticket';
import { resolveActor } from '@itsm/module-identity';
import { periodFor } from '../domain/budget.js';
import { CAPABILITIES, callsAModel, definitionFor, type Capability, type Evidence } from '../domain/capabilities.js';
import { UnparseableCompletion, parseCompletion } from '../domain/output.js';
import { activeDefaultModel, activeProvider } from '../providers/registry.js';
import { assemble, renderable } from './context-service.js';
import { assertWithinBudget, recordSpend } from './budget-service.js';
import { NoProviderConfigured, ProviderOutsideResidency, callModel, residencyPermits } from './gateway.js';
import { currentVersionOf } from './prompt-service.js';

/**
 * The suggestion lifecycle: asked for, generated, shown, decided.
 *
 * Everything here is **advisory**. Nothing this module produces is applied to
 * a ticket, sent to a requester or published as an article; a person accepts,
 * edits or rejects it and their act is what changes anything (ADR-0006). That
 * is not a limitation of this phase, it is the design: the audit trail stays
 * attributable to a person, and the worst failure is a bad suggestion nobody
 * sent.
 *
 * The refusals, in the order they are made, because the order is the design:
 *
 *   1. permission  — may this person ask at all
 *   2. kill switch — is the capability switched on for this tenant
 *   3. provider    — is there anything to ask (OD-04)
 *   4. residency   — may this tenant's prompts be processed where it runs
 *   5. budget      — has this tenant any money left this month
 *   6. visibility  — may this person see the ticket they named
 *
 * Every one of them happens before a job is queued, so a refusal is immediate
 * and costs nothing. A job that reached the worker and failed there would be a
 * spinner that ends in an apology.
 */

export const requestSchema = z
  .object({
    capability: z.enum(CAPABILITIES),
    ticketId: z.string().min(1).max(64),
  })
  .strict();
export type SuggestionRequest = z.input<typeof requestSchema>;

export const outcomeSchema = z
  .object({
    outcome: z.enum(['accepted', 'edited', 'rejected']),
    note: z.string().max(1000).optional(),
  })
  .strict();

/** The context an AI-generated row is attributed to: the AI, for the person. */
function asAi(ctx: TenantContext, onBehalfOf: string | null): TenantContext {
  return { ...ctx, actor: { type: 'ai', id: null, displayName: 'AI', onBehalfOf } };
}

async function assertSwitchedOn(ctx: TenantContext, capability: Capability): Promise<void> {
  const definition = definitionFor(capability);
  if (!(await isEnabled(ctx, 'ai.enabled'))) {
    throw new ForbiddenError('ai.suggest', 'AI is switched off for this tenant');
  }
  if (!(await isEnabled(ctx, definition.flagKey))) {
    throw new ForbiddenError('ai.suggest', `${definition.name} is switched off for this tenant`);
  }
}

export interface RequestResult {
  jobId: string;
  status: 'queued' | 'completed';
  suggestionId: string | null;
}

export async function requestSuggestion(ctx: TenantContext, input: SuggestionRequest): Promise<RequestResult> {
  authz.require(ctx, 'ai.suggest');
  const parsed = requestSchema.parse(input);
  const capability = parsed.capability;
  const requestedBy = ctx.actor.id;
  if (!requestedBy) throw new ForbiddenError('ai.suggest', 'only a person can ask for a suggestion');

  await assertSwitchedOn(ctx, capability);

  const needsAModel = callsAModel(capability);
  if (needsAModel) {
    const provider = activeProvider();
    if (!provider) throw new NoProviderConfigured();
    // The gateway makes the same decision immediately before it sends, and
    // that is the enforcement point — a worker can run long after the regions
    // were changed, and `runEvaluation` reaches the gateway without coming
    // through here at all. This is the *door*: both inputs are known now (the
    // provider is registered in this process, the regions are on the context),
    // so a tenant whose policy forbids the only provider is told so instead of
    // being handed a job id that will fail in a worker it cannot see.
    if (!residencyPermits(provider.processingRegion, aiRegions(ctx))) {
      metrics.increment('ai_calls_refused_total', { reason: 'residency', provider: provider.name });
      throw new ProviderOutsideResidency(provider.name, provider.processingRegion ?? 'unknown', aiRegions(ctx));
    }
    await assertWithinBudget(ctx);
  }

  // Throws 404 if this person may not see it, which is the answer they should
  // get: a ticket they cannot read must not become one they can summarise.
  const ticket = await ticketService.getTicket(ctx, parsed.ticketId);

  const promptKey = definitionFor(capability).promptKey;
  const version = promptKey ? await currentVersionOf(promptKey) : null;
  if (promptKey && !version) {
    throw new ValidationError(
      `no evaluated prompt has been promoted for ${capability}, so there is nothing to generate with`,
    );
  }

  const now = new Date();
  const jobId = newId();

  await transaction(ctx, async (tx) => {
    await tx.aiJob.create({
      data: {
        id: jobId,
        tenantId: ctx.tenantId,
        capability,
        subjectType: 'ticket',
        subjectId: ticket.id,
        status: 'queued',
        requestedBy,
        promptKey: promptKey ?? 'none',
        // Pinned at request time, so a promotion between the ask and the
        // answer cannot change what generated it — the same reason a workflow
        // run finishes on the version it started on.
        promptVersion: version?.version ?? 0,
        provider: activeProvider()?.name ?? 'none',
        // The provider's default, not a platform constant: a constant is right
        // for exactly one provider and refused by every other.
        model: needsAModel ? (activeDefaultModel() ?? 'none') : 'none',
        periodKey: periodFor(now),
      },
    });
  });

  // Retrieval only: no model, no cost, and no reason to make somebody wait for
  // a worker. It is the cheapest useful thing in the module and it stays
  // available when the budget has run out.
  if (!needsAModel) {
    const suggestionId = await runRetrievalOnly(ctx, jobId, capability, ticket.id);
    return { jobId, status: 'completed', suggestionId };
  }

  await enqueue(ctx, 'ai', 'ai.suggest', { jobId });
  metrics.increment('ai_jobs_queued_total', { capability });
  return { jobId, status: 'queued', suggestionId: null };
}

async function runRetrievalOnly(ctx: TenantContext, jobId: string, capability: Capability, ticketId: string): Promise<string> {
  const assembled = await assemble(ctx, capability, ticketId);
  const items = assembled.evidence.map((one) => ({
    kind: one.kind === 'article' ? 'article' : one.kind,
    id: one.id,
    title: one.title,
    ref: one.ref,
    why: one.extract.slice(0, 200),
  }));

  return transaction(ctx, async (tx) => {
    const job = await tx.aiJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundError('ai job', jobId);
    await tx.aiJob.update({
      where: { id: jobId },
      data: { status: 'completed', startedAt: new Date(), finishedAt: new Date() },
    });
    return storeSuggestion(ctx, tx, job, {
      content: { items },
      reason: items.length > 0 ? `Found ${items.length} related records.` : 'Nothing related was found.',
      confidence: items.length > 0 ? 'medium' : 'low',
      evidence: assembled.evidence,
    });
  });
}

interface StoredSuggestion {
  content: Record<string, unknown>;
  reason: string;
  confidence: string;
  evidence: Evidence[];
}

async function storeSuggestion(
  ctx: TenantContext,
  tx: Tx,
  job: { id: string; capability: string; subjectType: string; subjectId: string; requestedBy: string },
  input: StoredSuggestion,
): Promise<string> {
  const id = newId();
  await tx.aiSuggestion.create({
    data: {
      id,
      tenantId: ctx.tenantId,
      jobId: job.id,
      capability: job.capability,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      content: input.content as never,
      reason: input.reason,
      confidence: input.confidence,
      evidence: input.evidence as never,
    },
  });

  const aiCtx = asAi(ctx, job.requestedBy);
  await recordAudit(tx, aiCtx, {
    action: 'ai.suggestion.created',
    targetType: 'ai_suggestion',
    targetId: id,
    after: { capability: job.capability, confidence: input.confidence, evidence: input.evidence.length },
  });
  await publish(tx, ctx, {
    definition: events.aiSuggestionCreated,
    aggregateId: id,
    actorOverride: aiCtx.actor,
    payload: {
      suggestionId: id,
      jobId: job.id,
      capability: job.capability,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      confidence: input.confidence,
      evidenceCount: input.evidence.length,
      audience: [{ kind: 'user' as const, userId: job.requestedBy }],
    },
  });
  return id;
}

/**
 * Rebuilds the asking person's own context inside the worker.
 *
 * This is the most important function in the module, and it is five lines.
 * A job arrives with the actor's *id* and the worker's *permissions*, which
 * are the platform's system set — so retrieval running on the job's context
 * would search everything in the tenant and put it in front of somebody who
 * may see a tenth of it. Every permission check in the assembler is real and
 * every one of them would have passed. "The AI never sees more than the actor"
 * (doc 13 §1) is only true if the actor is the actor.
 */
async function asRequester(workerCtx: TenantContext, userId: string): Promise<TenantContext> {
  const actor = await resolveActor(workerCtx, userId);
  if (!actor || actor.status !== 'active') {
    throw new ValidationError('the person who asked for this suggestion no longer has an active account');
  }
  return createContext({
    tenantId: workerCtx.tenantId,
    actor: { type: 'user', id: userId, displayName: actor.displayName },
    permissions: actor.permissions,
    organisationIds: actor.organisationIds,
    organisationPaths: actor.organisationPaths,
    teamIds: actor.teamIds,
    correlationId: workerCtx.correlationId,
  });
}

/**
 * The worker half: assemble, call, parse, store.
 *
 * Everything that *reads* runs as the person who asked; everything that
 * *writes* runs as the worker, attributed to the AI on their behalf. Those are
 * two different contexts on purpose, and mixing them is how an assistant
 * becomes a privilege escalation with a friendly tone.
 */
export async function runSuggestionJob(ctx: TenantContext, jobId: string): Promise<void> {
  const job = await transaction(ctx, async (tx) => {
    const row = await tx.aiJob.findFirst({ where: { id: jobId } });
    if (!row) throw new NotFoundError('ai job', jobId);
    // Claimed once. A redelivered job finds it is no longer queued and stops,
    // which is what keeps a retry from being charged for twice.
    if (row.status !== 'queued') return null;
    return tx.aiJob.update({ where: { id: jobId }, data: { status: 'running', startedAt: new Date() } });
  });
  if (!job) {
    logger.debug('an AI job was delivered again after it had already been claimed', { jobId });
    return;
  }

  const capability = job.capability as Capability;
  try {
    const version = await currentVersionOfExactly(job.promptKey, job.promptVersion);
    const reader = await asRequester(ctx, job.requestedBy);
    const assembled = await assemble(reader, capability, job.subjectId);

    const definition = definitionFor(capability);
    if (definition.evidenceRequired && assembled.evidence.length === 0) {
      // A reply invented from nothing reads as confident and speaks for the
      // organisation. Refusing is the right answer, and saying why is what
      // makes it actionable: the knowledge base is what is missing.
      throw new ValidationError(
        `${definition.name} found nothing to ground an answer in, so it has not drafted one. ` +
          'A reply written from no evidence would read as confident and be unsupported.',
      );
    }

    const result = await callModel({
      capability,
      systemPrompt: version.systemPrompt,
      template: version.template,
      context: renderable(assembled.context),
      model: job.model,
      allowedRegions: aiRegions(ctx),
    });
    const parsedOut = parseCompletion(capability, result.completion.text);

    const retainDays = await getSetting<number>(ctx, 'ai.retainDays').catch(() => 30);
    await transaction(ctx, async (tx) => {
      await tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          provider: result.provider,
          model: result.completion.model,
          inputTokens: result.completion.inputTokens,
          outputTokens: result.completion.outputTokens,
          costMicros: result.costMicros,
          promptText: retainDays > 0 ? result.promptText : null,
          completionText: retainDays > 0 ? result.completion.text : null,
        },
      });
      await storeSuggestion(ctx, tx, job, {
        content: parsedOut.content,
        reason: parsedOut.reason,
        confidence: parsedOut.confidence,
        evidence: assembled.evidence,
      });
      await recordSpend(ctx, tx, job.periodKey);
    });
    metrics.increment('ai_jobs_completed_total', { capability });
    await announce(ctx, job, 'completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refused = error instanceof ValidationError || error instanceof UnparseableCompletion;
    await transaction(ctx, (tx) =>
      tx.aiJob.update({
        where: { id: job.id },
        data: { status: refused ? 'refused' : 'failed', finishedAt: new Date(), error: message.slice(0, 2000) },
      }),
    );
    metrics.increment('ai_jobs_failed_total', { capability, kind: refused ? 'refused' : 'failed' });
    logger.warn('an AI job did not produce a suggestion', { jobId, capability, refused, error: message });
    // Announced too. A panel that is told only about success waits out its
    // whole polling ceiling on a refusal and then says "this is taking a
    // while", which is both slower and untrue.
    await announce(ctx, job, refused ? 'refused' : 'failed');
  }
}

/**
 * Tells an open workspace the job has finished, whichever way it finished.
 *
 * To the person who asked, so their panel updates wherever they are looking,
 * and to the ticket, so a colleague with the same ticket open sees the
 * suggestion appear. Both carry the job id and nothing else: the client
 * refetches, so no model output travels over a channel whose subscribers were
 * authorised for a topic rather than for a document.
 */
async function announce(
  ctx: TenantContext,
  job: { id: string; subjectType: string; subjectId: string; requestedBy: string | null },
  status: 'completed' | 'failed' | 'refused',
): Promise<void> {
  const topics: string[] = [];
  if (job.requestedBy) topics.push(topicForUser(ctx.tenantId, job.requestedBy));
  // A job's subject is not always a ticket — an eval run names a prompt — so
  // the entity topic is only added when there is a ticket to name.
  if (job.subjectType === 'ticket') topics.push(topicForEntity(ctx.tenantId, 'ticket', job.subjectId));
  if (topics.length === 0) return;
  await publishNotice(ctx, topics, { entity: 'ai_job', id: job.id, action: status });
}

async function currentVersionOfExactly(promptKey: string, version: number) {
  const row = await platformDb().aiPromptVersion.findFirst({ where: { promptKey, version } });
  if (!row) throw new NotFoundError('prompt version', `${promptKey}@${version}`);
  return row;
}

// ---------------------------------------------------------------------------
// Reading, and saying what you did with it
// ---------------------------------------------------------------------------

export async function getJob(ctx: TenantContext, jobId: string) {
  authz.require(ctx, 'ai.read');
  return transaction(ctx, async (tx) => {
    const job = await tx.aiJob.findFirst({ where: { id: jobId }, include: { suggestion: true } });
    if (!job) throw new NotFoundError('ai job', jobId);
    return job;
  });
}

export async function listSuggestions(
  ctx: TenantContext,
  filter: { subjectId?: string; capability?: Capability; limit?: number } = {},
) {
  authz.require(ctx, 'ai.read');
  return transaction(ctx, (tx) =>
    tx.aiSuggestion.findMany({
      where: {
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
        ...(filter.capability ? { capability: filter.capability } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 20, 100),
    }),
  );
}

/**
 * What a person did with it.
 *
 * Recorded once and never changed: an outcome that could be revised is an
 * outcome that cannot be joined to what happened to the ticket afterwards,
 * which is the only thing that makes these figures worth collecting.
 */
export async function recordOutcome(ctx: TenantContext, id: string, input: z.input<typeof outcomeSchema>) {
  authz.require(ctx, 'ai.suggest');
  const parsed = outcomeSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const suggestion = await tx.aiSuggestion.findFirst({ where: { id } });
    if (!suggestion) throw new NotFoundError('ai suggestion', id);
    if (suggestion.outcome !== 'pending') {
      throw new ValidationError(`this suggestion was already ${suggestion.outcome}; an outcome is recorded once`);
    }

    const updated = await tx.aiSuggestion.update({
      where: { id },
      data: {
        outcome: parsed.outcome,
        outcomeBy: ctx.actor.id,
        outcomeAt: new Date(),
        outcomeNote: parsed.note ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'ai.suggestion.decided',
      targetType: 'ai_suggestion',
      targetId: id,
      before: { outcome: 'pending' },
      after: { outcome: parsed.outcome, capability: suggestion.capability },
    });
    metrics.increment('ai_suggestion_outcomes_total', { capability: suggestion.capability, outcome: parsed.outcome });
    return updated;
  });
}

/**
 * Removes rendered prompts and completions past the retention window.
 *
 * The job row, its cost and its outcome stay: those are the audit record and
 * the figures the budget is rebuilt from. What goes is the text, which is the
 * part that is classified confidential and the part a provider's terms and a
 * DPIA are actually about (doc 13 §5).
 */
export async function sweepPrompts(ctx: TenantContext, now = new Date()): Promise<{ cleared: number }> {
  const retainDays = await getSetting<number>(ctx, 'ai.retainDays').catch(() => 30);
  const cutoff = new Date(now.getTime() - retainDays * 86_400_000);

  return transaction(ctx, async (tx) => {
    const cleared = await tx.aiJob.updateMany({
      where: { createdAt: { lt: cutoff }, promptText: { not: null } },
      data: { promptText: null, completionText: null },
    });
    if (cleared.count > 0) logger.info('AI prompts and completions swept', { cleared: cleared.count, retainDays });
    return { cleared: cleared.count };
  });
}
