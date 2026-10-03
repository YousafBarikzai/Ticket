import { z } from 'zod';
import { DEMO_CAP_CATEGORIES, DEMO_FEATURES, DEMO_UNAVAILABLE_REASONS } from '../demo.js';

// Every category a `demo_limit` problem can carry: the per-visit caps and the
// per-visit write budget (`DemoLimitCategory`).
const DEMO_LIMIT_CATEGORIES = [...DEMO_CAP_CATEGORIES, 'writes'] as const;

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

/**
 * RFC 9457 extension members (§3.2 of the RFC): what a client needs to act on
 * a problem without parsing its prose. The shared demo's problems carry them
 * (ADR-0054): the UI words a `demo_disabled` from `feature` and a
 * `demo_limit` from `category`, through `@itsm/contracts/demo`, so the
 * sentence a visitor reads never depends on the API's English.
 */
export const problemExtensionsSchema = z.object({
  /** Set on every problem raised by the demo's own guards. */
  demo: z.literal(true).optional(),
  /** `demo_disabled`: the shared-demo feature that is turned off. */
  feature: z.enum(DEMO_FEATURES).optional(),
  /** `demo_limit`: the cap or budget that ran out. */
  category: z.enum(DEMO_LIMIT_CATEGORIES).optional(),
  /** `demo_limit`: the figure of that cap or budget. */
  limit: z.number().int().nonnegative().optional(),
  /** `demo_unavailable`: why the demo cannot answer now. */
  reason: z.enum(DEMO_UNAVAILABLE_REASONS).optional(),
  /** When to try again, for problems that also send `Retry-After`. */
  retryAfterSec: z.number().int().nonnegative().optional(),
});
export type ProblemExtensions = z.infer<typeof problemExtensionsSchema>;

/** RFC 9457 problem details. The only error shape the API returns. */
export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    correlationId: z.string(),
    errors: z
      .array(z.object({ field: z.string(), code: z.string(), message: z.string() }))
      .optional(),
  })
  .merge(problemExtensionsSchema);
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
