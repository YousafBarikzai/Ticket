import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DEMO_PERSONA_FOR_AREA,
  DEMO_SID_PATTERN,
  DEMO_TOKEN_HASH_PATTERN,
  DEMO_TOKEN_PATTERN,
  DEMO_TOKEN_PREFIX,
  mayMint,
  type DemoArea,
  type DemoPersonaKey,
  type DemoStatusRecords,
  type DemoTokenRecord,
} from '@itsm/contracts/demo';
import { demoTokenSchema } from '@itsm/contracts/demo/schemas';
import type { BffConfig } from '../config.js';
import { decodeSession, type Session } from '../session.js';
import type { DaySaltSource } from './ip.js';
import type { MintReply, RemintReply } from './lua.js';
import type { DemoSettings } from './settings.js';

/**
 * The demo token store (SPEC §4.2, §4.3): minting, re-minting, revoking and
 * touching `itsmdemo_` tokens.
 *
 * An interface with two implementations, like the session store: the Redis
 * one (`redis-store.ts`) runs the Lua scripts in `lua.ts`, and the memory one
 * (`memory-store.ts`) mirrors those scripts step for step so the BFF's own
 * tests need no Redis. One contract suite runs against both
 * (`__tests__/demo-store.test.ts`, `tests/integration/demo-token-store.test.ts`),
 * which is what keeps the mirror honest.
 *
 * Every operation that decides something — a limit, an eviction, a
 * compare-and-swap on a session — is one atomic step in the store, because
 * two replicas of each app serve the same visitors and a check followed by a
 * write in Node is a race between them. Redis errors are thrown, never
 * swallowed: the caller decides how a broken store looks to a visitor, and
 * no path here fails open.
 *
 * Tokens and their hashes are made here in Node; the store never sees
 * randomness, and nothing logs more than eight hex characters of a hash.
 */

/** Why a mint was refused: the Lua's own words. The BFF maps `unavailable` to `/demo?reason=preparing` (M6). */
export type DemoMintRefusal = 'paused' | 'unavailable' | 'busy' | 'capacity';

export interface DemoMintRequest {
  /** The app minting, which fixes the persona (`mayMint`). */
  readonly app: DemoArea;
  readonly persona: DemoPersonaKey;
  /** The caller's salted IP bucket (`ipBucket`); never an address. */
  readonly ipb: string;
  readonly settings: DemoSettings;
  /** The visit's id; a fresh `demo-<uuid>` when omitted. Stays the same across re-mints. */
  readonly sid?: string;
  /** Epoch ms. The store's limits run on the caller's clock, so tests can place mints in time. */
  readonly now?: number;
}

export type DemoMintResult =
  | {
      readonly ok: true;
      /** The plaintext token: it goes into the session record and nowhere else. */
      readonly token: string;
      readonly tokenHash: string;
      readonly record: DemoTokenRecord;
      /** Tokens this mint evicted: this bucket's oldest, and the least recently used idle one. */
      readonly evicted: { readonly ownOldest: number; readonly idle: number };
    }
  | {
      readonly ok: false;
      readonly reason: DemoMintRefusal;
      /** For `busy`: how long the refusing window has left at most. */
      readonly retryAfterSec: number | null;
    };

export interface DemoRemintRequest {
  /** The BFF session id (`bff:<app>:sess:<id>`), compared and swapped atomically. */
  readonly sessionId: string;
  readonly app: DemoArea;
  /** The session's `demoSid`; it names the re-mint counter, so the caller passes it. */
  readonly sid: string;
  /** The token the caller holds. If the record no longer holds it, another request rotated it first. */
  readonly currentToken: string;
  /** Used for the new token's bucket only when the old token record is unreadable. */
  readonly ipb?: string;
  readonly settings: DemoSettings;
  readonly now?: number;
}

export type DemoRemintResult =
  | {
      /** `ok`: this call rotated the token. `already`: another call did, and this is its session. */
      readonly status: 'ok' | 'already';
      readonly session: Session;
      /** The stored record as written, for fields `Session` does not decode yet. */
      readonly raw: string;
    }
  | {
      /** `gone`: no demo session, or its token no longer exists (expired, evicted or revoked) — the visit has ended. */
      readonly status: 'gone' | 'paused' | 'unavailable' | 'limited';
    };

export interface DemoTouchRequest {
  readonly sessionId: string;
  /** The token the caller holds; a session that has moved on to another token is not touched. */
  readonly token: string;
  readonly settings: DemoSettings;
  readonly now?: number;
}

/** `touched`: the score and `lastTouchAt` moved. `skipped`: touched too recently, or rotated since. `gone`: no demo session. */
export type DemoTouchResult = 'touched' | 'skipped' | 'gone';

export interface DemoTokenStore extends DaySaltSource {
  /**
   * The day's IP salt (`demo:salt:<ukDateKey>`), created with `SET NX` on
   * first use. Read in every mode: the sign-in limiter needs buckets whether
   * or not the demo is on (RV3).
   */
  daySalt(dateKey: string): Promise<string>;
  /** `demo:live`, `demo:build`, `demo:reset:cooldown`, `demo:paused` and `demo:reset:backoff` in one read, parsed strictly. */
  readStatusRecords(): Promise<DemoStatusRecords>;
  mint(request: DemoMintRequest): Promise<DemoMintResult>;
  remint(request: DemoRemintRequest): Promise<DemoRemintResult>;
  /** Marks the session's token as used now, at most once per `touchIntervalSeconds` per session. */
  touch(request: DemoTouchRequest): Promise<DemoTouchResult>;
  /** Deletes a token and its entries. Idempotent; `true` when the token record still existed. */
  revoke(token: string): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Where a BFF session record lives: `bff:<app>:sess:<id>` (§4.2). One
 * definition for the session store and the demo scripts, because the re-mint
 * and the touch compare and swap that record in place, and a key spelled
 * twice is a re-mint that silently finds no session.
 */
export function sessionRecordKey(appName: string, id: string): string {
  return `bff:${appName}:sess:${id}`;
}

/** A new opaque token: the prefix and 32 random bytes, 43 base64url characters (§4.4). */
export function newDemoToken(): string {
  return `${DEMO_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The token's SHA-256, the only form in which it appears in a key name. */
export function demoTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A visit id: `demo-` and a v4 UUID. */
export function newDemoSid(): string {
  return `demo-${randomUUID()}`;
}

/** The most of a hash a log line may carry (§4.3). */
export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

/**
 * Refuses inputs the scripts must never see. These are programming errors —
 * the routes validate the form before minting — so they throw rather than
 * answer with a refusal a visitor would see.
 */
export function assertMintable(request: Pick<DemoMintRequest, 'app' | 'persona'>): void {
  if (!mayMint(request.app, request.persona)) {
    throw new RangeError(`the ${request.app} app does not mint the ${String(request.persona)} persona`);
  }
}

export function assertSid(sid: string): void {
  if (!DEMO_SID_PATTERN.test(sid)) throw new RangeError('not a demo visit id');
}

export function assertToken(token: string): void {
  if (!DEMO_TOKEN_PATTERN.test(token)) throw new RangeError('not a demo token');
}

/** True for a value shaped like a demo token; anything else was never stored. */
export function isDemoToken(value: unknown): value is string {
  return typeof value === 'string' && DEMO_TOKEN_PATTERN.test(value);
}

export function isTokenHash(value: unknown): value is string {
  return typeof value === 'string' && DEMO_TOKEN_HASH_PATTERN.test(value);
}

/** The persona a token of this app must carry. */
export function personaForApp(app: DemoArea): DemoPersonaKey {
  return DEMO_PERSONA_FOR_AREA[app];
}

/** The numbers the mint script takes, in milliseconds where the scripts work in milliseconds. */
export interface MintLimits {
  readonly initialTtlMs: number;
  readonly ttlMs: number;
  readonly maxLive: number;
  readonly maxLivePerIp: number;
  readonly ipPerMin: number;
  readonly ipPerHour: number;
  readonly allPerMin: number;
  readonly allPerHour: number;
  readonly fairShare: number;
  readonly idleMs: number;
}

export function mintLimits(settings: DemoSettings): MintLimits {
  return {
    initialTtlMs: settings.initialTokenTtlSeconds * 1000,
    ttlMs: settings.tokenTtlSeconds * 1000,
    maxLive: settings.maxLiveTokens,
    maxLivePerIp: settings.maxLivePerIp,
    ipPerMin: settings.mintPerIpMinute,
    ipPerHour: settings.mintPerIpHour,
    allPerMin: settings.mintGlobalMinute,
    allPerHour: settings.mintGlobalHour,
    fairShare: settings.mintFairShare,
    idleMs: settings.idleEvictSeconds * 1000,
  };
}

/**
 * A mint's outcome as a log line: the result, the generation and at most
 * eight hex characters of the hash — never the token, the bucket or an
 * address (§4.7.6, §4.9).
 */
export function demoMintLogLine(appName: string, result: DemoMintResult): string {
  if (!result.ok) {
    const retry = result.retryAfterSec === null ? '' : ` retryAfter=${result.retryAfterSec}`;
    return `[bff:${appName}] demo mint result=${result.reason}${retry}`;
  }
  const evicted = [
    result.evicted.ownOldest > 0 ? `bucket:${result.evicted.ownOldest}` : null,
    result.evicted.idle > 0 ? `idle:${result.evicted.idle}` : null,
  ].filter((part): part is string => part !== null);
  return (
    `[bff:${appName}] demo mint result=ok persona=${result.record.persona} gen=${result.record.gen} ` +
    `token=${shortHash(result.tokenHash)}${evicted.length > 0 ? ` evicted=${evicted.join(',')}` : ''}`
  );
}

/**
 * A mint reply as the caller sees it. The token record the script wrote is
 * rebuilt from the reply and parsed with the API's own strict schema: a
 * `demo:live` the script could read but the API would refuse (a malformed
 * id, say) must not hand out a token that fails on its first use, so such a
 * token is revoked at once and the mint reads as `unavailable` — closed, as
 * every other unreadable record is.
 */
export async function settleMint(
  reply: MintReply,
  context: {
    readonly request: DemoMintRequest;
    readonly sid: string;
    readonly now: number;
    readonly token: string;
    readonly hash: string;
  },
  revokeHash: (hash: string) => Promise<boolean>,
): Promise<DemoMintResult> {
  if (reply.status === 'busy') return { ok: false, reason: 'busy', retryAfterSec: reply.retryAfterSec };
  if (reply.status !== 'ok') return { ok: false, reason: reply.status, retryAfterSec: null };

  const candidate: DemoTokenRecord = {
    v: 1,
    tenantId: reply.tenantId,
    userId: reply.userId,
    persona: context.request.persona,
    app: context.request.app,
    sid: context.sid,
    gen: reply.generation,
    iat: context.now,
    exp: reply.exp,
    ipb: context.request.ipb,
  };
  const parsed = demoTokenSchema.safeParse(candidate);
  if (!parsed.success) {
    await revokeHash(context.hash);
    return { ok: false, reason: 'unavailable', retryAfterSec: null };
  }
  return {
    ok: true,
    token: context.token,
    tokenHash: context.hash,
    record: parsed.data,
    evicted: { ownOldest: reply.evictedOwn, idle: reply.evictedIdle },
  };
}

/** A re-mint reply as the caller sees it; a record that no longer decodes as a session is a visit that has ended. */
export function settleRemint(reply: RemintReply): DemoRemintResult {
  if (reply.status !== 'ok' && reply.status !== 'already') return { status: reply.status };
  const session = decodeSession(reply.raw);
  if (!session) return { status: 'gone' };
  return { status: reply.status, session, raw: reply.raw };
}

/**
 * One token store per application, reused across requests — the same shape
 * as `sessionStore`, and for the same reasons: there is no composition root
 * to thread one through, and the Redis client is imported only when a store
 * is actually needed, so a test that installs its own never loads `ioredis`.
 */
const stores = new Map<string, DemoTokenStore>();

export async function demoTokenStore(config: Pick<BffConfig, 'appName' | 'redisUrl'>): Promise<DemoTokenStore> {
  const existing = stores.get(config.appName);
  if (existing) return existing;

  const { redisDemoTokenStore } = await import('./redis-store.js');
  const created = redisDemoTokenStore(config.redisUrl, config.appName);
  stores.set(config.appName, created);
  return created;
}

/** Test seam. Passing `null` forgets the store rather than installing one. */
export function setDemoTokenStore(appName: string, replacement: DemoTokenStore | null): void {
  if (replacement) stores.set(appName, replacement);
  else stores.delete(appName);
}
