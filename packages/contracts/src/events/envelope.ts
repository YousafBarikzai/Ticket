import { z } from 'zod';
import { actorSchema } from '../models/common.js';

/**
 * The event envelope. Identical for internal delivery, webhooks and any future
 * bus transport, so a consumer written today keeps working after extraction.
 * See docs/architecture/07-eventing-and-integration.md §1.
 */
export const eventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(3).max(100),
  version: z.number().int().min(1),
  tenantId: z.string().uuid(),
  occurredAt: z.string(),
  actor: actorSchema,
  correlationId: z.string(),
  causationId: z.string().nullable().optional(),
  aggregate: z.object({
    type: z.string(),
    id: z.string(),
    version: z.number().int().optional(),
  }),
  payload: z.unknown(),
  meta: z
    .object({
      source: z.enum(['api', 'worker', 'import', 'replay', 'channel', 'seed']).optional(),
      channel: z.string().optional(),
    })
    .optional(),
});

export type EventEnvelope<T = unknown> = Omit<z.infer<typeof eventEnvelopeSchema>, 'payload'> & { payload: T };

/** Declares one event type: its name, payload schema, aggregate and webhook eligibility. */
export interface EventDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  version: number;
  aggregateType: string;
  payload: S;
  /** Whether external subscribers may receive this event (specification §6). */
  webhook: boolean;
  description: string;
}

export function defineEvent<S extends z.ZodTypeAny>(def: EventDefinition<S>): EventDefinition<S> {
  return def;
}

export type PayloadOf<D> = D extends EventDefinition<infer S> ? z.infer<S> : never;
