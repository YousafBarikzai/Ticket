import { randomUUID, randomBytes } from 'node:crypto';

/**
 * Where the tokens live.
 *
 * The browser holds an opaque identifier and nothing else (doc 14 §3). The
 * access token, the refresh token and the tenant they belong to stay in Redis,
 * keyed by that identifier, so a cross-site scripting bug in a component
 * cannot read a bearer token and an attacker who steals the cookie loses it
 * the moment the session is revoked server-side.
 *
 * The store is an interface with two implementations because the BFF's own
 * tests must not need a Redis, and because a session store is precisely the
 * sort of thing that grows a second backing later.
 */

export interface Session {
  readonly id: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds. */
  readonly accessExpiresAt: number;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly createdAt: number;
}

export interface SessionStore {
  get(id: string): Promise<Session | null>;
  put(session: Session, ttlSeconds: number): Promise<void>;
  delete(id: string): Promise<void>;
  /** The short-lived record that carries a login across the redirect to the provider. */
  putPending(state: string, pending: PendingLogin, ttlSeconds: number): Promise<void>;
  /** Single use: reading it removes it, so a replayed callback finds nothing. */
  takePending(state: string): Promise<PendingLogin | null>;
  close(): Promise<void>;
}

export interface PendingLogin {
  readonly verifier: string;
  readonly redirectTo: string;
  readonly createdAt: number;
}

/** 256 bits of identifier: guessing one is the whole attack. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Refresh before the token expires rather than after. A request that leaves
 * with sixty seconds of life left can still arrive expired, and the resulting
 * 401 looks to the user like being signed out at random.
 */
export function needsRefresh(session: Session, now = Date.now(), skewSeconds = 60): boolean {
  return session.accessExpiresAt - skewSeconds * 1000 <= now;
}

/**
 * A stored record is untrusted input: Redis can be shared, keys collide, and a
 * half-written value is a plausible failure. Anything that is not a complete
 * session reads as no session, which signs the person in again rather than
 * carrying a malformed token into a request.
 */
export function decodeSession(raw: string | null): Session | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.accessToken !== 'string' || value.accessToken.length === 0) return null;
  if (typeof value.tenantId !== 'string' || value.tenantId.length === 0) return null;
  if (typeof value.accessExpiresAt !== 'number' || !Number.isFinite(value.accessExpiresAt)) return null;
  return {
    id: value.id,
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
    accessExpiresAt: value.accessExpiresAt,
    tenantId: value.tenantId,
    userId: typeof value.userId === 'string' ? value.userId : null,
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
  };
}

export function encodeSession(session: Session): string {
  return JSON.stringify(session);
}

export function memorySessionStore(): SessionStore {
  const sessions = new Map<string, { value: string; expiresAt: number }>();
  const pending = new Map<string, { value: PendingLogin; expiresAt: number }>();

  const live = <T,>(entry: { expiresAt: number; value: T } | undefined, now: number): T | null =>
    entry && entry.expiresAt > now ? entry.value : null;

  return {
    async get(id) {
      return decodeSession(live(sessions.get(id), Date.now()));
    },
    async put(session, ttlSeconds) {
      sessions.set(session.id, { value: encodeSession(session), expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async delete(id) {
      sessions.delete(id);
    },
    async putPending(state, value, ttlSeconds) {
      pending.set(state, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async takePending(state) {
      const found = live(pending.get(state), Date.now());
      pending.delete(state);
      return found;
    },
    async close() {
      sessions.clear();
      pending.clear();
    },
  };
}
