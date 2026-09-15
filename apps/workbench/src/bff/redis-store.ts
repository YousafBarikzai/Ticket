import Redis from 'ioredis';
import { decodeSession, encodeSession, type PendingLogin, type Session, type SessionStore } from './session.js';

/**
 * The Redis-backed session store.
 *
 * Kept in its own file so that importing the store interface — which the tests
 * and the pure logic do — does not pull a Redis client into the bundle.
 *
 * Keys are namespaced away from the platform's own (`sess:` there, `wb:sess:`
 * here) because the two hold different things for different lifetimes and a
 * shared prefix invites one to expire the other.
 */

const SESSION_PREFIX = 'wb:sess:';
const PENDING_PREFIX = 'wb:login:';

let client: Redis | null = null;

function connection(url: string): Redis {
  // One connection per process, reused across requests: Next's route handlers
  // run in the same process, and a client per request exhausts the connection
  // limit long before it exhausts anything else.
  client ??= new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  return client;
}

export function redisSessionStore(url: string): SessionStore {
  const redis = connection(url);

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
      await redis.quit();
      client = null;
    },
  };
}

export type { Session, SessionStore };
