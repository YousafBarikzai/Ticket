import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  majorIncidentService,
  reviewService,
  declareSchema,
  transitionSchema,
  updateEntrySchema,
  rolesSchema,
  reviewSchema,
  actionSchema,
  actionUpdateSchema,
} from '@itsm/module-incident';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-08-E1 major incidents.
 *
 * Written for somebody using it at 3am with one hand. Every route that changes
 * the incident also carries the words to go with the change, so running an
 * incident is one action per thing that happened rather than two.
 */
export async function majorIncidentRoutes(app: FastifyInstance): Promise<void> {
  const byNumber = z.object({ number: z.string().min(1).max(40) });
  const byId = z.object({ id: z.string().uuid() });

  app.get('/major-incidents', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ status: z.string().optional(), severity: z.string().optional(), open: z.coerce.boolean().optional() })
      .parse(request.query);
    const incidents = await majorIncidentService.listIncidents(ctx, query);
    return {
      data: incidents.map((incident) => ({
        number: incident.number,
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        commanderId: incident.commanderId,
        customerFacing: incident.customerFacing,
        declaredAt: incident.declaredAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        nextUpdateDueAt: incident.nextUpdateDueAt?.toISOString() ?? null,
      })),
    };
  });

  /** The incident room: the incident, its timeline and its review. */
  app.get('/major-incidents/:number', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ audience: z.enum(['internal', 'stakeholders', 'public']).default('internal') }).parse(request.query);
    const { incident, updates, review } = await majorIncidentService.getIncident(
      ctx,
      byNumber.parse(request.params).number,
      query.audience,
    );
    return {
      number: incident.number,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      impactSummary: incident.impactSummary,
      affectedServiceIds: incident.affectedServiceIds,
      customerFacing: incident.customerFacing,
      bridgeUrl: incident.bridgeUrl,
      ticketId: incident.ticketId,
      roles: { commanderId: incident.commanderId, commsLeadId: incident.commsLeadId, scribeId: incident.scribeId },
      updateIntervalMinutes: incident.updateIntervalMinutes,
      nextUpdateDueAt: incident.nextUpdateDueAt?.toISOString() ?? null,
      declaredAt: incident.declaredAt.toISOString(),
      identifiedAt: incident.identifiedAt?.toISOString() ?? null,
      mitigatedAt: incident.mitigatedAt?.toISOString() ?? null,
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      closedAt: incident.closedAt?.toISOString() ?? null,
      timeline: updates.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        audience: entry.audience,
        body: entry.body,
        statusFrom: entry.statusFrom,
        statusTo: entry.statusTo,
        authorId: entry.authorId,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      review: review
        ? { status: review.status, dueOn: review.dueOn?.toISOString().slice(0, 10) ?? null, publishedAt: review.publishedAt?.toISOString() ?? null }
        : null,
    };
  });

  app.post('/major-incidents', async (request, reply) => {
    const ctx = contextOf(request);
    const incident = await majorIncidentService.declare(ctx, declareSchema.parse(request.body));
    return reply.code(201).send({
      number: incident.number,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      nextUpdateDueAt: incident.nextUpdateDueAt?.toISOString() ?? null,
    });
  });

  /** A line on the timeline. The commonest call there is. */
  app.post('/major-incidents/:number/updates', async (request, reply) => {
    const ctx = contextOf(request);
    const entry = await majorIncidentService.postUpdate(
      ctx,
      byNumber.parse(request.params).number,
      updateEntrySchema.parse(request.body),
    );
    return reply.code(201).send({ id: entry.id, kind: entry.kind, audience: entry.audience, occurredAt: entry.occurredAt.toISOString() });
  });

  /** Moves it, and says why in the same call. */
  app.post('/major-incidents/:number/transition', async (request) => {
    const ctx = contextOf(request);
    const incident = await majorIncidentService.transition(
      ctx,
      byNumber.parse(request.params).number,
      transitionSchema.parse(request.body),
    );
    return {
      number: incident.number,
      status: incident.status,
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      nextUpdateDueAt: incident.nextUpdateDueAt?.toISOString() ?? null,
    };
  });

  app.patch('/major-incidents/:number/roles', async (request) => {
    const ctx = contextOf(request);
    const incident = await majorIncidentService.setRoles(
      ctx,
      byNumber.parse(request.params).number,
      rolesSchema.parse(request.body),
    );
    return { commanderId: incident.commanderId, commsLeadId: incident.commsLeadId, scribeId: incident.scribeId };
  });

  // ---- the review --------------------------------------------------------
  app.get('/major-incidents/:number/review', async (request) => {
    const ctx = contextOf(request);
    const { review, actions } = await reviewService.getReview(ctx, byNumber.parse(request.params).number);
    return {
      status: review.status,
      summary: review.summary,
      rootCause: review.rootCause,
      contributingFactors: review.contributingFactors,
      whatWentWell: review.whatWentWell,
      whatDidNot: review.whatDidNot,
      durationMinutes: review.durationMinutes,
      dueOn: review.dueOn?.toISOString().slice(0, 10) ?? null,
      publishedAt: review.publishedAt?.toISOString() ?? null,
      actions: actions.map((action) => ({
        id: action.id,
        description: action.description,
        ownerId: action.ownerId,
        dueOn: action.dueOn?.toISOString().slice(0, 10) ?? null,
        status: action.status,
        ticketId: action.ticketId,
      })),
    };
  });

  app.patch('/major-incidents/:number/review', async (request) => {
    const ctx = contextOf(request);
    const review = await reviewService.saveReview(
      ctx,
      byNumber.parse(request.params).number,
      reviewSchema.parse(request.body),
    );
    return { status: review.status, dueOn: review.dueOn?.toISOString().slice(0, 10) ?? null };
  });

  app.post('/major-incidents/:number/review/actions', async (request, reply) => {
    const ctx = contextOf(request);
    const action = await reviewService.addAction(
      ctx,
      byNumber.parse(request.params).number,
      actionSchema.parse(request.body),
    );
    return reply.code(201).send({ id: action.id, description: action.description, ownerId: action.ownerId });
  });

  app.patch('/major-incidents/review/actions/:id', async (request) => {
    const ctx = contextOf(request);
    const action = await reviewService.updateAction(ctx, byId.parse(request.params).id, actionUpdateSchema.parse(request.body));
    return { id: action.id, status: action.status, ownerId: action.ownerId, ticketId: action.ticketId };
  });

  /** Publishing the review is what closes the incident. One call, one moment. */
  app.post('/major-incidents/:number/review/publish', async (request) => {
    const ctx = contextOf(request);
    const { incident, review, actions } = await reviewService.publishAndClose(ctx, byNumber.parse(request.params).number);
    return {
      number: incident.number,
      status: incident.status,
      review: { status: review.status, publishedAt: review.publishedAt?.toISOString() ?? null },
      actionCount: actions.length,
    };
  });

  app.post('/major-incidents/:number/close', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(1000) }).parse(request.body);
    const incident = await reviewService.closeWithoutReview(ctx, byNumber.parse(request.params).number, body.reason);
    return { number: incident.number, status: incident.status };
  });
}
