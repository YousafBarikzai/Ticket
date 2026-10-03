import 'server-only';

/**
 * The public site's runtime configuration (SPEC v3 §6.1; A5 §3.6).
 *
 * Read per request, never at build time. CI builds the image before Railway
 * has named any host (`infra/scripts/railway-deploy.ts`, `generatedHost`), so
 * a value baked in by `next build` would be the empty one, and every link on
 * the site would point nowhere. That is the whole reason `/`, the robots file
 * and the sitemap render per request.
 *
 * The site holds no credential: four origins, the API's base URL and
 * `DEMO_MODE`. Nothing here may ever read a secret, because nothing on this
 * service is allowed to have one (no session, no BFF, no Redis).
 *
 * The origin rules are `appOrigins()`'s from `@itsm/contracts/areas` (SPEC
 * §3.1): `new URL(value).origin`, with the development defaults outside
 * production. That module does not exist until wave 1, so the same rules are
 * applied here, through the variable names rather than `process.env.X_ORIGIN`
 * property reads; `readOrigins` is the one function to swap for
 * `appOrigins(env)` when it lands (the result type is the same shape).
 */

export type SiteArea = 'portal' | 'workbench' | 'admin';

export interface Origins {
  readonly portal?: string;
  readonly workbench?: string;
  readonly admin?: string;
  readonly site?: string;
}

export interface SiteConfig {
  readonly origins: Origins;
  /** Where the site's server reads the public demo status; null in production when unset (status then reads as unknown). */
  readonly apiBaseUrl: string | null;
  /** `DEMO_MODE === 'on'`: the strip, the role buttons, `/try` and the demo copy. */
  readonly demo: boolean;
  /** Whether search engines may index the site: its own origin is https and not a Railway-generated host. */
  readonly indexable: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The variable each origin is read from, and the address `pnpm dev:<app>` serves it on. */
const ORIGIN_SOURCES: Readonly<Record<keyof Origins, { readonly variable: string; readonly dev: string }>> = {
  portal: { variable: 'PORTAL_ORIGIN', dev: 'http://localhost:3200' },
  workbench: { variable: 'WORKBENCH_ORIGIN', dev: 'http://localhost:3100' },
  admin: { variable: 'ADMIN_ORIGIN', dev: 'http://localhost:3300' },
  site: { variable: 'SITE_ORIGIN', dev: 'http://localhost:3400' },
};

const DEV_API_BASE_URL = 'http://localhost:3000';

const warned = new Set<string>();

/** Once per process and variable: a misconfigured deploy is worth one line, not one per request. */
function warnOnce(variable: string, message: string): void {
  if (warned.has(variable)) return;
  warned.add(variable);
  console.warn(`[site] ${variable} ${message}`);
}

/**
 * An `http(s)` origin, or null.
 *
 * `new URL(value).origin` drops a path, a query or a trailing slash someone
 * pasted along with the host, so `https://help.example.com/` and
 * `https://help.example.com` build the same links. Anything that is not an
 * http(s) URL is treated as unset rather than rendered into an `href`: a
 * `javascript:` origin would otherwise become a link on a public page.
 */
export function originOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The API's base URL without a trailing slash, or null: the BFF's own reading
 * of `API_BASE_URL` (`packages/bff/src/config.ts`), held to http(s) like the
 * origins. A path is kept, a query and a fragment are not.
 */
export function baseUrlOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

/** The four origins, by the rules of `appOrigins()` (see the module comment). */
export function readOrigins(env: Env): Origins {
  const origins: { -readonly [K in keyof Origins]: string } = {};
  for (const [key, { variable, dev }] of Object.entries(ORIGIN_SOURCES) as [keyof Origins, { variable: string; dev: string }][]) {
    const raw = env[variable];
    const origin = originOf(raw);
    if (origin) {
      origins[key] = origin;
      continue;
    }
    if (raw?.trim()) warnOnce(variable, 'is not an http(s) URL; links that need it are left out');
    // Development only: a production site with an origin missing says so on
    // the page ("isn't available right now") instead of linking to localhost.
    if (!isProduction(env)) origins[key] = dev;
  }
  return origins;
}

/**
 * True only for an https origin that is not `*.up.railway.app` (A5 §3.12).
 *
 * A temporary Railway host is never indexed, so moving to the owner's domain
 * leaves no duplicate behind and needs no code change: indexing switches on
 * with the new `SITE_ORIGIN`.
 */
export function isIndexable(siteOrigin: string | undefined): boolean {
  if (!siteOrigin) return false;
  try {
    const url = new URL(siteOrigin);
    return url.protocol === 'https:' && !url.hostname.endsWith('.up.railway.app') && url.hostname !== 'up.railway.app';
  } catch {
    return false;
  }
}

export function siteConfig(env: Env = process.env): SiteConfig {
  const origins = readOrigins(env);
  const apiBaseUrl = baseUrlOf(env.API_BASE_URL) ?? (isProduction(env) ? null : DEV_API_BASE_URL);
  return {
    origins,
    apiBaseUrl,
    demo: env.DEMO_MODE === 'on',
    indexable: isIndexable(origins.site),
  };
}
