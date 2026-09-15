import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authz, isEnabled } from '@itsm/platform';
import {
  CAPABILITIES,
  CAPABILITY_CATALOGUE,
  activeProvider,
  budgetSchema,
  formatMicros,
  getJob,
  listSuggestions,
  outcomeSchema,
  readBudget,
  recordOutcome,
  requestSchema,
  requestSuggestion,
  setBudget,
} from '@itsm/module-ai';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-09's AI surface.
 *
 * Every suggestion is returned with its evidence and its confidence band
 * beside it, never on its own: an answer a person cannot check is an answer
 * they either believe or ignore, and both are worse than one they can read the
 * sources of. The outcome route is the other half of the same bargain —
 * nothing here is applied, so the record of what a person did with it is the
 * only way anybody learns whether it was any good.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });

  /** What this tenant can ask for right now, and why not, where not. */
  app.get('/ai/capabilities', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'ai.read');
    const provider = activeProvider();
    const tenantOn = await isEnabled(ctx, 'ai.enabled');

    const capabilities = [];
    for (const key of CAPABILITIES) {
      const definition = CAPABILITY_CATALOGUE[key];
      const switchedOn = tenantOn && (await isEnabled(ctx, definition.flagKey));
      capabilities.push({
        key,
        name: definition.name,
        description: definition.description,
        callsAModel: definition.promptKey !== null,
        available: switchedOn && (definition.promptKey === null || provider !== null),
        unavailableBecause: !tenantOn
          ? 'AI is switched off for this tenant'
          : !switchedOn
            ? 'this capability is switched off for this tenant'
            : definition.promptKey !== null && !provider
              ? 'no model provider is configured for this deployment'
              : null,
      });
    }
    return { provider: provider?.name ?? null, capabilities };
  });

  app.post('/ai/suggest', async (request, reply) => {
    const ctx = contextOf(request);
    const body = requestSchema.strict().parse(request.body);
    const result = await requestSuggestion(ctx, body);
    // 201 when the answer is already there — retrieval needs no worker — and
    // 202 when something has been queued. The difference is what the client
    // does next, so it belongs in the status rather than in a field.
    reply.code(result.status === 'completed' ? 201 : 202);
    return result;
  });

  app.get('/ai/jobs/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const job = await getJob(ctx, id);
    return {
      id: job.id,
      capability: job.capability,
      status: job.status,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      model: job.model,
      provider: job.provider,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      cost: formatMicros(job.costMicros),
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      suggestion: job.suggestion
        ? {
            id: job.suggestion.id,
            content: job.suggestion.content,
            reason: job.suggestion.reason,
            confidence: job.suggestion.confidence,
            evidence: job.suggestion.evidence,
            outcome: job.suggestion.outcome,
          }
        : null,
    };
  });

  app.get('/ai/suggestions', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({
        subjectId: z.string().uuid().optional(),
        capability: z.enum(CAPABILITIES).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(request.query);
    const rows = await listSuggestions(ctx, query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        capability: row.capability,
        subjectId: row.subjectId,
        content: row.content,
        reason: row.reason,
        confidence: row.confidence,
        evidence: row.evidence,
        outcome: row.outcome,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.post('/ai/suggestions/:id/outcome', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const body = outcomeSchema.strict().parse(request.body);
    const updated = await recordOutcome(ctx, id, body);
    return { id: updated.id, outcome: updated.outcome, outcomeAt: updated.outcomeAt?.toISOString() ?? null };
  });

  app.get('/ai/budget', async (request) => {
    const ctx = contextOf(request);
    const budget = await readBudget(ctx);
    return { ...budget, spentMicros: String(budget.spentMicros) };
  });

  app.put('/ai/budget', async (request) => {
    const ctx = contextOf(request);
    const body = budgetSchema.strict().parse(request.body);
    const updated = await setBudget(ctx, body);
    return {
      periodKey: updated.periodKey,
      limitPence: updated.limitPence,
      warnPence: updated.warnPence,
      spentDisplay: formatMicros(updated.spentMicros),
      state: updated.state,
    };
  });
}
