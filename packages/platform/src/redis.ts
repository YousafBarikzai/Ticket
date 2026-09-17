import { Redis } from 'ioredis';
import { loadConfig } from './config.js';

/**
 * Redis connections. Queues need `maxRetriesPerRequest: null` (BullMQ's
 * requirement); the cache connection keeps the default so a cache problem
 * surfaces quickly instead of hanging a request.
 */

/**
 * What every connection needs, whatever else it sets.
 *
 * `family: 0` is the whole of it, and it is not a tuning knob. ioredis
 * defaults to `family: 4`, so it resolves the host as IPv4 and nothing else —
 * and a managed Redis is commonly reachable only over an IPv6 private network,
 * `redis.railway.internal` among them. The client then fails to connect to a
 * server that is running, listening and correctly addressed.
 *
 * `0` means "whichever the name resolves to", which is right everywhere: the
 * IPv4 address of a local `docker compose` Redis, the IPv6 address of a
 * managed one, without either being named here.
 *
 * This cost an evening in a readiness check that said `redis: failed` while
 * the host, port, user and password were all correct — because they were, and
 * the client was never asking for the address they pointed at.
 */
const COMMON = { family: 0 } as const;

let cacheClient: Redis | undefined;
let queueClient: Redis | undefined;
let subscriberClient: Redis | undefined;

export function cache(): Redis {
  if (!cacheClient) cacheClient = new Redis(loadConfig().REDIS_URL, { ...COMMON, lazyConnect: false, enableOfflineQueue: true });
  return cacheClient;
}

export function queueConnection(): Redis {
  if (!queueClient) queueClient = new Redis(loadConfig().REDIS_URL, { ...COMMON, maxRetriesPerRequest: null });
  return queueClient;
}

export function subscriber(): Redis {
  if (!subscriberClient) subscriberClient = new Redis(loadConfig().REDIS_URL, { ...COMMON, maxRetriesPerRequest: null });
  return subscriberClient;
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([cacheClient?.quit(), queueClient?.quit(), subscriberClient?.quit()].map((p) => p?.catch(() => undefined)));
  cacheClient = undefined;
  queueClient = undefined;
  subscriberClient = undefined;
}

/** Every key is tenant-prefixed; the isolation suite scans for any that are not. */
export function tenantKey(tenantId: string, ...parts: (string | number)[]): string {
  return `t:${tenantId}:${parts.join(':')}`;
}

/**
 * A small cache-aside helper with a per-tenant namespace and a "drop the whole
 * namespace" invalidation used by config and permission changes.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const redis = cache();
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    // A cache outage must never fail a request; fall through to the loader.
  }
  const value = await load();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Ignore: the value is still correct, it simply was not cached.
  }
  return value;
}

export async function invalidatePrefix(prefix: string): Promise<number> {
  const redis = cache();
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) removed += await redis.del(...keys);
  } while (cursor !== '0');
  return removed;
}
