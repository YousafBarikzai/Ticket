import Redis from 'ioredis';
import { sessionRecordKey } from './demo/store.js';
import { decodeSession, encodeSession, type PendingLogin, type Session, type SessionStore } from './session.js';

/**
 * The Redis-backed session store.
 *
 * Kept in its own file so that importing the store interface — which the tests
 * and the pure logic do — does not pull a Redis client into the bundle.
 *
 * Keys are namespaced away from the platform's own (`sess:` there,
 * `bff:<app>:sess:` here) because the two hold different things for different
 * lifetimes and a shared prefix invites one to expire the other.
 */

const clients = new Map<string, Redis>();

/**
 * The process's one connection to a Redis URL, shared by the session store
 * and the demo token store (`demo/redis-store.ts`): both are per-app stores
 * in the same process, and the demo's re-mint swaps session records in the
 * same keyspace.
 */
export function redisConnection(url: string): Redis {
  // One connection per URL, reused across requests: route handlers run in the
  // same process, and a client per request exhausts the connection limit long
  // before it exhausts anything else.
  let client = clients.get(url);
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    clients.set(url, client);
  }
  return client;
}

/** Closes the shared connection to `url`; the next `redisConnection(url)` opens a new one. */
export async function closeRedisConnection(url: string): Promise<void> {
  const client = clients.get(url);
  if (!client) return;
  clients.delete(url);
  await client.quit();
}

export function redisSessionStore(url: string, appName: string): SessionStore {
  const redis = redisConnection(url);
  // Namespaced by application as well as away from the platform's own `sess:`:
  // the workbench and the portal may share a Redis, and a session identifier
  // minted for one must not resolve in the other. The format is the demo
  // store's too (`sessionRecordKey`), because its re-mint swaps these records.
  const SESSION_PREFIX = sessionRecordKey(appName, '');
  const PENDING_PREFIX = `bff:${appName}:login:`;

  return {
    async get(id) {
      return decodeSession(await redis.get(`${SESSION_PREFIX}${id}`));
    },
    async put(session, ttlSeconds) {
      await redis.set(`${SESSION_PREFIX}${session.id}`, encodeSession(session), 'EX', ttlSeconds);
    },
    async delete(id) {
      await redis.del(`${SESSION_PREFIX}${id}`);
    },
    async putPending(state, pending, ttlSeconds) {
      await redis.set(`${PENDING_PREFIX}${state}`, JSON.stringify(pending), 'EX', ttlSeconds);
    },
    async takePending(state) {
      // GETDEL rather than GET then DEL: two commands leave a window in which a
      // replayed callback finds the record still there, which is the replay the
      // `state` parameter exists to prevent.
      const raw = await redis.getdel(`${PENDING_PREFIX}${state}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as PendingLogin;
        return typeof parsed?.verifier === 'string' ? parsed : null;
      } catch {
        return null;
      }
    },
    async close() {
      await closeRedisConnection(url);
    },
  };
}

export type { Session, SessionStore };
