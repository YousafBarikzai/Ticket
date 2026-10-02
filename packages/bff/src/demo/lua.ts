import type Redis from 'ioredis';

/**
 * The demo token store's Redis scripts (SPEC §4.3, A3 §3.3), registered with
 * ioredis `defineCommand` so each runs as one `EVALSHA` round trip.
 *
 * Each script is atomic, which is the point: the mint limits, the evictions
 * and the session compare-and-swap are decisions two replicas of an app make
 * about the same visitors at the same moment, and Redis running the whole
 * decision as one step is what makes them agree. Redis 7 (Railway and CI)
 * ships Lua with `cjson`.
 *
 * Every script takes `now` from its caller rather than reading the server's
 * clock: windows and evictions then follow the BFF's own clock, which is the
 * one the token's `iat` and `exp` are written in, and a test can place mints
 * in time without waiting. Key time-to-lives stay real time, as Redis keeps
 * them.
 *
 * `memory-store.ts` mirrors every script line for line and returns the same
 * replies; `interpret*` below read both, so the two can only differ in the
 * steps, which the shared contract suite checks.
 *
 * Window and record lifetimes, in milliseconds: minute windows 120,000 and
 * hour windows 7,200,000 (§4.2 `EX 120` / `EX 7200`); a bucket's live-token
 * set 90,000,000 (`EX 90000`); a bucket member older than 86,400,000 is a
 * visit past `DEMO_SESSION_MAX_SECONDS` and is dropped.
 */

/** Shared by every script. Lua has no modules in `EVAL`, so the helpers are prepended to each. */
const HELPERS = `
local function windowed_incr(key, ttl)
  local n = redis.call('INCR', key)
  -- A window that somehow lost its expiry would refuse its bucket for ever.
  if n == 1 or redis.call('PTTL', key) < 0 then redis.call('PEXPIRE', key, ttl) end
  return n
end

local function valid_hash(value)
  return type(value) == 'string' and #value == 64 and string.match(value, '^[0-9a-f]+$') ~= nil
end

local function valid_ipb(value)
  return type(value) == 'string'
    and (value == 'unknown' or (#value == 16 and string.match(value, '^[0-9a-f]+$') ~= nil))
end

-- demo:live and the persona's user; nil when either is missing or malformed.
local function read_live(key, persona)
  local raw = redis.call('GET', key)
  if not raw then return nil end
  local ok, live = pcall(cjson.decode, raw)
  if not ok or type(live) ~= 'table' or type(live.tenantId) ~= 'string'
    or type(live.generation) ~= 'number' or type(live.personas) ~= 'table' then
    return nil
  end
  local person = live.personas[persona]
  if type(person) ~= 'table' or type(person.userId) ~= 'string' then return nil end
  return live, person
end

-- A token gone from everywhere: its record, demo:active and its bucket's set.
local function forget(active, member)
  redis.call('ZREM', active, member)
  if not valid_hash(member) then return end
  local key = 'demo:tok:' .. member
  local raw = redis.call('GET', key)
  if raw then
    local ok, record = pcall(cjson.decode, raw)
    if ok and type(record) == 'table' and valid_ipb(record.ipb) then
      redis.call('ZREM', 'demo:active:ipb:' .. record.ipb, member)
    end
  end
  redis.call('DEL', key)
end
`;

/**
 * `mint` v3 (Y-B1). KEYS: live, paused, active, the bucket's live set, the
 * new token, the bucket's minute and hour counters, the global minute and
 * hour counters, the global minute and hour top-bucket sets. ARGV: now,
 * initial TTL, persona, app, sid, new hash, bucket, live cap, live cap per
 * bucket, per-bucket minute and hour caps, global minute and hour caps, fair
 * share, idle time, full TTL.
 *
 * Replies: `{'ok', tenantId, userId, generation, exp, evictedOwn,
 * evictedIdle}`, `{'busy', retryAfterSec}`, `{'paused'}`, `{'unavailable'}`,
 * `{'capacity'}`.
 */
export const MINT_LUA = `${HELPERS}
local now = tonumber(ARGV[1])
local initial_ttl = tonumber(ARGV[2])
local persona, app, sid, new_hash, ipb = ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7]
local max_live, max_live_per_ip = tonumber(ARGV[8]), tonumber(ARGV[9])
local ip_per_min, ip_per_hour = tonumber(ARGV[10]), tonumber(ARGV[11])
local all_per_min, all_per_hour = tonumber(ARGV[12]), tonumber(ARGV[13])
local fair_share, idle_ms, ttl_ms = tonumber(ARGV[14]), tonumber(ARGV[15]), tonumber(ARGV[16])

-- Closed or not built: refused before anything is counted.
if redis.call('EXISTS', KEYS[2]) == 1 then return {'paused'} end
local live, person = read_live(KEYS[1], persona)
if not live then return {'unavailable'} end

-- Per bucket, app and persona.
if windowed_incr(KEYS[6], 120000) > ip_per_min then return {'busy', 60} end
if windowed_incr(KEYS[7], 7200000) > ip_per_hour then return {'busy', 3600} end

-- Global windows. Over the cap, only the ten busiest buckets are refused;
-- over half of it, a bucket above its fair share is. Nobody else ever is.
local windows = {
  { KEYS[8], all_per_min, KEYS[10], 60, 120000 },
  { KEYS[9], all_per_hour, KEYS[11], 300, 7200000 },
}
for _, w in ipairs(windows) do
  local total = windowed_incr(w[1], w[5])
  local mine = tonumber(redis.call('ZINCRBY', w[3], 1, ipb))
  if redis.call('PTTL', w[3]) < 0 then redis.call('PEXPIRE', w[3], w[5]) end
  if total > w[2] then
    local rank = redis.call('ZREVRANK', w[3], ipb)
    if rank and rank < 10 then return {'busy', w[4]} end
  end
  if total > w[2] * 0.5 and mine > 5 and mine / total > fair_share then return {'busy', w[4]} end
end

-- This bucket's live tokens: past its cap, its own oldest goes. Never refuses.
local evicted_own = 0
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now - 86400000)
while redis.call('ZCARD', KEYS[4]) >= max_live_per_ip do
  local popped = redis.call('ZPOPMIN', KEYS[4])
  if #popped == 0 then break end
  forget(KEYS[3], popped[1])
  evicted_own = evicted_own + 1
end

-- Every live token. A score is a last use, and no token outlives its last
-- use by more than the full TTL, so anything older is certainly dead. Past
-- the cap, the least recently used idle token goes; only when none is idle
-- is the mint refused.
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', '(' .. (now - ttl_ms))
local evicted_idle = 0
while redis.call('ZCARD', KEYS[3]) >= max_live do
  if evicted_idle >= 25 then return {'capacity'} end
  local victims = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now - idle_ms, 'LIMIT', 0, 1)
  if #victims == 0 then return {'capacity'} end
  forget(KEYS[3], victims[1])
  evicted_idle = evicted_idle + 1
end

local exp = now + initial_ttl
redis.call('SET', KEYS[5], cjson.encode({
  v = 1, tenantId = live.tenantId, userId = person.userId, persona = persona, app = app,
  sid = sid, gen = live.generation, iat = now, exp = exp, ipb = ipb,
}), 'PX', initial_ttl)
redis.call('ZADD', KEYS[3], now, new_hash)
redis.call('ZADD', KEYS[4], now, new_hash)
redis.call('PEXPIRE', KEYS[4], 90000000)
return {'ok', live.tenantId, person.userId, live.generation, exp, evicted_own, evicted_idle}
`;

/**
 * `remint`: a compare-and-swap on the BFF session record, so two replicas
 * re-minting one visit converge on one token (A3 §3.3, amended by §4.3).
 * KEYS: the session, live, paused, active, the old token, the new token, the
 * visit's hourly re-mint counter. ARGV: now, full TTL, old token, new token,
 * old hash, new hash, re-mints per hour, sid, app, persona, a fallback bucket.
 *
 * The old token must still exist: a token that expired, was evicted or was
 * revoked has ended its visit, and a slide must not bring it back.
 *
 * Replies: `{'ok', session}`, `{'already', session}`, `{'gone'}`,
 * `{'paused'}`, `{'unavailable'}`, `{'limited'}`.
 */
export const REMINT_LUA = `${HELPERS}
local now, ttl = tonumber(ARGV[1]), tonumber(ARGV[2])
local old_token, new_token, old_hash, new_hash = ARGV[3], ARGV[4], ARGV[5], ARGV[6]
local max_per_hour, sid, app, persona, fallback_ipb = tonumber(ARGV[7]), ARGV[8], ARGV[9], ARGV[10], ARGV[11]

local raw_session = redis.call('GET', KEYS[1])
if not raw_session then return {'gone'} end
local ok, session = pcall(cjson.decode, raw_session)
if not ok or type(session) ~= 'table' or session.kind ~= 'demo'
  or session.demoSid ~= sid or session.persona ~= persona then
  return {'gone'}
end
-- Another request rotated it first: its session is the answer.
if session.accessToken ~= old_token then return {'already', raw_session} end
local old_raw = redis.call('GET', KEYS[5])
if not old_raw then return {'gone'} end
if redis.call('EXISTS', KEYS[3]) == 1 then return {'paused'} end
local live, person = read_live(KEYS[2], persona)
if not live then return {'unavailable'} end
if windowed_incr(KEYS[7], 7200000) > max_per_hour then return {'limited'} end

local ipb = fallback_ipb
local decoded, old = pcall(cjson.decode, old_raw)
if decoded and type(old) == 'table' and valid_ipb(old.ipb) then ipb = old.ipb end
if not valid_ipb(ipb) then ipb = 'unknown' end

local exp = now + ttl
redis.call('SET', KEYS[6], cjson.encode({
  v = 1, tenantId = live.tenantId, userId = person.userId, persona = persona, app = app,
  sid = sid, gen = live.generation, iat = now, exp = exp, ipb = ipb,
}), 'PX', ttl)
redis.call('DEL', KEYS[5])
redis.call('ZREM', KEYS[4], old_hash)
redis.call('ZADD', KEYS[4], now, new_hash)
-- The bucket keeps the visit's original mint time, so "oldest" still means
-- the oldest visit, and a visit past its maximum age still ages out.
local bucket = 'demo:active:ipb:' .. ipb
local since = redis.call('ZSCORE', bucket, old_hash)
redis.call('ZREM', bucket, old_hash)
redis.call('ZADD', bucket, since or now, new_hash)
redis.call('PEXPIRE', bucket, 90000000)

session.accessToken = new_token
session.accessExpiresAt = exp
session.tenantId = live.tenantId
session.userId = person.userId
session.demoGeneration = live.generation
local encoded = cjson.encode(session)
redis.call('SET', KEYS[1], encoded, 'PX', ttl)
return {'ok', encoded}
`;

/**
 * `touch` (Y-B1): moves the token's `demo:active` score to now — only up
 * (`GT`) and only for a member that exists (`XX`) — at most once per
 * interval per session, recorded as `lastTouchAt` on the session itself so
 * every replica sees the same throttle. KEYS: the session, active. ARGV:
 * now, hash, interval, token.
 *
 * Replies: `'touched'`, `'skipped'`, `'gone'`.
 */
export const TOUCH_LUA = `
local now = tonumber(ARGV[1])
local raw_session = redis.call('GET', KEYS[1])
if not raw_session then return 'gone' end
local ok, session = pcall(cjson.decode, raw_session)
if not ok or type(session) ~= 'table' or session.kind ~= 'demo' then return 'gone' end
if session.accessToken ~= ARGV[4] then return 'skipped' end
local last = tonumber(session.lastTouchAt)
if last and now - last < tonumber(ARGV[3]) then return 'skipped' end
redis.call('ZADD', KEYS[2], 'XX', 'GT', now, ARGV[2])
session.lastTouchAt = now
redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
return 'touched'
`;

/**
 * `revoke`: the token's record, its `demo:active` entry and its bucket entry.
 * Idempotent. KEYS: the token, active. ARGV: hash. Reply: 1 when the record
 * still existed, else 0.
 */
export const REVOKE_LUA = `${HELPERS}
local existed = redis.call('EXISTS', KEYS[1])
forget(KEYS[2], ARGV[1])
return existed
`;

export type ScriptArgument = string | number;

/** The commands `defineDemoScripts` adds to a client. */
export interface DemoScriptCommands {
  itsmDemoMint(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
  itsmDemoRemint(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
  itsmDemoTouch(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
  itsmDemoRevoke(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
}

/** Each command, its script and how many of its leading arguments are keys. */
export const DEMO_SCRIPTS: Readonly<Record<keyof DemoScriptCommands, { readonly numberOfKeys: number; readonly lua: string }>> =
  Object.freeze({
    itsmDemoMint: { numberOfKeys: 11, lua: MINT_LUA },
    itsmDemoRemint: { numberOfKeys: 7, lua: REMINT_LUA },
    itsmDemoTouch: { numberOfKeys: 2, lua: TOUCH_LUA },
    itsmDemoRevoke: { numberOfKeys: 2, lua: REVOKE_LUA },
  });

const defined = new WeakSet<object>();

/**
 * Registers the four scripts on a client, once. ioredis sends `EVALSHA` and
 * falls back to `EVAL` when the server has not seen a script (a restart, a
 * `SCRIPT FLUSH`), so nothing here has to manage the script cache.
 */
export function defineDemoScripts<T extends Pick<Redis, 'defineCommand'>>(redis: T): T & DemoScriptCommands {
  if (!defined.has(redis)) {
    for (const [name, script] of Object.entries(DEMO_SCRIPTS)) redis.defineCommand(name, script);
    defined.add(redis);
  }
  return redis as T & DemoScriptCommands;
}

/* ------------------------------------------------------------------ Replies */

/** A mint reply, read the same way for Redis and for the memory mirror. */
export type MintReply =
  | {
      readonly status: 'ok';
      readonly tenantId: string;
      readonly userId: string;
      readonly generation: number;
      readonly exp: number;
      readonly evictedOwn: number;
      readonly evictedIdle: number;
    }
  | { readonly status: 'busy'; readonly retryAfterSec: number }
  | { readonly status: 'paused' | 'unavailable' | 'capacity' };

function unexpected(script: string, reply: unknown): Error {
  // The reply names no token: the scripts never return one.
  return new Error(`the demo ${script} script answered unexpectedly: ${JSON.stringify(reply)?.slice(0, 200)}`);
}

export function interpretMintReply(reply: unknown): MintReply {
  if (!Array.isArray(reply)) throw unexpected('mint', reply);
  const [status, ...rest] = reply as unknown[];
  switch (status) {
    case 'ok': {
      const [tenantId, userId, generation, exp, evictedOwn, evictedIdle] = rest;
      return {
        status,
        tenantId: String(tenantId),
        userId: String(userId),
        generation: Number(generation),
        exp: Number(exp),
        evictedOwn: Number(evictedOwn ?? 0),
        evictedIdle: Number(evictedIdle ?? 0),
      };
    }
    case 'busy':
      return { status, retryAfterSec: Number(rest[0]) };
    case 'paused':
    case 'unavailable':
    case 'capacity':
      return { status };
    default:
      throw unexpected('mint', reply);
  }
}

export type RemintReply =
  | { readonly status: 'ok' | 'already'; readonly raw: string }
  | { readonly status: 'gone' | 'paused' | 'unavailable' | 'limited' };

export function interpretRemintReply(reply: unknown): RemintReply {
  if (!Array.isArray(reply)) throw unexpected('remint', reply);
  const [status, raw] = reply as unknown[];
  switch (status) {
    case 'ok':
    case 'already':
      if (typeof raw !== 'string') throw unexpected('remint', [status]);
      return { status, raw };
    case 'gone':
    case 'paused':
    case 'unavailable':
    case 'limited':
      return { status };
    default:
      throw unexpected('remint', [status]);
  }
}

export function interpretTouchReply(reply: unknown): 'touched' | 'skipped' | 'gone' {
  if (reply === 'touched' || reply === 'skipped' || reply === 'gone') return reply;
  throw unexpected('touch', reply);
}
