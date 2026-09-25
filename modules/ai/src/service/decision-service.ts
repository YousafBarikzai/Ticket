import { z } from 'zod';
import {
  NotFoundError,
  authz,
  getSetting,
  isEnabled,
  logger,
  maskRecord,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { formatMicros, periodFor } from '../domain/budget.js';
import {
  DECISION_PURPOSES,
  DEFAULT_THRESHOLDS,
  autoGate,
  decisionDefinitionFor,
  planDecision,
  problemWithThresholds,
  scoreAnswers,
  triageQuestions,
  type AutoGate,
  type DecisionMode,
  type DecisionPurpose,
  type Score,
  type ScoredAnswer,
  type Thresholds,
} from '../domain/decisions.js';
import type { DecisionValue } from '../providers/types.js';
import { budgetAllows, recordSpend } from './budget-service.js';
import { decide } from './gateway.js';
import { tenantAiRegions } from './residency-service.js';

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
    // One triage per ticket and question set. A job delivered twice, or an
    // event replayed, finds the first decision and stops before it spends.
    const earlier = await tx.aiDecision.findFirst({
      where: { purpose, subjectType: 'ticket', subjectId: ticketId, questionSetVersion: definition.questionSetVersion },
      select: { id: true, outcome: true, provider: true },
    });
    if (earlier) return { earlier } as const;
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, deletedAt: null } });
    if (!ticket) throw new NotFoundError('ticket', ticketId);
    const [categories, teams, budgetOk] = await Promise.all([
      tx.category.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, path: true }, orderBy: { path: 'asc' } }),
      tx.team.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      budgetAllows(ctx, tx, at),
    ]);
    return { earlier: null, ticket, categories, teams, budgetOk };
  });
  if (read.earlier) {
    return { decisionId: read.earlier.id, outcome: read.earlier.outcome, provider: read.earlier.provider };
  }

  const { ticket } = read;
  // The tenant's own residency policy, from its row: this runs in a worker,
  // whose context does not carry it.
  const allowedRegions = await tenantAiRegions(ctx);
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
    allowedRegions,
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

/**
 * What decided, how confidently, at what cost, newest first. Read-only.
 *
 * Two doors. About one ticket: anybody with `ai.read` who may see that ticket,
 * and a 404 for one they may not — a decision names the ticket and how it was
 * classified, so it must not be the thing that tells an agent in another team
 * the ticket exists. Across the tenant: `ai.manage`, because a list of every
 * decision is a list of every triaged ticket.
 */
export async function listDecisions(ctx: TenantContext, query: DecisionListQuery = {}): Promise<DecisionSummary[]> {
  const parsed = listSchema.parse(query);
  if (parsed.subjectId) {
    authz.require(ctx, 'ai.read');
    await ticketService.getTicket(ctx, parsed.subjectId);
  } else {
    authz.require(ctx, 'ai.manage');
  }
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

/**
 * Records what a resolved ticket ended up as, against every triage decision
 * made about it (ADR-0051).
 *
 * The values are the ticket's own fields at resolution, in the same terms the
 * decision's `proposed` column uses — ids for category and group — so scoring
 * compares like with like. `majorIncident` is whether one was declared from
 * this ticket and not stood down. Called inside the status-change event's
 * transaction; a ticket nobody triaged costs one indexed count and nothing
 * else.
 */
export async function settleDecisions(ctx: TenantContext, tx: Tx, ticketId: string, at = new Date()): Promise<number> {
  const decisions = await tx.aiDecision.findMany({
    where: { purpose: 'triage', subjectType: 'ticket', subjectId: ticketId },
    select: { id: true },
  });
  if (decisions.length === 0) return 0;

  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId },
    select: { type: true, categoryId: true, groupId: true, priority: true },
  });
  if (!ticket) return 0;
  const declared = await tx.majorIncident.count({ where: { ticketId, status: { not: 'stood_down' } } });

  const settled = {
    type: ticket.type,
    category: ticket.categoryId,
    group: ticket.groupId,
    priority: ticket.priority,
    majorIncident: declared > 0,
  };
  await tx.aiDecision.updateMany({
    where: { id: { in: decisions.map((decision) => decision.id) } },
    data: { settled: settled as never, settledAt: at },
  });
  logger.debug('triage decisions settled', { tenantId: ctx.tenantId, ticketId, decisions: decisions.length });
  return decisions.length;
}

/** The questions whose answers could ever be applied, and so gate `auto`. */
const GATED_QUESTIONS: readonly string[] = ['type', 'category', 'group'];

export interface QuestionScore extends Score {
  question: string;
  /** Present for the questions `auto` could apply. */
  autoGate: AutoGate | null;
}

export interface DecisionScore {
  purpose: DecisionPurpose;
  mode: DecisionMode;
  thresholds: Thresholds;
  since: Date;
  decisions: number;
  settled: number;
  /** Decisions nobody answered, which left the ticket as intake did. */
  fellToRules: number;
  byProvider: Record<string, number>;
  /** How often each link was passed over, and why. */
  skips: Record<string, number>;
  costMicros: string;
  costDisplay: string;
  meanLatencyMs: number | null;
  questions: QuestionScore[];
  /** True only when every gated question has earned it. */
  autoEligible: boolean;
}

const scoreSchema = z
  .object({
    purpose: z.enum(DECISION_PURPOSES).default('triage'),
    days: z.coerce.number().int().min(1).max(365).default(90),
  })
  .strict();

export type ScoreQuery = z.input<typeof scoreSchema>;

/** The most decisions one score reads. Beyond this the newest are scored. */
const SCORE_LIMIT = 5_000;

/**
 * How well a purpose's decisions matched what people settled on.
 *
 * Read-only and computed on request from the rows, like the budget: there is
 * no stored score to drift from the decisions beneath it. The `auto` gate is
 * the same function the mode change will call, so what this page says has
 * been earned is exactly what switching `auto` on will check.
 */
export async function scoreDecisions(ctx: TenantContext, query: ScoreQuery = {}, now = new Date()): Promise<DecisionScore> {
  authz.require(ctx, 'ai.read');
  const parsed = scoreSchema.parse(query);
  const since = new Date(now.getTime() - parsed.days * 86_400_000);
  const [mode, thresholds] = await Promise.all([modeFor(ctx, parsed.purpose), thresholdsFor(ctx)]);

  const rows = await transaction(ctx, (tx) =>
    tx.aiDecision.findMany({
      where: { purpose: parsed.purpose, createdAt: { gte: since } },
      select: {
        provider: true,
        answers: true,
        proposed: true,
        attempts: true,
        settled: true,
        latencyMs: true,
        costMicros: true,
      },
      orderBy: { createdAt: 'desc' },
      take: SCORE_LIMIT,
    }),
  );

  const byProvider: Record<string, number> = {};
  const skips: Record<string, number> = {};
  let cost = 0n;
  let latencyTotal = 0;
  let answered = 0;
  for (const row of rows) {
    byProvider[row.provider] = (byProvider[row.provider] ?? 0) + 1;
    cost += row.costMicros;
    if (row.provider !== 'rules') {
      latencyTotal += row.latencyMs;
      answered += 1;
    }
    for (const attempt of (row.attempts as { provider: string; outcome: string; reason: string | null }[]) ?? []) {
      if (attempt.outcome === 'answered' || !attempt.reason) continue;
      const key = `${attempt.provider}:${attempt.reason}`;
      skips[key] = (skips[key] ?? 0) + 1;
    }
  }

  const settledRows = rows.filter((row) => row.settled !== null);
  const questionKeys = new Set<string>();
  for (const row of settledRows) for (const key of Object.keys((row.answers as object) ?? {})) questionKeys.add(key);

  const questions: QuestionScore[] = [...questionKeys].sort().map((question) => {
    const scored: ScoredAnswer[] = settledRows.map((row) => {
      const answer = (row.answers as Record<string, { value: unknown; confidence: number }>)[question];
      const proposed = (row.proposed as Record<string, DecisionValue | null>)[question] ?? null;
      const actual = (row.settled as Record<string, DecisionValue | null>)[question] ?? null;
      return {
        predicted: answer && answer.value !== null ? proposed : null,
        confidence: answer?.confidence ?? 0,
        actual,
      };
    });
    return {
      question,
      ...scoreAnswers(scored),
      autoGate: GATED_QUESTIONS.includes(question) ? autoGate(scored, thresholds) : null,
    };
  });

  const gated = questions.filter((question) => question.autoGate !== null);
  return {
    purpose: parsed.purpose,
    mode,
    thresholds,
    since,
    decisions: rows.length,
    settled: settledRows.length,
    fellToRules: byProvider.rules ?? 0,
    byProvider,
    skips,
    costMicros: String(cost),
    costDisplay: formatMicros(cost),
    meanLatencyMs: answered > 0 ? Math.round(latencyTotal / answered) : null,
    questions,
    autoEligible: gated.length > 0 && gated.every((question) => question.autoGate!.eligible),
  };
}
