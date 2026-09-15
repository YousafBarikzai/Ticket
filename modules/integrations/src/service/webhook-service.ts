import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EventEnvelope } from '@itsm/contracts';
import {
  type TenantContext,
  authz,
  enqueue,
  logger,
  metrics,
  newId,
  NotFoundError,
  publish,
  recordAudit,
  transaction,
  ValidationError,
} from '@itsm/platform';
import { evaluate, events, findEvent, type Expr } from '@itsm/contracts';

/**
 * Webhooks (MOD-14-E2b).
 *
 * Signed with HMAC-SHA256 over a timestamp and the body, so a recipient can
 * reject a replayed delivery as well as a forged one. Retried with exponential
 * backoff for up to 24 hours, then dead-lettered and surfaced to the owner.
 */

const MAX_ATTEMPTS = 12;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function verifySignature(secret: string, body: string, header: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const provided = Buffer.from(parts.v1 ?? '', 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function createSubscription(
  ctx: TenantContext,
  input: { name: string; url: string; eventTypes: string[]; filters?: Expr; orgId?: string },
) {
  authz.require(ctx, 'webhook.manage');

  const url = new URL(input.url);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new ValidationError('webhook URLs must use https');
  }
  // Only events that exist, and only events external subscribers may receive.
  for (const type of input.eventTypes) {
    const definition = findEvent(type);
    if (!definition) throw new ValidationError(`unknown event type: ${type}`);
    if (!definition.webhook) throw new ValidationError(`${type} is an internal event and cannot be sent to a webhook`);
  }

  return transaction(ctx, async (tx) => {
    const id = newId();
    const secret = randomBytes(32).toString('hex');
    const subscription = await tx.webhookSubscription.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        orgId: input.orgId ?? null,
        name: input.name,
        url: input.url,
        secret,
        eventTypes: input.eventTypes,
        filters: (input.filters ?? null) as never,
        status: 'active',
        ownerId: ctx.actor.id,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'webhook.subscription.created',
      targetType: 'webhook_subscription',
      targetId: id,
      after: { name: input.name, url: input.url, eventTypes: input.eventTypes },
    });
    // The secret is returned exactly once, at creation.
    return { ...subscription, secret };
  });
}

export async function listSubscriptions(ctx: TenantContext) {
  authz.require(ctx, 'webhook.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.webhookSubscription.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(({ secret: _secret, ...rest }) => rest);
  });
}

export async function deleteSubscription(ctx: TenantContext, id: string) {
  authz.require(ctx, 'webhook.manage');
  return transaction(ctx, async (tx) => {
    const subscription = await tx.webhookSubscription.findFirst({ where: { id } });
    if (!subscription) throw new NotFoundError('webhook subscription', id);
    await tx.webhookSubscription.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: 'webhook.subscription.deleted', targetType: 'webhook_subscription', targetId: id, before: { url: subscription.url } });
  });
}

/** Queues one delivery per matching subscription. */
export async function fanOut(ctx: TenantContext, envelope: EventEnvelope): Promise<number> {
  const definition = findEvent(envelope.type);
  if (!definition?.webhook) return 0;

  return transaction(ctx, async (tx) => {
    const subscriptions = await tx.webhookSubscription.findMany({
      where: { status: 'active', eventTypes: { has: envelope.type } },
    });

    let queued = 0;
    for (const subscription of subscriptions) {
      if (subscription.filters) {
        const context = { event: envelope, payload: envelope.payload, now: envelope.occurredAt };
        try {
          if (!evaluate(subscription.filters as Expr, context)) continue;
        } catch (error) {
          logger.warn('webhook filter could not be evaluated; skipping', {
            subscriptionId: subscription.id,
            error: (error as Error).message,
          });
          continue;
        }
      }

      const deliveryId = newId();
      await tx.webhookDelivery.create({
        data: {
          id: deliveryId,
          tenantId: ctx.tenantId,
          subscriptionId: subscription.id,
          eventId: envelope.id,
          eventType: envelope.type,
          status: 'pending',
          nextAttemptAt: new Date(),
        },
      });
      await enqueue(ctx, 'webhooks', 'webhook.deliver', { deliveryId }, { idempotencyKey: `deliver-${deliveryId}` });
      queued += 1;
    }
    return queued;
  });
}

export type HttpSender = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number; ok: boolean }>;

const defaultSender: HttpSender = async (url, body, headers) => {
  const response = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, ok: response.ok };
};

let sender: HttpSender = defaultSender;

export function setHttpSender(next: HttpSender): void {
  sender = next;
}

function backoffMs(attempt: number): number {
  // 2s, 8s, 32s ... capped at an hour; twelve attempts span just over a day.
  return Math.min(3_600_000, 2000 * 4 ** (attempt - 1));
}

export async function deliverWebhook(ctx: TenantContext, deliveryId: string): Promise<'sent' | 'retry' | 'dead'> {
  const loaded = await transaction(ctx, async (tx) => {
    const delivery = await tx.webhookDelivery.findFirst({ where: { id: deliveryId } });
    if (!delivery) return null;
    const subscription = await tx.webhookSubscription.findFirst({ where: { id: delivery.subscriptionId } });
    if (!subscription) return null;
    const outbox = await tx.outboxEvent.findFirst({ where: { id: delivery.eventId } });
    return { delivery, subscription, envelope: outbox?.envelope as EventEnvelope | undefined };
  });

  if (!loaded?.envelope) {
    logger.warn('webhook delivery has no event to send', { deliveryId });
    return 'dead';
  }

  const { delivery, subscription, envelope } = loaded;
  const body = JSON.stringify(envelope);
  const headers = {
    'Content-Type': 'application/json',
    'X-Signature': signPayload(subscription.secret, body),
    'X-Event-Type': envelope.type,
    'X-Event-Id': envelope.id,
    'X-Correlation-Id': envelope.correlationId,
  };

  const started = performance.now();
  let status = 0;
  let ok = false;
  let error: string | null = null;
  try {
    const response = await sender(subscription.url, body, headers);
    status = response.status;
    ok = response.ok;
  } catch (caught) {
    error = (caught as Error).message;
  }
  const latencyMs = Math.round(performance.now() - started);
  metrics.observe('webhook_delivery_ms', latencyMs, { outcome: ok ? 'ok' : 'error' });

  if (ok) {
    await transaction(ctx, async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'sent', responseCode: status, latencyMs, nextAttemptAt: null },
      });
      await tx.webhookSubscription.update({ where: { id: subscription.id }, data: { failureCount: 0 } });
    });
    return 'sent';
  }

  const attempt = delivery.attempt + 1;
  const dead = attempt > MAX_ATTEMPTS;

  await transaction(ctx, async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: dead ? 'dead' : 'pending',
        attempt,
        responseCode: status || null,
        latencyMs,
        error,
        nextAttemptAt: dead ? null : new Date(Date.now() + backoffMs(attempt)),
      },
    });
    const failures = subscription.failureCount + 1;
    await tx.webhookSubscription.update({
      where: { id: subscription.id },
      // A subscription that has failed a hundred times in a row is almost
      // certainly gone; pausing it stops the worker burning retries on it.
      data: { failureCount: failures, ...(failures >= 100 ? { status: 'paused' } : {}) },
    });

    if (dead) {
      await publish(tx, ctx, {
        definition: events.webhookDeliveryFailed,
        aggregateId: subscription.id,
        payload: { subscriptionId: subscription.id, eventId: envelope.id, attempts: attempt, lastStatus: status || null },
      });
    }
  });

  if (!dead) {
    await enqueue(ctx, 'webhooks', 'webhook.deliver', { deliveryId }, { delay: backoffMs(attempt), idempotencyKey: `deliver-${deliveryId}-${attempt}` });
  }
  return dead ? 'dead' : 'retry';
}

export async function redeliver(ctx: TenantContext, deliveryId: string): Promise<void> {
  authz.require(ctx, 'webhook.manage');
  await transaction(ctx, async (tx) => {
    const delivery = await tx.webhookDelivery.findFirst({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundError('webhook delivery', deliveryId);
    await tx.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'pending', attempt: 1, nextAttemptAt: new Date() } });
  });
  await enqueue(ctx, 'webhooks', 'webhook.deliver', { deliveryId }, { idempotencyKey: `redeliver-${deliveryId}-${Date.now()}` });
}
