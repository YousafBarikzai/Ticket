import { z } from 'zod';
import {
  type TenantContext,
  NotFoundError,
  authz,
  cached,
  getSetting,
  invalidatePrefix,
  metrics,
  tenantKey,
  transaction,
} from '@itsm/platform';
import {
  DEFAULT_DEPTH,
  IMPACT_EDGES,
  MAX_DEPTH,
  dependenciesOf,
  impactOf,
  type GraphNode,
} from '../repo/graph-repo.js';
import { RELATIONSHIP_TYPES, carriesImpact, summarise, type ImpactSummary } from '../domain/relationships.js';

/**
 * "What falls over if this goes?" — and its mirror, "what does this need?".
 *
 * The only question the CMDB exists to answer quickly, which is why it is the
 * one thing in this module with a performance target attached: under a second
 * at 100 000 configuration items and 500 000 relationships, at depth 3
 * (docs/architecture/18 §1). The three mechanisms that meet it are a depth
 * bound, typed-edge indexes, and this cache.
 */

export const impactQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(MAX_DEPTH).optional(),
  /** Restrict to particular edge types; defaults to every type that carries impact. */
  types: z.array(z.enum(RELATIONSHIP_TYPES)).min(1).optional(),
});
export type ImpactQuery = z.input<typeof impactQuerySchema>;

export interface ImpactResult {
  ci: { id: string; name: string; status: string; criticality: string; serviceId: string | null };
  depth: number;
  types: string[];
  nodes: GraphNode[];
  summary: ImpactSummary;
}

/** 60 seconds, from doc 06 §2.4. */
export const IMPACT_CACHE_SECONDS = 60;

function edgesFor(types: readonly string[] | undefined): string[] {
  if (!types || types.length === 0) return [...IMPACT_EDGES];
  // A caller asking explicitly for `connected_to` gets it. The default excludes
  // it because it reaches everything; an explicit request is somebody who knows
  // that and wants it anyway.
  return [...types];
}

async function traverse(
  ctx: TenantContext,
  ciId: string,
  query: ImpactQuery | undefined,
  direction: 'impact' | 'dependencies',
): Promise<ImpactResult> {
  authz.require(ctx, 'cmdb.read');
  const parsed = impactQuerySchema.parse(query ?? {});
  // A tenant with a flat estate may want four; one with a dense one may want
  // two, because beyond three hops an answer tends to reach everything and
  // stops being an answer.
  const configured = await getSetting<number>(ctx, 'cmdb.impactDepth');
  const depth = parsed.depth ?? (configured && configured >= 1 && configured <= MAX_DEPTH ? configured : DEFAULT_DEPTH);
  const types = edgesFor(parsed.types).sort();

  return transaction(ctx, async (tx) => {
    const ci = await tx.configurationItem.findFirst({
      where: { id: ciId },
      select: { id: true, name: true, status: true, criticality: true, serviceId: true },
    });
    if (!ci) throw new NotFoundError('configuration item', ciId);

    // The cache key carries everything that changes the answer. A key that
    // ignored depth or edge types would serve a depth-1 answer to a depth-5
    // question, which is worse than no cache: it is wrong and it looks right.
    const key = tenantKey(ctx.tenantId, 'impact', direction, ciId, depth, types.join('+'));
    const started = Date.now();
    const nodes = await cached(key, IMPACT_CACHE_SECONDS, () =>
      direction === 'impact'
        ? impactOf(tx, ctx.tenantId, ciId, depth, types)
        : dependenciesOf(tx, ctx.tenantId, ciId, depth, types),
    );
    metrics.observe('cmdb_traversal_ms', Date.now() - started, { direction });

    return { ci, depth, types, nodes, summary: summarise(nodes, depth) };
  });
}

/** What falls over if this configuration item does. */
export function impact(ctx: TenantContext, ciId: string, query?: ImpactQuery): Promise<ImpactResult> {
  return traverse(ctx, ciId, query, 'impact');
}

/** What this configuration item needs in order to work. */
export function dependencies(ctx: TenantContext, ciId: string, query?: ImpactQuery): Promise<ImpactResult> {
  return traverse(ctx, ciId, query, 'dependencies');
}

/**
 * Drops every cached traversal for a tenant.
 *
 * Called whenever a relationship is written, because one new edge can change
 * the answer for any configuration item on either side of it, at any depth —
 * there is no cheap way to work out which cached answers it invalidated, and a
 * stale impact answer is the specific failure this module cannot afford.
 *
 * Cheap, because the cache holds a minute of answers at most: after a bulk
 * import the first few questions are slow and then it is warm again. That trade
 * is the right way round — imports are rare and impact questions are asked when
 * something is on fire.
 */
export async function invalidateTraversals(tenantId: string): Promise<void> {
  try {
    await invalidatePrefix(tenantKey(tenantId, 'impact'));
  } catch {
    // A cache that cannot be cleared must not fail the write that cleared it.
    // The entries expire within a minute regardless, which is the guarantee
    // the TTL is there to provide.
  }
}

export { carriesImpact, DEFAULT_DEPTH, MAX_DEPTH, type GraphNode };
