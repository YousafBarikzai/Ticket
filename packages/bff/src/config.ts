/**
 * What a backend-for-frontend needs to know, read once and validated loudly.
 *
 * The token-handler pattern (doc 08 §9) only holds if the browser can never
 * reach the API directly, so every value here describes a server-to-server
 * relationship. None of it is exposed to a client bundle — there is
 * deliberately no `NEXT_PUBLIC_` anything in this package, because a value the
 * browser can read is a value an extension can read.
 *
 * Parameterised by application rather than duplicated per application: the
 * workbench and the portal differ in their origin, their landing page and
 * their session namespace, and in nothing else that matters here. A second
 * copy of this file would be a second place for the `__Host-` rules to be got
 * wrong.
 */

import { DemoSettingsError, readClientIpHeader, readDemoSettings, type ClientIpHeader, type DemoSettings } from './demo/settings.js';

export interface OidcSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** What distinguishes one application's BFF from another's. */
export interface AppIdentity {
  /** `workbench`, `portal`. Namespaces the session keys and names the app in a log line. */
  readonly appName: string;
  /** The environment variable holding this app's public origin, e.g. `WORKBENCH_ORIGIN`. */
  readonly originEnvVar: string;
  readonly defaultOrigin: string;
  /** Where a sign-in lands when nothing else was asked for. */
  readonly defaultLanding: string;
  /** The development sign-in form, and where a failed or finished session lands. */
  readonly signInPath: string;
  readonly signedOutPath: string;
}

export interface BffConfig extends AppIdentity {
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
  /**
   * The demo's limits and token lives, or `null` when `DEMO_MODE` is not `on`
   * (SPEC §4.9). Null is the whole switch: every demo route answers 404
   * without it.
   */
  readonly demo: DemoSettings | null;
  /**
   * Which header names the client's address. Outside `demo` because the
   * sign-in limiter buckets callers by address in every mode (RV3).
   */
  readonly clientIpHeader: ClientIpHeader;
}

export class ConfigurationError extends Error {}

/** Widened from `NodeJS.ProcessEnv` so a test can pass the two variables it cares about. */
export type Environment = Readonly<Record<string, string | undefined>>;

function required(name: string, value: string | undefined): string {
  if (!value) throw new ConfigurationError(`${name} is not set; the application cannot start without it`);
  return value;
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function readConfig(app: AppIdentity, env: Environment = process.env): BffConfig {
  const production = env.NODE_ENV === 'production';
  const issuer = env.OIDC_ISSUER?.trim();

  // A deployed app with no issuer would fall through to the development
  // sign-in, which mints a token from a shared secret. Refused here rather than
  // guarded at each call site, because one missed guard is the whole
  // vulnerability.
  if (production && !issuer) {
    throw new ConfigurationError(
      'OIDC_ISSUER must be set in production; the development sign-in is not a deployment option',
    );
  }

  let demo: DemoSettings | null;
  let clientIpHeader: ClientIpHeader;
  try {
    demo = readDemoSettings(env);
    clientIpHeader = readClientIpHeader(env);
  } catch (error) {
    // One error class for every refusal here, so a caller that reports a
    // misconfigured deployment does not need to know which file noticed.
    if (error instanceof DemoSettingsError) throw new ConfigurationError(error.message);
    throw error;
  }

  return {
    ...app,
    apiBaseUrl: trimSlash(env.API_BASE_URL ?? 'http://127.0.0.1:3000'),
    appOrigin: trimSlash(env[app.originEnvVar] ?? app.defaultOrigin),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    sessionTtlSeconds: Number(env.BFF_SESSION_TTL_SECONDS ?? 60 * 60 * 12),
    oidc: issuer
      ? {
          issuer: trimSlash(issuer),
          clientId: required('OIDC_CLIENT_ID', env.OIDC_CLIENT_ID),
          clientSecret: required('OIDC_CLIENT_SECRET', env.OIDC_CLIENT_SECRET),
        }
      : null,
    production,
    demo,
    clientIpHeader,
  };
}

/** Whether the development sign-in form should exist at all. */
export function developmentSignInAvailable(config: BffConfig): boolean {
  return !config.production && config.oidc === null;
}
