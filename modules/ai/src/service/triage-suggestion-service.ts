import { z } from 'zod';
import {
  NotFoundError,
  ValidationError,
  authz,
  logger,
  metrics,
  recordAudit,
  transaction,
  type TenantContext,
} from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { pendingSuggestions, type PendingSuggestion } from '../domain/decisions.js';
import { modeFor } from './decision-service.js';

/**
 * Triage suggestions, in front of an agent (ADR-0051, `suggest` mode).
 *
 * The decision was made in the background when the ticket arrived. This is
 * where a person sees it and does something about it — and it is the person
 * who changes the ticket, not the AI: Accept goes through the same ticket
 * update an agent would make by hand, under their name and their permissions,
 * with the version they loaded. The decision only records that it happened.
 *
 * Nothing here is shown in `shadow` or `off`. Shadow answers are evidence for
 * the desk's administrators; showing them to agents would turn an experiment
 * nobody opted into into advice.
 */

export interface TriageSuggestionView {
  decisionId: string;
  provider: string;
  model: string | null;
  createdAt: Date;
  suggestions: PendingSuggestion[];
}

interface DecisionForSuggestion {
  id: string;
  provider: string;
  model: string | null;
  createdAt: Date;
  plan: unknown;
  answers: unknown;
  proposed: unknown;
  baseline: unknown;
  responses: unknown;
}

function currentFields(ticket: { type: string; categoryId: string | null; groupId: string | null; priority: string }) {
  return { type: ticket.type, categoryId: ticket.categoryId, groupId: ticket.groupId, priority: ticket.priority };
}

function pendingFor(decision: DecisionForSuggestion, ticket: Parameters<typeof currentFields>[0]): PendingSuggestion[] {
  return pendingSuggestions({
    plan: (decision.plan as { question: string; field: string | null; action: 'record' | 'suggest' | 'apply' }[]) ?? [],
    answers: (decision.answers as Record<string, { value: unknown; confidence: number }>) ?? {},
    proposed: (decision.proposed as Record<string, string | number | boolean | null>) ?? {},
    baseline: (decision.baseline as Record<string, unknown>) ?? {},
    current: currentFields(ticket),
    responded: new Set(Object.keys((decision.responses as object) ?? {})),
  });
}

/**
 * The triage suggestions still waiting on a ticket, or null when there are
 * none to show.
 *
 * `ai.read` and sight of the ticket, the same pair as the suggestions the
 * reply panel shows: an agent who cannot see the ticket gets its 404.
 */
export async function triageSuggestionFor(ctx: TenantContext, ticketId: string): Promise<TriageSuggestionView | null> {
  authz.require(ctx, 'ai.read');
  const ticket = await ticketService.getTicket(ctx, ticketId);
  if ((await modeFor(ctx, 'triage')) !== 'suggest') return null;

  const decision = await transaction(ctx, (tx) =>
    tx.aiDecision.findFirst({
      where: { purpose: 'triage', subjectType: 'ticket', subjectId: ticket.id, outcome: 'suggested' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        model: true,
        createdAt: true,
        plan: true,
        answers: true,
        proposed: true,
        baseline: true,
        responses: true,
      },
    }),
  );
  if (!decision) return null;

  const suggestions = pendingFor(decision, ticket);
  if (suggestions.length === 0) return null;
  return {
    decisionId: decision.id,
    provider: decision.provider,
    model: decision.model,
    createdAt: decision.createdAt,
    suggestions,
  };
}

export const respondSchema = z
  .object({
    /** The ticket version the agent was looking at. Required to accept. */
    version: z.number().int().positive().optional(),
  })
  .strict();

export type RespondInput = z.input<typeof respondSchema>;

export type SuggestionResponse = 'accepted' | 'dismissed';

/**
 * Accepts or dismisses one suggestion.
 *
 * Accept is the agent's own edit: priority and category through the ticket
 * update, the group through assignment — each with the agent's permissions
 * and the version they loaded, so a ticket that changed under them is a 409
 * rather than a silent overwrite. A type suggestion has nothing to apply (a
 * ticket's type is fixed when it is raised) and a major-incident one is
 * declared from its own screen, so both can only be dismissed.
 */
export async function respondToSuggestion(
  ctx: TenantContext,
  decisionId: string,
  question: string,
  response: SuggestionResponse,
  input: RespondInput = {},
): Promise<{ decisionId: string; question: string; response: SuggestionResponse }> {
  authz.require(ctx, 'ai.suggest');
  const parsed = respondSchema.parse(input);

  const decision = await transaction(ctx, (tx) =>
    tx.aiDecision.findFirst({
      where: { id: decisionId, purpose: 'triage', outcome: 'suggested' },
      select: {
        id: true,
        subjectId: true,
        provider: true,
        model: true,
        createdAt: true,
        plan: true,
        answers: true,
        proposed: true,
        baseline: true,
        responses: true,
      },
    }),
  );
  if (!decision) throw new NotFoundError('triage suggestion', decisionId);

  // Sight of the ticket first, so a decision about a ticket this agent cannot
  // see is a 404 like the ticket itself.
  const ticket = await ticketService.getTicket(ctx, decision.subjectId);
  const suggestion = pendingFor(decision, ticket).find((pending) => pending.question === question);
  if (!suggestion) {
    throw new ValidationError(`there is no open ${question} suggestion on this ticket; it may already have been dealt with`);
  }

  if (response === 'accepted') {
    if (suggestion.kind !== 'apply') {
      throw new ValidationError(
        suggestion.kind === 'warning'
          ? 'a major incident is declared from the major incident screen, never from a suggestion'
          : 'a ticket’s type is fixed when it is raised, so there is nothing to apply; dismiss it instead',
      );
    }
    if (parsed.version === undefined) {
      throw new ValidationError('accepting a suggestion needs the ticket version you were looking at');
    }
    if (suggestion.field === 'groupId') {
      await ticketService.assignTicket(ctx, ticket.id, { groupId: String(suggestion.value), method: 'manual' }, parsed.version);
    } else if (suggestion.field === 'categoryId') {
      await ticketService.updateTicket(ctx, ticket.id, { categoryId: String(suggestion.value) }, parsed.version);
    } else if (suggestion.field === 'priority') {
      await ticketService.updateTicket(
        ctx,
        ticket.id,
        { priority: String(suggestion.value) as 'P1' | 'P2' | 'P3' | 'P4' },
        parsed.version,
      );
    } else {
      throw new ValidationError(`${question} cannot be applied from a suggestion`);
    }
  }

  const at = new Date();
  await transaction(ctx, async (tx) => {
    // One statement that merges this answer into the others, rather than a
    // read and a write: two agents answering two suggestions on the same
    // ticket at once would otherwise each write back a copy without the
    // other's answer in it.
    const entry = JSON.stringify({ [question]: { action: response, by: ctx.actor.id, at: at.toISOString() } });
    await tx.$executeRaw`
      UPDATE ai_decision SET responses = responses || ${entry}::jsonb WHERE id = ${decision.id}::uuid
    `;
    // The ticket's own history already records an accepted change under the
    // agent's name. This entry says where the value came from.
    await recordAudit(tx, ctx, {
      action: response === 'accepted' ? 'ai.suggestion.accepted' : 'ai.suggestion.dismissed',
      targetType: 'ticket',
      targetId: ticket.id,
      after: {
        decisionId: decision.id,
        question,
        value: suggestion.value,
        display: suggestion.display,
        confidence: suggestion.confidence,
        provider: decision.provider,
        model: decision.model,
      },
    });
  });

  metrics.increment('ai_triage_suggestions_total', { question, response });
  logger.info('a triage suggestion was answered', { decisionId: decision.id, question, response });
  return { decisionId: decision.id, question, response };
}
