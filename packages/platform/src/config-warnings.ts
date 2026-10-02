import type { Redis } from 'ioredis';
import { loadConfig, type PlatformConfig } from './config.js';
import { cache } from './redis.js';
import { logger } from './telemetry.js';

/**
 * Deployment warnings (D24, SPEC v3 §6.5): say loudly that a deployment is
 * running with a dangerous configuration, and never refuse to start because of
 * it.
 *
 * The case this exists for is `DEV_TOKEN_SECRET`. It signs survey links,
 * status-page confirm and unsubscribe links, and upload and download links
 * (`tokens.ts`, `storage.ts`), and its default is in this repository — so a
 * deployment that never set it lets anyone who has read the code forge any of
 * those links. Refusing to boot would turn a forgotten variable into an outage
 * on the next deploy; staying quiet leaves the forgery open indefinitely. The
 * middle course is to make the gap impossible to miss: an error line in every
 * process that signs, a `warnings` array on `/health/ready` (which the deploy
 * turns into an annotation), and a banner in front of every platform operator.
 *
 * Shared through Redis rather than computed by the API alone because the
 * workers sign links too and need the same value: the operator's banner names
 * every service that still has the default, so "I set it on the API" is not
 * mistaken for done.
 */

/**
 * The default `config.ts` gives `DEV_TOKEN_SECRET`, restated here rather than
 * imported: `config.ts` predates this file and is shared, so the two stay
 * separate files and a unit test pins them equal instead.
 */
export const DEFAULT_DEV_TOKEN_SECRET = 'dev-only-not-a-secret';

/** Shorter than this and a secret is a guessable one (32 characters ≈ 192 bits as base64). */
export const MIN_DEV_TOKEN_SECRET_LENGTH = 32;

/** The Redis hash: a field per service, `{"codes":[…],"at":"<ISO>"}`. Holds no tenant data. */
export const CONFIG_WARNINGS_KEY = 'ops:config-warnings';

/**
 * 26 hours. Each report refreshes it and each service reports every six hours,
 * so the record outlives a missed report or two but not a deployment that has
 * stopped reporting altogether — and a field older than this is ignored by the
 * reader, because a service that was deleted never comes back to clear it.
 */
export const CONFIG_WARNINGS_TTL_SECONDS = 93_600;

/** How often a running process repeats its report: the log line again, and the Redis field refreshed. */
export const CONFIG_WARNINGS_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The demo build's operator record (Y-M7; SPEC v3 §4.2, §5.3). The demo
 * builder writes `demo_build_failing` here after three consecutive failed
 * nightly builds and deletes it at the next good swap; this file only reads it.
 * The same strings as `DEMO_OPS_KEY` and `DEMO_BUILD_FAILING_FIELD` in
 * `@itsm/contracts/demo` — which the test pins — kept private here so this
 * barrel never exports a second symbol of those names.
 */
const DEMO_OPS_KEY = 'ops:demo';
const DEMO_BUILD_FAILING_FIELD = 'demo_build_failing';

/** The service the demo build runs on (`infra/railway/services.json`); its warning is reported under this name. */
const DEMO_BUILD_SERVICE = 'itsm-worker-data';

export type ConfigWarningCode = 'dev_token_secret_default' | 'dev_token_secret_short';
export type DeploymentWarningCode = ConfigWarningCode | 'demo_build_failing';

export interface ConfigWarning {
  readonly code: ConfigWarningCode;
  readonly severity: 'critical' | 'warning';
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What is wrong with this process's configuration. Codes only: nothing here
 * ever carries a configured value, because every caller publishes the result.
 *
 * Production only. Development and test deployments run on the default on
 * purpose, and a warning that is always on is a warning nobody reads.
 *
 * The secret is read exactly as `tokens.ts` reads it — the environment's value
 * first, the validated configuration's after — so the warning describes the
 * secret that actually signs. The default is reported as the default and not
 * also as short: one problem, one fix.
 */
export function configWarnings(
  config: Pick<PlatformConfig, 'NODE_ENV' | 'DEV_TOKEN_SECRET'>,
  env: Environment = process.env,
): ConfigWarning[] {
  if (config.NODE_ENV !== 'production') return [];
  const secret = env.DEV_TOKEN_SECRET ?? config.DEV_TOKEN_SECRET;
  if (secret === DEFAULT_DEV_TOKEN_SECRET) return [{ code: 'dev_token_secret_default', severity: 'critical' }];
  if (secret.length < MIN_DEV_TOKEN_SECRET_LENGTH) return [{ code: 'dev_token_secret_short', severity: 'warning' }];
  return [];
}

const RISK = 'survey and status-page links and file upload and download links can be forged by anyone who has read the repository';
const FIX =
  'set DEV_TOKEN_SECRET to the same long random value on api, worker-events, worker-engine, worker-comms and worker-data; see docs/runbooks/first-production-deploy.md, "The signing secret"';

const LOG_LINES: Record<ConfigWarningCode, { readonly message: string; readonly risk: string }> = {
  dev_token_secret_default: { message: 'CONFIGURATION WARNING: DEV_TOKEN_SECRET is the public development default', risk: RISK },
  dev_token_secret_short: {
    message: 'CONFIGURATION WARNING: DEV_TOKEN_SECRET is shorter than 32 characters',
    risk: 'a short signing secret can be guessed, and with it survey, status-page, upload and download links forged',
  },
};

/** What `reportConfigWarnings` needs from Redis; the cache connection in production, a fake in a unit test. */
export type ConfigWarningsStore = Pick<Redis, 'hset' | 'hdel' | 'expire'>;

export interface ConfigWarningReport {
  /** What the first report found. */
  readonly warnings: readonly ConfigWarning[];
  /** Stops the six-hourly repeat. Shutdown need not call it — the timer never holds the process open — but tests do. */
  stop(): void;
}

export interface ReportOptions {
  readonly config?: Pick<PlatformConfig, 'NODE_ENV' | 'DEV_TOKEN_SECRET'>;
  readonly env?: Environment;
  readonly store?: ConfigWarningsStore;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  /** How long a report waits for Redis before giving up on the record (the write itself carries on). */
  readonly storeTimeoutMs?: number;
}

/**
 * The longest a boot waits on the record. ioredis queues commands while it
 * reconnects and gives up only after its retries, which is tens of seconds of
 * a process not yet listening for SIGTERM; the record is not worth that.
 */
const STORE_TIMEOUT_MS = 5_000;

/** `work`, or a rejection after `ms` — on a timer that never holds the process open. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const timers = new Map<string, ReturnType<typeof setInterval>>();

/** One report: the log lines, then the shared record. Never throws. */
async function reportOnce(service: string, options: ReportOptions): Promise<ConfigWarning[]> {
  const config = options.config ?? loadConfig();
  const warnings = configWarnings(config, options.env ?? process.env);

  for (const warning of warnings) {
    const line = LOG_LINES[warning.code];
    const fields = { code: warning.code, service, risk: line.risk, fix: FIX };
    if (warning.severity === 'critical') logger.error(line.message, fields);
    else logger.warn(line.message, fields);
  }

  // The record is a convenience for the operator's banner; the log line above
  // is the warning itself. A Redis that is down, read-only or full must not
  // turn a configuration warning into a failed boot.
  try {
    const store = options.store ?? cache();
    const at = (options.now?.() ?? new Date()).toISOString();
    const record = async (): Promise<void> => {
      if (warnings.length === 0) {
        await store.hdel(CONFIG_WARNINGS_KEY, service);
        return;
      }
      await store.hset(CONFIG_WARNINGS_KEY, service, JSON.stringify({ codes: warnings.map((warning) => warning.code), at }));
      await store.expire(CONFIG_WARNINGS_KEY, CONFIG_WARNINGS_TTL_SECONDS);
    };
    await within(record(), options.storeTimeoutMs ?? STORE_TIMEOUT_MS);
  } catch (error) {
    logger.warn('configuration warnings could not be shared through Redis', {
      service,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return warnings;
}

/**
 * Reports this process's configuration warnings now and every six hours
 * after: an `error` line per critical warning (never the value), the service's
 * field in `ops:config-warnings` while something is wrong, and its field
 * removed once nothing is — which is how the operator's banner clears within a
 * minute of the last service restarting with the secret set.
 *
 * `service` is the name the operator sees (`itsm-api`, `itsm-worker-comms`, …:
 * each service's `OTEL_SERVICE_NAME`). Calling it again for the same service
 * replaces the earlier repeat rather than adding a second.
 */
export async function reportConfigWarnings(service: string, options: ReportOptions = {}): Promise<ConfigWarningReport> {
  const warnings = await reportOnce(service, options);

  const previous = timers.get(service);
  if (previous) clearInterval(previous);
  const timer = setInterval(() => void reportOnce(service, options), options.intervalMs ?? CONFIG_WARNINGS_INTERVAL_MS);
  // A reminder, not work: it must never be what keeps a process alive after
  // its server and its queues have closed.
  timer.unref();
  timers.set(service, timer);

  return {
    warnings,
    stop() {
      clearInterval(timer);
      if (timers.get(service) === timer) timers.delete(service);
    },
  };
}

/* ---- Reading: the operator's view (`GET /api/platform/v1/deployment-warnings`) ---- */

/** One service's warnings, as the platform API serves them. */
export interface DeploymentWarningRecord {
  readonly service: string;
  readonly codes: readonly DeploymentWarningCode[];
  /** When the service last reported it; for `demo_build_failing`, when the run of failures began. ISO 8601. */
  readonly at: string;
  /** `demo_build_failing` only: where the last build stopped. */
  readonly failure?: { readonly step: string | null; readonly check: string | null; readonly failures: number | null };
}

/** What `readDeploymentWarnings` needs from Redis. */
export type DeploymentWarningsSource = Pick<Redis, 'hgetall' | 'hget'>;

const CONFIG_CODES: ReadonlySet<string> = new Set<ConfigWarningCode>(['dev_token_secret_default', 'dev_token_secret_short']);
const SERVICE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
const SHORT_TEXT = 120;

function isoOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A step or check name for a sentence: one line, bounded, or nothing. */
function shortText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  return line.length > SHORT_TEXT ? `${line.slice(0, SHORT_TEXT - 1)}…` : line;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** One `ops:config-warnings` field, or nothing when it is malformed or stale. */
function configRecord(service: string, raw: string, nowMs: number): DeploymentWarningRecord | null {
  if (!SERVICE_NAME.test(service)) return null;
  const value = parseJson(raw) as { codes?: unknown; at?: unknown } | null;
  if (!value || !Array.isArray(value.codes)) return null;
  const codes = [...new Set(value.codes.filter((code): code is ConfigWarningCode => typeof code === 'string' && CONFIG_CODES.has(code)))].sort();
  const at = isoOf(value.at);
  if (codes.length === 0 || at === null) return null;
  // The key's own expiry is refreshed by every service that reports, so a
  // field left by a service that no longer exists would never expire with it.
  if (nowMs - Date.parse(at) > CONFIG_WARNINGS_TTL_SECONDS * 1000) return null;
  return { service, codes, at };
}

/** The demo build's `{ since, failures, step, check }`, or nothing when there is none or it cannot be read. */
function demoRecord(raw: string | null): DeploymentWarningRecord | null {
  if (raw === null) return null;
  const value = parseJson(raw) as { since?: unknown; failures?: unknown; step?: unknown; check?: unknown } | null;
  if (!value || typeof value !== 'object') return null;
  const at = isoOf(value.since);
  if (at === null) return null;
  const failures = typeof value.failures === 'number' && Number.isInteger(value.failures) && value.failures > 0 ? value.failures : null;
  return {
    service: DEMO_BUILD_SERVICE,
    codes: ['demo_build_failing'],
    at,
    failure: { step: shortText(value.step), check: shortText(value.check), failures },
  };
}

/**
 * Every deployment warning there is now: each service's configuration
 * warnings from `ops:config-warnings`, plus the demo build's failure from
 * `ops:demo` when there is one. Sorted by service, then by code.
 *
 * Read defensively, because both hashes are written by other processes —
 * possibly an older or newer release of them: a field that does not parse,
 * names no code this release knows, or has not been refreshed for 26 hours is
 * left out rather than failing the whole answer. A Redis error is thrown: the
 * caller decides what an unreachable store means.
 */
export async function readDeploymentWarnings(source: DeploymentWarningsSource, now: Date = new Date()): Promise<DeploymentWarningRecord[]> {
  const [fields, demo] = await Promise.all([source.hgetall(CONFIG_WARNINGS_KEY), source.hget(DEMO_OPS_KEY, DEMO_BUILD_FAILING_FIELD)]);
  const records = Object.entries(fields ?? {})
    .map(([service, raw]) => configRecord(service, raw, now.getTime()))
    .filter((record): record is DeploymentWarningRecord => record !== null);
  const failing = demoRecord(demo);
  if (failing) records.push(failing);
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return records.sort((a, b) => order(a.service, b.service) || order(a.codes[0]!, b.codes[0]!));
}
