import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { TWENTY_FOUR_SEVEN } from '@itsm/business-time';
import { dateKey, durationsBetween } from '../domain/durations.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';

/**
 * The notification projector.
 *
 * This one is operational rather than managerial: is the platform actually
 * reaching people? A desk whose email has been silently bouncing for a week
 * looks, in every other report, like a desk where nobody replies — so the
 * delivery figures belong next to the service figures rather than in a log
 * somebody would have to think to check.
 */

const PROJECTOR = 'notification';

export async function refreshNotificationFact(
  ctx: TenantContext,
  tx: Tx,
  event: EventEnvelope,
  notificationId: string,
  channel: string,
): Promise<void> {
  const notification = await tx.notification.findFirst({
    where: { id: notificationId },
    select: { id: true, templateKey: true, status: true, createdAt: true },
  });
  if (!notification) {
    logger.debug('notification for projection no longer exists', { notificationId, type: event.type });
    return;
  }

  // The attempt that settled it, which is the last one: a message delivered on
  // its third try was delivered, and the latency people care about is the wait
  // they actually had, not the wait the first attempt promised.
  const attempt = await tx.deliveryAttempt.findFirst({
    where: { notificationId, status: { in: ['sent', 'failed'] } },
    select: { status: true, error: true, attemptedAt: true, channel: true },
    orderBy: { attemptedAt: 'desc' },
  });

  const occurredAt = new Date(event.occurredAt);
  const sentAt = attempt?.status === 'sent' ? attempt.attemptedAt : null;
  const outcome = attempt?.status === 'sent' ? 'sent' : attempt?.status === 'failed' ? 'failed' : 'queued';

  await dims.ensureChannel(tx, ctx.tenantId, attempt?.channel ?? channel);
  await dims.ensureDate(tx, dateKey(notification.createdAt));

  await facts.writeNotificationFact(tx, ctx.tenantId, {
    id: (await facts.findNotificationFact(tx, notificationId))?.id,
    notificationId: notification.id,
    channel: attempt?.channel ?? channel,
    templateKey: notification.templateKey,
    queuedDate: dateKey(notification.createdAt),
    queuedAt: notification.createdAt,
    sentAt,
    outcome,
    failureReason: attempt?.status === 'failed' ? (attempt.error ?? 'unknown') : null,
    // Wall-clock: a notification does not wait for opening hours.
    latencyMinutes: sentAt
      ? durationsBetween(notification.createdAt, sentAt, TWENTY_FOUR_SEVEN).elapsedMinutes
      : null,
    lastEventId: event.id,
    lastEventAt: occurredAt,
  });

  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);
  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}
