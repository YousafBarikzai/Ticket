/**
 * What the BFF needs to know, read once and validated loudly.
 *
 * The token-handler pattern (doc 08 §9) only holds if the browser can never
 * reach the API directly, so every value here describes a server-to-server
 * relationship. None of it is exposed to the client bundle — there is
 * deliberately no `NEXT_PUBLIC_` anything in this file, because a value the
 * browser can read is a value an extension can read.
 */

export interface OidcSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface BffConfig {
  /** Where the API lives, on the private network. */
  readonly apiBaseUrl: string;
  /** This app's own public origin, used for the redirect URI and the origin check. */
  readonly appOrigin: string;
  readonly redisUrl: string;
  /** How long a signed-in session survives without being refreshed. */
  readonly sessionTtlSeconds: number;
  /** Null when no issuer is configured, which is the only case that enables the development sign-in. */
  readonly oidc: OidcSettings | null;
  readonly production: boolean;
}

export class ConfigurationError extends Error {}

function required(name: string, value: string | undefined): string {
  if (!value) throw new ConfigurationError(`${name} is not set; the workbench cannot start without it`);
  return value;
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** Widened from `NodeJS.ProcessEnv` so a test can pass the two variables it cares about. */
export type Environment = Readonly<Record<string, string | undefined>>;

export function readConfig(env: Environment = process.env): BffConfig {
  const production = env.NODE_ENV === 'production';
  const issuer = env.OIDC_ISSUER?.trim();

  // A deployed app with no issuer would fall through to the development sign-in,
  // which mints a token from a shared secret. Refused here rather than guarded
  // at each call site, because one missed guard is the whole vulnerability.
  if (production && !issuer) {
    throw new ConfigurationError('OIDC_ISSUER must be set in production; the development sign-in is not a deployment option');
  }

  return {
    apiBaseUrl: trimSlash(env.API_BASE_URL ?? 'http://127.0.0.1:3000'),
    appOrigin: trimSlash(env.WORKBENCH_ORIGIN ?? 'http://localhost:3100'),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    sessionTtlSeconds: Number(env.WORKBENCH_SESSION_TTL_SECONDS ?? 60 * 60 * 12),
    oidc: issuer
      ? {
          issuer: trimSlash(issuer),
          clientId: required('OIDC_CLIENT_ID', env.OIDC_CLIENT_ID),
          clientSecret: required('OIDC_CLIENT_SECRET', env.OIDC_CLIENT_SECRET),
        }
      : null,
    production,
  };
}

/** Whether the development sign-in form should exist at all. */
export function developmentSignInAvailable(config: BffConfig): boolean {
  return !config.production && config.oidc === null;
}

let cached: BffConfig | null = null;

export function config(): BffConfig {
  cached ??= readConfig();
  return cached;
}

/** Test seam: the module-level cache would otherwise outlive a changed environment. */
export function resetConfig(): void {
  cached = null;
}
