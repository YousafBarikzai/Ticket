/**
 * The demo's BFF settings (SPEC §4.8, §4.9), read once with the rest of the
 * BFF's configuration.
 *
 * Every value has a code default, so a deployment sets exactly one variable —
 * `DEMO_MODE=on` — and the limits that keep a shared demo fair come with it.
 * The variables exist so an operator can tune a limit without a release, not
 * so a deployment has to remember them.
 *
 * Nothing here is a secret: a demo token is opaque and random, and the IP
 * salt lives in Redis and rotates daily. That is deliberate (A3 §9.1) — a
 * credential the demo needed would be one more thing a fresh deployment could
 * get wrong.
 */

/** Which header names the client's address (§4.8). Only a CDN in front of the apps changes it. */
export type ClientIpHeader = 'x-forwarded-for' | 'cf-connecting-ip';

export const CLIENT_IP_HEADERS: readonly ClientIpHeader[] = Object.freeze(['x-forwarded-for', 'cf-connecting-ip']);

export interface DemoSettings {
  /** A used token's life, slid on the first page render and again at half-life (`DEMO_TOKEN_TTL_SECONDS`). */
  readonly tokenTtlSeconds: number;
  /** A freshly minted token's life, so a mint nobody uses dies in 15 minutes (`DEMO_TOKEN_INITIAL_TTL_SECONDS`, Y-B1). */
  readonly initialTokenTtlSeconds: number;
  /** The longest one visit lasts, re-mints included (`DEMO_SESSION_MAX_SECONDS`). */
  readonly sessionMaxSeconds: number;
  /** Mints per IP bucket, app and persona, per minute and per hour (`DEMO_MINT_PER_IP_*`). */
  readonly mintPerIpMinute: number;
  readonly mintPerIpHour: number;
  /** Mints across every bucket (`DEMO_MINT_GLOBAL_*`); above these only the top ten buckets are refused. */
  readonly mintGlobalMinute: number;
  readonly mintGlobalHour: number;
  /** Above half a global window, a bucket holding more than this share of it is refused (`DEMO_MINT_FAIR_SHARE`). */
  readonly mintFairShare: number;
  /** Live tokens in all; overflow evicts the least recently used idle token (`DEMO_MAX_LIVE_TOKENS`). */
  readonly maxLiveTokens: number;
  /** Live tokens per IP bucket; overflow evicts that bucket's oldest (`DEMO_MAX_LIVE_PER_IP`). */
  readonly maxLivePerIp: number;
  /** How long a token must be unused before a full demo may evict it (`DEMO_IDLE_EVICT_SECONDS`). */
  readonly idleEvictSeconds: number;
  /** Re-mints per visit per hour; past it the visit ends (§4.8). Fixed: no deployment has a reason to change it. */
  readonly remintPerHour: number;
  /** `touch` refreshes a token's last-use score at most this often per session (Y-B1). Fixed. */
  readonly touchIntervalSeconds: number;
}

/** The code defaults (§4.8 and §4.9). */
export const DEMO_SETTING_DEFAULTS: DemoSettings = Object.freeze({
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

/** The environment variable behind each tunable setting. The two fixed ones have none. */
const VARIABLES = Object.freeze({
  tokenTtlSeconds: 'DEMO_TOKEN_TTL_SECONDS',
  initialTokenTtlSeconds: 'DEMO_TOKEN_INITIAL_TTL_SECONDS',
  sessionMaxSeconds: 'DEMO_SESSION_MAX_SECONDS',
  mintPerIpMinute: 'DEMO_MINT_PER_IP_MINUTE',
  mintPerIpHour: 'DEMO_MINT_PER_IP_HOUR',
  mintGlobalMinute: 'DEMO_MINT_GLOBAL_MINUTE',
  mintGlobalHour: 'DEMO_MINT_GLOBAL_HOUR',
  maxLiveTokens: 'DEMO_MAX_LIVE_TOKENS',
  maxLivePerIp: 'DEMO_MAX_LIVE_PER_IP',
  idleEvictSeconds: 'DEMO_IDLE_EVICT_SECONDS',
} as const satisfies Partial<Record<keyof DemoSettings, string>>);

/**
 * A setting that cannot be read. `readConfig` turns it into a
 * `ConfigurationError`; it is its own class here only so this module does not
 * import `config.ts`, which imports this one.
 */
export class DemoSettingsError extends Error {}

type Environment = Readonly<Record<string, string | undefined>>;

function present(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function wholeNumber(env: Environment, name: string, fallback: number): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  // Digits only: `Number('1e3')`, `Number('0x10')` and `Number(' ')` all parse,
  // and a limit nobody meant to write is worse than a refusal to start.
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DemoSettingsError(`${name} must be a whole number of at least 1; it is ${JSON.stringify(raw)}`);
  }
  return value;
}

function fraction(env: Environment, name: string, fallback: number): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  const value = /^(?:0|1)?(?:\.\d+)?$/.test(raw) && raw !== '.' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new DemoSettingsError(`${name} must be a fraction above 0 and at most 1; it is ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * `DEMO_CLIENT_IP_HEADER`, read in every mode: the sign-in limiter buckets
 * callers by address whether or not the demo is on (RV3).
 */
export function readClientIpHeader(env: Environment = process.env): ClientIpHeader {
  const raw = present(env, 'DEMO_CLIENT_IP_HEADER')?.toLowerCase();
  if (raw === undefined) return 'x-forwarded-for';
  if (!(CLIENT_IP_HEADERS as readonly string[]).includes(raw)) {
    throw new DemoSettingsError(
      `DEMO_CLIENT_IP_HEADER must be one of ${CLIENT_IP_HEADERS.join(', ')}; it is ${JSON.stringify(raw)}`,
    );
  }
  return raw as ClientIpHeader;
}

/**
 * The demo's settings, or `null` when `DEMO_MODE` is not `on`.
 *
 * `DEMO_MODE` accepts exactly `on` and `off`, as the API's does: a typo that
 * quietly left the demo off would be found by a prospect, not by the deploy.
 */
export function readDemoSettings(env: Environment = process.env): DemoSettings | null {
  const mode = present(env, 'DEMO_MODE');
  if (mode === undefined || mode === 'off') return null;
  if (mode !== 'on') throw new DemoSettingsError(`DEMO_MODE must be on or off; it is ${JSON.stringify(mode)}`);

  const d = DEMO_SETTING_DEFAULTS;
  const settings: DemoSettings = {
    tokenTtlSeconds: wholeNumber(env, VARIABLES.tokenTtlSeconds, d.tokenTtlSeconds),
    initialTokenTtlSeconds: wholeNumber(env, VARIABLES.initialTokenTtlSeconds, d.initialTokenTtlSeconds),
    sessionMaxSeconds: wholeNumber(env, VARIABLES.sessionMaxSeconds, d.sessionMaxSeconds),
    mintPerIpMinute: wholeNumber(env, VARIABLES.mintPerIpMinute, d.mintPerIpMinute),
    mintPerIpHour: wholeNumber(env, VARIABLES.mintPerIpHour, d.mintPerIpHour),
    mintGlobalMinute: wholeNumber(env, VARIABLES.mintGlobalMinute, d.mintGlobalMinute),
    mintGlobalHour: wholeNumber(env, VARIABLES.mintGlobalHour, d.mintGlobalHour),
    mintFairShare: fraction(env, 'DEMO_MINT_FAIR_SHARE', d.mintFairShare),
    maxLiveTokens: wholeNumber(env, VARIABLES.maxLiveTokens, d.maxLiveTokens),
    maxLivePerIp: wholeNumber(env, VARIABLES.maxLivePerIp, d.maxLivePerIp),
    idleEvictSeconds: wholeNumber(env, VARIABLES.idleEvictSeconds, d.idleEvictSeconds),
    remintPerHour: d.remintPerHour,
    touchIntervalSeconds: d.touchIntervalSeconds,
  };

  // The store trims `demo:active` entries whose last use is older than the
  // longest token life; that is only sound when no token outlives it.
  if (settings.initialTokenTtlSeconds > settings.tokenTtlSeconds) {
    throw new DemoSettingsError(
      `DEMO_TOKEN_INITIAL_TTL_SECONDS (${settings.initialTokenTtlSeconds}) must not exceed DEMO_TOKEN_TTL_SECONDS (${settings.tokenTtlSeconds})`,
    );
  }
  if (settings.maxLivePerIp > settings.maxLiveTokens) {
    throw new DemoSettingsError(
      `DEMO_MAX_LIVE_PER_IP (${settings.maxLivePerIp}) must not exceed DEMO_MAX_LIVE_TOKENS (${settings.maxLiveTokens})`,
    );
  }
  return Object.freeze(settings);
}
