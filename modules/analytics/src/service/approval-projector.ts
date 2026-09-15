import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { TWENTY_FOUR_SEVEN } from '@itsm/business-time';
import { dateKey, durationsBetween } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/**
 * The approval projector.
 *
 * One number justifies this table: turnaround. An approval step is either a
 * control or a queue, and the difference is measured in how long it sits. A
 * service desk that cannot show the median turnaround cannot make the argument
 * for removing a step, which is how approval chains grow and never shrink.
 */

const PROJECTOR = 'approval';

export async function refreshApprovalFact(
  ctx: TenantContext,
  tx: Tx,
  event: EventEnvelope,
  requestId: string,
): Promise<void> {
  const request = await tx.approvalRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      policyId: true,
      subjectType: true,
      subjectId: true,
      status: true,
      outcome: true,
      requestedAt: true,
      decidedAt: true,
    },
  });
  if (!request) {
    logger.debug('approval for projection no longer exists', { requestId, type: event.type });
    return;
  }

  // Whoever cast the deciding vote, rather than whoever was asked: an approval
  // routed to four people and answered by one is a fact about that one.
  const lastDecision = request.decidedAt
    ? await tx.approvalDecision.findFirst({
        where: { step: { requestId } },
        select: { approverId: true, actedById: true },
        orderBy: { decidedAt: 'desc' },
      })
    : null;
  // The delegate where one acted, otherwise the named approver.
  const deciderId = lastDecision?.actedById ?? lastDecision?.approverId ?? null;

  const occurredAt = new Date(event.occurredAt);
  // Elapsed hours, not business hours: an approval that waits over a weekend
  // really did wait over the weekend, and the approver was not on a rota.
  const turnaround = request.decidedAt
    ? durationsBetween(request.requestedAt, request.decidedAt, TWENTY_FOUR_SEVEN).elapsedMinutes
    : null;

  await dims.ensureUser(tx, ctx.tenantId, deciderId, occurredAt);
  await dims.ensureDate(tx, dateKey(request.requestedAt));

  await facts.writeApprovalFact(tx, ctx.tenantId, {
    id: (await facts.findApprovalFact(tx, requestId))?.id,
    requestId: request.id,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    policyId: request.policyId,
    requestedDate: dateKey(request.requestedAt),
    requestedAt: request.requestedAt,
    decidedAt: request.decidedAt,
    deciderId,
    outcome: request.outcome ?? (request.status === 'pending' ? 'pending' : request.status),
    turnaroundMinutes: turnaround,
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
