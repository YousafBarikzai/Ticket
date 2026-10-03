import 'dotenv/config';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_KEYS, demoWindow, type DemoLiveRecord } from '@itsm/contracts/demo';
import { redisDemoTokenStore } from '../../packages/bff/src/demo/redis-store.js';
import {
  demoTokenHash,
  sessionRecordKey,
  type DemoMintRequest,
  type DemoRemintRequest,
  type DemoTokenStore,
} from '../../packages/bff/src/demo/store.js';
import {
  demoTokenStoreContract,
  liveRecord,
  settingsWith,
  type DemoStoreHarness,
} from '../../packages/bff/src/__tests__/demo-store.test.js';
import { deleteTracked, preserveRedisKeys, scanKeys, trackRedisKeys } from '../support/redis-keys.js';

/**
 * The demo token store against real Redis: the Lua scripts of
 * `packages/bff/src/demo/lua.ts` are the code under test (SPEC §4.11, A3
 * §11.2 rows 23–24 and the Y-B1 rows).
 *
 * The behaviour is the shared contract suite from the BFF's unit tests,
 * which runs there against the memory mirror; importing it also runs those
 * memory rows here, which take a second and touch nothing.
 *
 * Redis hygiene (V-M2): BFF session records use this file's own app name,
 * `it-demo-token-store`; every key the store writes is tracked and deleted in
 * `afterAll`; and the demo's singletons (`demo:live`, `demo:active`, …) are
 * snapshotted first and put back exactly, so the isolation scan and a
 * developer's running demo find the Redis this file found.
 */

const APP = 'it-demo-token-store';
const SINGLETONS = [
  DEMO_KEYS.live,
  DEMO_KEYS.paused,
  DEMO_KEYS.active,
  DEMO_KEYS.build,
  DEMO_KEYS.resetCooldown,
  DEMO_KEYS.resetBackoff,
];

let redis: Redis;
let store: DemoTokenStore;
let restoreSingletons: () => Promise<void>;

/** Every key a call will write, tracked before it is made, so nothing outlives the file. */
function trackMint(request: DemoMintRequest): void {
  const now = request.now ?? Date.now();
  const keys = [DEMO_KEYS.activeForBucket(request.ipb)];
  for (const window of [demoWindow('m', now), demoWindow('h', now)]) {
    keys.push(
      DEMO_KEYS.mintPerBucket(request.app, request.persona, request.ipb, window),
      DEMO_KEYS.mintAll(window),
      DEMO_KEYS.mintTop(window),
    );
  }
  trackRedisKeys(redis, keys);
}

function trackRemint(request: DemoRemintRequest): void {
  trackRedisKeys(redis, [DEMO_KEYS.remint(request.sid, demoWindow('h', request.now ?? Date.now()))]);
}

/** The store, with every key it writes tracked for deletion. */
function trackingStore(inner: DemoTokenStore): DemoTokenStore {
  return {
    ...inner,
    async mint(request) {
      trackMint(request);
      const result = await inner.mint(request);
      if (result.ok) trackRedisKeys(redis, [DEMO_KEYS.token(result.tokenHash)]);
      return result;
    },
    async remint(request) {
      trackRemint(request);
      const result = await inner.remint(request);
      if (result.status === 'ok') trackRedisKeys(redis, [DEMO_KEYS.token(demoTokenHash(result.session.accessToken))]);
      return result;
    },
    async daySalt(dateKey) {
      trackRedisKeys(redis, [DEMO_KEYS.salt(dateKey)]);
      return inner.daySalt(dateKey);
    },
  };
}

async function redisHarness(): Promise<DemoStoreHarness> {
  // Each contract row starts from an empty demo: no live record, no pause,
  // no live tokens, no status records.
  await redis.del(...SINGLETONS);
  const json = (raw: string | null): Record<string, unknown> | null =>
    raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  return {
    store: trackingStore(store),
    appName: APP,
    async setLive(record: DemoLiveRecord | string | null) {
      if (record === null) await redis.del(DEMO_KEYS.live);
      else await redis.set(DEMO_KEYS.live, typeof record === 'string' ? record : JSON.stringify(record));
    },
    async setPaused(paused) {
      if (paused) await redis.set(DEMO_KEYS.paused, JSON.stringify({ by: 'operator', at: 1, reason: 'test' }));
      else await redis.del(DEMO_KEYS.paused);
    },
    async write(key, value) {
      if (value === null) await redis.del(key);
      else await redis.set(key, value);
    },
    async putSession(id, record, ttlMs) {
      await redis.set(sessionRecordKey(APP, id), JSON.stringify(record), 'PX', ttlMs);
    },
    async readSession(id) {
      return json(await redis.get(sessionRecordKey(APP, id)));
    },
    async readToken(hash) {
      return json(await redis.get(DEMO_KEYS.token(hash)));
    },
    async pttl(key) {
      return redis.pttl(key);
    },
    async score(key, member) {
      const score = await redis.zscore(key, member);
      return score === null ? null : Number(score);
    },
    async card(key) {
      return redis.zcard(key);
    },
    async keys() {
      return [...(await scanKeys(redis, 'demo:*')), ...(await scanKeys(redis, `bff:${APP}:*`))];
    },
  };
}

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 3 });
  restoreSingletons = await preserveRedisKeys(redis, SINGLETONS);
  trackRedisKeys(redis, [`bff:${APP}:*`]);
  // The test's own client is shared, so the store's `close()` leaves it to `afterAll`.
  store = redisDemoTokenStore(redis, APP);
});

afterAll(async () => {
  await deleteTracked();
  await restoreSingletons();
  // V-M2: nothing of this file's BFF keyspace survives it.
  expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
  await store.close();
  await redis.quit();
});

demoTokenStoreContract('redis', redisHarness);

describe('the demo token store in Redis', () => {
  it('leaves nothing behind: deleteTracked() removes a session written by remint', async () => {
    const harness = await redisHarness();
    await harness.setLive(liveRecord(1));
    const settings = settingsWith();
    const now = Date.UTC(2098, 5, 1, 12);
    const minted = await harness.store.mint({ app: 'admin', persona: 'admin', ipb: 'unknown', settings, now });
    if (!minted.ok) throw new Error(`expected a mint, got ${minted.reason}`);
    await harness.putSession('hygiene-1', { id: 'hygiene-1', kind: 'demo', accessToken: minted.token, refreshToken: null, accessExpiresAt: minted.record.exp, tenantId: minted.record.tenantId, userId: minted.record.userId, displayName: 'Jordan Lee', createdAt: now, persona: 'admin', demoGeneration: 1, demoSid: minted.record.sid }, 900_000);
    const slid = await harness.store.remint({ sessionId: 'hygiene-1', app: 'admin', sid: minted.record.sid, currentToken: minted.token, settings, now: now + 1 });
    expect(slid.status).toBe('ok');
    expect(await redis.exists(sessionRecordKey(APP, 'hygiene-1'))).toBe(1);

    const deleted = await deleteTracked();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await redis.exists(sessionRecordKey(APP, 'hygiene-1'))).toBe(0);
    expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
    expect(await redis.exists(DEMO_KEYS.token(demoTokenHash(slid.status === 'ok' ? slid.session.accessToken : '')))).toBe(0);
  });

  it('refuses to track a pattern that could empty the shared Redis', () => {
    expect(() => trackRedisKeys(redis, ['demo:*'])).toThrow(RangeError);
    expect(() => trackRedisKeys(redis, ['*'])).toThrow(RangeError);
    expect(() => trackRedisKeys(redis, ['bff:workbench:sess:*'])).toThrow(RangeError);
    expect(() => trackRedisKeys(redis, ['bff:workbench:sess:abc'])).toThrow(RangeError);
  });
});
