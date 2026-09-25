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
import {
  pendingSuggestions,
  standingApplied,
  type AppliedEntry,
  type PendingSuggestion,
  type StandingApplied,
} from '../domain/decisions.js';
import { reviewAutoMode } from './auto-service.js';
import { modeFor } from './decision-service.js';

/**
 * Triage, in front of an agent (ADR-0051, `suggest` and `auto` modes).
 *
 * The decision was made in the background when the ticket arrived. This is
 * where a person sees it and does something about it. A suggestion is
 * changed by the person, not the AI: Accept goes through the same ticket
 * update an agent would make by hand, under their name and their permissions,
 * with the version they loaded. A value the AI set by itself, in `auto`, is
 * shown as set by AI with an Undo that puts back what was there before — the
 * same kind of edit, by the same person, recorded as a correction.
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
  /** Values the AI set by itself that are still on the ticket, each undoable. */
  applied: StandingApplied[];
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
  applied: unknown;
}

/** The decisions a person may act on: something was offered, or something was set. */
const SHOWN_OUTCOMES = ['suggested', 'applied'];

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
    applied: new Set(Object.keys((decision.applied as object) ?? {})),
  });
}

function appliedFor(decision: DecisionForSuggestion, ticket: Parameters<typeof currentFields>[0]): StandingApplied[] {
  return standingApplied({
    applied: (decision.applied as Record<string, AppliedEntry>) ?? {},
    answers: (decision.answers as Record<string, { value: unknown; confidence: number }>) ?? {},
    current: currentFields(ticket),
    responded: new Set(Object.keys((decision.responses as object) ?? {})),
  });
}

const DECISION_FIELDS = {
  id: true,
  provider: true,
  model: true,
  createdAt: true,
  plan: true,
  answers: true,
  proposed: true,
  baseline: true,
  responses: true,
  applied: true,
} as const;

/**
 * The triage suggestions still waiting on a ticket, and the values the AI set
 * that can still be undone, or null when there is nothing to show.
 *
 * `ai.read` and sight of the ticket, the same pair as the suggestions the
 * reply panel shows: an agent who cannot see the ticket gets its 404. Shown
 * in `suggest` and `auto`. A desk that stepped down from `auto` to `suggest`
 * keeps its Undo on the tickets the AI already changed.
 */
export async function triageSuggestionFor(ctx: TenantContext, ticketId: string): Promise<TriageSuggestionView | null> {
  authz.require(ctx, 'ai.read');
  const ticket = await ticketService.getTicket(ctx, ticketId);
  const mode = await modeFor(ctx, 'triage');
  if (mode !== 'suggest' && mode !== 'auto') return null;

  const decision = await transaction(ctx, (tx) =>
    tx.aiDecision.findFirst({
      where: { purpose: 'triage', subjectType: 'ticket', subjectId: ticket.id, outcome: { in: SHOWN_OUTCOMES } },
      orderBy: { createdAt: 'desc' },
      select: DECISION_FIELDS,
    }),
  );
  if (!decision) return null;

  const suggestions = pendingFor(decision, ticket);
  const applied = appliedFor(decision, ticket);
  if (suggestions.length === 0 && applied.length === 0) return null;
  return {
    decisionId: decision.id,
    provider: decision.provider,
    model: decision.model,
    createdAt: decision.createdAt,
    suggestions,
    applied,
  };
}

/** The decision behind a suggestion or an undo, or a 404. */
async function findDecision(ctx: TenantContext, decisionId: string) {
  const decision = await transaction(ctx, (tx) =>
    tx.aiDecision.findFirst({
      where: { id: decisionId, purpose: 'triage', outcome: { in: SHOWN_OUTCOMES } },
      select: { ...DECISION_FIELDS, subjectId: true },
    }),
  );
  if (!decision) throw new NotFoundError('triage suggestion', decisionId);
  return decision;
}

/** Merges one person's answer into a decision's responses and audits it, in one transaction. */
async function recordResponse(
  ctx: TenantContext,
  decision: { id: string; provider: string; model: string | null },
  ticketId: string,
  question: string,
  action: 'accepted' | 'dismissed' | 'undone',
  detail: Record<string, unknown>,
  at: Date,
): Promise<void> {
  await transaction(ctx, async (tx) => {
    // One statement that merges this answer into the others, rather than a
    // read and a write: two agents answering two suggestions on the same
    // ticket at once would otherwise each write back a copy without the
    // other's answer in it.
    const entry = JSON.stringify({ [question]: { action, by: ctx.actor.id, at: at.toISOString() } });
    await tx.$executeRaw`
      UPDATE ai_decision SET responses = responses || ${entry}::jsonb WHERE id = ${decision.id}::uuid
    `;
    // The ticket's own history already records the change under the agent's
    // name. This entry says where the value came from, or went back to.
    await recordAudit(tx, ctx, {
      action: action === 'undone' ? 'ai.decision.undone' : `ai.suggestion.${action}`,
      targetType: 'ticket',
      targetId: ticketId,
      after: { decisionId: decision.id, question, provider: decision.provider, model: decision.model, ...detail },
    });
  });
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
  const decision = await findDecision(ctx, decisionId);

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

  await recordResponse(
    ctx,
    decision,
    ticket.id,
    question,
    response,
    { value: suggestion.value, display: suggestion.display, confidence: suggestion.confidence },
    new Date(),
  );

  metrics.increment('ai_triage_suggestions_total', { question, response });
  logger.info('a triage suggestion was answered', { decisionId: decision.id, question, response });
  return { decisionId: decision.id, question, response };
}

/**
 * Undoes a value the AI set by itself: puts back what the field held before,
 * as the agent's own edit, and records it as a correction.
 *
 * Same permissions and the same version rule as Accept. Only a value that is
 * still on the ticket can be undone; once somebody has changed it, it is
 * theirs, and there is nothing of the AI's left to take back. A correction
 * counts towards the step-down, so this asks straight away whether `auto`
 * should withdraw itself.
 */
export async function undoApplied(
  ctx: TenantContext,
  decisionId: string,
  question: string,
  input: RespondInput = {},
): Promise<{ decisionId: string; question: string; restored: string | number | boolean | null }> {
  authz.require(ctx, 'ai.suggest');
  const parsed = respondSchema.parse(input);
  const decision = await findDecision(ctx, decisionId);
  const ticket = await ticketService.getTicket(ctx, decision.subjectId);
  const standing = appliedFor(decision, ticket).find((entry) => entry.question === question);
  if (!standing) {
    throw new ValidationError(`the AI's ${question} is no longer on this ticket, so there is nothing to undo`);
  }
  if (parsed.version === undefined) {
    throw new ValidationError('undoing needs the ticket version you were looking at');
  }
  const entry = (decision.applied as unknown as Record<string, AppliedEntry>)[question]!;
  if (entry.field === 'groupId') {
    await ticketService.assignTicket(
      ctx,
      ticket.id,
      { groupId: entry.from === null ? null : String(entry.from), method: 'manual' },
      parsed.version,
    );
  } else if (entry.field === 'categoryId') {
    await ticketService.updateTicket(
      ctx,
      ticket.id,
      { categoryId: entry.from === null ? null : String(entry.from) },
      parsed.version,
    );
  } else {
    throw new ValidationError(`${question} cannot be undone from here`);
  }

  await recordResponse(
    ctx,
    decision,
    ticket.id,
    question,
    'undone',
    { [entry.field]: entry.to, restored: entry.from, confidence: entry.confidence },
    new Date(),
  );
  metrics.increment('ai_decision_overrides_total', { purpose: 'triage', question });
  logger.info('an applied triage value was undone', { decisionId: decision.id, question });

  try {
    await reviewAutoMode(ctx, 'triage');
  } catch (error) {
    // The undo stands either way; the next correction asks again.
    logger.warn('the auto step-down could not be checked after an undo', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { decisionId: decision.id, question, restored: entry.from };
}
