import { z } from 'zod';
import {
  NotFoundError,
  aiRegions,
  authz,
  getSetting,
  isEnabled,
  logger,
  maskRecord,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
} from '@itsm/platform';
import { formatMicros, periodFor } from '../domain/budget.js';
import {
  DECISION_PURPOSES,
  DEFAULT_THRESHOLDS,
  decisionDefinitionFor,
  planDecision,
  problemWithThresholds,
  triageQuestions,
  type DecisionMode,
  type DecisionPurpose,
  type Thresholds,
} from '../domain/decisions.js';
import { budgetAllows, recordSpend } from './budget-service.js';
import { decide } from './gateway.js';

/**
 * Structured decisions, recorded (ADR-0051).
 *
 * This release decides and records and does nothing else. `shadow` is the
 * only mode a tenant can select, so no answer here changes a ticket, is shown
 * to anybody, or is sent anywhere a person did not first switch on. What it
 * produces is the evidence the later modes are gated on: who answered, what
 * they said, how sure they said they were, what it cost, how long it took,
 * and every provider the chain passed over and why.
 *
 * A decision never fails the thing it is about. Every path that cannot decide
 * — switched off, budget spent, no provider inside the tenant's regions, a
 * provider that timed out — ends with the ticket exactly as intake left it.
 */

/** What a person may read about a decision. Never the ticket text that was sent. */
export interface DecisionSummary {
  id: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  mode: string;
  outcome: string;
  provider: string;
  model: string | null;
  providerRequestId: string | null;
  questionSetVersion: number;
  answers: unknown;
  proposed: unknown;
  plan: unknown;
  attempts: unknown;
  problems: unknown;
  omitted: unknown;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: string;
  costDisplay: string;
  createdAt: Date;
}

type DecisionRow = {
  id: string;
  purpose: string;
  subjectType: string;
  subjectId: string;
  mode: string;
  outcome: string;
  provider: string;
  model: string | null;
  providerRequestId: string | null;
  questionSetVersion: number;
  answers: unknown;
  proposed: unknown;
  plan: unknown;
  attempts: unknown;
  problems: unknown;
  omitted: unknown;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: bigint;
  createdAt: Date;
};

function summarise(row: DecisionRow): DecisionSummary {
  return {
    id: row.id,
    purpose: row.purpose,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    mode: row.mode,
    outcome: row.outcome,
    provider: row.provider,
    model: row.model,
    providerRequestId: row.providerRequestId,
    questionSetVersion: row.questionSetVersion,
    answers: row.answers,
    proposed: row.proposed,
    plan: row.plan,
    attempts: row.attempts,
    problems: row.problems,
    omitted: row.omitted,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costMicros: String(row.costMicros),
    costDisplay: formatMicros(row.costMicros),
    createdAt: row.createdAt,
  };
}

/**
 * The tenant's mode for a purpose, or `off`.
 *
 * Off when the tenant-wide switch is off, when the purpose's own switch is
 * off, or when the setting says so: three ways to say no, and any one of them
 * is enough.
 */
export async function modeFor(ctx: TenantContext, purpose: DecisionPurpose): Promise<DecisionMode> {
  const definition = decisionDefinitionFor(purpose);
  if (!(await isEnabled(ctx, 'ai.enabled'))) return 'off';
  if (!(await isEnabled(ctx, definition.flagKey))) return 'off';
  return getSetting<DecisionMode>(ctx, definition.modeSetting);
}

/**
 * The tenant's thresholds, or the defaults when what is stored does not hold
 * together. Each setting is valid on its own; the pair is checked here, and a
 * pair that is wrong is logged and ignored rather than obeyed.
 */
export async function thresholdsFor(ctx: TenantContext): Promise<Thresholds> {
  const thresholds: Thresholds = {
    auto: await getSetting<number>(ctx, 'ai.decision.autoThreshold'),
    suggest: await getSetting<number>(ctx, 'ai.decision.suggestThreshold'),
  };
  const problem = problemWithThresholds(thresholds);
  if (!problem) return thresholds;
  logger.warn('decision thresholds do not hold together; using the defaults', { tenantId: ctx.tenantId, problem });
  return DEFAULT_THRESHOLDS;
}

/** The longest description sent. Past this it is the requester's signature and their email history. */
const MAX_DESCRIPTION = 4000;

export interface TriageRun {
  decisionId: string;
  outcome: string;
  provider: string;
}

/**
 * Decides a ticket's triage and records the decision.
 *
 * Returns null when the purpose is off, which is the common case and costs
 * nothing: no ticket is read and nothing is written. Otherwise exactly one
 * `ai_decision` row and one audit entry, whether or not anybody answered.
 */
export async function runTriage(ctx: TenantContext, ticketId: string, at = new Date()): Promise<TriageRun | null> {
  const purpose: DecisionPurpose = 'triage';
  const definition = decisionDefinitionFor(purpose);
  const selected = await modeFor(ctx, purpose);
  if (selected === 'off') return null;
  // Only shadow is honoured in this release. The settings schema already
  // refuses anything else; this is the second lock, so that a value written
  // around the schema still cannot make this code act on a ticket.
  const mode: DecisionMode = 'shadow';
  if (selected !== mode) logger.warn('a decision mode this release does not honour was treated as shadow', { selected });
  const thresholds = await thresholdsFor(ctx);
  const periodKey = periodFor(at);

  // Read, then let go of the transaction: a provider call is seconds long, and
  // a transaction held across it is a connection held across it.
  const read = await transaction(ctx, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!ticket) throw new NotFoundError('ticket', ticketId);
    const [categories, teams, budgetOk] = await Promise.all([
      tx.category.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, path: true }, orderBy: { path: 'asc' } }),
      tx.team.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      budgetAllows(ctx, tx, at),
    ]);
    return { ticket, categories, teams, budgetOk };
  });

  const { ticket } = read;
  // Masked under the classification registry for this actor, the same as a
  // suggestion's context: a decision provider is sent what the tenant's
  // policy lets leave, and nothing else from the row.
  const state = maskRecord(ctx, 'ticket', {
    title: ticket.title,
    description: (ticket.description ?? '').slice(0, MAX_DESCRIPTION),
    sourceChannel: ticket.sourceChannel,
  });
  const set = triageQuestions({ categories: read.categories, groups: read.teams });

  const result = await decide({
    purpose,
    state,
    questions: set.questions,
    allowedRegions: aiRegions(ctx),
    budgetAvailable: read.budgetOk,
  });

  const answers = result.decision?.answers ?? {};
  const proposed: Record<string, string | number | boolean | null> = {};
  for (const [question, answer] of Object.entries(answers)) {
    const map = set.decode[question];
    proposed[question] =
      answer.value === null ? null : map && typeof answer.value === 'string' ? (map.get(answer.value) ?? null) : answer.value;
  }

  // Every field that already has a value counts as a person's (or a rule's)
  // until the ticket's own history can say otherwise. Conservative on
  // purpose: in shadow mode it changes nothing, and before `auto` exists it
  // is replaced by the field history rather than loosened.
  const current: Record<string, unknown> = {
    type: ticket.type,
    categoryId: ticket.categoryId,
    groupId: ticket.groupId,
    priority: ticket.priority,
  };
  const humanSet = new Set(Object.entries(current).filter(([, value]) => value !== null).map(([field]) => field));
  const plan = planDecision({
    mode,
    thresholds,
    bindings: definition.bindings,
    answers,
    values: proposed,
    current,
    humanSet,
  });

  const outcome = result.decision ? 'shadowed' : 'none';
  const decisionId = newId();
  await transaction(ctx, async (tx) => {
    await tx.aiDecision.create({
      data: {
        id: decisionId,
        tenantId: ctx.tenantId,
        purpose,
        subjectType: 'ticket',
        subjectId: ticket.id,
        mode,
        questionSetVersion: definition.questionSetVersion,
        provider: result.provider,
        model: result.model,
        providerRequestId: result.decision?.providerRequestId ?? null,
        answers: answers as never,
        proposed: proposed as never,
        plan: plan as never,
        attempts: result.attempts as never,
        problems: result.problems as never,
        omitted: set.omitted as never,
        outcome,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicros: result.costMicros,
        periodKey,
      },
    });
    if (result.costMicros > 0n) await recordSpend(ctx, tx, periodKey);
    // Which AI decided, on the tenant's hash-chained audit log. The answers
    // are on the decision row; the audit entry names who, how, and at what
    // cost, which is what an auditor asks first.
    await recordAudit(tx, ctx, {
      action: 'ai.decision.recorded',
      targetType: 'ticket',
      targetId: ticket.id,
      after: {
        decisionId,
        purpose,
        mode,
        outcome,
        provider: result.provider,
        model: result.model,
        fellBackFrom: result.attempts.filter((attempt) => attempt.outcome !== 'answered').map((attempt) => `${attempt.provider}:${attempt.reason}`),
        costMicros: String(result.costMicros),
        latencyMs: result.latencyMs,
      },
    });
  });

  return { decisionId, outcome, provider: result.provider };
}

const listSchema = z
  .object({
    purpose: z.enum(DECISION_PURPOSES).optional(),
    subjectId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type DecisionListQuery = z.input<typeof listSchema>;

/** What decided, how confidently, at what cost, newest first. Read-only. */
export async function listDecisions(ctx: TenantContext, query: DecisionListQuery = {}): Promise<DecisionSummary[]> {
  authz.require(ctx, 'ai.read');
  const parsed = listSchema.parse(query);
  const rows = await transaction(ctx, (tx) =>
    tx.aiDecision.findMany({
      where: {
        ...(parsed.purpose ? { purpose: parsed.purpose } : {}),
        ...(parsed.subjectId ? { subjectType: 'ticket', subjectId: parsed.subjectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.limit,
    }),
  );
  return rows.map((row) => summarise(row as DecisionRow));
}
