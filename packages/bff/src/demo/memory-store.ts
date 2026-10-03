import { randomBytes } from 'node:crypto';
import { DEMO_IP_BUCKET_PATTERN, DEMO_KEYS, demoWindow } from '@itsm/contracts/demo';
import {
  demoBackoffSchema,
  demoBuildSchema,
  demoCooldownSchema,
  demoLiveSchema,
  parseDemoRecord,
} from '@itsm/contracts/demo/schemas';
import { decodeSession, encodeSession, type PendingLogin, type SessionStore } from '../session.js';
import type { MintReply, RemintReply } from './lua.js';
import {
  assertMintable,
  assertSid,
  assertToken,
  demoTokenHash,
  isDemoToken,
  mintLimits,
  newDemoSid,
  newDemoToken,
  personaForApp,
  settleMint,
  sessionRecordKey,
  settleRemint,
  type DemoTokenStore,
  type DemoTouchResult,
} from './store.js';

/**
 * The demo token store in memory, for the BFF's own tests (SPEC §4.3: "the
 * BFF unit tests use `memoryDemoTokenStore()` with the same interface").
 *
 * It mirrors the Lua scripts of `lua.ts` step for step — the same checks in
 * the same order, the same counters and sets, the same replies, read by the
 * same `interpret`/`settle` functions — over a small keyspace with Redis's
 * own semantics: real-time key expiry, sorted sets ordered by score then
 * member, empty sets deleted. The shared contract suite runs against this
 * and against Redis, so a difference between the two is a failing test
 * rather than a surprise in production.
 *
 * Session records live in the same keyspace (`sessions`), as they do in
 * Redis, because the re-mint and the touch compare and swap them in place.
 */

interface StringEntry {
  readonly kind: 'string';
  value: string;
  expiresAt: number | null;
}
interface ZsetEntry {
  readonly kind: 'zset';
  readonly value: Map<string, number>;
  expiresAt: number | null;
}
type Entry = StringEntry | ZsetEntry;

/** Redis order for a sorted set: by score, then by member. */
function ascending(a: readonly [string, number], b: readonly [string, number]): number {
  return a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * Just enough of Redis for the scripts: strings, sorted sets and expiry, on
 * an injectable clock. Synchronous, so a whole script runs between two
 * awaits — the memory equivalent of a script's atomicity.
 */
export class MemoryKeyspace {
  readonly #entries = new Map<string, Entry>();

  constructor(private readonly clock: () => number) {}

  #entry(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.clock()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  #zset(key: string, create: boolean): Map<string, number> | null {
    const entry = this.#entry(key);
    if (entry?.kind === 'zset') return entry.value;
    if (entry) throw new Error(`WRONGTYPE ${key}`);
    if (!create) return null;
    const value = new Map<string, number>();
    this.#entries.set(key, { kind: 'zset', value, expiresAt: null });
    return value;
  }

  #dropIfEmpty(key: string, set: Map<string, number>): void {
    if (set.size === 0) this.#entries.delete(key);
  }

  keys(): string[] {
    return [...this.#entries.keys()].filter((key) => this.#entry(key) !== undefined);
  }

  exists(key: string): boolean {
    return this.#entry(key) !== undefined;
  }

  get(key: string): string | null {
    const entry = this.#entry(key);
    if (!entry) return null;
    if (entry.kind !== 'string') throw new Error(`WRONGTYPE ${key}`);
    return entry.value;
  }

  set(key: string, value: string, options: { px?: number; nx?: boolean; keepTtl?: boolean } = {}): boolean {
    const existing = this.#entry(key);
    if (options.nx && existing) return false;
    const expiresAt =
      options.px !== undefined ? this.clock() + options.px : options.keepTtl ? (existing?.expiresAt ?? null) : null;
    this.#entries.set(key, { kind: 'string', value, expiresAt });
    return true;
  }

  del(key: string): number {
    const existed = this.#entry(key) !== undefined;
    this.#entries.delete(key);
    return existed ? 1 : 0;
  }

  incr(key: string): number {
    const entry = this.#entry(key);
    if (entry && entry.kind !== 'string') throw new Error(`WRONGTYPE ${key}`);
    const next = (entry ? Number(entry.value) : 0) + 1;
    if (entry) entry.value = String(next);
    else this.#entries.set(key, { kind: 'string', value: String(next), expiresAt: null });
    return next;
  }

  pexpire(key: string, ms: number): void {
    const entry = this.#entry(key);
    if (entry) entry.expiresAt = this.clock() + ms;
  }

  /** Redis's answers: -2 for no key, -1 for no expiry, else the milliseconds left. */
  pttl(key: string): number {
    const entry = this.#entry(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - this.clock();
  }

  zadd(key: string, score: number, member: string, options: { xx?: boolean; gt?: boolean } = {}): void {
    const set = this.#zset(key, !options.xx);
    if (!set) return;
    const current = set.get(member);
    if (options.xx && current === undefined) return;
    if (options.gt && current !== undefined && score <= current) return;
    set.set(member, score);
  }

  zincrby(key: string, by: number, member: string): number {
    const set = this.#zset(key, true)!;
    const next = (set.get(member) ?? 0) + by;
    set.set(member, next);
    return next;
  }

  zscore(key: string, member: string): number | null {
    return this.#zset(key, false)?.get(member) ?? null;
  }

  zrem(key: string, member: string): void {
    const set = this.#zset(key, false);
    if (!set) return;
    set.delete(member);
    this.#dropIfEmpty(key, set);
  }

  zcard(key: string): number {
    return this.#zset(key, false)?.size ?? 0;
  }

  /** Members in Redis order, lowest score first. */
  zmembers(key: string): [string, number][] {
    const set = this.#zset(key, false);
    return set ? [...set.entries()].sort(ascending) : [];
  }

  zrevrank(key: string, member: string): number | null {
    const set = this.#zset(key, false);
    if (!set?.has(member)) return null;
    const descending = [...set.entries()].sort((a, b) => ascending(b, a));
    return descending.findIndex(([name]) => name === member);
  }

  zpopmin(key: string): string | null {
    const set = this.#zset(key, false);
    if (!set) return null;
    let lowest: [string, number] | null = null;
    for (const pair of set) if (!lowest || ascending(pair, lowest) < 0) lowest = pair;
    if (!lowest) return null;
    set.delete(lowest[0]);
    this.#dropIfEmpty(key, set);
    return lowest[0];
  }

  /** `ZRANGEBYSCORE key -inf max LIMIT 0 1`. */
  zfirstAtMost(key: string, max: number): string | null {
    const set = this.#zset(key, false);
    if (!set) return null;
    let lowest: [string, number] | null = null;
    for (const pair of set) if (pair[1] <= max && (!lowest || ascending(pair, lowest) < 0)) lowest = pair;
    return lowest ? lowest[0] : null;
  }

  /** `ZREMRANGEBYSCORE key -inf max` (or `(max` when exclusive). */
  zremBelow(key: string, max: number, exclusive = false): void {
    const set = this.#zset(key, false);
    if (!set) return;
    for (const [member, score] of set) if (exclusive ? score < max : score <= max) set.delete(member);
    this.#dropIfEmpty(key, set);
  }

  clear(): void {
    this.#entries.clear();
  }
}

/* ------------------------------------------------------------------ The scripts, mirrored */

const MINUTE_WINDOW_MS = 120_000;
const HOUR_WINDOW_MS = 7_200_000;
const BUCKET_SET_MS = 90_000_000;
const VISIT_MAX_MS = 86_400_000;

function windowedIncr(ks: MemoryKeyspace, key: string, ttl: number): number {
  const n = ks.incr(key);
  if (n === 1 || ks.pttl(key) < 0) ks.pexpire(key, ttl);
  return n;
}

const validHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validIpb = (value: unknown): value is string => typeof value === 'string' && DEMO_IP_BUCKET_PATTERN.test(value);

/** Like `cjson.decode` under `pcall`: anything unreadable is `null`. */
function decode(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Lua's `tonumber`, for the values a session record can hold: a number, or a string of one. */
function luaNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLive(
  ks: MemoryKeyspace,
  persona: string,
): { live: Record<string, unknown> & { tenantId: string; generation: number }; userId: string } | null {
  const live = decode(ks.get(DEMO_KEYS.live));
  if (!live || typeof live.tenantId !== 'string' || typeof live.generation !== 'number') return null;
  if (live.generation < 1 || !Number.isInteger(live.generation)) return null;
  const personas = live.personas;
  if (!personas || typeof personas !== 'object') return null;
  const person = (personas as Record<string, unknown>)[persona];
  if (!person || typeof person !== 'object') return null;
  const userId = (person as Record<string, unknown>).userId;
  if (typeof userId !== 'string') return null;
  return { live: live as Record<string, unknown> & { tenantId: string; generation: number }, userId };
}

function forget(ks: MemoryKeyspace, member: string): void {
  ks.zrem(DEMO_KEYS.active, member);
  if (!validHash(member)) return;
  const key = `demo:tok:${member}`;
  const record = decode(ks.get(key));
  if (record && validIpb(record.ipb)) ks.zrem(`demo:active:ipb:${record.ipb}`, member);
  ks.del(key);
}

interface MintArgs {
  readonly now: number;
  readonly persona: string;
  readonly app: string;
  readonly sid: string;
  readonly newHash: string;
  readonly ipb: string;
  readonly limits: ReturnType<typeof mintLimits>;
  readonly keys: {
    readonly bucketSet: string;
    readonly token: string;
    readonly ipMin: string;
    readonly ipHour: string;
    readonly allMin: string;
    readonly allHour: string;
    readonly topMin: string;
    readonly topHour: string;
  };
}

function mintScript(ks: MemoryKeyspace, a: MintArgs): MintReply {
  const { now, limits, keys } = a;
  if (ks.exists(DEMO_KEYS.paused)) return { status: 'paused' };
  const found = readLive(ks, a.persona);
  if (!found) return { status: 'unavailable' };

  if (windowedIncr(ks, keys.ipMin, MINUTE_WINDOW_MS) > limits.ipPerMin) return { status: 'busy', retryAfterSec: 60 };
  if (windowedIncr(ks, keys.ipHour, HOUR_WINDOW_MS) > limits.ipPerHour) return { status: 'busy', retryAfterSec: 3600 };

  const windows = [
    { counter: keys.allMin, cap: limits.allPerMin, top: keys.topMin, retry: 60, ttl: MINUTE_WINDOW_MS },
    { counter: keys.allHour, cap: limits.allPerHour, top: keys.topHour, retry: 300, ttl: HOUR_WINDOW_MS },
  ];
  for (const w of windows) {
    const total = windowedIncr(ks, w.counter, w.ttl);
    const mine = ks.zincrby(w.top, 1, a.ipb);
    if (ks.pttl(w.top) < 0) ks.pexpire(w.top, w.ttl);
    if (total > w.cap) {
      const rank = ks.zrevrank(w.top, a.ipb);
      if (rank !== null && rank < 10) return { status: 'busy', retryAfterSec: w.retry };
    }
    if (total > w.cap * 0.5 && mine > 5 && mine / total > limits.fairShare) {
      return { status: 'busy', retryAfterSec: w.retry };
    }
  }

  let evictedOwn = 0;
  ks.zremBelow(keys.bucketSet, now - VISIT_MAX_MS);
  while (ks.zcard(keys.bucketSet) >= limits.maxLivePerIp) {
    const popped = ks.zpopmin(keys.bucketSet);
    if (popped === null) break;
    forget(ks, popped);
    evictedOwn += 1;
  }

  ks.zremBelow(DEMO_KEYS.active, now - limits.ttlMs, true);
  let evictedIdle = 0;
  while (ks.zcard(DEMO_KEYS.active) >= limits.maxLive) {
    if (evictedIdle >= 25) return { status: 'capacity' };
    const victim = ks.zfirstAtMost(DEMO_KEYS.active, now - limits.idleMs);
    if (victim === null) return { status: 'capacity' };
    forget(ks, victim);
    evictedIdle += 1;
  }

  const exp = now + limits.initialTtlMs;
  ks.set(
    keys.token,
    JSON.stringify({
      v: 1,
      tenantId: found.live.tenantId,
      userId: found.userId,
      persona: a.persona,
      app: a.app,
      sid: a.sid,
      gen: found.live.generation,
      iat: now,
      exp,
      ipb: a.ipb,
    }),
    { px: limits.initialTtlMs },
  );
  ks.zadd(DEMO_KEYS.active, now, a.newHash);
  ks.zadd(keys.bucketSet, now, a.newHash);
  ks.pexpire(keys.bucketSet, BUCKET_SET_MS);
  return {
    status: 'ok',
    tenantId: found.live.tenantId,
    userId: found.userId,
    generation: found.live.generation,
    exp: Math.trunc(exp),
    evictedOwn,
    evictedIdle,
  };
}

interface RemintArgs {
  readonly now: number;
  readonly ttl: number;
  readonly sessionKey: string;
  readonly oldToken: string;
  readonly newToken: string;
  readonly oldHash: string;
  readonly newHash: string;
  readonly maxPerHour: number;
  readonly sid: string;
  readonly app: string;
  readonly persona: string;
  readonly fallbackIpb: string;
  readonly remintKey: string;
}

function remintScript(ks: MemoryKeyspace, a: RemintArgs): RemintReply {
  const rawSession = ks.get(a.sessionKey);
  if (rawSession === null) return { status: 'gone' };
  const session = decode(rawSession);
  if (!session || session.kind !== 'demo' || session.demoSid !== a.sid || session.persona !== a.persona) {
    return { status: 'gone' };
  }
  if (session.accessToken !== a.oldToken) return { status: 'already', raw: rawSession };
  const oldKey = `demo:tok:${a.oldHash}`;
  const oldRaw = ks.get(oldKey);
  if (oldRaw === null) return { status: 'gone' };
  if (ks.exists(DEMO_KEYS.paused)) return { status: 'paused' };
  const found = readLive(ks, a.persona);
  if (!found) return { status: 'unavailable' };
  if (windowedIncr(ks, a.remintKey, HOUR_WINDOW_MS) > a.maxPerHour) return { status: 'limited' };

  let ipb = a.fallbackIpb;
  const old = decode(oldRaw);
  if (old && validIpb(old.ipb)) ipb = old.ipb;
  if (!validIpb(ipb)) ipb = 'unknown';

  const exp = a.now + a.ttl;
  ks.set(
    `demo:tok:${a.newHash}`,
    JSON.stringify({
      v: 1,
      tenantId: found.live.tenantId,
      userId: found.userId,
      persona: a.persona,
      app: a.app,
      sid: a.sid,
      gen: found.live.generation,
      iat: a.now,
      exp,
      ipb,
    }),
    { px: a.ttl },
  );
  ks.del(oldKey);
  ks.zrem(DEMO_KEYS.active, a.oldHash);
  ks.zadd(DEMO_KEYS.active, a.now, a.newHash);
  const bucket = `demo:active:ipb:${ipb}`;
  const since = ks.zscore(bucket, a.oldHash);
  ks.zrem(bucket, a.oldHash);
  ks.zadd(bucket, since ?? a.now, a.newHash);
  ks.pexpire(bucket, BUCKET_SET_MS);

  session.accessToken = a.newToken;
  session.accessExpiresAt = exp;
  session.tenantId = found.live.tenantId;
  session.userId = found.userId;
  session.demoGeneration = found.live.generation;
  const encoded = JSON.stringify(session);
  ks.set(a.sessionKey, encoded, { px: a.ttl });
  return { status: 'ok', raw: encoded };
}

function touchScript(
  ks: MemoryKeyspace,
  a: { now: number; sessionKey: string; hash: string; intervalMs: number; token: string },
): DemoTouchResult {
  const rawSession = ks.get(a.sessionKey);
  if (rawSession === null) return 'gone';
  const session = decode(rawSession);
  if (!session || session.kind !== 'demo') return 'gone';
  if (session.accessToken !== a.token) return 'skipped';
  const last = luaNumber(session.lastTouchAt);
  if (last !== null && a.now - last < a.intervalMs) return 'skipped';
  ks.zadd(DEMO_KEYS.active, a.now, a.hash, { xx: true, gt: true });
  session.lastTouchAt = a.now;
  ks.set(a.sessionKey, JSON.stringify(session), { keepTtl: true });
  return 'touched';
}

function revokeScript(ks: MemoryKeyspace, hash: string): boolean {
  const existed = ks.exists(`demo:tok:${hash}`);
  forget(ks, hash);
  return existed;
}

/* ------------------------------------------------------------------ The store */

export interface MemoryDemoTokenStoreOptions {
  /** Namespaces the session records, as `bff:<app>:sess:` does in Redis. */
  readonly appName?: string;
  /** The clock key expiry runs on; Redis's is real time. Operations still take their own `now`. */
  readonly clock?: () => number;
}

export interface MemoryDemoTokenStore extends DemoTokenStore {
  /** A session store over the same records, as `redisSessionStore` shares the Redis keyspace. */
  readonly sessions: SessionStore;
  /** The keyspace itself, for tests that look at what a script wrote. */
  readonly keyspace: MemoryKeyspace;
  /** Writes a record as JSON (or a string as is) — the worker's and the CLI's side of the contract. */
  write(key: string, value: unknown, ttlMs?: number): void;
}

export function memoryDemoTokenStore(options: MemoryDemoTokenStoreOptions = {}): MemoryDemoTokenStore {
  const appName = options.appName ?? 'app';
  const clock = options.clock ?? Date.now;
  const ks = new MemoryKeyspace(clock);
  const pendingKey = (state: string): string => `bff:${appName}:login:${state}`;

  const sessions: SessionStore = {
    async get(id) {
      return decodeSession(ks.get(sessionRecordKey(appName, id)));
    },
    async put(session, ttlSeconds) {
      ks.set(sessionRecordKey(appName, session.id), encodeSession(session), { px: ttlSeconds * 1000 });
    },
    async delete(id) {
      ks.del(sessionRecordKey(appName, id));
    },
    async putPending(state, pending, ttlSeconds) {
      ks.set(pendingKey(state), JSON.stringify(pending), { px: ttlSeconds * 1000 });
    },
    async takePending(state) {
      const raw = ks.get(pendingKey(state));
      ks.del(pendingKey(state));
      const parsed = decode(raw) as PendingLogin | null;
      return typeof parsed?.verifier === 'string' ? parsed : null;
    },
    async close() {
      ks.clear();
    },
  };

  async function revokeHash(hash: string): Promise<boolean> {
    return revokeScript(ks, hash);
  }

  return {
    sessions,
    keyspace: ks,

    write(key, value, ttlMs) {
      ks.set(key, typeof value === 'string' ? value : JSON.stringify(value), ttlMs === undefined ? {} : { px: ttlMs });
    },

    async daySalt(dateKey) {
      const key = DEMO_KEYS.salt(dateKey);
      ks.set(key, randomBytes(32).toString('base64url'), { px: 172_800_000, nx: true });
      const salt = ks.get(key);
      if (!salt) throw new Error('the demo IP salt could not be read back');
      return salt;
    },

    async readStatusRecords() {
      return {
        live: parseDemoRecord(demoLiveSchema, ks.get(DEMO_KEYS.live)),
        build: parseDemoRecord(demoBuildSchema, ks.get(DEMO_KEYS.build)),
        cooldown: parseDemoRecord(demoCooldownSchema, ks.get(DEMO_KEYS.resetCooldown)),
        paused: ks.exists(DEMO_KEYS.paused),
        backoff: parseDemoRecord(demoBackoffSchema, ks.get(DEMO_KEYS.resetBackoff)),
      };
    },

    async mint(request) {
      assertMintable(request);
      const now = request.now ?? clock();
      const sid = request.sid ?? newDemoSid();
      assertSid(sid);
      const { app, persona, ipb } = request;
      const token = newDemoToken();
      const hash = demoTokenHash(token);
      const minute = demoWindow('m', now);
      const hour = demoWindow('h', now);
      const reply = mintScript(ks, {
        now,
        persona,
        app,
        sid,
        newHash: hash,
        ipb,
        limits: mintLimits(request.settings),
        keys: {
          bucketSet: DEMO_KEYS.activeForBucket(ipb),
          token: DEMO_KEYS.token(hash),
          ipMin: DEMO_KEYS.mintPerBucket(app, persona, ipb, minute),
          ipHour: DEMO_KEYS.mintPerBucket(app, persona, ipb, hour),
          allMin: DEMO_KEYS.mintAll(minute),
          allHour: DEMO_KEYS.mintAll(hour),
          topMin: DEMO_KEYS.mintTop(minute),
          topHour: DEMO_KEYS.mintTop(hour),
        },
      });
      return settleMint(reply, { request, sid, now, token, hash }, revokeHash);
    },

    async remint(request) {
      const now = request.now ?? clock();
      assertSid(request.sid);
      assertToken(request.currentToken);
      const fallbackIpb = request.ipb ?? 'unknown';
      if (!DEMO_IP_BUCKET_PATTERN.test(fallbackIpb)) throw new RangeError('not a demo IP bucket');
      const newToken = newDemoToken();
      const oldHash = demoTokenHash(request.currentToken);
      const newHash = demoTokenHash(newToken);
      // Built for their validation, exactly as the Redis store builds them.
      DEMO_KEYS.token(oldHash);
      DEMO_KEYS.token(newHash);
      const reply = remintScript(ks, {
        now,
        ttl: request.settings.tokenTtlSeconds * 1000,
        sessionKey: sessionRecordKey(appName, request.sessionId),
        oldToken: request.currentToken,
        newToken,
        oldHash,
        newHash,
        maxPerHour: request.settings.remintPerHour,
        sid: request.sid,
        app: request.app,
        persona: personaForApp(request.app),
        fallbackIpb,
        remintKey: DEMO_KEYS.remint(request.sid, demoWindow('h', now)),
      });
      return settleRemint(reply);
    },

    async touch(request) {
      if (!isDemoToken(request.token)) return 'gone';
      return touchScript(ks, {
        now: request.now ?? clock(),
        sessionKey: sessionRecordKey(appName, request.sessionId),
        hash: demoTokenHash(request.token),
        intervalMs: request.settings.touchIntervalSeconds * 1000,
        token: request.token,
      });
    },

    async revoke(token) {
      if (!isDemoToken(token)) return false;
      return revokeHash(demoTokenHash(token));
    },

    async close() {
      ks.clear();
    },
  };
}
