import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEMO_COMPANY,
  DEMO_COPY,
  DEMO_FEATURES,
  DEMO_KEYS,
  computeDemoStatus,
  type DemoFeature,
  type DemoStatus,
} from '@itsm/contracts/demo';
import {
  demoBackoffSchema,
  demoBuildSchema,
  demoCooldownSchema,
  demoEventSchema,
  demoLiveSchema,
  parseDemoRecord,
} from '@itsm/contracts/demo/schemas';
import {
  ConflictError,
  DemoResetError,
  DemoUnavailableError,
  ForbiddenError,
  RateLimitedError,
  cache,
  checkDemoInterlock,
  demoJobOptions,
  enqueue,
  loadConfig,
  logger,
  metrics,
  platformDb,
  recordAudit,
  subscriber,
  toProblemDetails,
  transaction,
  type DemoContext,
} from '@itsm/platform';
import { readDemoRecords } from '../auth/demo-token.js';
import { contextOf } from '../plugins/context.js';

/**
 * The shared demo's API routes (SPEC v3 §4.6.4; annex A3 §6.4), mounted at
 * `/api/demo/v1`, and the pieces of `/me` and the event stream that only a
 * demo session has.
 *
 * Two routes, and neither mints anything: a token is created only by an
 * app's BFF, from its own origin, after its own checks (D21). The status is
 * public because the site and every demo bar read it before anybody has a
 * session; it is built from the Redis records alone and names no tenant,
 * user or token. The reset needs a demo session and only ever asks the
 * worker to build — the build, the swap and the cooldown are the worker's.
 */

/* ------------------------------------------------------------------ /me */

/** The `demo` block of `GET /api/v1/me` for a demo session (§4.4, X5, X-B2). */
export interface MeDemo {
  readonly persona: DemoContext['persona'];
  /** The area the session belongs to: the persona's own. */
  readonly area: DemoContext['app'];
  readonly generation: number;
  readonly company: string;
  /**
   * Every feature the shared demo turns off. The whole list, not the ones
   * this persona would otherwise have: a page shows the demo's sentence
   * instead of "View only" whenever the feature is listed (§4.7.1).
   */
  readonly disabledFeatures: readonly DemoFeature[];
  readonly personaUserIds: DemoContext['personaUserIds'];
  readonly agentTeamIds: readonly string[];
}

export function meDemo(demo: DemoContext): MeDemo {
  return {
    persona: demo.persona,
    area: demo.app,
    generation: demo.generation,
    company: DEMO_COMPANY.name,
    disabledFeatures: [...DEMO_FEATURES],
    personaUserIds: { employee: demo.personaUserIds.employee, agent: demo.personaUserIds.agent, admin: demo.personaUserIds.admin },
    agentTeamIds: [...demo.agentTeamIds],
  };
}

/* ------------------------------------------------------------------ Event streams of an older generation */

/** One open demo event stream, as the registry sees it. */
export interface DemoStream {
  readonly generation: number;
  /** Ends the stream; called at most once by the registry. */
  end(): void;
}

/**
 * The demo event streams open in this process, so a swap can end those of
 * the generation it replaced (A3 §6.9).
 *
 * An old stream is subscribed to the old tenant's topics and would sit there
 * forever, live-looking and silent. Ending it is enough: the browser's
 * `EventSource` reconnects through the BFF proxy, meets `demo_reset`, the BFF
 * re-mints, and the new stream belongs to the new generation.
 */
export class DemoStreamRegistry {
  private readonly streams = new Set<DemoStream>();

  /** Tracks a stream; the returned function stops tracking it. */
  add(stream: DemoStream): () => void {
    this.streams.add(stream);
    return () => {
      this.streams.delete(stream);
    };
  }

  /** Ends every stream of a generation before `generation`, and returns how many. */
  endOlderThan(generation: number): number {
    let ended = 0;
    for (const stream of [...this.streams]) {
      if (stream.generation >= generation) continue;
      this.streams.delete(stream);
      ended += 1;
      try {
        stream.end();
      } catch (error) {
        logger.debug('a demo event stream could not be ended cleanly', { error: (error as Error).message });
      }
    }
    if (ended > 0) metrics.increment('demo_streams_ended_total', { cause: 'swapped' }, ended);
    return ended;
  }

  get size(): number {
    return this.streams.size;
  }
}

export const demoStreams = new DemoStreamRegistry();

/**
 * Reacts to one message on `demo:events`. Only `swapped` matters here; a
 * message that does not parse is ignored, because the heartbeat's own check
 * of the live record catches whatever a lost or garbled message would have.
 */
export function onDemoEvent(raw: string, registry: DemoStreamRegistry = demoStreams): number {
  const parsed = demoEventSchema.safeParse(safeJson(raw));
  if (!parsed.success || parsed.data.type !== 'swapped') return 0;
  return registry.endOlderThan(parsed.data.generation);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The heartbeat's backstop (A3 §3.4): whether `demo:live` still names this
 * stream's generation. Missing, unreadable or moved on — or Redis not
 * answering — all read as "no", so a stream never outlives its generation by
 * more than one heartbeat even when the swap message was lost.
 */
export async function demoStreamIsCurrent(generation: number): Promise<boolean> {
  try {
    const [raw] = await readDemoRecords([DEMO_KEYS.live]);
    return parseDemoRecord(demoLiveSchema, raw)?.generation === generation;
  } catch {
    return false;
  }
}

let eventConnection: ReturnType<typeof subscriber> | null = null;
let eventConnecting: Promise<void> | null = null;

/**
 * Subscribes this process to `demo:events`, once, on the first demo stream.
 * Its own connection, because a subscribed connection can do nothing else;
 * a failure is logged and left to the heartbeat, never thrown at a visitor.
 */
export function ensureDemoEventSubscriber(registry: DemoStreamRegistry = demoStreams): Promise<void> {
  if (eventConnecting) return eventConnecting;
  eventConnecting = (async () => {
    try {
      const connection = subscriber().duplicate();
      eventConnection = connection;
      connection.on('message', (channel: string, message: string) => {
        if (channel === DEMO_KEYS.events) onDemoEvent(message, registry);
      });
      connection.on('error', (error: Error) => {
        logger.debug('the demo event subscriber reported an error', { error: error.message });
      });
      await connection.subscribe(DEMO_KEYS.events);
    } catch (error) {
      logger.warn('the demo event subscriber could not start; old demo streams end on the heartbeat instead', {
        error: (error as Error).message,
      });
      await stopDemoEventSubscriber();
    }
  })();
  return eventConnecting;
}

/** Closes the subscriber, when the API shuts down (or a test is done). */
export async function stopDemoEventSubscriber(): Promise<void> {
  const connection = eventConnection;
  eventConnection = null;
  eventConnecting = null;
  if (connection) await connection.quit().catch(() => connection.disconnect());
}

/* ------------------------------------------------------------------ The routes */

/** The visitor reset's confirmation, exactly: anything else is a 422 (§4.6.4 step 3). */
const resetBodySchema = z.object({ confirm: z.literal('RESET') }).strict();

/** `demo:reset:requested` lives five minutes: long enough to cover the queue, short enough not to block a retry for long. */
const RESET_REQUEST_TTL_SECONDS = 300;

/** The estimate when no build has finished yet (A4 §3.3). */
export const DEFAULT_BUILD_ETA_SECONDS = 180;

/** The builds the estimate is the median of. */
const ETA_SAMPLE = 5;

/** Whether the demo is on at all; with it off the routes answer exactly as an unknown path does. */
function demoIsOn(): boolean {
  return loadConfig().DEMO_MODE === 'on';
}

/** The API's own 404, word for word what an unknown path gets, so nothing hints that a route exists. */
function notFound(reply: FastifyReply): FastifyReply {
  reply.callNotFound();
  return reply;
}

/** The job id of a visitor reset: one per live generation, and a fresh one for each attempt (Y-B3). */
export function manualResetJobId(generation: number, attempt: number): string {
  return `demo-reset-manual-g${generation}-a${attempt}`;
}

/** Seconds left on a key, from its `PTTL` in milliseconds, or `null` when it has none. */
function secondsFromPttl(pttl: number): number | null {
  return pttl > 0 ? Math.ceil(pttl / 1000) : null;
}

/** The median of some build durations in milliseconds, as whole seconds; the default with none. */
export function medianEtaSeconds(buildMs: readonly number[]): number {
  const sorted = buildMs.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return DEFAULT_BUILD_ETA_SECONDS;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.max(1, Math.round(median / 1000));
}

/** What the ledger says about the next visitor reset. */
export interface ResetLedger {
  /** 1 + the manual builds already attempted for this generation (Y-B3). */
  readonly attempt: number;
  /** The median of the last five good builds, in seconds; 180 with none. */
  readonly etaSec: number;
}

function isUndefinedTable(error: unknown): boolean {
  const meta = (error as { meta?: { code?: unknown } } | null)?.meta;
  if (meta?.code === '42P01') return true;
  return /relation "demo_generation" does not exist/.test((error as Error | null)?.message ?? '');
}

let ledgerMissingReported = false;

/**
 * Reads the generation ledger (`demo_generation`, §5.3) for a reset of
 * `generation`: how many manual builds of the next generation were already
 * attempted, and how long good builds have taken.
 *
 * The attempt number is what keeps a retry from being swallowed: BullMQ
 * drops an `add` whose id names a job it still holds, so the id carries
 * `-a<attempt>`, one more than the manual rows already ledgered for the
 * generation this reset would build.
 *
 * A database whose migrations have not reached the ledger yet answers as an
 * empty ledger, logged once: the id is then `-a1`, which is right for a
 * ledger with no rows, and the reset still reaches a worker able to build.
 */
export async function readResetLedger(generation: number): Promise<ResetLedger> {
  const next = generation + 1;
  try {
    const db = platformDb();
    const attempts = await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM demo_generation WHERE reason = 'manual' AND generation = ${next}
    `;
    const builds = await db.$queryRaw<{ build_ms: number | null }[]>`
      SELECT build_ms FROM demo_generation
       WHERE status IN ('live', 'retired', 'purged') AND build_ms IS NOT NULL
       ORDER BY started_at DESC NULLS LAST
       LIMIT ${ETA_SAMPLE}
    `;
    return {
      attempt: 1 + Number(attempts[0]?.count ?? 0),
      etaSec: medianEtaSeconds(builds.map((row) => Number(row.build_ms))),
    };
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    if (!ledgerMissingReported) {
      ledgerMissingReported = true;
      logger.error('the demo generation ledger does not exist; run the migrations. Visitor resets use attempt 1 until it does');
    }
    return { attempt: 1, etaSec: DEFAULT_BUILD_ETA_SECONDS };
  }
}

/** 409 with the state the demo bar shows: a build, the lock or another reset is already under way. */
function sendBusy(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem = toProblemDetails(new ConflictError(DEMO_COPY.resetRunning), request.correlationId ?? 'unknown', request.url);
  metrics.increment('api_errors_total', { status: '409' });
  return reply.status(409).type('application/problem+json').send({ ...problem, state: 'building' });
}

/** Reads the public status from the records (§4.6.4). */
export async function readDemoStatus(now: number = Date.now()): Promise<DemoStatus> {
  const [live, build, cooldown, paused, backoff] = await readDemoRecords([
    DEMO_KEYS.live,
    DEMO_KEYS.build,
    DEMO_KEYS.resetCooldown,
    DEMO_KEYS.paused,
    DEMO_KEYS.resetBackoff,
  ]);
  return computeDemoStatus(
    {
      live: parseDemoRecord(demoLiveSchema, live),
      build: parseDemoRecord(demoBuildSchema, build),
      cooldown: parseDemoRecord(demoCooldownSchema, cooldown),
      // Any value is a pause: an unreadable pause is still a pause.
      paused: paused !== null && paused !== undefined,
      backoff: parseDemoRecord(demoBackoffSchema, backoff),
    },
    now,
    { cooldownSeconds: loadConfig().DEMO_RESET_COOLDOWN_SECONDS },
  );
}

/** Mounted at `/api/demo/v1` by `registerRoutes`. */
export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onClose', async () => {
    await stopDemoEventSubscriber();
  });

  /**
   * The public status. `public, max-age=5`: every demo bar polls it, and a
   * few seconds of staleness is invisible next to a build of minutes.
   */
  app.get('/status', async (_request, reply) => {
    if (!demoIsOn()) return notFound(reply);
    // On, but pointed at a slug the boot interlock refused: say so, and
    // never describe a tenant the demo must not use.
    if (!checkDemoInterlock().ready) throw new DemoUnavailableError('misconfigured');
    const status = await readDemoStatus();
    reply.header('cache-control', 'public, max-age=5');
    return status;
  });

  /**
   * A visitor's reset (§4.6.4 steps 1–8). Each refusal is checked in order
   * and nothing is written until all have passed; the one write before the
   * enqueue is `demo:reset:requested`, which makes a double click — or two
   * visitors at once — one reset.
   */
  app.post('/reset', async (request, reply) => {
    // 1. With the demo off, there is nothing to reset.
    if (!demoIsOn()) return notFound(reply);

    // 2. Only a demo session; a real account has no business here.
    const ctx = contextOf(request);
    const demo = ctx.demo;
    if (!demo) throw new ForbiddenError('demo.reset', DEMO_COPY.resetOnlyInDemo);

    // 3. The explicit confirmation, and nothing else.
    resetBodySchema.parse(request.body ?? {});

    // 4–6b. One read of everything that can refuse it.
    const [paused, build, lock, requested, cooldown, backoff, liveRaw] = await readDemoRecords([
      DEMO_KEYS.paused,
      DEMO_KEYS.build,
      DEMO_KEYS.resetLock,
      DEMO_KEYS.resetRequested,
      DEMO_KEYS.resetCooldown,
      DEMO_KEYS.resetBackoff,
      DEMO_KEYS.live,
    ]);
    if (paused !== null && paused !== undefined) throw new DemoUnavailableError('paused');
    if ([build, lock, requested].some((value) => value !== null && value !== undefined)) return sendBusy(request, reply);

    const now = Date.now();
    if (cooldown !== null && cooldown !== undefined) {
      const record = parseDemoRecord(demoCooldownSchema, cooldown);
      const fromRecord = record ? Math.ceil((record.at + loadConfig().DEMO_RESET_COOLDOWN_SECONDS * 1000 - now) / 1000) : null;
      throw new RateLimitedError(Math.max(1, (await keySeconds(DEMO_KEYS.resetCooldown)) ?? fromRecord ?? 1));
    }
    if (backoff !== null && backoff !== undefined) {
      const record = parseDemoRecord(demoBackoffSchema, backoff);
      const fromRecord = record && record.retryAt > now ? Math.ceil((record.retryAt - now) / 1000) : null;
      throw new RateLimitedError(Math.max(1, fromRecord ?? (await keySeconds(DEMO_KEYS.resetBackoff)) ?? 1));
    }

    // The session must still be the live generation's: after a swap the BFF
    // re-mints and resends, and the swap's own cooldown then answers.
    const live = parseDemoRecord(demoLiveSchema, liveRaw);
    if (!live) throw new DemoUnavailableError('preparing');
    if (live.generation !== demo.generation || live.tenantId !== ctx.tenantId) throw new DemoResetError();
    const generation = live.generation;

    // 7. One reset at a time, across every replica.
    const marker = JSON.stringify({ at: now, sidHash: createHash('sha256').update(demo.sid).digest('hex').slice(0, 16), generation });
    if (!(await claimResetRequest(marker))) return sendBusy(request, reply);

    // 8. Ask the worker to build. The audit row and the job stand or fall
    //    together; if either fails the claim is released, so a visitor can
    //    try again at once rather than in five minutes.
    try {
      const ledger = await readResetLedger(generation);
      const jobId = manualResetJobId(generation, ledger.attempt);
      await transaction(ctx, async (tx) => {
        await recordAudit(tx, ctx, {
          action: 'demo.reset.requested',
          targetType: 'tenant',
          targetId: ctx.tenantId,
          after: { requestedGeneration: generation, nextGeneration: generation + 1, persona: demo.persona, jobId },
        });
        await enqueue(ctx, 'demo', 'demo.reset', { reason: 'manual', requestedGeneration: generation }, { ...demoJobOptions, jobId });
      });
      metrics.increment('demo_resets_requested_total');
      reply.status(202);
      return { nextGeneration: generation + 1, etaSec: ledger.etaSec };
    } catch (error) {
      await cache()
        .del(DEMO_KEYS.resetRequested)
        .catch(() => undefined);
      throw error;
    }
  });
}

/** Seconds left on a key, or `null` (no key, no expiry, or Redis not answering: the record's own clock is used then). */
async function keySeconds(key: string): Promise<number | null> {
  try {
    return secondsFromPttl(await cache().pttl(key));
  } catch {
    return null;
  }
}

/** `SET demo:reset:requested NX EX 300`; false when another reset holds it. A Redis error is 503, never a pass. */
async function claimResetRequest(marker: string): Promise<boolean> {
  try {
    return (await cache().set(DEMO_KEYS.resetRequested, marker, 'EX', RESET_REQUEST_TTL_SECONDS, 'NX')) === 'OK';
  } catch (error) {
    logger.warn('the demo reset request could not be recorded', { error: (error as Error).message });
    throw new DemoUnavailableError('store');
  }
}
