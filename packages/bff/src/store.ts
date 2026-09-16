import type { BffConfig } from './config.js';
import type { SessionStore } from './session.js';

/**
 * One session store per application, reused across requests.
 *
 * A module-level map rather than a value threaded through every handler,
 * because route handlers have no composition root to thread it from — and a
 * per-request store would mean a per-request Redis connection.
 *
 * Asynchronous so the Redis client is imported only when it is actually
 * needed: a test that installs its own store never loads `ioredis`, and so
 * never tries to connect to a Redis that is not running.
 */

const stores = new Map<string, SessionStore>();

export async function sessionStore(config: BffConfig): Promise<SessionStore> {
  const existing = stores.get(config.appName);
  if (existing) return existing;

  const { redisSessionStore } = await import('./redis-store.js');
  const created = redisSessionStore(config.redisUrl, config.appName);
  stores.set(config.appName, created);
  return created;
}

/** Test seam. Passing `null` forgets the store rather than installing one. */
export function setSessionStore(appName: string, replacement: SessionStore | null): void {
  if (replacement) stores.set(appName, replacement);
  else stores.delete(appName);
}
