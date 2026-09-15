import { config } from './config.js';
import type { SessionStore } from './session.js';

/**
 * The one session store the running app uses.
 *
 * A module-level singleton rather than a value threaded through every handler,
 * because Next route handlers have no composition root to thread it from — and
 * a per-request store would mean a per-request Redis connection.
 *
 * Asynchronous so the Redis client is imported only when it is actually
 * needed: a test that installs its own store never loads `ioredis`, and so
 * never tries to connect to a Redis that is not running.
 */

let store: SessionStore | null = null;

export async function sessionStore(): Promise<SessionStore> {
  if (!store) {
    const { redisSessionStore } = await import('./redis-store.js');
    store = redisSessionStore(config().redisUrl);
  }
  return store;
}

/** Test seam. */
export function setSessionStore(replacement: SessionStore | null): void {
  store = replacement;
}
