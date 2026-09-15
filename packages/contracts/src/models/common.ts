import { z } from 'zod';

/** Who performed an action. Every audit row and event envelope carries one. */
export const actorTypeSchema = z.enum(['user', 'api_key', 'integration', 'workflow', 'ai', 'system', 'scheduler', 'channel']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const actorSchema = z.object({
  type: actorTypeSchema,
  id: z.string().nullable(),
  displayName: z.string().max(200).optional(),
  /** Set when a person acted through a delegate, an impersonation or a channel. */
  onBehalfOf: z.string().nullable().optional(),
  /** Set when an MSP tenant acts inside a client tenant under an explicit grant. */
  granteeTenantId: z.string().nullable().optional(),
});
export type Actor = z.infer<typeof actorSchema>;

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** RFC 9457 problem details. The only error shape the API returns. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  correlationId: z.string(),
  errors: z
    .array(z.object({ field: z.string(), code: z.string(), message: z.string() }))
    .optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** Cursor pagination: the only pagination the API offers. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

export const sortSchema = z.string().regex(/^-?[a-zA-Z][a-zA-Z0-9.]*(,-?[a-zA-Z][a-zA-Z0-9.]*)*$/);

/** Data-classification levels, used for masking, logging and AI context assembly. */
export const classificationSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);
export type Classification = z.infer<typeof classificationSchema>;
