import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DEMO_CAPS, DEMO_KEYS, demoWindow, isDemoHeroRef, isDemoLockedSetting, type DemoCapCategory } from '@itsm/contracts/demo';
import {
  DemoDisabledError,
  DemoLimitError,
  DemoUnavailableError,
  RateLimitedError,
  cache,
  loadConfig,
  logger,
  metrics,
  type DemoContext,
  type PlatformConfig,
  type TenantContext,
} from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { DEMO_STORE_TIMEOUT_MS } from '../auth/demo-token.js';
import {
  DEMO_ROUTE_POLICY,
  DEMO_SHORT_CIRCUITS,
  READ_LIKE_POSTS,
  demoRouteKey,
  isUnsafeMethod,
  type DemoRoutePolicy,
} from './demo-policy.js';

/**
 * The shared demo's request policy (SPEC v3 §4.7.3, §4.7.4, §4.7.7, §4.8;
 * annex A3 §7.5, §7.6, §7.9, §8.2).
 *
 * One `preHandler`, registered after the rate limiter, that runs only for a
 * request whose context is a verified demo session. A standard tenant's
 * request returns on the first line and never touches Redis: none of this
 * exists for a real customer. For a demo visit it does, in this order:
 *
 *   1. the short-circuits for the shared personas' sessions (§4.7.3);
 *   2. the read budget of the visitor's IP bucket, on every request (Y-M2);
 *   3. for an unsafe method not in `READ_LIKE_POSTS`, the write budgets: per
 *      visit per minute, per visit in all, per bucket per hour, and above the
 *      tenant's hourly alert level a refusal for the ten busiest buckets only
 *      — never for everybody (Y-M1);
 *   4. the route's policy from `demo-policy.ts`: a high-visibility cap, a
 *      guard (the personas' own accounts, the locked settings, the story's
 *      hero tickets) or read-only.
 *
 * A cap is counted on the way in and given back in `onResponse` when the
 * request fails, so a typo in a form costs the visitor nothing.
 *
 * The budgets fail closed: a Redis error or a Redis that does not answer
 * within two seconds is 503 `demo_unavailable`, never an unmetered write.
 * That costs nothing extra, because without Redis no demo token verifies
 * either. Every counter lives in a `DEMO_KEYS` name holding a salted IP
 * bucket or the visit id, never an address (§4.7.6).
 */

/* ------------------------------------------------------------------ The counter store */

/** The per-request budgets, from the API's configuration (§4.9). */
export interface DemoBudgetLimits {
  /** `DEMO_READS_PER_IP_MINUTE`. */
  readonly readsPerBucketMinute: number;
  /** `DEMO_WRITES_PER_MINUTE`, per visit. */
  readonly writesPerMinute: number;
  /** `DEMO_WRITES_PER_SESSION`, per visit, in all. */
  readonly writesPerVisit: number;
  /** `DEMO_WRITES_PER_IP_HOUR`. */
  readonly writesPerBucketHour: number;
  /** `DEMO_WRITES_ALERT_PER_HOUR`: above it only the busiest buckets are refused. */
  readonly writesAlertPerHour: number;
}

/** How many of the hour's busiest buckets are refused above the alert level (Y-M1). */
export const DEMO_TOP_WRITERS_REFUSED = 10;

/** The keys one request's budgets are counted under (§4.2). */
export interface DemoSpendKeys {
  readonly readsPerBucket: string;
  readonly writesPerVisitMinute: string;
  readonly writesPerVisit: string;
  readonly writesPerBucketHour: string;
  readonly tenantWritesHour: string;
  readonly topWritersHour: string;
}

export interface DemoSpend {
  readonly keys: DemoSpendKeys;
  /** The visitor's salted bucket: the member of the busiest-writers set. */
  readonly ipb: string;
  /** Whether this request is a write (an unsafe method not in `READ_LIKE_POSTS`). */
  readonly write: boolean;
  readonly limits: DemoBudgetLimits;
}

/** Which budget refused a request. */
export type DemoBudget = 'reads' | 'writes-minute' | 'writes-visit' | 'writes-bucket' | 'writes-ceiling';

export type DemoSpendOutcome =
  /** `tenantWrites`: the demo tenant's writes this hour including this one; `null` for a read. */
  | { readonly ok: true; readonly tenantWrites: number | null }
  | { readonly ok: false; readonly budget: DemoBudget };

/** The two counters of one high-visibility cap: this visit's, and every visitor's of this generation. */
export interface DemoCapClaim {
  readonly category: DemoCapCategory;
  readonly visitKey: string;
  readonly generationKey: string;
}

export type DemoCapOutcome = { readonly ok: true } | { readonly ok: false; readonly exhausted: 'visit' | 'generation' };

/**
 * Where the counters live. Redis in every deployment; replaceable so the unit
 * tests can drive the policy without one and the integration tests can stand
 * in a store that fails.
 */
export interface DemoCounterStore {
  /** Counts one request against the read budget and, for a write, the write budgets; a refused write counts nothing. */
  spend(spend: DemoSpend): Promise<DemoSpendOutcome>;
  /** Takes one use of a cap, unless the visit's or the generation's is used up. */
  takeCap(claim: DemoCapClaim, limits: { readonly perVisit: number; readonly perGeneration: number }): Promise<DemoCapOutcome>;
  /** Gives one use back to both counters, never below zero. */
  giveBackCap(claim: DemoCapClaim): Promise<void>;
}

/**
 * The scripts. Each decision is one atomic `EVALSHA`, because two API
 * replicas count the same visitors at the same moment: checking a budget
 * and then counting in two round trips would let a burst through between
 * them. Windows expire as §4.2 says (minute 120 s, hour 7,200 s, visit total
 * 86,400 s, caps 90,000 s); a counter that somehow lost its expiry is given
 * one back rather than refusing its visitor for ever.
 */
const HELPERS = `
local function windowed_incr(key, ttl)
  local n = redis.call('INCR', key)
  if n == 1 or redis.call('PTTL', key) < 0 then redis.call('PEXPIRE', key, ttl) end
  return n
end

local function current(key)
  return tonumber(redis.call('GET', key) or '0') or 0
end
`;

/**
 * KEYS: reads per bucket (minute), writes per visit (minute), writes per
 * visit (total), writes per bucket (hour), tenant writes (hour), busiest
 * writers (hour). ARGV: reads limit, write flag, per-minute, per-visit,
 * per-bucket-hour, alert level, bucket, how many busiest buckets to refuse.
 *
 * Reads count every request, refused or not. A write is checked against
 * every write budget first and counted only when all of them allow it, so
 * a refused write does not use up the visit's 500.
 */
const SPEND = `${HELPERS}
local reads = windowed_incr(KEYS[1], 120000)
if reads > tonumber(ARGV[1]) then return {'reads'} end
if ARGV[2] ~= '1' then return {'ok', -1} end
if current(KEYS[2]) >= tonumber(ARGV[3]) then return {'writes-minute'} end
if current(KEYS[3]) >= tonumber(ARGV[4]) then return {'writes-visit'} end
if current(KEYS[4]) >= tonumber(ARGV[5]) then return {'writes-bucket'} end
if current(KEYS[5]) >= tonumber(ARGV[6]) then
  local rank = redis.call('ZREVRANK', KEYS[6], ARGV[7])
  if rank and rank < tonumber(ARGV[8]) then return {'writes-ceiling'} end
end
windowed_incr(KEYS[2], 120000)
windowed_incr(KEYS[3], 86400000)
windowed_incr(KEYS[4], 7200000)
local all = windowed_incr(KEYS[5], 7200000)
redis.call('ZINCRBY', KEYS[6], 1, ARGV[7])
if redis.call('PTTL', KEYS[6]) < 0 then redis.call('PEXPIRE', KEYS[6], 7200000) end
return {'ok', all}
`;

/** KEYS: the visit's counter, the generation's. ARGV: per visit, per generation. */
const CAP_TAKE = `${HELPERS}
if current(KEYS[1]) >= tonumber(ARGV[1]) then return {'visit'} end
if current(KEYS[2]) >= tonumber(ARGV[2]) then return {'generation'} end
windowed_incr(KEYS[1], 90000000)
windowed_incr(KEYS[2], 90000000)
return {'ok'}
`;

/** KEYS: the counters to give one back to. */
const CAP_GIVE = `${HELPERS}
for i = 1, #KEYS do
  if current(KEYS[i]) > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
`;

type RedisClient = ReturnType<typeof cache>;
type ScriptArgument = string | number;

interface DemoPolicyCommands {
  itsmDemoSpend(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
  itsmDemoCapTake(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
  itsmDemoCapGive(...keysAndArgs: ScriptArgument[]): Promise<unknown>;
}

const defined = new WeakSet<object>();

function withScripts(redis: RedisClient): RedisClient & DemoPolicyCommands {
  if (!defined.has(redis)) {
    redis.defineCommand('itsmDemoSpend', { numberOfKeys: 6, lua: SPEND });
    redis.defineCommand('itsmDemoCapTake', { numberOfKeys: 2, lua: CAP_TAKE });
    redis.defineCommand('itsmDemoCapGive', { numberOfKeys: 2, lua: CAP_GIVE });
    defined.add(redis);
  }
  return redis as RedisClient & DemoPolicyCommands;
}

const BUDGETS: readonly DemoBudget[] = ['reads', 'writes-minute', 'writes-visit', 'writes-bucket', 'writes-ceiling'];

/** Reads a script's reply; anything unexpected is an error, which the plugin answers with 503. */
export function interpretSpendReply(reply: unknown): DemoSpendOutcome {
  if (!Array.isArray(reply) || typeof reply[0] !== 'string') throw new Error('the demo budget script answered with an unexpected shape');
  if (reply[0] === 'ok') {
    const all = Number(reply[1]);
    return { ok: true, tenantWrites: Number.isFinite(all) && all >= 0 ? all : null };
  }
  const budget = reply[0] as DemoBudget;
  if (!BUDGETS.includes(budget)) throw new Error(`the demo budget script answered ${JSON.stringify(reply[0])}`);
  return { ok: false, budget };
}

export function interpretCapReply(reply: unknown): DemoCapOutcome {
  if (!Array.isArray(reply) || typeof reply[0] !== 'string') throw new Error('the demo cap script answered with an unexpected shape');
  if (reply[0] === 'ok') return { ok: true };
  if (reply[0] === 'visit' || reply[0] === 'generation') return { ok: false, exhausted: reply[0] };
  throw new Error(`the demo cap script answered ${JSON.stringify(reply[0])}`);
}

/** The counters in Redis, on the API's shared cache connection. */
export function redisDemoCounterStore(client: () => RedisClient = cache): DemoCounterStore {
  return {
    async spend({ keys, ipb, write, limits }) {
      const reply = await withScripts(client()).itsmDemoSpend(
        keys.readsPerBucket,
        keys.writesPerVisitMinute,
        keys.writesPerVisit,
        keys.writesPerBucketHour,
        keys.tenantWritesHour,
        keys.topWritersHour,
        limits.readsPerBucketMinute,
        write ? '1' : '0',
        limits.writesPerMinute,
        limits.writesPerVisit,
        limits.writesPerBucketHour,
        limits.writesAlertPerHour,
        ipb,
        DEMO_TOP_WRITERS_REFUSED,
      );
      return interpretSpendReply(reply);
    },
    async takeCap(claim, limits) {
      const reply = await withScripts(client()).itsmDemoCapTake(claim.visitKey, claim.generationKey, limits.perVisit, limits.perGeneration);
      return interpretCapReply(reply);
    },
    async giveBackCap(claim) {
      await withScripts(client()).itsmDemoCapGive(claim.visitKey, claim.generationKey);
    },
  };
}

let defaultStore: DemoCounterStore = redisDemoCounterStore();

/**
 * Test seam: replaces the store every app built without its own uses, so an
 * integration test can make Redis fail without stopping the shared one.
 * `null` restores Redis.
 */
export function setDemoCounterStore(store: DemoCounterStore | null): void {
  defaultStore = store ?? redisDemoCounterStore();
}

/** Waits for the store within `DEMO_STORE_TIMEOUT_MS`; any failure is 503 `store` (fail closed). */
async function counted<T>(work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis within ${DEMO_STORE_TIMEOUT_MS} ms`)), DEMO_STORE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    logger.warn('the demo budgets could not be counted; refusing the request', { error: (error as Error).message });
    metrics.increment('demo_budget_unavailable_total');
    throw new DemoUnavailableError('store');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ Budgets */

export function budgetLimits(config: Pick<
  PlatformConfig,
  'DEMO_READS_PER_IP_MINUTE' | 'DEMO_WRITES_PER_MINUTE' | 'DEMO_WRITES_PER_SESSION' | 'DEMO_WRITES_PER_IP_HOUR' | 'DEMO_WRITES_ALERT_PER_HOUR'
>): DemoBudgetLimits {
  return {
    readsPerBucketMinute: config.DEMO_READS_PER_IP_MINUTE,
    writesPerMinute: config.DEMO_WRITES_PER_MINUTE,
    writesPerVisit: config.DEMO_WRITES_PER_SESSION,
    writesPerBucketHour: config.DEMO_WRITES_PER_IP_HOUR,
    writesAlertPerHour: config.DEMO_WRITES_ALERT_PER_HOUR,
  };
}

/** The keys of one request's budgets, in the windows `now` falls in. */
export function spendKeys(sid: string, ipb: string, now: number): DemoSpendKeys {
  const minute = demoWindow('m', now);
  const hour = demoWindow('h', now);
  return {
    readsPerBucket: DEMO_KEYS.readsPerBucket(ipb, minute),
    writesPerVisitMinute: DEMO_KEYS.writesPerVisit(sid, minute),
    writesPerVisit: DEMO_KEYS.writesPerVisitTotal(sid),
    writesPerBucketHour: DEMO_KEYS.writesPerBucket(ipb, hour),
    tenantWritesHour: DEMO_KEYS.writesAll(hour),
    topWritersHour: DEMO_KEYS.writesTop(hour),
  };
}

/** Whole seconds until the next minute or hour window opens; at least one. */
export function secondsUntilNextWindow(unit: 'm' | 'h', now: number): number {
  const length = unit === 'm' ? 60_000 : 3_600_000;
  return Math.max(1, Math.ceil((length - (now % length)) / 1000));
}

/**
 * The answer for a budget that ran out (§4.8). The windowed budgets say when
 * to try again; the visit's total does not, because waiting does not help —
 * a new visit, or the nightly reset, does.
 */
function refusal(budget: DemoBudget, now: number, limits: DemoBudgetLimits): Error {
  switch (budget) {
    case 'reads':
      metrics.increment('demo_reads_refused_total');
      return new RateLimitedError(secondsUntilNextWindow('m', now));
    case 'writes-minute':
      return new RateLimitedError(secondsUntilNextWindow('m', now));
    case 'writes-visit':
      metrics.increment('demo_limit_hits_total', { category: 'writes' });
      return new DemoLimitError('writes', limits.writesPerVisit);
    case 'writes-bucket':
      return new RateLimitedError(secondsUntilNextWindow('h', now));
    case 'writes-ceiling':
      metrics.increment('demo_write_ceiling_total', { level: 'refused' });
      return new RateLimitedError(secondsUntilNextWindow('h', now));
  }
}

let alertedHour: number | null = null;

/**
 * The tenant passed its hourly alert level: a metric for every write over
 * it, and one warning per hour per process, so a flood is visible without
 * becoming a flood of log lines too.
 */
function noteOverAlert(tenantWrites: number, limits: DemoBudgetLimits, now: number): void {
  if (tenantWrites <= limits.writesAlertPerHour) return;
  metrics.increment('demo_write_ceiling_total', { level: 'alert' });
  const hour = Math.floor(now / 3_600_000);
  if (alertedHour === hour) return;
  alertedHour = hour;
  logger.warn('the shared demo is over its hourly write alert level; the ten busiest IP buckets are refused until the hour ends', {
    writes: tenantWrites,
    alert: limits.writesAlertPerHour,
  });
}

/* ------------------------------------------------------------------ Guards */

/** What the hero-ticket guard needs to know about a ticket. */
export interface TicketStory {
  readonly externalRef: string | null;
  readonly title: string;
  readonly description: string | null;
}

/** Reads a ticket as the caller may see it; throws as the route would (404 for one they cannot). */
export type TicketStoryReader = (ctx: TenantContext, idOrNumber: string) => Promise<TicketStory>;

const readTicketStoryFromService: TicketStoryReader = async (ctx, idOrNumber) => {
  const ticket = await ticketService.getTicket(ctx, idOrNumber);
  // `externalRef` is a column of the row the repository reads whole; the
  // row type does not name it because nothing else in the API reads it.
  // demo-limits.test.ts edits a real hero ticket, so a repository change
  // that stopped reading it would fail there rather than open the story.
  const externalRef = (ticket as typeof ticket & { externalRef?: string | null }).externalRef ?? null;
  return { externalRef, title: ticket.title, description: ticket.description };
};

function param(request: FastifyRequest, name: string): string | null {
  const value = (request.params as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : null;
}

/**
 * The story's hero tickets keep their title and description (Y-m5): every
 * visitor's walk through the demo opens them, and a vandalised title would
 * greet the next prospect. Status, assignment, replies and everything else on
 * them stay allowed — working a ticket is the demo. A value sent unchanged is
 * not a change, so a client that sends the whole form is not refused.
 */
async function guardStory(request: FastifyRequest, ctx: TenantContext, read: TicketStoryReader): Promise<void> {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const patch = body as Record<string, unknown>;
  const touchesTitle = Object.hasOwn(patch, 'title');
  const touchesDescription = Object.hasOwn(patch, 'description');
  if (!touchesTitle && !touchesDescription) return;

  const idOrNumber = param(request, 'idOrNumber');
  if (!idOrNumber) return;
  const ticket = await read(ctx, idOrNumber);
  if (!isDemoHeroRef(ticket.externalRef)) return;

  const titleChanges = touchesTitle && patch.title !== ticket.title;
  const descriptionChanges = touchesDescription && (patch.description ?? null) !== (ticket.description ?? null);
  if (titleChanges || descriptionChanges) throw new DemoDisabledError('story');
}

/** The personas' own accounts are shared by every visitor; nobody may switch one off (§4.7.3). */
function guardPersona(request: FastifyRequest, demo: DemoContext): void {
  const id = param(request, 'id');
  if (id && Object.values(demo.personaUserIds).includes(id)) throw new DemoDisabledError('personas');
}

/* ------------------------------------------------------------------ The plugin */

declare module 'fastify' {
  interface FastifyRequest {
    /** A cap this request took, to give back if it fails. */
    demoCap?: DemoCapClaim;
  }
}

export interface DemoPluginOptions {
  /** Where the counters live; the shared Redis unless a test says otherwise. */
  readonly store?: DemoCounterStore;
  /** How the hero-ticket guard reads a ticket. */
  readonly readTicketStory?: TicketStoryReader;
  /** The clock windows are counted in. */
  readonly now?: () => number;
}

/** Every route of an app built with the plugin, as `METHOD /path` keys, in registration order. */
const routeTables = new WeakMap<FastifyInstance, Set<string>>();

/**
 * The routes registered after the plugin, which `buildApp` makes every
 * route: what `demo-policy.test.ts` checks the policy against. Exact paths,
 * parameter names included, because that is what a request's
 * `routeOptions.url` — and so the policy lookup — carries.
 */
export function registeredRoutes(app: FastifyInstance): readonly string[] {
  return [...(routeTables.get(app) ?? [])];
}

const unlisted = new Set<string>();

export const demoPlugin = fp<DemoPluginOptions>(
  async (app, options) => {
    const read = options.readTicketStory ?? readTicketStoryFromService;
    const clock = options.now ?? Date.now;
    const storeFor = (): DemoCounterStore => options.store ?? defaultStore;

    const table = new Set<string>();
    routeTables.set(app, table);
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) table.add(`${String(method).toUpperCase()} ${route.url}`);
    });

    app.decorateRequest('demoCap', undefined);

    app.addHook('preHandler', async (request, reply) => {
      const ctx = request.tenantContext;
      const demo = ctx?.demo;
      // A real tenant: none of this applies, and nothing is counted.
      if (!ctx || !demo) return undefined;

      const key = demoRouteKey(request.method, request.routeOptions.url);

      // 1. The shared personas' sessions (§4.7.3).
      const shortCircuit = key ? DEMO_SHORT_CIRCUITS[key] : undefined;
      if (shortCircuit) {
        if (shortCircuit.kind === 'refuse') throw new DemoDisabledError(shortCircuit.feature);
        reply.code(shortCircuit.status);
        if (shortCircuit.status === 204) reply.send();
        else reply.send(shortCircuit.body);
        return reply;
      }

      // 2 and 3. The read budget, and the write budgets for a write.
      const now = clock();
      const store = storeFor();
      const limits = budgetLimits(loadConfig());
      const write = isUnsafeMethod(request.method) && !(key !== null && READ_LIKE_POSTS.has(key));
      const ipb = request.token?.demo?.ipBucket ?? 'unknown';
      const spent = await counted(() => store.spend({ keys: spendKeys(demo.sid, ipb, now), ipb, write, limits }));
      if (!spent.ok) throw refusal(spent.budget, now, limits);
      if (write) {
        metrics.increment('demo_writes_total');
        if (spent.tenantWrites !== null) noteOverAlert(spent.tenantWrites, limits, now);
      }

      // 4. The route's own policy.
      const policy: DemoRoutePolicy | undefined = key ? DEMO_ROUTE_POLICY[key] : undefined;
      if (!policy) {
        // demo-policy.test.ts fails on an unsafe route without a policy, so
        // this is a route added since; the write budgets above still bound it.
        if (write && key && !unlisted.has(key)) {
          unlisted.add(key);
          logger.warn('a demo write reached a route the demo policy does not list', { route: key });
        }
        return undefined;
      }
      await apply(policy, request, ctx, demo);
      return undefined;
    });

    async function apply(policy: DemoRoutePolicy, request: FastifyRequest, ctx: TenantContext, demo: DemoContext): Promise<void> {
      switch (policy.kind) {
        case 'allow':
        case 'outside-session':
          return;
        case 'read-only':
          throw new DemoDisabledError(policy.feature);
        case 'locked-setting': {
          const settingKey = param(request, 'key');
          if (settingKey !== null && isDemoLockedSetting(settingKey)) throw new DemoDisabledError('settings');
          return take(request, demo, 'setting.change');
        }
        case 'guard':
          guardPersona(request, demo);
          return take(request, demo, policy.category);
        case 'hero-ticket':
          return guardStory(request, ctx, read);
        case 'cap':
          return take(request, demo, policy.category);
      }
    }

    async function take(request: FastifyRequest, demo: DemoContext, category: DemoCapCategory): Promise<void> {
      const cap = DEMO_CAPS[category];
      const claim: DemoCapClaim = {
        category,
        visitKey: DEMO_KEYS.capPerVisit(demo.generation, category, demo.sid),
        generationKey: DEMO_KEYS.capAll(demo.generation, category),
      };
      const store = storeFor();
      const outcome = await counted(() => store.takeCap(claim, cap));
      if (!outcome.ok) {
        metrics.increment('demo_limit_hits_total', { category });
        // The per-visit figure even when every visitor's share ran out: the
        // sentence speaks to the visitor ("each visit can …"), and waiting
        // does not help either way.
        throw new DemoLimitError(category, cap.perVisit);
      }
      request.demoCap = claim;
    }

    // A failed request gives its cap back: the cap counts what visitors did,
    // not what they tried.
    app.addHook('onResponse', async (request, reply) => {
      const claim = request.demoCap;
      if (!claim || reply.statusCode < 400) return;
      request.demoCap = undefined;
      const store = storeFor();
      try {
        await counted(() => store.giveBackCap(claim));
      } catch {
        // Already logged; the answer has gone, and a lost give-back costs the
        // visitor one use until the reset.
      }
    });
  },
  { name: 'itsm-demo-policy' },
);
