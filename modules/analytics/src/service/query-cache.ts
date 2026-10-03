import { createHash } from 'node:crypto';
import { authz, cache, logger, metrics, tenantKey, type TenantContext } from '@itsm/platform';

/**
 * The metric answer cache (A8 R4c).
 *
 * Page time is dominated by round trips to the API, and the shared demo sends
 * every visitor's identical dashboard questions to the same tenant. So an
 * answer is kept for `ANALYTICS_QUERY_CACHE_SECONDS` and handed to the next
 * caller who may see exactly the same thing.
 *
 * Nothing is ever invalidated by finding it. Every entry's key carries the
 * tenant's **version**, and every write to the facts moves the version on, so
 * one `INCR` makes every older answer unreachable and the TTL clears it away.
 *
 * | Key | Holds | Lives |
 * |---|---|---|
 * | `t:{tenantId}:aq:v` | the version | 7 days, renewed by every bump (a nightly demo generation is a new tenant, so its key must not outlive it) |
 * | `t:{tenantId}:aq:{version}:{hash}` | one answer, as JSON | `ANALYTICS_QUERY_CACHE_SECONDS` |
 * | `t:{tenantId}:aq:settling` | "a bump may not have committed yet" | `QUERY_SETTLE_MS` |
 *
 * The third key exists because the projection handlers cannot see their own
 * commit: they run inside the event dispatcher's transaction and bump as
 * their last statement, a moment before it commits. A reader who picked up
 * the new version in that moment could read the old facts and store them
 * under the new version, where they would be served until the TTL ran out.
 * So no answer is stored while a bump is younger than the settle window, or
 * if the version moved while it was being worked out: an answer is cached
 * only when nothing could have changed underneath it.
 *
 * A Redis outage never fails a question; it only makes every answer a miss.
 */

/** The version key's life: long enough to outlast any entry, short enough that a purged tenant's key goes too (Y-m11). */
export const QUERY_VERSION_TTL_SECONDS = 604_800;

/**
 * How long after a bump no answer is stored. Several times what a commit
 * takes; while it lasts readers still get answers, they are simply not kept.
 */
export const QUERY_SETTLE_MS = 3_000;

type CacheClient = ReturnType<typeof cache>;

let override: CacheClient | null = null;

/** Test seam: the unit tests run the cache against an in-memory Redis. */
export function setQueryCacheClient(client: CacheClient | null): void {
  override = client;
}

function client(): CacheClient {
  return override ?? cache();
}

export function versionKey(tenantId: string): string {
  return tenantKey(tenantId, 'aq', 'v');
}

export function settleKey(tenantId: string): string {
  return tenantKey(tenantId, 'aq', 'settling');
}

export function entryKey(tenantId: string, version: string, hash: string): string {
  return tenantKey(tenantId, 'aq', version, hash);
}

/**
 * Who may share an answer.
 *
 * The only thing `evaluate` takes from the caller is their analytics scope —
 * the whole tenant, or the teams a lead is in — so that, and nothing about
 * the person, is what an entry is keyed by: two leads of the same team share
 * an answer, a lead and an administrator never do, nor leads of different
 * teams. `null` for a caller with no analytics at all, who is refused before
 * any cache is asked.
 */
export function scopeKeyFor(ctx: TenantContext): string | null {
  const scope = authz.effectiveScope(ctx, 'analytics.read');
  if (scope === 'any') return 'any';
  if (scope === 'team') return `team:${[...new Set(ctx.teamIds)].sort().join(',')}`;
  return null;
}

function sortedKeys(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, sortedKeys(record[key])]),
    );
  }
  return value;
}

/**
 * JSON with every object's keys in order, so two spellings of one question
 * hash alike. Arrays keep their order: a filter's list of values is the
 * caller's, and reordering it is not this function's business.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedKeys(value));
}

export interface QueryIdentity {
  /** `scopeKeyFor(ctx)`. */
  scope: string;
  /** The parsed query, defaults applied. */
  query: unknown;
  /** The resolved period: a new day is a new period, and so a new key. */
  period: { from: Date; to: Date };
  bucket: string;
}

/** The first 32 hex digits of SHA-256 over everything the answer depends on. */
export function queryHash(identity: QueryIdentity): string {
  const material = canonicalJson({
    scope: identity.scope,
    query: identity.query,
    from: identity.period.from.toISOString(),
    to: identity.period.to.toISOString(),
    bucket: identity.bucket,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

interface Snapshot {
  version: string;
  settling: boolean;
}

async function snapshot(redis: CacheClient, tenantId: string): Promise<Snapshot> {
  const [version, settling] = await redis.mget(versionKey(tenantId), settleKey(tenantId));
  return { version: version ?? '0', settling: settling !== null };
}

/**
 * An answer from the cache, or from `load` and then kept.
 *
 * `load` must return plain JSON (no `Date`s): a hit is what `JSON.parse`
 * gives back, and a caller must not be able to tell a hit from a miss.
 */
export async function readThrough<T>(tenantId: string, hash: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  if (ttlSeconds <= 0) return load();
  const redis = client();

  let before: Snapshot;
  try {
    before = await snapshot(redis, tenantId);
  } catch (error) {
    metrics.increment('analytics_query_cache_total', { outcome: 'unavailable' });
    logger.debug('metric cache unavailable; answering uncached', { error: (error as Error).message });
    return load();
  }

  const key = entryKey(tenantId, before.version, hash);
  try {
    const hit = await redis.get(key);
    if (hit !== null) {
      const answer = JSON.parse(hit) as T;
      metrics.increment('analytics_query_cache_total', { outcome: 'hit' });
      return answer;
    }
  } catch {
    // An unreadable entry is a miss; the answer below replaces it.
  }

  metrics.increment('analytics_query_cache_total', { outcome: 'miss' });
  const answer = await load();
  if (before.settling) return answer;

  try {
    const after = await snapshot(redis, tenantId);
    if (after.version === before.version && !after.settling) {
      await redis.set(key, JSON.stringify(answer), 'EX', ttlSeconds);
    }
  } catch {
    // The answer is still right; it simply is not kept.
  }
  return answer;
}

/**
 * Moves the tenant's version on, so every cached answer is out of date.
 *
 * Called after anything that changes what a metric would say: a projection
 * write, a rollup rebuild, a replay, a metric definition change. It never
 * throws — a write must not fail because a cache could not be told about it —
 * and a bump that is lost costs at most one TTL of a stale answer.
 */
export async function bumpQueryVersion(tenantId: string): Promise<void> {
  try {
    const key = versionKey(tenantId);
    await client()
      .multi()
      .incr(key)
      .expire(key, QUERY_VERSION_TTL_SECONDS)
      .set(settleKey(tenantId), '1', 'PX', QUERY_SETTLE_MS)
      .exec();
    metrics.increment('analytics_query_version_bumps_total');
  } catch (error) {
    metrics.increment('analytics_query_version_bump_failures_total');
    logger.warn('could not move the metric cache version on; cached answers may lag by up to their lifetime', {
      tenantId,
      error: (error as Error).message,
    });
  }
}

const bumped = new WeakSet<object>();

/**
 * The projection handlers' bump: once per transaction.
 *
 * The event dispatcher runs one event per transaction, so this is one bump
 * per projected event. A replay hands a whole batch of events to the handlers
 * in one transaction, and one bump covers it — the replay bumps again when
 * it has finished, which is what makes the batch visible.
 */
export async function bumpQueryVersionFor(tx: object, tenantId: string): Promise<void> {
  if (bumped.has(tx)) return;
  bumped.add(tx);
  await bumpQueryVersion(tenantId);
}
