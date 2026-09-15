import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { dateKey } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/**
 * The survey projector — the one E1a left out because MOD-18 did not exist.
 *
 * It reads the response row rather than the payload, like every other
 * projector, and takes the team and service from the ticket at the time of
 * projection. A satisfaction score is about the ticket the person was asked
 * about, so the ticket's team is the team that earned it.
 */

const PROJECTOR = 'survey';

export async function refreshSurveyFact(ctx: TenantContext, tx: Tx, event: EventEnvelope, responseId: string): Promise<void> {
  const response = await tx.surveyResponse.findFirst({
    where: { id: responseId },
    select: { id: true, surveyId: true, ticketId: true, respondentId: true, score: true, scale: true, comment: true, respondedAt: true },
  });
  if (!response) {
    logger.debug('survey response for projection no longer exists', { responseId, type: event.type });
    return;
  }

  const ticket = response.ticketId
    ? await tx.ticket.findFirst({ where: { id: response.ticketId }, select: { groupId: true, serviceId: true } })
    : null;
  const occurredAt = new Date(event.occurredAt);

  await dims.ensureTeam(tx, ctx.tenantId, ticket?.groupId ?? null);
  await dims.ensureService(tx, ctx.tenantId, ticket?.serviceId ?? null);
  await dims.ensureUser(tx, ctx.tenantId, response.respondentId, occurredAt);
  await dims.ensureDate(tx, dateKey(response.respondedAt));

  await facts.writeSurveyFact(tx, ctx.tenantId, {
    id: (await facts.findSurveyFact(tx, responseId))?.id,
    responseId: response.id,
    surveyId: response.surveyId,
    ticketId: response.ticketId,
    respondentId: response.respondentId,
    teamId: ticket?.groupId ?? null,
    serviceId: ticket?.serviceId ?? null,
    respondedDate: dateKey(response.respondedAt),
    respondedAt: response.respondedAt,
    score: response.score,
    scale: response.scale,
    comment: response.comment,
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
