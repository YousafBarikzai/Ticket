import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { DEMO_IP_BUCKET_PATTERN, DEMO_KEYS, demoWindow } from '@itsm/contracts/demo';
import {
  demoBackoffSchema,
  demoBuildSchema,
  demoCooldownSchema,
  demoLiveSchema,
  parseDemoRecord,
} from '@itsm/contracts/demo/schemas';
import { closeRedisConnection, redisConnection } from '../redis-store.js';
import {
  defineDemoScripts,
  interpretMintReply,
  interpretRemintReply,
  interpretTouchReply,
  type ScriptArgument,
} from './lua.js';
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
  sessionRecordKey,
  settleMint,
  settleRemint,
  type DemoTokenStore,
} from './store.js';

/**
 * The Redis-backed demo token store: the Lua scripts of `lua.ts` over the
 * process's shared connection (`redisConnection`), in the same keyspace as
 * the session store, because the re-mint swaps session records in place.
 *
 * Kept in its own file, like the session store's, so importing the interface
 * never loads `ioredis`.
 */

/** A salt read from Redis is reused for this long before it is read again. */
const SALT_CACHE_MS = 10 * 60_000;
/** `demo:salt:<ukDateKey>` lives two days, so a request at 23:59 and one at 00:01 both find theirs (§4.2). */
const SALT_TTL_SECONDS = 172_800;

/**
 * `url` names the shared connection; a client may be passed instead, which a
 * test fixture uses to share its own connection (that client is then the
 * caller's to close).
 */
export function redisDemoTokenStore(source: string | Redis, appName: string): DemoTokenStore {
  const ownedUrl = typeof source === 'string' ? source : null;
  const redis = defineDemoScripts(ownedUrl !== null ? redisConnection(ownedUrl) : (source as Redis));
  const salts = new Map<string, { value: string; readAt: number }>();

  async function revokeHash(hash: string): Promise<boolean> {
    const existed = await redis.itsmDemoRevoke(DEMO_KEYS.token(hash), DEMO_KEYS.active, hash);
    return Number(existed) === 1;
  }

  return {
    async daySalt(dateKey) {
      const cached = salts.get(dateKey);
      if (cached && Date.now() - cached.readAt < SALT_CACHE_MS) return cached.value;

      const key = DEMO_KEYS.salt(dateKey);
      let salt = await redis.get(key);
      if (!salt) {
        // `NX`: the first replica to ask creates the day's salt and every
        // other one reads the same value back, so the three apps' BFFs agree
        // on every visitor's bucket.
        await redis.set(key, randomBytes(32).toString('base64url'), 'EX', SALT_TTL_SECONDS, 'NX');
        salt = await redis.get(key);
      }
      if (!salt) throw new Error('the demo IP salt could not be read back from Redis');
      // Only today's and yesterday's are ever asked for.
      if (salts.size >= 4) salts.clear();
      salts.set(dateKey, { value: salt, readAt: Date.now() });
      return salt;
    },

    async readStatusRecords() {
      const [live, build, cooldown, paused, backoff] = await redis.mget(
        DEMO_KEYS.live,
        DEMO_KEYS.build,
        DEMO_KEYS.resetCooldown,
        DEMO_KEYS.paused,
        DEMO_KEYS.resetBackoff,
      );
      return {
        live: parseDemoRecord(demoLiveSchema, live),
        build: parseDemoRecord(demoBuildSchema, build),
        cooldown: parseDemoRecord(demoCooldownSchema, cooldown),
        paused: paused !== null && paused !== undefined,
        backoff: parseDemoRecord(demoBackoffSchema, backoff),
      };
    },

    async mint(request) {
      assertMintable(request);
      const now = request.now ?? Date.now();
      const sid = request.sid ?? newDemoSid();
      assertSid(sid);
      const { app, persona, ipb } = request;
      const limits = mintLimits(request.settings);
      const token = newDemoToken();
      const hash = demoTokenHash(token);
      const minute = demoWindow('m', now);
      const hour = demoWindow('h', now);

      // The key builders refuse anything that is not a bucket, a hash or a
      // visit id, which is what keeps a raw address out of every key name.
      const keys: ScriptArgument[] = [
        DEMO_KEYS.live,
        DEMO_KEYS.paused,
        DEMO_KEYS.active,
        DEMO_KEYS.activeForBucket(ipb),
        DEMO_KEYS.token(hash),
        DEMO_KEYS.mintPerBucket(app, persona, ipb, minute),
        DEMO_KEYS.mintPerBucket(app, persona, ipb, hour),
        DEMO_KEYS.mintAll(minute),
        DEMO_KEYS.mintAll(hour),
        DEMO_KEYS.mintTop(minute),
        DEMO_KEYS.mintTop(hour),
      ];
      const args: ScriptArgument[] = [
        now,
        limits.initialTtlMs,
        persona,
        app,
        sid,
        hash,
        ipb,
        limits.maxLive,
        limits.maxLivePerIp,
        limits.ipPerMin,
        limits.ipPerHour,
        limits.allPerMin,
        limits.allPerHour,
        limits.fairShare,
        limits.idleMs,
        limits.ttlMs,
      ];
      const reply = interpretMintReply(await redis.itsmDemoMint(...keys, ...args));
      return settleMint(reply, { request, sid, now, token, hash }, revokeHash);
    },

    async remint(request) {
      const now = request.now ?? Date.now();
      assertSid(request.sid);
      assertToken(request.currentToken);
      const fallbackIpb = request.ipb ?? 'unknown';
      if (!DEMO_IP_BUCKET_PATTERN.test(fallbackIpb)) throw new RangeError('not a demo IP bucket');
      const newToken = newDemoToken();
      const oldHash = demoTokenHash(request.currentToken);
      const newHash = demoTokenHash(newToken);
      const ttlMs = request.settings.tokenTtlSeconds * 1000;

      const reply = interpretRemintReply(
        await redis.itsmDemoRemint(
          sessionRecordKey(appName, request.sessionId),
          DEMO_KEYS.live,
          DEMO_KEYS.paused,
          DEMO_KEYS.active,
          DEMO_KEYS.token(oldHash),
          DEMO_KEYS.token(newHash),
          DEMO_KEYS.remint(request.sid, demoWindow('h', now)),
          now,
          ttlMs,
          request.currentToken,
          newToken,
          oldHash,
          newHash,
          request.settings.remintPerHour,
          request.sid,
          request.app,
          personaForApp(request.app),
          fallbackIpb,
        ),
      );
      return settleRemint(reply);
    },

    async touch(request) {
      // A session holding anything but a demo token is not a demo session.
      if (!isDemoToken(request.token)) return 'gone';
      const now = request.now ?? Date.now();
      return interpretTouchReply(
        await redis.itsmDemoTouch(
          sessionRecordKey(appName, request.sessionId),
          DEMO_KEYS.active,
          now,
          demoTokenHash(request.token),
          request.settings.touchIntervalSeconds * 1000,
          request.token,
        ),
      );
    },

    async revoke(token) {
      // Never stored, so there is nothing to delete — and a value that is
      // not a token is never hashed into a key.
      if (!isDemoToken(token)) return false;
      return revokeHash(demoTokenHash(token));
    },

    async close() {
      if (ownedUrl !== null) await closeRedisConnection(ownedUrl);
    },
  };
}
