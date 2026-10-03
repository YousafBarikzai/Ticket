import 'server-only';
import { bff } from '../bff.js';

/**
 * Where the public status page lives (A7 §2.3, §4.7): the page chip
 * "Public · /status/northwind ↗" on the Status page console.
 *
 * The API serves the public page itself (`GET /status/:slug`), so its address
 * is the API's base URL plus the page's path, read through the BFF's config
 * (`bff.config.apiBaseUrl`) rather than from the environment, so this app
 * reads no origin of its own (`no-raw-origins`).
 *
 * That base URL is where the console reaches the API, which is often a
 * private address — loopback in development, a `*.internal` host on Railway —
 * that a visitor's browser cannot open. A link nobody can follow is worse
 * than none, so a private or unparsable address answers `null` and the chip is
 * drawn without a link. So does a page that is not public.
 */

export interface StatusPageRef {
  /** The page's public path, `/status/northwind`, as the API reports it. */
  readonly path?: string | null;
  readonly slug?: string | null;
  /** A page that is not published has no public address to link. */
  readonly isPublic?: boolean;
}

const PRIVATE_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[::1?\])$|\.(?:internal|local|localhost)$/i;

/** Whether a base URL is one a member of the public could open: http(s) and not a private host. */
export function isPublicBase(base: string | null | undefined): boolean {
  if (!base) return false;
  try {
    const url = new URL(base);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !PRIVATE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** The page's public path: its own `path`, else `/status/<slug>`; `null` for neither. */
function pathOf(page: StatusPageRef): string | null {
  if (typeof page.path === 'string' && page.path.startsWith('/') && !page.path.startsWith('//')) return page.path;
  if (typeof page.slug === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(page.slug)) return `/status/${page.slug}`;
  return null;
}

/** The public status page's address, or `null` when there is none a visitor could open. */
export function publicStatusUrl(page: StatusPageRef, apiBaseUrl: string | null | undefined = bff.config.apiBaseUrl): string | null {
  if (page.isPublic === false || !isPublicBase(apiBaseUrl)) return null;
  const path = pathOf(page);
  if (path === null) return null;
  return new URL(path, `${apiBaseUrl!.replace(/\/+$/, '')}/`).toString();
}
