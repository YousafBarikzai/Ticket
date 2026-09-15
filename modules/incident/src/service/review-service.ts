import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  NotFoundError,
  ValidationError,
  authz,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { assertTransition, isIncidentState, type IncidentState } from '../domain/lifecycle.js';
import { reviewRequiredFor } from './major-incident-service.js';

/**
 * The post-incident review, and closing the incident.
 *
 * The review is the only part of a major incident that pays anything back. An
 * organisation that restores service and moves on has spent the outage and
 * bought nothing with it, so closure goes through here rather than through the
 * status path: it is the one transition with a precondition, and a precondition
 * nobody checks is a convention.
 *
 * What is *not* enforced is the content. A review with an empty root cause can
 * be published, because a platform that demanded one would get "human error"
 * typed into the box, which is worse than an honest blank.
 */

export const reviewSchema = z.object({
  summary: z.string().max(20_000).optional(),
  rootCause: z.string().max(10_000).optional(),
  contributingFactors: z.string().max(10_000).optional(),
  whatWentWell: z.string().max(10_000).optional(),
  whatDidNot: z.string().max(10_000).optional(),
  dueOn: z.coerce.date().optional(),
});

export const actionSchema = z.object({
  description: z.string().min(1).max(2000),
  ownerId: z.string().uuid().optional(),
  dueOn: z.coerce.date().optional(),
});

export async function getReview(ctx: TenantContext, number: string) {
  authz.require(ctx, 'incident.major.read');
  return transaction(ctx, async (tx) => {
    const { review } = await loadReview(tx, number);
    const actions = await tx.actionItem.findMany({ where: { reviewId: review.id }, orderBy: { createdAt: 'asc' } });
    return { review, actions };
  });
}

/** Edits the draft. Refused once published: a published review is a record. */
export async function saveReview(ctx: TenantContext, number: string, input: z.input<typeof reviewSchema>) {
  authz.require(ctx, 'incident.review.write');
  const parsed = reviewSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const { review } = await loadReview(tx, number);
    assertEditable(review);

    const updated = await tx.postIncidentReview.update({
      where: { id: review.id },
      data: {
        ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
        ...(parsed.rootCause !== undefined ? { rootCause: parsed.rootCause } : {}),
        ...(parsed.contributingFactors !== undefined ? { contributingFactors: parsed.contributingFactors } : {}),
        ...(parsed.whatWentWell !== undefined ? { whatWentWell: parsed.whatWentWell } : {}),
        ...(parsed.whatDidNot !== undefined ? { whatDidNot: parsed.whatDidNot } : {}),
        ...(parsed.dueOn ? { dueOn: parsed.dueOn } : {}),
        status: review.status === 'draft' ? 'in_review' : review.status,
      },
    });
    return updated;
  });
}

export async function addAction(ctx: TenantContext, number: string, input: z.input<typeof actionSchema>) {
  authz.require(ctx, 'incident.review.write');
  const parsed = actionSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const { review } = await loadReview(tx, number);
    assertEditable(review);

    const action = await tx.actionItem.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        reviewId: review.id,
        description: parsed.description,
        ownerId: parsed.ownerId ?? null,
        dueOn: parsed.dueOn ?? null,
        status: 'open',
      },
    });
    return action;
  });
}

export const actionUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueOn: z.coerce.date().nullable().optional(),
  /** The ticket this action became, so the work is tracked with all other work. */
  ticketId: z.string().uuid().nullable().optional(),
});

/**
 * Updates an action.
 *
 * Editable after publication, unlike the review itself: the review records what
 * happened and does not change, but whether somebody has done what they agreed
 * to is live for weeks afterwards and is the only part anybody checks later.
 */
export async function updateAction(ctx: TenantContext, actionId: string, input: z.input<typeof actionUpdateSchema>) {
  authz.require(ctx, 'incident.review.write');
  const parsed = actionUpdateSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const action = await tx.actionItem.findFirst({ where: { id: actionId } });
    if (!action) throw new NotFoundError('action item', actionId);

    const updated = await tx.actionItem.update({
      where: { id: actionId },
      data: {
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.ownerId !== undefined ? { ownerId: parsed.ownerId } : {}),
        ...(parsed.dueOn !== undefined ? { dueOn: parsed.dueOn } : {}),
        ...(parsed.ticketId !== undefined ? { ticketId: parsed.ticketId } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'incident.review.action.updated',
      targetType: 'action_item',
      targetId: actionId,
      before: { status: action.status, ownerId: action.ownerId },
      after: { status: updated.status, ownerId: updated.ownerId },
    });
    return updated;
  });
}

/**
 * Publishes the review and closes the incident, in one transaction.
 *
 * One call rather than two, because the two-call version has an obvious middle
 * state — a published review on an incident nobody closed — and that state is
 * indistinguishable from the thing this whole path exists to prevent.
 *
 * Every action needs an owner. "We should improve monitoring", owned by nobody,
 * is how the same incident happens twice, and it is the one piece of content
 * worth refusing over: unlike a root cause, an owner cannot be fudged into the
 * box to get past the check.
 */
export async function publishAndClose(ctx: TenantContext, number: string) {
  authz.require(ctx, 'incident.review.publish');

  return transaction(ctx, async (tx) => {
    const { incident, review } = await loadReview(tx, number);
    const from: IncidentState = isIncidentState(incident.status) ? incident.status : 'declared';
    assertTransition(from, 'closed');

    if (review.status === 'published') throw new ValidationError('this review has already been published');

    const actions = await tx.actionItem.findMany({ where: { reviewId: review.id } });
    const unowned = actions.filter((action) => !action.ownerId);
    if (unowned.length > 0) {
      throw new ValidationError(
        `${unowned.length} action${unowned.length === 1 ? '' : 's'} on this review ${
          unowned.length === 1 ? 'has' : 'have'
        } no owner; an action nobody owns is not an action`,
        unowned.map((action) => ({
          field: `actions.${action.id}`,
          code: 'owner_required',
          message: action.description.slice(0, 120),
        })),
      );
    }

    const now = new Date();
    const published = await tx.postIncidentReview.update({
      where: { id: review.id },
      data: { status: 'published', publishedAt: now, publishedBy: ctx.actor.id },
    });
    const closed = await tx.majorIncident.update({
      where: { id: incident.id },
      data: { status: 'closed', closedAt: incident.closedAt ?? now, version: { increment: 1 } },
    });

    await tx.majorIncidentUpdate.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        incidentId: incident.id,
        kind: 'status',
        audience: 'internal',
        body: `Review published with ${actions.length} action${actions.length === 1 ? '' : 's'}. Incident closed.`,
        statusFrom: from,
        statusTo: 'closed',
        authorId: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'incident.major.review.published',
      targetType: 'major_incident',
      targetId: incident.id,
      after: { reviewId: review.id, actionCount: actions.length },
    });
    await publish(tx, ctx, {
      definition: events.incidentMajorReviewPublished,
      aggregateId: incident.id,
      payload: {
        incidentId: incident.id,
        number: incident.number,
        severity: incident.severity,
        reviewId: review.id,
        actionCount: actions.length,
      },
    });
    await publish(tx, ctx, {
      definition: events.incidentMajorClosed,
      aggregateId: incident.id,
      payload: {
        incidentId: incident.id,
        number: incident.number,
        severity: incident.severity,
        reviewPublished: true,
      },
    });

    metrics.increment('incident_review_published_total', { severity: incident.severity });
    return { incident: closed, review: published, actions };
  });
}

/**
 * Closes without a review.
 *
 * Only for a severity whose policy does not require one — and it still says so
 * on the timeline, because "we decided not to review this" is itself a decision
 * somebody may want to ask about later.
 */
export async function closeWithoutReview(ctx: TenantContext, number: string, reason: string) {
  authz.require(ctx, 'incident.review.publish');
  if (!reason.trim()) throw new ValidationError('say why this incident is being closed without a review');

  return transaction(ctx, async (tx) => {
    const incident = await tx.majorIncident.findFirst({ where: { number } });
    if (!incident) throw new NotFoundError('major incident', number);
    const from: IncidentState = isIncidentState(incident.status) ? incident.status : 'declared';
    assertTransition(from, 'closed');

    if (reviewRequiredFor(incident.severity)) {
      throw new ValidationError(
        `a ${incident.severity} may not be closed without a published review; write the review instead`,
      );
    }

    const closed = await tx.majorIncident.update({
      where: { id: incident.id },
      data: { status: 'closed', closedAt: incident.closedAt ?? new Date(), version: { increment: 1 } },
    });
    await tx.majorIncidentUpdate.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        incidentId: incident.id,
        kind: 'status',
        audience: 'internal',
        body: `Closed without a review: ${reason}`,
        statusFrom: from,
        statusTo: 'closed',
        authorId: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'incident.major.closed',
      targetType: 'major_incident',
      targetId: incident.id,
      before: { status: from },
      after: { status: 'closed', reviewPublished: false },
      reason,
    });
    await publish(tx, ctx, {
      definition: events.incidentMajorClosed,
      aggregateId: incident.id,
      payload: {
        incidentId: incident.id,
        number: incident.number,
        severity: incident.severity,
        reviewPublished: false,
      },
    });
    return closed;
  });
}

async function loadReview(tx: Tx, number: string) {
  const incident = await tx.majorIncident.findFirst({ where: { number } });
  if (!incident) throw new NotFoundError('major incident', number);
  const review = await tx.postIncidentReview.findFirst({ where: { incidentId: incident.id } });
  if (!review) {
    throw new NotFoundError(
      'post-incident review',
      `${number} (a review opens when the incident resolves)`,
    );
  }
  return { incident, review };
}

function assertEditable(review: { status: string }): void {
  if (review.status === 'published') {
    throw new ValidationError('this review is published; it is a record now and does not change');
  }
}
