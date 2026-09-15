import { Redis } from 'ioredis';
import { loadConfig } from './config.js';

/**
 * Redis connections. Queues need `maxRetriesPerRequest: null` (BullMQ's
 * requirement); the cache connection keeps the default so a cache problem
 * surfaces quickly instead of hanging a request.
 */
let cacheClient: Redis | undefined;
let queueClient: Redis | undefined;
let subscriberClient: Redis | undefined;

export function cache(): Redis {
  if (!cacheClient) cacheClient = new Redis(loadConfig().REDIS_URL, { lazyConnect: false, enableOfflineQueue: true });
  return cacheClient;
}

export function queueConnection(): Redis {
  if (!queueClient) queueClient = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
  return queueClient;
}

export function subscriber(): Redis {
  if (!subscriberClient) subscriberClient = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
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
