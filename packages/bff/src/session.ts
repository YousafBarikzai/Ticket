import { randomUUID, randomBytes } from 'node:crypto';
import { DEMO_SID_PATTERN, isDemoPersonaKey, isDemoTokenShape, type DemoPersonaKey } from '@itsm/contracts/demo';

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

/**
 * How a session began (SPEC §4.5, A3 §5.5). `oidc`: the identity provider's
 * callback. `dev`: the development form. `demo`: a minted demo token, which is
 * never refreshed, never recorded with the API and ends when its token does.
 */
export type SessionKind = 'oidc' | 'dev' | 'demo';

export const SESSION_KINDS: readonly SessionKind[] = Object.freeze(['oidc', 'dev', 'demo'] as const);

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
  readonly kind: SessionKind;
  /** Demo only: the persona this app mints (`mayMint`). */
  readonly persona?: DemoPersonaKey;
  /** Demo only: the generation the current token was minted for. */
  readonly demoGeneration?: number;
  /** Demo only: the visit, `demo-<uuid>`; stable across re-mints. */
  readonly demoSid?: string;
  /**
   * Demo only: the real session this demo replaced on this device (critique
   * S12). It comes back when the demo ends — on "End demo" (O2), and when the
   * visit ends by itself (X3, F6, F7) while it is still live.
   */
  readonly parkedSessionId?: string;
  /** Demo only: when `touch` last moved this token's last-use score (epoch ms). */
  readonly lastTouchAt?: number;
}

/** A session the demo minted, with the fields `decodeSession` guarantees for that kind. */
export type DemoSession = Session & {
  readonly kind: 'demo';
  readonly persona: DemoPersonaKey;
  readonly demoGeneration: number;
  readonly demoSid: string;
};

export function isDemoSession(session: Session | null | undefined): session is DemoSession {
  return session?.kind === 'demo';
}

/** A person's own sign-in: through the provider, or the development form. */
export type RealSession = Session & { readonly kind: 'oidc' | 'dev' };

/**
 * A person's own sign-in — through the provider or the development form — as
 * opposed to a demo visit. "A real sign-in always wins" (D22) is about these.
 */
export function isRealSession(session: Session | null | undefined): session is RealSession {
  return session?.kind === 'oidc' || session?.kind === 'dev';
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
 * A timestamp as stored. The demo scripts rewrite the record in Lua, whose
 * JSON round trip may hand a number back as a string; both read the same.
 */
function epochMs(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

/**
 * A stored record is untrusted input: Redis can be shared, keys collide, and a
 * half-written value is a plausible failure. Anything that is not a complete
 * session reads as no session, which signs the person in again rather than
 * carrying a malformed token into a request.
 *
 * Records written before v3 carry no `kind`; they were all provider or
 * development sessions, and read as `oidc` — the one kind that is refreshed,
 * so a development record read this way simply expires as before. A demo
 * record must carry everything the re-mint needs (a persona, a whole
 * generation, a visit id and a demo-shaped token); one that does not is
 * refused outright rather than half-trusted, because a demo session the
 * re-mint cannot match is a visit that would loop on 401s.
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

  const kind = value.kind === undefined ? 'oidc' : value.kind;
  if (kind !== 'oidc' && kind !== 'dev' && kind !== 'demo') return null;

  const base = {
    id: value.id,
    accessToken: value.accessToken,
    accessExpiresAt: value.accessExpiresAt,
    tenantId: value.tenantId,
    userId: typeof value.userId === 'string' ? value.userId : null,
    displayName: typeof value.displayName === 'string' ? value.displayName : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
  };

  if (kind !== 'demo') {
    return { ...base, kind, refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null };
  }

  if (!isDemoTokenShape(value.accessToken)) return null;
  if (!isDemoPersonaKey(value.persona)) return null;
  const generation = value.demoGeneration;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) return null;
  if (typeof value.demoSid !== 'string' || !DEMO_SID_PATTERN.test(value.demoSid)) return null;

  const lastTouchAt = epochMs(value.lastTouchAt);
  const parked = typeof value.parkedSessionId === 'string' && value.parkedSessionId.length > 0 ? value.parkedSessionId : null;
  return {
    ...base,
    kind,
    // A demo token is never refreshed; a refresh token on a demo record is
    // not one this side will ever use.
    refreshToken: null,
    persona: value.persona,
    demoGeneration: generation,
    demoSid: value.demoSid,
    ...(parked !== null ? { parkedSessionId: parked } : {}),
    ...(lastTouchAt !== undefined ? { lastTouchAt } : {}),
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
