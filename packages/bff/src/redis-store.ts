import Redis from 'ioredis';
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

function connection(url: string): Redis {
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

export function redisSessionStore(url: string, appName: string): SessionStore {
  const redis = connection(url);
  // Namespaced by application as well as away from the platform's own `sess:`:
  // the workbench and the portal may share a Redis, and a session identifier
  // minted for one must not resolve in the other.
  const SESSION_PREFIX = `bff:${appName}:sess:`;
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
      await redis.quit();
      clients.delete(url);
    },
  };
}

export type { Session, SessionStore };
