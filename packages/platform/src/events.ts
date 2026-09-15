import type { EventDefinition, EventEnvelope } from '@itsm/contracts';
import type { TenantContext } from './context.js';
import type { Tx } from './db.js';
import { newId } from './ids.js';
import { logger, metrics } from './telemetry.js';

/**
 * The event bus (ADR-0002).
 *
 * `publish` only ever writes to the outbox table, inside the caller's
 * transaction. Nothing is sent anywhere at publish time, so an event can never
 * describe a change that was rolled back, and a crash between the write and the
 * send is impossible by construction.
 */

export interface PublishInput<D extends EventDefinition> {
  definition: D;
  aggregateId: string;
  aggregateVersion?: number;
  payload: D extends EventDefinition<infer S> ? import('zod').infer<S> : never;
  /** Overrides the envelope actor, for example when a channel acts for a user. */
  actorOverride?: EventEnvelope['actor'];
}

export async function publish<D extends EventDefinition>(tx: Tx, ctx: TenantContext, input: PublishInput<D>): Promise<string> {
  const { definition, aggregateId, payload } = input;
  const parsed = definition.payload.parse(payload);

  const id = newId();
  const envelope: EventEnvelope = {
    id,
    type: definition.type,
    version: definition.version,
    tenantId: ctx.tenantId,
    occurredAt: new Date().toISOString(),
    actor: input.actorOverride ?? ctx.actor,
    correlationId: ctx.correlationId,
    causationId: ctx.causationId ?? null,
    aggregate: {
      type: definition.aggregateType,
      id: aggregateId,
      ...(input.aggregateVersion !== undefined ? { version: input.aggregateVersion } : {}),
    },
    payload: parsed,
  };

  await tx.outboxEvent.create({
    data: {
      id,
      tenantId: ctx.tenantId,
      type: definition.type,
      version: definition.version,
      aggregateType: definition.aggregateType,
      aggregateId,
      aggregateVersion: input.aggregateVersion ?? null,
      envelope: envelope as never,
    },
  });

  metrics.increment('outbox_events_published_total', { type: definition.type });
  return id;
}

/** A registered consumer of one event type. */
export interface EventHandler {
  consumer: string;
  moduleId: string;
  eventType: string;
  /** Required consumers are re-enqueued by the reconciler if they never acknowledge. */
  required: boolean;
  handle(ctx: TenantContext, event: EventEnvelope, tx: Tx): Promise<void>;
}

const handlers: EventHandler[] = [];

export function defineHandler(handler: EventHandler): EventHandler {
  handlers.push(handler);
  return handler;
}

export function registeredHandlers(): readonly EventHandler[] {
  return handlers;
}

export function handlersFor(eventType: string): EventHandler[] {
  return handlers.filter((h) => h.eventType === eventType || (h.eventType.endsWith('*') && eventType.startsWith(h.eventType.slice(0, -1))));
}

export function consumersFor(eventType: string): string[] {
  return [...new Set(handlersFor(eventType).map((h) => h.consumer))];
}

/** Test helper: forget registered handlers. */
export function clearHandlers(): void {
  handlers.length = 0;
}

/**
 * Claims an event for a consumer. Returns false when the event was already
 * processed, which is what makes duplicate deliveries harmless.
 */
export async function claimEvent(tx: Tx, consumer: string, event: EventEnvelope): Promise<boolean> {
  const claimed = await tx.$executeRaw`
    INSERT INTO inbox_event (consumer, event_id, tenant_id, processed_at, outcome)
    VALUES (${consumer}, ${event.id}::uuid, ${event.tenantId}::uuid, now(), 'done')
    ON CONFLICT (consumer, event_id) DO NOTHING
  `;
  if (claimed === 0) {
    logger.debug('duplicate event delivery ignored', { consumer, eventId: event.id, type: event.type });
    metrics.increment('inbox_duplicates_total', { consumer });
  }
  return claimed > 0;
}
