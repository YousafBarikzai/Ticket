import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ForbiddenError, ValidationError } from '@itsm/platform';
import type { FormValues } from '@itsm/contracts';
import {
  invitationService,
  questionsOf,
  renderSurveyPage,
  renderThanksPage,
  responseService,
  surveyService,
} from '@itsm/module-feedback';
import { contextOf } from '../plugins/context.js';

/** MOD-18 surveys: design, triggers, who was asked and what they said — and the public page behind the link. */
export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(64) });
  const byId = z.object({ id: z.string().uuid() });

  const survey = (row: { id: string; key: string; name: string; description: string | null; status: string; version: number; publishedAt: Date | null; updatedAt: Date }) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });

  const trigger = (row: { id: string; kind: string; conditions: unknown; throttleDays: number; expiryDays: number; isActive: boolean }) => ({
    id: row.id,
    kind: row.kind,
    conditions: row.conditions,
    throttleDays: row.throttleDays,
    expiryDays: row.expiryDays,
    isActive: row.isActive,
  });

  // ---- Design -------------------------------------------------------------

  app.get('/surveys', async (request) => {
    const ctx = contextOf(request);
    const rows = await surveyService.listSurveys(ctx);
    return { data: rows.map((row) => ({ ...survey(row), triggers: row._count.triggers, versions: row._count.versions })) };
  });

  app.post('/surveys', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await surveyService.createSurvey(ctx, request.body as never);
    reply.status(201);
    return survey(row);
  });

  app.get('/surveys/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const row = await surveyService.getSurvey(ctx, key);
    return { ...survey(row), document: row.document, triggers: row.triggers.map(trigger) };
  });

  app.patch('/surveys/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return survey(await surveyService.updateSurvey(ctx, key, request.body as never));
  });

  app.post('/surveys/:key/publish', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return survey(await surveyService.publishSurvey(ctx, key));
  });

  app.post('/surveys/:key/retire', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return survey(await surveyService.retireSurvey(ctx, key));
  });

  app.post('/surveys/:key/triggers', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const row = await surveyService.addTrigger(ctx, key, request.body as never);
    reply.status(201);
    return trigger(row);
  });

  app.patch('/survey-triggers/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return trigger(await surveyService.updateTrigger(ctx, id, request.body as never));
  });

  app.delete('/survey-triggers/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await surveyService.removeTrigger(ctx, id);
    reply.status(204);
    return null;
  });

  // ---- Who was asked, and what they said ------------------------------------

  app.get('/survey-invitations', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ ticketId: z.string().uuid().optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    const rows = await invitationService.listInvitations(ctx, query, query.limit);
    return {
      data: rows.map((row) => ({
        id: row.id,
        surveyId: row.surveyId,
        ticketId: row.ticketId,
        recipientId: row.recipientId,
        status: row.status,
        channels: row.channels,
        sentAt: row.sentAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        respondedAt: row.respondedAt?.toISOString() ?? null,
      })),
    };
  });

  app.get('/survey-responses', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ survey: z.string().max(64).optional(), ticketId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    const rows = await responseService.listResponses(ctx, { surveyKey: query.survey, ticketId: query.ticketId }, query.limit);
    return {
      data: rows.map((row) => ({
        id: row.id,
        surveyId: row.surveyId,
        ticketId: row.ticketId,
        respondentId: row.respondentId,
        score: row.score,
        scale: row.scale,
        comment: row.comment,
        answers: row.answers,
        via: row.via,
        respondedAt: row.respondedAt.toISOString(),
      })),
    };
  });

  // ---- The page behind the link -------------------------------------------
  //
  // Under /public/, so it needs no session: the signed token in the path is
  // the whole of the credential (see the context plugin). HTML for a browser,
  // JSON for a portal that renders its own.

  const wantsHtml = (accept: string | undefined) => (accept ?? '').includes('text/html');

  app.get('/public/surveys/:token', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(2000) }).parse(request.params);
    const opened = await responseService.openByToken(token);
    if (!opened.ok) {
      reply.status(404);
      return wantsHtml(request.headers.accept)
        ? reply.type('text/html; charset=utf-8').send(renderThanksPage('Survey', 'This survey link is not valid.'))
        : { error: 'invalid_link', reason: opened.reason };
    }
    if (wantsHtml(request.headers.accept)) {
      return reply.type('text/html; charset=utf-8').send(renderSurveyPage(opened.opened));
    }
    return {
      status: opened.opened.status,
      survey: { key: opened.opened.survey.key, name: opened.opened.survey.name, version: opened.opened.survey.version, title: opened.opened.survey.document.title, description: opened.opened.survey.document.description ?? null },
      ticketNumber: opened.opened.ticketNumber,
      expiresAt: opened.opened.expiresAt.toISOString(),
      questions: questionsOf(opened.opened.survey.document),
    };
  });

  app.post('/public/surveys/:token', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(2000) }).parse(request.params);
    const opened = await responseService.openByToken(token);
    if (!opened.ok) throw new ForbiddenError('this survey link is not valid');

    // A browser form posts strings; a portal posts JSON. Coerce by what the
    // question expects, so a "4" from a radio button is the number 4.
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const answers: Record<string, string | number | boolean | null> = {};
    for (const question of questionsOf(opened.opened.survey.document)) {
      const value = raw[question.field];
      if (value === undefined || value === '') continue;
      if (question.control === 'number') answers[question.field] = typeof value === 'number' ? value : Number(value);
      else if (question.control === 'checkbox') answers[question.field] = value === true || value === 'true' || value === 'on';
      else answers[question.field] = String(value);
    }

    try {
      const result = await responseService.respondByToken(token, answers as FormValues, 'portal');
      if (wantsHtml(request.headers.accept)) {
        return reply.type('text/html; charset=utf-8').send(renderThanksPage(opened.opened.survey.document.title, result.thanks));
      }
      return { ok: true, responseId: result.responseId, score: result.score, thanks: result.thanks };
    } catch (error) {
      if (error instanceof ValidationError && wantsHtml(request.headers.accept)) {
        reply.status(422);
        const errors = Object.fromEntries((error.fieldErrors ?? []).map((entry) => [entry.field, entry.message]));
        return reply.type('text/html; charset=utf-8').send(renderSurveyPage(opened.opened, errors));
      }
      throw error;
    }
  });
}
