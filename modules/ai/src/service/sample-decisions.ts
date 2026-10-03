import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
} from '@itsm/platform';
import { periodFor } from '../domain/budget.js';
import { checkDecision, decisionDefinitionFor, planDecision, triageQuestions, type DecisionPurpose } from '../domain/decisions.js';
import type { ChainAttempt } from './gateway.js';
import { settleDecisions, thresholdsFor } from './decision-service.js';

/**
 * Sample triage decisions for the shared demo (D13; A4 §1.14, §2.3; WP-43b).
 *
 * The demo shows what AI triage looks like on a desk without calling any
 * model: sixty decisions on the last fortnight's tickets, written here as the
 * rows `runTriage` would have written in `suggest` mode, with what agents did
 * about each suggestion and, once a ticket was resolved, what it settled as.
 * The Service Desk's suggestion card and the AI-triage pages read them like
 * any other decision, and say "Sample" because the provider is `sample`.
 *
 * Two refusals make the door narrow, and both come before anything is
 * written: every row must name the `sample` provider, so a sample can never be
 * passed off as a model's answer; and the tenant must be the shared demo
 * (`kind = 'demo'`, read from its own row), so no customer's AI record — the
 * evidence its `auto` gate and step-down are read from — can be padded.
 *
 * The answers go through the live checks: the triage questions built from the
 * tenant's own categories and teams, `checkDecision`, the label-to-id decode,
 * `planDecision` at the tenant's thresholds, and `settleDecisions` for a
 * resolved ticket. Nothing is spent, nothing is published, nothing is queued.
 */

/** The provider every sample names. Never a provider anybody can register. */
export const SAMPLE_PROVIDER = 'sample';

/**
 * The model every sample names. A4 §1.14 asked for none, but the table holds
 * that a decision somebody answered names what answered it — only `rules`
 * names no model (`ai_decision_rules_means_no_model`) — and a sample was
 * answered, by the sample set.
 */
export const SAMPLE_MODEL = 'sample';

/** The most decisions one call takes, so its one audit row can name each ticket. */
export const SAMPLE_DECISIONS_MAX = 50;

const PURPOSE: DecisionPurpose = 'triage';

const answerSchema = z.object({
  /** The label a provider would pick (a category's path, a team's name), or a value; null for no answer. */
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  confidence: z.number(),
});

export const sampleDecisionSchema = z
  .object({
    /** Must be `sample`. Checked by the door, so the refusal names the row. */
    provider: z.string(),
    ticketId: z.string().uuid(),
    /** When the ticket was triaged. */
    createdAt: z.coerce.date(),
    /** Per question, what the sample answered and how sure it was. */
    answers: z.record(answerSchema),
    /**
     * The ticket's triage fields when it was triaged. Omitted, as they are now.
     * A suggestion an agent accepted changed the ticket, so its baseline is
     * what the ticket held before.
     */
    baseline: z
      .object({
        type: z.string(),
        categoryId: z.string().uuid().nullable(),
        groupId: z.string().uuid().nullable(),
        priority: z.string(),
      })
      .strict()
      .optional(),
    /** What agents did with the suggestions, by question, as the suggestion card records it. */
    responses: z
      .record(z.object({ action: z.enum(['accepted', 'dismissed']), by: z.string().uuid(), at: z.coerce.date() }).strict())
      .default({}),
  })
  .strict();
export type SampleDecisionInput = z.input<typeof sampleDecisionSchema>;

export interface SampleDecisionsOptions {
  /** What the audit row calls the call, e.g. "demo g42 AI samples". */
  label?: string;
  /** The audit row's reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

const optionsSchema = z
  .object({ label: z.string().min(1).max(200).optional(), reason: z.string().min(1).max(500).optional() })
  .strict();

type FieldProblem = { field: string; code: string; message: string };

function instantProblem(at: Date, field: string): FieldProblem | null {
  if (Number.isNaN(at.getTime())) return { field, code: 'invalid', message: 'not a date' };
  if (at.getTime() > Date.now()) return { field, code: 'in_future', message: 'must not be later than now' };
  return null;
}

/** What can be refused before anything is read: a row that is not a sample, and instants that are wrong. */
function rowProblems(row: z.infer<typeof sampleDecisionSchema>, prefix: string): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (row.provider !== SAMPLE_PROVIDER) {
    problems.push({ field: `${prefix}provider`, code: 'not_sample', message: `only ${SAMPLE_PROVIDER} decisions are imported; this one names ${row.provider}` });
  }
  const created = instantProblem(row.createdAt, `${prefix}createdAt`);
  if (created) problems.push(created);
  for (const [question, response] of Object.entries(row.responses)) {
    const field = `${prefix}responses.${question}.at`;
    const problem = instantProblem(response.at, field);
    if (problem) problems.push(problem);
    else if (!created && response.at < row.createdAt) problems.push({ field, code: 'before_decided', message: 'nobody answers a suggestion before it is made' });
  }
  return problems;
}

export interface ImportedSampleDecision {
  decisionId: string;
  ticketNumber: string;
  outcome: 'suggested' | 'shadowed';
  settled: boolean;
}

/**
 * Writes sample triage decisions into the shared demo (A4 §2.3).
 *
 * Each row becomes one `ai_decision` exactly as `runTriage` records one in
 * `suggest` mode: provider and model `sample`, nothing spent, every question
 * of the set answered or recorded as unanswered, the plan the tenant's
 * thresholds give, `suggested` when the plan offers anything (otherwise
 * `shadowed`, as live). Responses are kept as the card keeps them; a resolved
 * ticket's decision is settled at its resolution. Returns one entry per row,
 * in the order given.
 *
 * Refused, with nothing written: a row that is not a sample; a tenant that is
 * not the shared demo; an instant in the future, before the ticket was
 * raised, or after it was resolved; an answer the question does not allow, or
 * to a question not asked; a response to a suggestion the plan did not make,
 * or by somebody not in the directory; a ticket already triaged, here or
 * earlier. Needs `ai.manage`.
 */
export async function importSampleDecisions(
  ctx: TenantContext,
  rows: SampleDecisionInput[],
  options: SampleDecisionsOptions = {},
): Promise<ImportedSampleDecision[]> {
  const parsed = z.array(sampleDecisionSchema).max(SAMPLE_DECISIONS_MAX).parse(rows);
  const settings = optionsSchema.parse(options);
  authz.require(ctx, 'ai.manage');
  const problems = parsed.flatMap((row, index) => rowProblems(row, `${index}.`));
  if (problems.length > 0) throw new ValidationError('these are not sample decisions that could have happened', problems);
  if (parsed.length === 0) return [];

  const definition = decisionDefinitionFor(PURPOSE);
  const thresholds = await thresholdsFor(ctx);

  return transaction(
    ctx,
    async (tx) => {
      // Read from the tenant's own row, not from a cache: a missing row is
      // not the demo, whatever the egress guards (which fail closed) think.
      const tenant = await tx.tenant.findFirst({ where: { id: ctx.tenantId }, select: { kind: true } });
      if (tenant?.kind !== 'demo') {
        throw new ForbiddenError('ai.manage', 'sample decisions are written only into the shared demo, where every visitor is told they are samples');
      }

      // The questions a live triage asks this tenant, and how a label decodes to an id.
      const [categories, teams] = await Promise.all([
        tx.category.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, path: true }, orderBy: { path: 'asc' } }),
        tx.team.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const set = triageQuestions({ categories, groups: teams });

      const imported: ImportedSampleDecision[] = [];
      const seen = new Set<string>();
      for (const [index, row] of parsed.entries()) {
        const prefix = `${index}.`;
        const ticket = await tx.ticket.findFirst({
          where: { id: row.ticketId, deletedAt: null },
          select: { id: true, number: true, type: true, categoryId: true, groupId: true, priority: true, createdAt: true, resolvedAt: true },
        });
        if (!ticket) throw new NotFoundError('ticket', row.ticketId);
        if (row.createdAt < ticket.createdAt) {
          throw new ValidationError('a ticket is triaged once it has been raised', [
            { field: `${prefix}createdAt`, code: 'before_ticket', message: `must not be earlier than ${ticket.createdAt.toISOString()}` },
          ]);
        }
        if (ticket.resolvedAt && row.createdAt > ticket.resolvedAt) {
          throw new ValidationError('a ticket is triaged before it is resolved', [
            { field: `${prefix}createdAt`, code: 'after_resolved', message: `must not be later than ${ticket.resolvedAt.toISOString()}` },
          ]);
        }
        if (seen.has(ticket.id)) {
          throw new ValidationError('a ticket is triaged once per question set', [{ field: `${prefix}ticketId`, code: 'duplicate', message: 'this ticket is in the import twice' }]);
        }
        seen.add(ticket.id);
        const earlier = await tx.aiDecision.findFirst({
          where: { purpose: PURPOSE, subjectType: 'ticket', subjectId: ticket.id, questionSetVersion: definition.questionSetVersion },
          select: { id: true },
        });
        if (earlier) throw new ConflictError(`${ticket.number} has already been triaged`, { decisionId: earlier.id });

        // The answers, checked as a provider's are: one that does not fit its
        // question is refused here rather than quietly recorded as none.
        const unknown = Object.keys(row.answers).filter((question) => !(question in set.questions));
        if (unknown.length > 0) {
          throw new ValidationError(
            'a sample answers only the questions a live triage asks this tenant',
            unknown.map((question) => ({ field: `${prefix}answers.${question}`, code: 'unknown_question', message: 'not a question in this triage' })),
          );
        }
        const checked = checkDecision(set.questions, { answers: row.answers });
        if (checked.problems.length > 0) {
          throw new ValidationError(
            'a sample answers as a provider must',
            checked.problems.map((problem) => ({ field: `${prefix}answers.${problem.split(':')[0]}`, code: 'invalid', message: problem })),
          );
        }

        // Labels to the ids a ticket stores, as `runTriage` decodes them.
        const proposed: Record<string, string | number | boolean | null> = {};
        for (const [question, answer] of Object.entries(checked.answers)) {
          const map = set.decode[question];
          proposed[question] =
            answer.value === null ? null : map && typeof answer.value === 'string' ? (map.get(answer.value) ?? null) : answer.value;
        }

        const current: Record<string, unknown> = row.baseline ?? {
          type: ticket.type,
          categoryId: ticket.categoryId,
          groupId: ticket.groupId,
          priority: ticket.priority,
        };
        const humanSet = new Set(Object.entries(current).filter(([, value]) => value !== null).map(([field]) => field));
        const plan = planDecision({ mode: 'suggest', thresholds, bindings: definition.bindings, answers: checked.answers, values: proposed, current, humanSet });
        const offered = new Set(plan.filter((entry) => entry.action === 'suggest').map((entry) => entry.question));
        const outcome = offered.size > 0 ? 'suggested' : 'shadowed';

        const responses: Record<string, { action: string; by: string; at: string }> = {};
        for (const [question, response] of Object.entries(row.responses)) {
          if (!offered.has(question)) {
            throw new ValidationError('a person answers only a suggestion that was made', [
              { field: `${prefix}responses.${question}`, code: 'not_suggested', message: `the plan did not suggest ${question}` },
            ]);
          }
          const person = await tx.user.findFirst({ where: { id: response.by }, select: { id: true } });
          if (!person) {
            throw new ValidationError('that person is not in this directory', [{ field: `${prefix}responses.${question}.by`, code: 'not_found', message: 'no such person' }]);
          }
          responses[question] = { action: response.action, by: response.by, at: response.at.toISOString() };
        }

        const attempt: ChainAttempt = { provider: SAMPLE_PROVIDER, outcome: 'answered', reason: null, model: SAMPLE_MODEL, ms: 0, costMicros: '0' };
        const decisionId = newId();
        await tx.aiDecision.create({
          data: {
            id: decisionId,
            tenantId: ctx.tenantId,
            purpose: PURPOSE,
            subjectType: 'ticket',
            subjectId: ticket.id,
            mode: 'suggest',
            questionSetVersion: definition.questionSetVersion,
            provider: SAMPLE_PROVIDER,
            model: SAMPLE_MODEL,
            providerRequestId: null,
            answers: checked.answers as never,
            proposed: proposed as never,
            plan: plan as never,
            attempts: [attempt] as never,
            problems: [] as never,
            omitted: set.omitted as never,
            baseline: current as never,
            responses: responses as never,
            outcome,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            costMicros: 0n,
            periodKey: periodFor(row.createdAt),
            createdAt: row.createdAt,
          },
        });
        // What the ticket settled as, at its resolution: the same rule a live
        // resolution applies, so a sample is scored like any decision.
        const settled = ticket.resolvedAt ? (await settleDecisions(ctx, tx, ticket.id, ticket.resolvedAt)) > 0 : false;
        imported.push({ decisionId, ticketNumber: ticket.number, outcome, settled });
      }

      await recordAudit(tx, ctx, {
        action: 'ai.decisions.imported.batch',
        targetType: 'import_batch',
        targetId: newId(),
        after: {
          label: settings.label ?? null,
          provider: SAMPLE_PROVIDER,
          count: imported.length,
          first: imported[0]!.ticketNumber,
          last: imported.at(-1)!.ticketNumber,
          tickets: imported.map((each) => each.ticketNumber),
        },
        ...(settings.reason ? { reason: settings.reason } : {}),
      });
      metrics.increment('ai_sample_decisions_imported_total', {}, imported.length);
      return imported;
    },
    parsed.length > 1 ? { timeout: 60_000 } : {},
  );
}
