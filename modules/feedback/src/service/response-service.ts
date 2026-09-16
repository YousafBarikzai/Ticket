import { events } from '@itsm/contracts';
import type { FormValues } from '@itsm/contracts';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  buildPermissionSet,
  createContext,
  digest,
  metrics,
  newId,
  publish,
  transaction,
  verifyToken,
  withContext,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { evaluateAnswers, questionsOf, type SurveyDocument } from '../domain/survey-document.js';
import { narrowToScope } from './invitation-service.js';

/**
 * Answering.
 *
 * Two doors, one room. The link in an email proves itself with a signed
 * token; a button in a chat thread proves itself by the linked identity of
 * whoever pressed it. Both end in `record`, which validates against the
 * version that was shown, stores every answer, and publishes the normalised
 * score for MOD-12.
 */

export interface OpenedInvitation {
  invitationId: string;
  tenantId: string;
  status: string;
  survey: { key: string; name: string; version: number; document: SurveyDocument };
  ticketNumber: string | null;
  expiresAt: Date;
}

/** Resolves a signed link to the invitation it opens, with the reason when it does not. */
export async function openByToken(token: string, now: Date = new Date()): Promise<{ ok: true; opened: OpenedInvitation; ctx: TenantContext } | { ok: false; reason: string }> {
  const verdict = verifyToken(token, now);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (verdict.payload.kind !== 'survey_invitation') return { ok: false, reason: 'malformed' };

  // The person the link was sent to, with no permissions: the token is the
  // whole of their authority and it reaches exactly one row.
  const ctx = createContext({
    tenantId: verdict.payload.tenantId,
    actor: { type: 'user', id: null },
    permissions: buildPermissionSet([]),
  });

  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const invitation = await tx.surveyInvitation.findFirst({ where: { id: verdict.payload.subjectId } });
      if (!invitation || invitation.tokenHash !== digest(token)) return { ok: false as const, reason: 'bad_signature' };

      const version = await tx.surveyVersion.findFirst({ where: { id: invitation.versionId }, include: { definition: { select: { key: true, name: true } } } });
      if (!version) return { ok: false as const, reason: 'malformed' };
      const ticket = invitation.ticketId ? await tx.ticket.findFirst({ where: { id: invitation.ticketId }, select: { number: true } }) : null;

      const status = invitation.status === 'pending' && invitation.expiresAt <= now ? 'expired' : invitation.status;
      const recipientCtx = createContext({
        tenantId: ctx.tenantId,
        actor: { type: 'user', id: invitation.recipientId },
        permissions: buildPermissionSet([]),
      });
      return {
        ok: true as const,
        ctx: recipientCtx,
        opened: {
          invitationId: invitation.id,
          tenantId: ctx.tenantId,
          status,
          survey: { key: version.definition.key, name: version.definition.name, version: version.version, document: version.document as unknown as SurveyDocument },
          ticketNumber: ticket?.number ?? null,
          expiresAt: invitation.expiresAt,
        },
      };
    }),
  );
}

/** The questions a page needs, for a renderer with no form engine. */
export function questionsFor(opened: OpenedInvitation) {
  return questionsOf(opened.survey.document);
}

/**
 * Records the answers for an invitation and publishes the score. The single
 * write path; every door ends here. Throws a ValidationError naming the field
 * when the answers do not fit the version that was shown.
 */
export async function record(
  ctx: TenantContext,
  tx: Tx,
  invitationId: string,
  answers: FormValues,
  via: string,
  now: Date = new Date(),
) {
  const invitation = await tx.surveyInvitation.findFirst({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError('survey invitation', invitationId);
  if (invitation.status === 'responded') throw new ForbiddenError('this survey has already been answered');
  if (invitation.status === 'expired' || invitation.expiresAt <= now) throw new ForbiddenError('this survey has expired');
  if (invitation.status !== 'pending') throw new ForbiddenError(`this survey is ${invitation.status}`);

  const version = await tx.surveyVersion.findFirst({ where: { id: invitation.versionId }, include: { definition: { select: { key: true } } } });
  if (!version) throw new NotFoundError('survey version', invitation.versionId);
  const document = version.document as unknown as SurveyDocument;

  const outcome = evaluateAnswers(document, version.definition.key, version.version, answers);
  if (!outcome.ok) {
    const [field, message] = Object.entries(outcome.errors)[0]!;
    throw new ValidationError(
      `${field}: ${message}`,
      Object.entries(outcome.errors).map(([name, text]) => ({ field: name, code: 'invalid', message: text })),
    );
  }

  const responseId = newId();
  await tx.surveyResponse.create({
    data: {
      id: responseId,
      tenantId: ctx.tenantId,
      invitationId,
      surveyId: invitation.surveyId,
      versionId: invitation.versionId,
      ticketId: invitation.ticketId,
      respondentId: invitation.recipientId,
      answers: outcome.accepted as never,
      score: outcome.score,
      scale: outcome.scale,
      comment: outcome.comment,
      via,
      respondedAt: now,
    },
  });
  await tx.surveyInvitation.update({ where: { id: invitationId }, data: { status: 'responded', respondedAt: now } });

  await publish(tx, ctx, {
    definition: events.surveyResponded,
    aggregateId: responseId,
    payload: {
      responseId,
      invitationId,
      surveyId: invitation.surveyId,
      surveyKey: version.definition.key,
      version: version.version,
      ticketId: invitation.ticketId,
      respondentId: invitation.recipientId,
      score: outcome.score,
      scale: outcome.scale,
      comment: outcome.comment,
      via,
    },
  });

  metrics.increment('survey_responses_total', { via });
  if (outcome.score !== null) metrics.observe('survey_score', outcome.score, { survey: version.definition.key });
  return { responseId, score: outcome.score, thanks: document.thanks ?? 'Thank you.' };
}

/** The email-link door: verify, then record as the recipient. */
export async function respondByToken(token: string, answers: FormValues, via: 'portal' | 'email' = 'portal', now: Date = new Date()) {
  const opened = await openByToken(token, now);
  if (!opened.ok) throw new ForbiddenError(`this survey link is ${opened.reason === 'expired' ? 'no longer valid' : 'not valid'}`);
  return withContext(opened.ctx, () => transaction(opened.ctx, (tx) => record(opened.ctx, tx, opened.opened.invitationId, answers, via, now)));
}

/**
 * The chat door: the person who pressed the button must be the person the
 * survey was sent to. A rating in a shared channel from anybody else is not
 * that person's opinion, however well meant.
 */
export async function respondFromChat(
  ctx: TenantContext,
  tx: Tx,
  invitationId: string,
  value: number,
  senderUserId: string | null,
  via: string,
): Promise<{ reply: string }> {
  const invitation = await tx.surveyInvitation.findFirst({ where: { id: invitationId } });
  if (!invitation) return { reply: 'That survey is no longer open.' };
  if (!senderUserId || senderUserId !== invitation.recipientId) {
    return { reply: 'This survey was sent to the person who raised the ticket; only they can answer it.' };
  }
  if (invitation.status !== 'pending') return { reply: invitation.status === 'responded' ? 'Thank you — you have already answered.' : 'That survey is no longer open.' };

  const version = await tx.surveyVersion.findFirst({ where: { id: invitation.versionId } });
  const document = version?.document as unknown as SurveyDocument | undefined;
  if (!document?.scoring) return { reply: 'That survey cannot be answered here; please use the link you were sent.' };

  try {
    const result = await record(ctx, tx, invitationId, { [document.scoring.field]: value }, via);
    return { reply: result.thanks };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { reply: `Please answer with a number from ${document.scoring.min} to ${document.scoring.max}.` };
    }
    throw error;
  }
}

export async function listResponses(ctx: TenantContext, filter: { surveyKey?: string; ticketId?: string }, limit = 50) {
  authz.require(ctx, 'feedback.read');
  return transaction(ctx, async (tx) => {
    const survey = filter.surveyKey ? await tx.surveyDefinition.findFirst({ where: { key: filter.surveyKey } }) : null;
    if (filter.surveyKey && !survey) throw new NotFoundError('survey', filter.surveyKey);
    const rows = await tx.surveyResponse.findMany({
      where: { ...(survey ? { surveyId: survey.id } : {}), ...(filter.ticketId ? { ticketId: filter.ticketId } : {}) },
      orderBy: { respondedAt: 'desc' },
      take: limit,
    });
    return narrowToScope(ctx, tx, rows);
  });
}
