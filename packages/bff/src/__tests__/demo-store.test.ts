import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEMO_KEYS,
  DEMO_SID_PATTERN,
  DEMO_TOKEN_PATTERN,
  demoWindow,
  isDemoKey,
  type DemoLiveRecord,
} from '@itsm/contracts/demo';
import { demoTokenSchema } from '@itsm/contracts/demo/schemas';
import { ConfigurationError, readConfig, type AppIdentity } from '../config.js';
import { ipBucket } from '../demo/ip.js';
import { DEMO_SCRIPTS, defineDemoScripts, interpretMintReply, interpretRemintReply, interpretTouchReply } from '../demo/lua.js';
import { MemoryKeyspace, memoryDemoTokenStore, type MemoryDemoTokenStore } from '../demo/memory-store.js';
import {
  DEMO_SETTING_DEFAULTS,
  DemoSettingsError,
  readClientIpHeader,
  readDemoSettings,
  type DemoSettings,
} from '../demo/settings.js';
import {
  demoMintLogLine,
  demoTokenHash,
  demoTokenStore,
  mintLimits,
  newDemoSid,
  newDemoToken,
  sessionRecordKey,
  setDemoTokenStore,
  shortHash,
  type DemoMintResult,
  type DemoTokenStore,
} from '../demo/store.js';

/**
 * The demo token store (SPEC §4.2, §4.3, §4.8, §4.11).
 *
 * `demoTokenStoreContract` is the behaviour both stores must share. It runs
 * here against the memory mirror and in `tests/integration/demo-token-store
 * .test.ts` against real Redis and the Lua scripts, which is what "the memory
 * store mirrors Lua semantics" means in practice: one suite, two backends.
 */

/* ------------------------------------------------------------------ Fixtures */

const DAY = 86_400_000;
const MINUTE = 60_000;

export const TENANT_A = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
export const TENANT_B = '8a7b6c5d-4e3f-4a1b-8c9d-0e1f2a3b4c5d';
const USERS_A = {
  employee: 'a1000000-0000-4000-8000-000000000001',
  agent: 'a1000000-0000-4000-8000-000000000002',
  admin: 'a1000000-0000-4000-8000-000000000003',
};
const USERS_B = {
  employee: 'b2000000-0000-4000-8000-000000000001',
  agent: 'b2000000-0000-4000-8000-000000000002',
  admin: 'b2000000-0000-4000-8000-000000000003',
};

export function liveRecord(generation = 1, tenant: 'A' | 'B' = 'A'): DemoLiveRecord {
  const users = tenant === 'A' ? USERS_A : USERS_B;
  return {
    v: 1,
    tenantId: tenant === 'A' ? TENANT_A : TENANT_B,
    slug: 'demo',
    generation,
    builtAt: Date.UTC(2026, 9, 2),
    anchor: Date.UTC(2026, 9, 2),
    lastResetAt: Date.UTC(2026, 9, 2),
    lastResetReason: 'initial',
    personas: { employee: { userId: users.employee }, agent: { userId: users.agent }, admin: { userId: users.admin } },
    agentTeamIds: ['c3000000-0000-4000-8000-000000000001'],
  };
}

export function settingsWith(overrides: Partial<DemoSettings> = {}): DemoSettings {
  return { ...DEMO_SETTING_DEFAULTS, ...overrides };
}

/**
 * Each test gets its own stretch of (far-future) time, aligned to the hour,
 * so its rate-limit windows never meet another test's — or a real visitor's,
 * when the backend is a shared Redis.
 */
let slot = 0;
function timeBase(): number {
  slot += 1;
  return Date.UTC(2099, 0, 1) + slot * 2 * DAY;
}

/** IP buckets unique to one test: a random prefix and an index. */
function bucketMaker(): (index: number) => string {
  const prefix = randomBytes(3).toString('hex');
  return (index) => `${prefix}${index.toString(16).padStart(10, '0')}`;
}

/** What a contract test may look at and arrange, whatever the backend. */
export interface DemoStoreHarness {
  readonly store: DemoTokenStore;
  readonly appName: string;
  setLive(record: DemoLiveRecord | string | null): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  /** Writes a raw string at a key, or deletes it. */
  write(key: string, value: string | null): Promise<void>;
  putSession(id: string, record: Record<string, unknown>, ttlMs: number): Promise<void>;
  readSession(id: string): Promise<Record<string, unknown> | null>;
  readToken(hash: string): Promise<Record<string, unknown> | null>;
  pttl(key: string): Promise<number>;
  score(key: string, member: string): Promise<number | null>;
  card(key: string): Promise<number>;
  /** Every key under `demo:` and the harness's own `bff:<app>:` the backend now holds. */
  keys(): Promise<string[]>;
}

/** A demo session record as WP-30's `Session` will carry it (§4.4, §4.5). */
function demoSession(
  id: string,
  minted: Extract<DemoMintResult, { ok: true }>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: 'demo',
    accessToken: minted.token,
    refreshToken: null,
    accessExpiresAt: minted.record.exp,
    tenantId: minted.record.tenantId,
    userId: minted.record.userId,
    displayName: 'Alex Morgan',
    createdAt: minted.record.iat,
    persona: minted.record.persona,
    demoGeneration: minted.record.gen,
    demoSid: minted.record.sid,
    ...extra,
  };
}

function expectMinted(result: DemoMintResult): Extract<DemoMintResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected a mint, got ${result.reason}`);
  return result;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/* ------------------------------------------------------------------ The contract */

export function demoTokenStoreContract(label: string, makeHarness: () => Promise<DemoStoreHarness>): void {
  describe(`the demo token store contract · ${label}`, () => {
    const agent = { app: 'workbench', persona: 'agent' } as const;

    async function ready(): Promise<{ h: DemoStoreHarness; t0: number; b: (index: number) => string }> {
      const h = await makeHarness();
      await h.setLive(liveRecord(1));
      return { h, t0: timeBase(), b: bucketMaker() };
    }

    it('mints a token for the live generation that lives 900 s until it is used', async () => {
      const { h, t0, b } = await ready();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings: settingsWith(), now: t0 }));

      expect(minted.token).toMatch(DEMO_TOKEN_PATTERN);
      expect(minted.tokenHash).toBe(sha256(minted.token));
      expect(minted.record).toEqual({
        v: 1,
        tenantId: TENANT_A,
        userId: USERS_A.agent,
        persona: 'agent',
        app: 'workbench',
        sid: minted.record.sid,
        gen: 1,
        iat: t0,
        exp: t0 + 900_000,
        ipb: b(1),
      });
      expect(minted.record.sid).toMatch(DEMO_SID_PATTERN);
      expect(minted.evicted).toEqual({ ownOldest: 0, idle: 0 });

      // What the API will read: strict, and the same record.
      const stored = await h.readToken(minted.tokenHash);
      expect(demoTokenSchema.parse(stored)).toEqual(minted.record);
      const ttl = await h.pttl(DEMO_KEYS.token(minted.tokenHash));
      expect(ttl).toBeGreaterThan(890_000);
      expect(ttl).toBeLessThanOrEqual(900_000);

      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBe(t0);
      expect(await h.score(DEMO_KEYS.activeForBucket(b(1)), minted.tokenHash)).toBe(t0);
      expect(await h.pttl(DEMO_KEYS.activeForBucket(b(1)))).toBeGreaterThan(89_000_000);
    });

    it('keeps a visit id it is given', async () => {
      const { h, t0, b } = await ready();
      const sid = newDemoSid();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), sid, settings: settingsWith(), now: t0 }));
      expect(minted.record.sid).toBe(sid);
    });

    it('refuses while paused and before the first build, and counts nothing', async () => {
      const { h, t0, b } = await ready();
      const minuteKey = DEMO_KEYS.mintPerBucket('workbench', 'agent', b(1), demoWindow('m', t0));

      await h.setPaused(true);
      expect(await h.store.mint({ ...agent, ipb: b(1), settings: settingsWith(), now: t0 })).toEqual({
        ok: false,
        reason: 'paused',
        retryAfterSec: null,
      });
      await h.setPaused(false);

      for (const live of [null, 'not json', '{"v":1}', JSON.stringify({ ...liveRecord(1), personas: {} })]) {
        await h.setLive(live);
        expect(await h.store.mint({ ...agent, ipb: b(1), settings: settingsWith(), now: t0 })).toEqual({
          ok: false,
          reason: 'unavailable',
          retryAfterSec: null,
        });
      }
      expect(await h.pttl(minuteKey)).toBe(-2);
      expect(await h.card(DEMO_KEYS.active)).toBe(0);
    });

    it('revokes at once a token the API would refuse, and reads as unavailable', async () => {
      const { h, t0, b } = await ready();
      const broken = liveRecord(1);
      await h.setLive({ ...broken, personas: { ...broken.personas, agent: { userId: 'not-a-uuid' } } });
      expect(await h.store.mint({ ...agent, ipb: b(1), settings: settingsWith(), now: t0 })).toEqual({
        ok: false,
        reason: 'unavailable',
        retryAfterSec: null,
      });
      expect(await h.card(DEMO_KEYS.active)).toBe(0);
      expect(await h.card(DEMO_KEYS.activeForBucket(b(1)))).toBe(0);
    });

    it('limits one bucket to 30 mints a minute per app and persona', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      for (let i = 0; i < 30; i += 1) {
        expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + i }));
      }
      expect(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + 30 })).toEqual({
        ok: false,
        reason: 'busy',
        retryAfterSec: 60,
      });
      const minuteKey = DEMO_KEYS.mintPerBucket('workbench', 'agent', b(1), demoWindow('m', t0));
      const ttl = await h.pttl(minuteKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120_000);

      // Another app's persona from the same bucket has its own allowance, and
      // so does this one in the next minute.
      expectMinted(await h.store.mint({ app: 'portal', persona: 'employee', ipb: b(1), settings, now: t0 + 31 }));
      expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + MINUTE }));
    });

    it('limits one bucket per hour as well', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith({ mintPerIpHour: 5 });
      for (let i = 0; i < 5; i += 1) {
        expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + i * MINUTE }));
      }
      expect(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + 5 * MINUTE })).toEqual({
        ok: false,
        reason: 'busy',
        retryAfterSec: 3600,
      });
      const hourTtl = await h.pttl(DEMO_KEYS.mintPerBucket('workbench', 'agent', b(1), demoWindow('h', t0)));
      expect(hourTtl).toBeGreaterThan(0);
      expect(hourTtl).toBeLessThanOrEqual(7_200_000);
    });

    it('leaves 20 live tokens after 21 mints from one bucket: its own oldest goes', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted: Extract<DemoMintResult, { ok: true }>[] = [];
      for (let i = 0; i < 21; i += 1) {
        minted.push(expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + i })));
      }
      expect(minted.slice(0, 20).every((result) => result.evicted.ownOldest === 0)).toBe(true);
      expect(minted[20]!.evicted).toEqual({ ownOldest: 1, idle: 0 });
      expect(await h.card(DEMO_KEYS.activeForBucket(b(1)))).toBe(20);
      expect(await h.card(DEMO_KEYS.active)).toBe(20);
      expect(await h.readToken(minted[0]!.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.active, minted[0]!.tokenHash)).toBeNull();
      expect(await h.readToken(minted[1]!.tokenHash)).not.toBeNull();
    });

    it('refuses for capacity only when no token is idle, and evicts the least recently used', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith({ maxLiveTokens: 5 });
      const minted: Extract<DemoMintResult, { ok: true }>[] = [];
      for (let i = 0; i < 5; i += 1) {
        minted.push(expectMinted(await h.store.mint({ ...agent, ipb: b(i), settings, now: t0 + i })));
      }
      expect(await h.store.mint({ ...agent, ipb: b(9), settings, now: t0 + MINUTE })).toEqual({
        ok: false,
        reason: 'capacity',
        retryAfterSec: null,
      });

      // The first token is used ten minutes in, so it is not the least recently used any more.
      await h.putSession('lru-1', demoSession('lru-1', minted[0]!), 900_000);
      expect(await h.store.touch({ sessionId: 'lru-1', token: minted[0]!.token, settings, now: t0 + 10 * MINUTE })).toBe(
        'touched',
      );

      const fresh = expectMinted(await h.store.mint({ ...agent, ipb: b(9), settings, now: t0 + 15 * MINUTE + 1 }));
      expect(fresh.evicted).toEqual({ ownOldest: 0, idle: 1 });
      expect(await h.readToken(minted[1]!.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.activeForBucket(b(1)), minted[1]!.tokenHash)).toBeNull();
      expect(await h.readToken(minted[0]!.tokenHash)).not.toBeNull();
      expect(await h.card(DEMO_KEYS.active)).toBe(5);
    });

    it(
      'evicts and never refuses: 3,001 mints across 200 buckets with 2,500 idle tokens',
      async () => {
        const { h, t0, b } = await ready();
        // Global windows wide open, so this row isolates the live-token cap.
        const settings = settingsWith({ mintGlobalMinute: 1_000_000, mintGlobalHour: 1_000_000 });
        const t1 = t0 + 20 * MINUTE;
        const refusals: string[] = [];
        let idleEvictions = 0;
        let ownEvictions = 0;
        for (let i = 0; i < 3_001; i += 1) {
          const now = i < 2_500 ? t0 + i : t1 + i;
          const result = await h.store.mint({ ...agent, ipb: b(i % 200), settings, now });
          if (!result.ok) refusals.push(result.reason);
          else {
            idleEvictions += result.evicted.idle;
            ownEvictions += result.evicted.ownOldest;
          }
        }
        expect(refusals).toEqual([]);
        expect(ownEvictions).toBe(0);
        expect(idleEvictions).toBe(1);
        expect(await h.card(DEMO_KEYS.active)).toBe(3_000);
      },
      120_000,
    );

    it('refuses a bucket over 5 % of a window that is over half full, while a fresh bucket succeeds', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith({ mintGlobalMinute: 200, mintGlobalHour: 1_000_000 });
      const heavy = b(0);
      // Below half the window, even all of it is fine.
      for (let i = 0; i < 6; i += 1) expectMinted(await h.store.mint({ ...agent, ipb: heavy, settings, now: t0 + i }));
      for (let i = 1; i <= 94; i += 1) expectMinted(await h.store.mint({ ...agent, ipb: b(i), settings, now: t0 + 10 + i }));

      // 101 of a 200 window; the heavy bucket holds 7 of them (6.9 %).
      expect(await h.store.mint({ ...agent, ipb: heavy, settings, now: t0 + 200 })).toEqual({
        ok: false,
        reason: 'busy',
        retryAfterSec: 60,
      });
      expectMinted(await h.store.mint({ ...agent, ipb: b(500), settings, now: t0 + 201 }));
      expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 + 202 }));
    });

    it('refuses only the ten busiest buckets over a full window', async () => {
      const { h, t0, b } = await ready();
      // A fair share of 1 can never be exceeded, so this row isolates the top-ten rule.
      const settings = settingsWith({ mintGlobalMinute: 100, mintGlobalHour: 1_000_000, mintFairShare: 1 });
      for (let heavy = 0; heavy < 10; heavy += 1) {
        for (let i = 0; i < 8; i += 1) {
          expectMinted(await h.store.mint({ ...agent, ipb: b(heavy), settings, now: t0 + heavy * 10 + i }));
        }
      }
      for (let light = 10; light < 30; light += 1) {
        expectMinted(await h.store.mint({ ...agent, ipb: b(light), settings, now: t0 + 200 + light }));
      }
      expect(await h.store.mint({ ...agent, ipb: b(3), settings, now: t0 + 300 })).toEqual({
        ok: false,
        reason: 'busy',
        retryAfterSec: 60,
      });
      expectMinted(await h.store.mint({ ...agent, ipb: b(10), settings, now: t0 + 301 }));
      expectMinted(await h.store.mint({ ...agent, ipb: b(999), settings, now: t0 + 302 }));

      // The hour window answers with its own retry.
      const hourly = settingsWith({ mintGlobalMinute: 1_000_000, mintGlobalHour: 3, mintFairShare: 1 });
      const later = t0 + DAY;
      for (let i = 0; i < 3; i += 1) expectMinted(await h.store.mint({ ...agent, ipb: b(2000 + i), settings: hourly, now: later + i }));
      expect(await h.store.mint({ ...agent, ipb: b(2000), settings: hourly, now: later + 10 })).toEqual({
        ok: false,
        reason: 'busy',
        retryAfterSec: 300,
      });
    });

    it('slides a used token to its full 14,400 s life and keeps the visit', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      await h.putSession('slide-1', demoSession('slide-1', minted, { parkedSessionId: 'parked-1', lastTouchAt: t0 }), 900_000);

      const now = t0 + 30_000;
      const result = await h.store.remint({
        sessionId: 'slide-1',
        app: 'workbench',
        sid: minted.record.sid,
        currentToken: minted.token,
        settings,
        now,
      });
      if (result.status !== 'ok') throw new Error(`expected a re-mint, got ${result.status}`);
      const newToken = result.session.accessToken;
      const newHash = sha256(newToken);
      expect(newToken).toMatch(DEMO_TOKEN_PATTERN);
      expect(newToken).not.toBe(minted.token);
      expect(result.session.accessExpiresAt).toBe(now + 14_400_000);

      const raw = JSON.parse(result.raw) as Record<string, unknown>;
      expect(raw).toMatchObject({
        kind: 'demo',
        demoSid: minted.record.sid,
        demoGeneration: 1,
        parkedSessionId: 'parked-1',
        lastTouchAt: t0,
        accessToken: newToken,
      });
      expect(await h.readSession('slide-1')).toEqual(raw);
      const sessionTtl = await h.pttl(sessionRecordKey(h.appName, 'slide-1'));
      expect(sessionTtl).toBeGreaterThan(14_390_000);

      const record = demoTokenSchema.parse(await h.readToken(newHash));
      expect(record).toEqual({ ...minted.record, iat: now, exp: now + 14_400_000 });
      expect(await h.pttl(DEMO_KEYS.token(newHash))).toBeGreaterThan(14_390_000);

      expect(await h.readToken(minted.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.active, newHash)).toBe(now);
      // The bucket remembers when the visit began.
      expect(await h.score(DEMO_KEYS.activeForBucket(b(1)), minted.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.activeForBucket(b(1)), newHash)).toBe(t0);
    });

    it('moves a re-minted visit to the new generation after a reset', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      await h.putSession('reset-1', demoSession('reset-1', minted), 900_000);
      await h.setLive(liveRecord(2, 'B'));

      const result = await h.store.remint({
        sessionId: 'reset-1',
        app: 'workbench',
        sid: minted.record.sid,
        currentToken: minted.token,
        settings,
        now: t0 + 1_000,
      });
      if (result.status !== 'ok') throw new Error(`expected a re-mint, got ${result.status}`);
      expect(result.session.tenantId).toBe(TENANT_B);
      expect(result.session.userId).toBe(USERS_B.agent);
      expect(JSON.parse(result.raw)).toMatchObject({ demoGeneration: 2 });
      const record = demoTokenSchema.parse(await h.readToken(sha256(result.session.accessToken)));
      expect(record).toMatchObject({ gen: 2, tenantId: TENANT_B, userId: USERS_B.agent, sid: minted.record.sid });
    });

    it('converges two concurrent re-mints of one visit on one token', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      await h.putSession('race-1', demoSession('race-1', minted), 900_000);

      const request = {
        sessionId: 'race-1',
        app: 'workbench',
        sid: minted.record.sid,
        currentToken: minted.token,
        settings,
        now: t0 + 5_000,
      } as const;
      const [first, second] = await Promise.all([h.store.remint(request), h.store.remint(request)]);
      expect([first.status, second.status].sort()).toEqual(['already', 'ok']);
      if (!('session' in first) || !('session' in second)) throw new Error('both callers need the session');
      expect(first.session.accessToken).toBe(second.session.accessToken);
      expect(first.raw).toBe(second.raw);

      const winner = sha256(first.session.accessToken);
      expect(await h.readToken(minted.tokenHash)).toBeNull();
      expect(await h.card(DEMO_KEYS.active)).toBe(1);
      expect(await h.score(DEMO_KEYS.active, winner)).toBe(t0 + 5_000);
      expect(await h.card(DEMO_KEYS.activeForBucket(b(1)))).toBe(1);
    });

    it('never revives a visit that has ended', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      const request = (sessionId: string) =>
        ({ sessionId, app: 'workbench', sid: minted.record.sid, currentToken: minted.token, settings, now: t0 + 1 }) as const;

      expect(await h.store.remint(request('missing'))).toEqual({ status: 'gone' });

      await h.putSession('oidc-1', { ...demoSession('oidc-1', minted), kind: 'oidc' }, 900_000);
      expect(await h.store.remint(request('oidc-1'))).toEqual({ status: 'gone' });

      await h.putSession('other-sid', demoSession('other-sid', minted, { demoSid: newDemoSid() }), 900_000);
      expect(await h.store.remint(request('other-sid'))).toEqual({ status: 'gone' });

      await h.putSession('other-persona', demoSession('other-persona', minted, { persona: 'employee' }), 900_000);
      expect(await h.store.remint(request('other-persona'))).toEqual({ status: 'gone' });

      // Revoked (or evicted, or expired): the token is gone, and so is the visit.
      await h.putSession('revoked', demoSession('revoked', minted), 900_000);
      expect(await h.store.revoke(minted.token)).toBe(true);
      expect(await h.store.remint(request('revoked'))).toEqual({ status: 'gone' });
      expect(await h.card(DEMO_KEYS.active)).toBe(0);
    });

    it('answers paused and unavailable, and ends a visit past 12 re-mints an hour', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      await h.putSession('limits-1', demoSession('limits-1', minted), 900_000);
      const base = { sessionId: 'limits-1', app: 'workbench', sid: minted.record.sid, settings } as const;

      await h.setPaused(true);
      expect(await h.store.remint({ ...base, currentToken: minted.token, now: t0 + 1 })).toEqual({ status: 'paused' });
      await h.setPaused(false);
      await h.setLive(null);
      expect(await h.store.remint({ ...base, currentToken: minted.token, now: t0 + 2 })).toEqual({ status: 'unavailable' });
      await h.setLive(liveRecord(1));

      let token = minted.token;
      for (let i = 0; i < 12; i += 1) {
        const result = await h.store.remint({ ...base, currentToken: token, now: t0 + 10 + i });
        if (result.status !== 'ok') throw new Error(`re-mint ${i + 1} answered ${result.status}`);
        token = result.session.accessToken;
      }
      expect(await h.store.remint({ ...base, currentToken: token, now: t0 + 30 })).toEqual({ status: 'limited' });
      // The next hour is a new allowance.
      expect((await h.store.remint({ ...base, currentToken: token, now: t0 + 3_600_000 })).status).toBe('ok');
    });

    it('touches a token at most once every five minutes, only ever forwards', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings, now: t0 }));
      await h.putSession('touch-1', demoSession('touch-1', minted), 900_000);
      const touch = (now: number, token = minted.token, sessionId = 'touch-1') =>
        h.store.touch({ sessionId, token, settings, now });

      expect(await touch(t0 + 60_000)).toBe('touched');
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBe(t0 + 60_000);
      expect(await h.readSession('touch-1')).toMatchObject({ lastTouchAt: t0 + 60_000 });
      // The touch keeps the record's own time-to-live.
      expect(await h.pttl(sessionRecordKey(h.appName, 'touch-1'))).toBeLessThanOrEqual(900_000);
      expect(await h.pttl(sessionRecordKey(h.appName, 'touch-1'))).toBeGreaterThan(880_000);

      expect(await touch(t0 + 200_000)).toBe('skipped');
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBe(t0 + 60_000);
      expect(await touch(t0 + 359_999)).toBe('skipped');
      expect(await touch(t0 + 360_000)).toBe('touched');
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBe(t0 + 360_000);

      // A replica with a slow clock never moves the score back.
      await h.putSession('touch-1', demoSession('touch-1', minted), 900_000);
      expect(await touch(t0 + 100_000)).toBe('touched');
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBe(t0 + 360_000);

      // A session that has moved on to another token, a missing one, and a non-demo token.
      expect(await touch(t0 + 999_000, newDemoToken())).toBe('skipped');
      expect(await touch(t0 + 999_000, minted.token, 'nobody')).toBe('gone');
      expect(await touch(t0 + 999_000, 'eyJhbGciOiJSUzI1NiJ9.e30.sig')).toBe('gone');

      // A revoked token is not brought back by a touch.
      await h.putSession('touch-1', demoSession('touch-1', minted), 900_000);
      await h.store.revoke(minted.token);
      expect(await touch(t0 + 2_000_000)).toBe('touched');
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBeNull();
    });

    it('revokes a token everywhere, idempotently', async () => {
      const { h, t0, b } = await ready();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb: b(1), settings: settingsWith(), now: t0 }));
      expect(await h.store.revoke(minted.token)).toBe(true);
      expect(await h.readToken(minted.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.active, minted.tokenHash)).toBeNull();
      expect(await h.score(DEMO_KEYS.activeForBucket(b(1)), minted.tokenHash)).toBeNull();
      expect(await h.store.revoke(minted.token)).toBe(false);
      expect(await h.store.revoke('not a token')).toBe(false);
    });

    it("creates each day's salt once and hands every caller the same one", async () => {
      const { h } = await ready();
      const day = `2099-0${1 + (slot % 9)}-1${slot % 10}`;
      const salt = await h.store.daySalt(day);
      expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await h.store.daySalt(day)).toBe(salt);
      const ttl = await h.pttl(DEMO_KEYS.salt(day));
      expect(ttl).toBeGreaterThan(172_000_000);
      expect(ttl).toBeLessThanOrEqual(172_800_000);
      const nextDay = `2099-0${1 + (slot % 9)}-2${slot % 10}`;
      expect(await h.store.daySalt(nextDay)).not.toBe(salt);
    });

    it('reads the status records strictly, and any pause as a pause', async () => {
      const { h } = await ready();
      const build = { v: 1, state: 'building', generation: 2, reason: 'scheduled', startedAt: 1, step: 'people', stepIndex: 3, steps: 11, etaSec: 180 };
      await h.write(DEMO_KEYS.build, JSON.stringify(build));
      await h.write(DEMO_KEYS.resetCooldown, JSON.stringify({ at: 5, generation: 1, reason: 'initial' }));
      await h.write(DEMO_KEYS.resetBackoff, '{"broken":');
      await h.write(DEMO_KEYS.paused, 'not even json');
      const records = await h.store.readStatusRecords();
      expect(records.live).toEqual(liveRecord(1));
      expect(records.cooldown).toEqual({ at: 5, generation: 1, reason: 'initial' });
      expect(records.backoff).toBeNull();
      expect(records.paused).toBe(true);
      expect(records.build).toEqual(build);

      for (const key of [DEMO_KEYS.build, DEMO_KEYS.resetCooldown, DEMO_KEYS.resetBackoff, DEMO_KEYS.paused]) {
        await h.write(key, null);
      }
      await h.setLive('{"v":2}');
      expect(await h.store.readStatusRecords()).toEqual({
        live: null,
        build: null,
        cooldown: null,
        paused: false,
        backoff: null,
      });
    });

    it('writes only exact demo key shapes, so no address can reach a key', async () => {
      const { h, t0 } = await ready();
      const address = '203.0.113.7';
      const ipb = ipBucket(address, await h.store.daySalt('2099-12-31'));
      const settings = settingsWith();
      const minted = expectMinted(await h.store.mint({ ...agent, ipb, settings, now: t0 }));
      await h.putSession('keys-1', demoSession('keys-1', minted), 900_000);
      const slid = await h.store.remint({ sessionId: 'keys-1', app: 'workbench', sid: minted.record.sid, currentToken: minted.token, settings, now: t0 + 1 });
      expect(slid.status).toBe('ok');
      if (slid.status === 'ok') {
        expect(await h.store.touch({ sessionId: 'keys-1', token: slid.session.accessToken, settings, now: t0 + 2 })).toBe('touched');
      }

      const keys = await h.keys();
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).not.toContain(address);
        expect(isDemoKey(key) || key.startsWith(`bff:${h.appName}:`)).toBe(true);
      }
      await expect(h.store.mint({ ...agent, ipb: address, settings, now: t0 })).rejects.toThrow(RangeError);
    });

    it('refuses programming errors before it touches the store', async () => {
      const { h, t0, b } = await ready();
      const settings = settingsWith();
      await expect(h.store.mint({ app: 'workbench', persona: 'admin', ipb: b(1), settings, now: t0 })).rejects.toThrow(
        RangeError,
      );
      await expect(h.store.mint({ ...agent, ipb: b(1), sid: 'demo-nope', settings, now: t0 })).rejects.toThrow(RangeError);
      await expect(
        h.store.remint({ sessionId: 'x', app: 'workbench', sid: 'nope', currentToken: newDemoToken(), settings, now: t0 }),
      ).rejects.toThrow(RangeError);
      await expect(
        h.store.remint({ sessionId: 'x', app: 'workbench', sid: newDemoSid(), currentToken: 'not-a-token', settings, now: t0 }),
      ).rejects.toThrow(RangeError);
      expect(await h.card(DEMO_KEYS.active)).toBe(0);
    });
  });
}

/* ------------------------------------------------------------------ The memory backend */

export function memoryHarness(store: MemoryDemoTokenStore = memoryDemoTokenStore({ appName: 'memory-contract' })): DemoStoreHarness {
  const ks = store.keyspace;
  const json = (raw: string | null): Record<string, unknown> | null => (raw === null ? null : (JSON.parse(raw) as Record<string, unknown>));
  return {
    store,
    appName: 'memory-contract',
    async setLive(record) {
      if (record === null) ks.del(DEMO_KEYS.live);
      else store.write(DEMO_KEYS.live, record);
    },
    async setPaused(paused) {
      if (paused) store.write(DEMO_KEYS.paused, { by: 'operator', at: 1, reason: 'test' });
      else ks.del(DEMO_KEYS.paused);
    },
    async write(key, value) {
      if (value === null) ks.del(key);
      else store.write(key, value);
    },
    async putSession(id, record, ttlMs) {
      store.write(sessionRecordKey('memory-contract', id), record, ttlMs);
    },
    async readSession(id) {
      return json(ks.get(sessionRecordKey('memory-contract', id)));
    },
    async readToken(hash) {
      return json(ks.get(DEMO_KEYS.token(hash)));
    },
    async pttl(key) {
      return ks.pttl(key);
    },
    async score(key, member) {
      return ks.zscore(key, member);
    },
    async card(key) {
      return ks.zcard(key);
    },
    async keys() {
      return ks.keys();
    },
  };
}

demoTokenStoreContract('memory', async () => memoryHarness());

/* ------------------------------------------------------------------ Memory only */

describe('the memory demo token store', () => {
  it('lets an unused token die at 900 s on its clock, as Redis does in real time', async () => {
    let clock = Date.UTC(2026, 9, 2, 12);
    const store = memoryDemoTokenStore({ clock: () => clock });
    store.write(DEMO_KEYS.live, liveRecord(1));
    const minted = expectMinted(
      await store.mint({ app: 'portal', persona: 'employee', ipb: 'unknown', settings: settingsWith(), now: clock }),
    );
    clock += 899_999;
    expect(store.keyspace.get(DEMO_KEYS.token(minted.tokenHash))).not.toBeNull();
    clock += 1;
    expect(store.keyspace.get(DEMO_KEYS.token(minted.tokenHash))).toBeNull();
  });

  it('shares its records with a session store view, as Redis shares one keyspace', async () => {
    const store = memoryDemoTokenStore({ appName: 'portal' });
    store.write(DEMO_KEYS.live, liveRecord(1));
    const now = Date.now();
    const minted = expectMinted(await store.mint({ app: 'portal', persona: 'employee', ipb: 'unknown', settings: settingsWith(), now }));
    await store.sessions.put(
      { id: 's1', accessToken: minted.token, refreshToken: null, accessExpiresAt: minted.record.exp, tenantId: TENANT_A, userId: USERS_A.employee, displayName: 'Emma Clarke', createdAt: now, ...{ kind: 'demo', persona: 'employee', demoSid: minted.record.sid, demoGeneration: 1 } },
      900,
    );
    expect(store.keyspace.exists(sessionRecordKey('portal', 's1'))).toBe(true);

    const slid = await store.remint({ sessionId: 's1', app: 'portal', sid: minted.record.sid, currentToken: minted.token, settings: settingsWith(), now: now + 1 });
    expect(slid.status).toBe('ok');
    const seen = await store.sessions.get('s1');
    expect(seen?.accessToken).not.toBe(minted.token);
    expect(seen?.accessToken).toBe(slid.status === 'ok' ? slid.session.accessToken : null);

    await store.sessions.putPending('state-1', { verifier: 'v', redirectTo: '/', createdAt: now }, 60);
    expect(await store.sessions.takePending('state-1')).toEqual({ verifier: 'v', redirectTo: '/', createdAt: now });
    expect(await store.sessions.takePending('state-1')).toBeNull();
    await store.sessions.delete('s1');
    expect(await store.sessions.get('s1')).toBeNull();
  });

  it('orders sorted sets as Redis does: by score, then by member', () => {
    const ks = new MemoryKeyspace(() => 0);
    ks.zadd('z', 2, 'b');
    ks.zadd('z', 2, 'a');
    ks.zadd('z', 1, 'c');
    expect(ks.zmembers('z')).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 2],
    ]);
    expect(ks.zrevrank('z', 'b')).toBe(0);
    expect(ks.zrevrank('z', 'a')).toBe(1);
    expect(ks.zfirstAtMost('z', 2)).toBe('c');
    expect(ks.zpopmin('z')).toBe('c');
    ks.zadd('z', 5, 'a', { gt: true });
    ks.zadd('z', 1, 'b', { gt: true });
    ks.zadd('z', 9, 'missing', { xx: true });
    expect(ks.zmembers('z')).toEqual([
      ['b', 2],
      ['a', 5],
    ]);
    ks.zremBelow('z', 5, true);
    expect(ks.zmembers('z')).toEqual([['a', 5]]);
    ks.zrem('z', 'a');
    expect(ks.exists('z')).toBe(false);
  });

  it('keeps or replaces a time-to-live as SET does', () => {
    let clock = 1_000;
    const ks = new MemoryKeyspace(() => clock);
    ks.set('k', 'v', { px: 100 });
    ks.set('k', 'w', { keepTtl: true });
    expect(ks.pttl('k')).toBe(100);
    ks.set('k', 'x');
    expect(ks.pttl('k')).toBe(-1);
    expect(ks.set('k', 'y', { nx: true })).toBe(false);
    expect(ks.incr('n')).toBe(1);
    ks.pexpire('n', 10);
    clock += 10;
    expect(ks.pttl('n')).toBe(-2);
  });
});

/* ------------------------------------------------------------------ Scripts and helpers */

describe('the demo scripts', () => {
  it('declare exactly the keys each script reads', () => {
    for (const [name, script] of Object.entries(DEMO_SCRIPTS)) {
      const indices = [...script.lua.matchAll(/KEYS\[(\d+)\]/g)].map((match) => Number(match[1]));
      expect(Math.max(...indices), name).toBe(script.numberOfKeys);
      for (let i = 1; i <= script.numberOfKeys; i += 1) expect(indices, `${name} KEYS[${i}]`).toContain(i);
    }
  });

  it('are registered once per client', () => {
    const calls: string[] = [];
    const client = { defineCommand: (name: string) => void calls.push(name) };
    defineDemoScripts(client);
    defineDemoScripts(client);
    expect(calls).toEqual(['itsmDemoMint', 'itsmDemoRemint', 'itsmDemoTouch', 'itsmDemoRevoke']);
  });

  it('read every reply and refuse one they do not know, without echoing a session', () => {
    expect(interpretMintReply(['busy', 60])).toEqual({ status: 'busy', retryAfterSec: 60 });
    expect(interpretMintReply(['capacity'])).toEqual({ status: 'capacity' });
    expect(interpretRemintReply(['limited'])).toEqual({ status: 'limited' });
    expect(interpretTouchReply('skipped')).toBe('skipped');
    expect(() => interpretMintReply('ok')).toThrow(/mint/);
    expect(() => interpretRemintReply(['weird', '{"accessToken":"itsmdemo_secret"}'])).toThrow(/remint/);
    try {
      interpretRemintReply(['weird', '{"accessToken":"itsmdemo_secret"}']);
    } catch (error) {
      expect(String(error)).not.toContain('itsmdemo_secret');
    }
    expect(() => interpretTouchReply(1)).toThrow(/touch/);
  });
});

describe('demo token helpers', () => {
  it('makes opaque tokens, their hashes and visit ids in the contract shapes', () => {
    const token = newDemoToken();
    expect(token).toMatch(DEMO_TOKEN_PATTERN);
    expect(newDemoToken()).not.toBe(token);
    expect(demoTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newDemoSid()).toMatch(DEMO_SID_PATTERN);
    expect(shortHash(demoTokenHash(token))).toHaveLength(8);
    expect(sessionRecordKey('workbench', 'abc')).toBe('bff:workbench:sess:abc');
  });

  it('turns settings into the milliseconds the scripts take', () => {
    expect(mintLimits(settingsWith())).toEqual({
      initialTtlMs: 900_000,
      ttlMs: 14_400_000,
      maxLive: 3_000,
      maxLivePerIp: 20,
      ipPerMin: 30,
      ipPerHour: 300,
      allPerMin: 300,
      allPerHour: 3_000,
      fairShare: 0.05,
      idleMs: 900_000,
    });
  });

  it('logs a mint with eight hex characters of its hash and nothing more', async () => {
    const store = memoryDemoTokenStore();
    store.write(DEMO_KEYS.live, liveRecord(4));
    const ipb = 'abcdef0123456789';
    const minted = expectMinted(await store.mint({ app: 'admin', persona: 'admin', ipb, settings: settingsWith(), now: Date.now() }));
    const line = demoMintLogLine('admin', minted);
    expect(line).toBe(`[bff:admin] demo mint result=ok persona=admin gen=4 token=${minted.tokenHash.slice(0, 8)}`);
    expect(line).not.toContain(minted.token);
    expect(line).not.toContain(minted.tokenHash);
    expect(line).not.toContain(ipb);
    expect(line).not.toContain(minted.record.sid);
    expect(demoMintLogLine('admin', { ok: false, reason: 'busy', retryAfterSec: 60 })).toBe(
      '[bff:admin] demo mint result=busy retryAfter=60',
    );
    expect(
      demoMintLogLine('admin', { ...minted, evicted: { ownOldest: 1, idle: 2 } }),
    ).toMatch(/ evicted=bucket:1,idle:2$/);
  });

  it('keeps one store per app, and a test can install its own', async () => {
    const installed = memoryDemoTokenStore();
    const appName = `seam-${randomUUID()}`;
    setDemoTokenStore(appName, installed);
    expect(await demoTokenStore({ appName, redisUrl: 'redis://never-used.invalid:6379' })).toBe(installed);
    setDemoTokenStore(appName, null);
  });
});

/* ------------------------------------------------------------------ Settings and BffConfig.demo */

const APP: AppIdentity = {
  appName: 'workbench',
  originEnvVar: 'WORKBENCH_ORIGIN',
  defaultOrigin: 'http://localhost:3100',
  defaultLanding: '/overview',
  signInPath: '/sign-in',
  signedOutPath: '/signed-out',
};

describe('the demo settings', () => {
  it('are off unless DEMO_MODE is on', () => {
    expect(readDemoSettings({})).toBeNull();
    expect(readDemoSettings({ DEMO_MODE: 'off' })).toBeNull();
    expect(readDemoSettings({ DEMO_MODE: ' ' })).toBeNull();
    expect(readDemoSettings({ DEMO_MODE: 'on' })).toEqual(DEMO_SETTING_DEFAULTS);
  });

  it('default to the figures of SPEC §4.8 and §4.9', () => {
    expect(DEMO_SETTING_DEFAULTS).toEqual({
      tokenTtlSeconds: 14_400,
      initialTokenTtlSeconds: 900,
      sessionMaxSeconds: 86_400,
      mintPerIpMinute: 30,
      mintPerIpHour: 300,
      mintGlobalMinute: 300,
      mintGlobalHour: 3_000,
      mintFairShare: 0.05,
      maxLiveTokens: 3_000,
      maxLivePerIp: 20,
      idleEvictSeconds: 900,
      remintPerHour: 12,
      touchIntervalSeconds: 300,
    });
  });

  it('read every tunable variable', () => {
    expect(
      readDemoSettings({
        DEMO_MODE: 'on',
        DEMO_TOKEN_TTL_SECONDS: '7200',
        DEMO_TOKEN_INITIAL_TTL_SECONDS: '600',
        DEMO_SESSION_MAX_SECONDS: '43200',
        DEMO_MINT_PER_IP_MINUTE: '10',
        DEMO_MINT_PER_IP_HOUR: '100',
        DEMO_MINT_GLOBAL_MINUTE: '200',
        DEMO_MINT_GLOBAL_HOUR: '2000',
        DEMO_MINT_FAIR_SHARE: '0.1',
        DEMO_MAX_LIVE_TOKENS: '1000',
        DEMO_MAX_LIVE_PER_IP: '5',
        DEMO_IDLE_EVICT_SECONDS: '300',
      }),
    ).toEqual({
      tokenTtlSeconds: 7_200,
      initialTokenTtlSeconds: 600,
      sessionMaxSeconds: 43_200,
      mintPerIpMinute: 10,
      mintPerIpHour: 100,
      mintGlobalMinute: 200,
      mintGlobalHour: 2_000,
      mintFairShare: 0.1,
      maxLiveTokens: 1_000,
      maxLivePerIp: 5,
      idleEvictSeconds: 300,
      remintPerHour: 12,
      touchIntervalSeconds: 300,
    });
  });

  it('refuse a value nobody meant, naming the variable', () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ DEMO_MODE: 'yes' }, /DEMO_MODE/],
      [{ DEMO_MODE: 'ON' }, /DEMO_MODE/],
      [{ DEMO_MODE: 'on', DEMO_MAX_LIVE_TOKENS: '1e3' }, /DEMO_MAX_LIVE_TOKENS/],
      [{ DEMO_MODE: 'on', DEMO_MAX_LIVE_TOKENS: '0' }, /DEMO_MAX_LIVE_TOKENS/],
      [{ DEMO_MODE: 'on', DEMO_MINT_PER_IP_MINUTE: '-1' }, /DEMO_MINT_PER_IP_MINUTE/],
      [{ DEMO_MODE: 'on', DEMO_TOKEN_TTL_SECONDS: '14400.5' }, /DEMO_TOKEN_TTL_SECONDS/],
      [{ DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '0' }, /DEMO_MINT_FAIR_SHARE/],
      [{ DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '1.5' }, /DEMO_MINT_FAIR_SHARE/],
      [{ DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '5%' }, /DEMO_MINT_FAIR_SHARE/],
      [{ DEMO_MODE: 'on', DEMO_TOKEN_INITIAL_TTL_SECONDS: '20000' }, /DEMO_TOKEN_INITIAL_TTL_SECONDS/],
      [{ DEMO_MODE: 'on', DEMO_MAX_LIVE_PER_IP: '5000' }, /DEMO_MAX_LIVE_PER_IP/],
    ];
    for (const [env, message] of cases) {
      expect(() => readDemoSettings(env), JSON.stringify(env)).toThrow(DemoSettingsError);
      expect(() => readDemoSettings(env), JSON.stringify(env)).toThrow(message);
    }
    expect(readDemoSettings({ DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '1' })?.mintFairShare).toBe(1);
    expect(readDemoSettings({ DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '.25' })?.mintFairShare).toBe(0.25);
  });

  it('read the client-address header in every mode', () => {
    expect(readClientIpHeader({})).toBe('x-forwarded-for');
    expect(readClientIpHeader({ DEMO_CLIENT_IP_HEADER: 'CF-Connecting-IP' })).toBe('cf-connecting-ip');
    expect(() => readClientIpHeader({ DEMO_CLIENT_IP_HEADER: 'x-real-ip' })).toThrow(/DEMO_CLIENT_IP_HEADER/);
  });
});

describe('BffConfig.demo', () => {
  it('is null unless the demo is on, and carries the settings when it is', () => {
    expect(readConfig(APP, {}).demo).toBeNull();
    expect(readConfig(APP, { DEMO_MODE: 'on' }).demo).toEqual(DEMO_SETTING_DEFAULTS);
    expect(readConfig(APP, { DEMO_MODE: 'on', DEMO_MAX_LIVE_PER_IP: '3' }).demo?.maxLivePerIp).toBe(3);
  });

  it('names the client-address header whether or not the demo is on', () => {
    expect(readConfig(APP, {}).clientIpHeader).toBe('x-forwarded-for');
    expect(readConfig(APP, { DEMO_CLIENT_IP_HEADER: 'cf-connecting-ip' }).clientIpHeader).toBe('cf-connecting-ip');
  });

  it('refuses a misconfigured demo as a ConfigurationError', () => {
    expect(() => readConfig(APP, { DEMO_MODE: 'maybe' })).toThrow(ConfigurationError);
    expect(() => readConfig(APP, { DEMO_MODE: 'on', DEMO_MINT_FAIR_SHARE: '2' })).toThrow(ConfigurationError);
    expect(() => readConfig(APP, { DEMO_CLIENT_IP_HEADER: 'forwarded' })).toThrow(ConfigurationError);
  });
});
