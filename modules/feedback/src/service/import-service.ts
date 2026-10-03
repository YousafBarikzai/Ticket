import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FormValues } from '@itsm/contracts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  digest,
  metrics,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { evaluateAnswers, type SurveyDocument } from '../domain/survey-document.js';
import { expiryFor } from '../domain/throttle.js';
import { TRIGGER_KINDS } from './survey-service.js';

/**
 * History imports (A4 §1.11 "CSAT model", §2.3; WP-43b).
 *
 * Who was asked how they found a resolved ticket, and what the third of them
 * who answered said: the shared demo's four months of satisfaction, or a
 * migration's. Each is written as the rows the live doors leave behind — an
 * invitation, and for an answer the response with its score through
 * `evaluateAnswers` and `normaliseScore` — dated when it happened.
 *
 * Nothing is set off. No `survey.invited`, so nobody is e-mailed about a
 * ticket closed in July; no chat post is queued, so a tenant being built
 * (which refuses every job, A4 §2.4 Q2) can import; no `survey.responded`,
 * so no webhook hears last month's answer now. Analytics reads imported
 * responses through `reprojectFromSource` (the demo build's S8; anybody else
 * passes `sources: ['surveys']`).
 *
 * An imported invitation's link was never sent from here, so its token is a
 * secret nobody holds: the hash of random bytes, which no link can match.
 */

const VIAS = ['portal', 'email', 'slack', 'teams', 'whatsapp'] as const;

const askedSchema = z.object({
  /** The survey asked, by key; its live version is the one answered. */
  surveyKey: z.string().min(1).max(63),
  /** The resolved ticket it asked about. */
  ticketId: z.string().uuid(),
  /** Who was asked. Omitted, the ticket's requester, as the live trigger asks. */
  recipientId: z.string().uuid().optional(),
  /** What sent it, when that was one of the survey's triggers; its expiry then applies. */
  trigger: z.enum(TRIGGER_KINDS).optional(),
  /** When it was sent. */
  sentAt: z.coerce.date(),
  /** When the link stops working. Omitted, the trigger's expiry after `sentAt`, or 14 days. */
  expiresAt: z.coerce.date().optional(),
  /** Where it was shown. Omitted, by e-mail, as the live trigger sends it. */
  channels: z.array(z.enum(VIAS)).max(5).optional(),
});

export const importInvitationSchema = askedSchema.strict();
export type ImportInvitationInput = z.input<typeof importInvitationSchema>;

export const importResponseSchema = askedSchema
  .extend({
    /** When they answered. */
    respondedAt: z.coerce.date(),
    /** The answers, by question, as the version asked accepts them. */
    answers: z.record(z.unknown()),
    /** Where they answered. */
    via: z.enum(VIAS),
  })
  .strict();
export type ImportResponseInput = z.input<typeof importResponseSchema>;

/**
 * The most rows one call takes: one transaction, and — audited as a batch —
 * one audit row that can still name every ticket (the trail keeps 50
 * entries of any list).
 */
export const IMPORT_SURVEYS_MAX = 50;

export interface ImportSurveysOptions {
  /** `row` (the default): one audit row per invitation. `batch`: one row for the call (D19). */
  audit?: 'row' | 'batch';
  /** What the batch row calls the chunk, e.g. "demo g42 csat 0001-0050". */
  label?: string;
  /** The audit rows' reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

const optionsSchema = z
  .object({
    audit: z.enum(['row', 'batch']).default('row'),
    label: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

type FieldProblem = { field: string; code: string; message: string };
type Asked = z.infer<typeof askedSchema>;
type Answered = z.infer<typeof importResponseSchema>;

/** An instant that is not a date or has not happened yet; a history records the past. */
function instantProblem(at: Date | undefined, field: string): FieldProblem | null {
  if (at === undefined) return null;
  if (Number.isNaN(at.getTime())) return { field, code: 'invalid', message: 'not a date' };
  if (at.getTime() > Date.now()) return { field, code: 'in_future', message: 'must not be later than now' };
  return null;
}

/** What can be refused before anything is read. */
function rowProblems(row: Asked & Partial<Pick<Answered, 'respondedAt'>>, prefix: string): FieldProblem[] {
  const problems = [instantProblem(row.sentAt, `${prefix}sentAt`), instantProblem(row.respondedAt, `${prefix}respondedAt`)].filter(
    (problem): problem is FieldProblem => problem !== null,
  );
  if (row.expiresAt && !Number.isNaN(row.expiresAt.getTime()) && row.expiresAt <= row.sentAt) {
    problems.push({ field: `${prefix}expiresAt`, code: 'before_sent', message: 'a link expires after it is sent' });
  }
  if (row.respondedAt && problems.length === 0 && row.respondedAt < row.sentAt) {
    problems.push({ field: `${prefix}respondedAt`, code: 'before_sent', message: 'nobody answers before they are asked' });
  }
  return problems;
}

function requireImporter(ctx: TenantContext): void {
  authz.require(ctx, 'feedback.manage');
}

interface SurveyInHand {
  id: string;
  key: string;
  versionId: string;
  version: number;
  document: SurveyDocument;
  triggers: Map<string, { id: string; expiryDays: number }>;
}

/** The survey asked, with its live version and triggers, read once per call. */
async function surveyFor(tx: Tx, key: string, cache: Map<string, SurveyInHand>): Promise<SurveyInHand> {
  const known = cache.get(key);
  if (known) return known;
  const survey = await tx.surveyDefinition.findFirst({ where: { key } });
  if (!survey) throw new NotFoundError('survey', key);
  if (survey.status !== 'published') throw new ValidationError(`the survey ${key} is ${survey.status}; only a published survey has been asked`);
  const version = await tx.surveyVersion.findFirst({ where: { definitionId: survey.id, version: survey.version } });
  if (!version) throw new NotFoundError('survey version', `${key} v${survey.version}`);
  const triggers = await tx.surveyTrigger.findMany({ where: { surveyId: survey.id }, orderBy: { createdAt: 'asc' } });
  const found: SurveyInHand = {
    id: survey.id,
    key: survey.key,
    versionId: version.id,
    version: version.version,
    document: version.document as unknown as SurveyDocument,
    // The first trigger of each kind, as the live trigger is chosen.
    triggers: new Map(triggers.reverse().map((trigger) => [trigger.kind, { id: trigger.id, expiryDays: trigger.expiryDays }])),
  };
  cache.set(key, found);
  return found;
}

/** A link nobody holds: the hash of random bytes, so no token can open an imported invitation. */
function unusableTokenHash(): string {
  return digest(`imported:${randomBytes(32).toString('base64url')}`);
}

interface Placed {
  invitationId: string;
  survey: SurveyInHand;
  ticket: { id: string; number: string };
  recipientId: string;
  expiresAt: Date;
}

/**
 * Checks one row against what the tenant has and writes its invitation:
 * `responded` when it was answered, otherwise `pending` while its link would
 * still work and `expired` once it would not. Everything a refusal names is
 * checked before the row is written, and a refusal rolls back the whole call.
 */
async function placeInvitation(
  ctx: TenantContext,
  tx: Tx,
  row: Asked,
  respondedAt: Date | null,
  prefix: string,
  surveys: Map<string, SurveyInHand>,
  seen: Set<string>,
): Promise<Placed> {
  const survey = await surveyFor(tx, row.surveyKey, surveys);
  const ticket = await tx.ticket.findFirst({ where: { id: row.ticketId }, select: { id: true, number: true, requesterId: true, createdAt: true } });
  if (!ticket) throw new NotFoundError('ticket', row.ticketId);
  if (row.sentAt < ticket.createdAt) {
    throw new ValidationError('nobody is asked about a ticket before it was raised', [
      { field: `${prefix}sentAt`, code: 'before_ticket', message: `must not be earlier than ${ticket.createdAt.toISOString()}` },
    ]);
  }
  const recipientId = row.recipientId ?? ticket.requesterId;
  if (!recipientId) {
    throw new ValidationError('this ticket has no requester to have asked', [{ field: `${prefix}recipientId`, code: 'required', message: 'name who was asked' }]);
  }
  const person = await tx.user.findFirst({ where: { id: recipientId }, select: { id: true } });
  if (!person) throw new ValidationError('that person is not in this directory', [{ field: `${prefix}recipientId`, code: 'not_found', message: 'no such person' }]);

  let trigger: { id: string; expiryDays: number } | null = null;
  if (row.trigger) {
    trigger = survey.triggers.get(row.trigger) ?? null;
    if (!trigger) {
      throw new ValidationError(`the survey ${survey.key} is not sent on ${row.trigger}`, [{ field: `${prefix}trigger`, code: 'not_found', message: 'no such trigger' }]);
    }
  }

  // One ask per person per thing, as the live trigger keeps it.
  const once = `${survey.id}:${ticket.id}:${recipientId}`;
  if (seen.has(once)) {
    throw new ValidationError('the same person is asked about the same ticket twice in this import', [
      { field: `${prefix}ticketId`, code: 'duplicate', message: 'one ask per person per ticket' },
    ]);
  }
  seen.add(once);
  const already = await tx.surveyInvitation.findFirst({ where: { surveyId: survey.id, ticketId: ticket.id, recipientId }, select: { id: true } });
  if (already) throw new ConflictError(`${ticket.number} has already been asked about`, { invitationId: already.id });

  const expiresAt = row.expiresAt ?? expiryFor(row.sentAt, trigger?.expiryDays ?? 14);
  if (respondedAt && respondedAt >= expiresAt) {
    throw new ValidationError('nobody answers a survey after its link has expired', [
      { field: `${prefix}respondedAt`, code: 'after_expiry', message: `must be earlier than ${expiresAt.toISOString()}` },
    ]);
  }

  const status = respondedAt ? 'responded' : expiresAt <= new Date() ? 'expired' : 'pending';
  const invitationId = newId();
  await tx.surveyInvitation.create({
    data: {
      id: invitationId,
      tenantId: ctx.tenantId,
      surveyId: survey.id,
      versionId: survey.versionId,
      triggerId: trigger?.id ?? null,
      ticketId: ticket.id,
      incidentId: null,
      recipientId,
      tokenHash: unusableTokenHash(),
      status,
      sentAt: row.sentAt,
      expiresAt,
      respondedAt,
      channels: row.channels ?? ['email'],
    },
  });
  return { invitationId, survey, ticket: { id: ticket.id, number: ticket.number }, recipientId, expiresAt };
}

async function auditBatch(
  ctx: TenantContext,
  tx: Tx,
  action: string,
  numbers: string[],
  settings: z.infer<typeof optionsSchema>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // One row for the chunk, naming the ticket of every row (A4 §2.9).
  await recordAudit(tx, ctx, {
    action,
    targetType: 'import_batch',
    targetId: newId(),
    after: { label: settings.label ?? null, count: numbers.length, first: numbers[0]!, last: numbers.at(-1)!, tickets: numbers, ...extra },
    ...(settings.reason ? { reason: settings.reason } : {}),
  });
}

/**
 * Imports survey invitations nobody answered (A4 §2.3): `pending` while the
 * link would still work, `expired` once it would not. Returns the invitation
 * ids in the order given.
 *
 * Refused, with nothing written: an instant in the future, or before its
 * ticket was raised; a survey that is not published; a trigger the survey
 * does not have; a person not in the directory; an ask the ticket already
 * has, here or earlier in the call. Needs `feedback.manage`.
 */
export async function importInvitations(ctx: TenantContext, rows: ImportInvitationInput[], options: ImportSurveysOptions = {}): Promise<string[]> {
  const parsed = z.array(importInvitationSchema).max(IMPORT_SURVEYS_MAX).parse(rows);
  const settings = optionsSchema.parse(options);
  requireImporter(ctx);
  const problems = parsed.flatMap((row, index) => rowProblems(row, `${index}.`));
  if (problems.length > 0) throw new ValidationError('the imported invitations do not hold together', problems);
  if (parsed.length === 0) return [];

  return transaction(ctx, async (tx) => {
    const surveys = new Map<string, SurveyInHand>();
    const seen = new Set<string>();
    const ids: string[] = [];
    const numbers: string[] = [];
    for (const [index, row] of parsed.entries()) {
      const placed = await placeInvitation(ctx, tx, row, null, `${index}.`, surveys, seen);
      ids.push(placed.invitationId);
      numbers.push(placed.ticket.number);
      if (settings.audit === 'row') {
        await recordAudit(tx, ctx, {
          action: 'survey.invitation.imported',
          targetType: 'survey_invitation',
          targetId: placed.invitationId,
          after: { survey: placed.survey.key, ticket: placed.ticket.number, recipientId: placed.recipientId, sentAt: row.sentAt.toISOString() },
          ...(settings.reason ? { reason: settings.reason } : {}),
        });
      }
    }
    if (settings.audit === 'batch') await auditBatch(ctx, tx, 'survey.invitations.imported.batch', numbers, settings);
    metrics.increment('survey_invitations_imported_total', {}, ids.length);
    return ids;
  });
}

export interface ImportedResponse {
  invitationId: string;
  responseId: string;
  ticketNumber: string;
  /** The headline answer out of 100, as `normaliseScore` gives it; null when the survey scores nothing. */
  score: number | null;
}

/**
 * Imports answered surveys (A4 §2.3): the invitation, `responded`, and its
 * response, each dated when it happened. The answers are checked against
 * the survey's live version exactly as a live answer is (`evaluateAnswers`),
 * and the score is the one the live door would store. Returns one entry per
 * row, in the order given.
 *
 * Refused, with nothing written: everything `importInvitations` refuses; an
 * answer before the ask, after the link expired, or in the future; answers
 * the survey does not accept, at `<i>.answers.<question>`. Needs
 * `feedback.manage`.
 */
export async function importResponses(ctx: TenantContext, rows: ImportResponseInput[], options: ImportSurveysOptions = {}): Promise<ImportedResponse[]> {
  const parsed = z.array(importResponseSchema).max(IMPORT_SURVEYS_MAX).parse(rows);
  const settings = optionsSchema.parse(options);
  requireImporter(ctx);
  const problems = parsed.flatMap((row, index) => rowProblems(row, `${index}.`));
  if (problems.length > 0) throw new ValidationError('the imported responses do not hold together', problems);
  if (parsed.length === 0) return [];

  return transaction(ctx, async (tx) => {
    const surveys = new Map<string, SurveyInHand>();
    const seen = new Set<string>();
    const imported: ImportedResponse[] = [];
    const scores: number[] = [];
    for (const [index, row] of parsed.entries()) {
      const prefix = `${index}.`;
      const survey = await surveyFor(tx, row.surveyKey, surveys);
      const outcome = evaluateAnswers(survey.document, survey.key, survey.version, row.answers as FormValues);
      if (!outcome.ok) {
        throw new ValidationError(
          'the answers do not fit the survey that was asked',
          Object.entries(outcome.errors).map(([field, message]) => ({ field: `${prefix}answers.${field}`, code: 'invalid', message })),
        );
      }

      const placed = await placeInvitation(ctx, tx, row, row.respondedAt, prefix, surveys, seen);
      const responseId = newId();
      await tx.surveyResponse.create({
        data: {
          id: responseId,
          tenantId: ctx.tenantId,
          invitationId: placed.invitationId,
          surveyId: survey.id,
          versionId: survey.versionId,
          ticketId: placed.ticket.id,
          respondentId: placed.recipientId,
          answers: outcome.accepted as never,
          score: outcome.score,
          scale: outcome.scale,
          comment: outcome.comment,
          via: row.via,
          respondedAt: row.respondedAt,
        },
      });
      imported.push({ invitationId: placed.invitationId, responseId, ticketNumber: placed.ticket.number, score: outcome.score });
      if (outcome.score !== null) scores.push(outcome.score);

      if (settings.audit === 'row') {
        await recordAudit(tx, ctx, {
          action: 'survey.response.imported',
          targetType: 'survey_response',
          targetId: responseId,
          after: { survey: survey.key, ticket: placed.ticket.number, score: outcome.score, via: row.via, respondedAt: row.respondedAt.toISOString() },
          ...(settings.reason ? { reason: settings.reason } : {}),
        });
      }
    }
    if (settings.audit === 'batch') {
      await auditBatch(
        ctx,
        tx,
        'survey.responses.imported.batch',
        imported.map((each) => each.ticketNumber),
        settings,
        { meanScore: scores.length > 0 ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null },
      );
    }
    metrics.increment('survey_responses_imported_total', {}, imported.length);
    return imported;
  });
}
