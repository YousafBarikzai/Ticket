/**
 * Which caching strategy a request gets.
 *
 * Pure, and separate from the worker, because "what should happen to this
 * request" is the part that is easy to get subtly wrong and impossible to
 * debug once it is wrong: a service worker that caches the wrong thing serves
 * it to somebody for as long as their browser keeps it, and they cannot tell
 * the difference between a stale page and a broken one.
 *
 * Five rules, in order of how much damage getting them wrong does:
 *
 * **Nothing about a session is ever cached.** `/api/session/*` mints, refreshes
 * and destroys sessions. A cached sign-in response is somebody else's session
 * served to the next person on a shared machine.
 *
 * **The doors are never kept.** `/demo`, `/sign-in`, `/signed-out` and
 * `/resume` decide where a visit goes from the cookies and the session it
 * arrives with — the demo's auto-submitting entry, the re-entry chooser,
 * "Thanks for exploring", the hop to the last page in another area (A3 §5.3,
 * critique S11). A cached copy would replay yesterday's decision, or one made
 * for whoever used the browser before, so they go to the network whatever
 * the request, and offline they fail rather than pretend.
 *
 * **A write is never cached, and only three of them are queued.** Everything
 * else that fails offline fails, visibly, where the person can see it — which
 * is more honest than a queue that replays a transition against a ticket that
 * moved.
 *
 * **API reads are network-first.** A queue that shows yesterday's tickets
 * because the cache was quicker is worse than a queue that takes a second. The
 * cache is the answer only when the network has none.
 *
 * **Static assets are stale-while-revalidate.** They are content-hashed, so a
 * stale one is not a wrong one; it is a previous build's file that the page
 * referencing it no longer asks for.
 *
 * Two same-origin routes are named rather than left to the patterns. The
 * workbench's aggregation handlers (`/api/desk/*`) answer reads the way the
 * proxy does — one person's inbox, one ticket — so they are API reads,
 * network-first and in the API cache that sign-out clears; left to the
 * default they were never cached, and "showing the copy from 10:42" could not
 * happen. The design system's stylesheet (`/itsm-ui.css?v=<hash>`) is
 * versioned by its query string, so it is a static asset however its name
 * happens to end.
 */

export type Strategy =
  | 'network-only'
  | 'network-first'
  | 'stale-while-revalidate'
  | 'cache-first'
  /** A write that may be queued when the network is unavailable. */
  | 'queueable'
  /** A navigation: network, falling back to the cached shell. */
  | 'shell';

/** The three actions doc 14 §5 allows into the queue, by the path they POST to. */
const QUEUEABLE_PATHS: readonly RegExp[] = [
  /^\/api\/proxy\/api\/v1\/tickets$/,
  /^\/api\/proxy\/api\/v1\/tickets\/[^/]+\/comments$/,
  /^\/api\/proxy\/api\/v1\/approvals\/[^/]+\/decide$/,
];

export function isQueueablePath(pathname: string): boolean {
  return QUEUEABLE_PATHS.some((pattern) => pattern.test(pathname));
}

export interface Routed {
  readonly strategy: Strategy;
  /** Which cache it belongs in, when it belongs in one. */
  readonly cache: 'shell' | 'assets' | 'api' | null;
}

const NEVER_CACHED: Routed = { strategy: 'network-only', cache: null };

/** The pages that route a visit by its cookies and session: `/demo`, `/sign-in`, `/signed-out`, `/resume` (and below). */
const DOOR_PAGES = /^\/(?:demo|sign-in|signed-out|resume)(?:\/|$)/;

export function isDoorPage(pathname: string): boolean {
  return DOOR_PAGES.test(pathname);
}

/** The design system's stylesheet, served by each app's route handler. */
const STYLESHEET_PATH = '/itsm-ui.css';

export function routeFor(request: { method: string; url: string; mode?: string }): Routed {
  const url = new URL(request.url, 'http://localhost');
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // Never anything to do with a session, whatever the method.
  if (path.startsWith('/api/session/')) return NEVER_CACHED;
  // Nor the pages that decide where a visit goes, navigated to or fetched.
  if (isDoorPage(path)) return NEVER_CACHED;

  if (method !== 'GET' && method !== 'HEAD') {
    return isQueueablePath(path) && method === 'POST'
      ? { strategy: 'queueable', cache: null }
      : NEVER_CACHED;
  }

  // A document request: the page, or the shell when there is no network.
  if (request.mode === 'navigate') return { strategy: 'shell', cache: 'shell' };

  if (path.startsWith('/api/proxy/')) {
    // Server-sent events are a stream, not a response to keep.
    if (path.includes('/events/')) return NEVER_CACHED;
    return { strategy: 'network-first', cache: 'api' };
  }

  // The workbench's aggregation handlers: an inbox, a ticket, the counts. A
  // person's data, like the proxy's, so it goes where sign-out can find it.
  if (path.startsWith('/api/desk/')) return { strategy: 'network-first', cache: 'api' };

  // Anything else under `/api/` is a route handler with its own reasons —
  // health checks, sessions — and none of it is worth keeping.
  if (path.startsWith('/api/')) return NEVER_CACHED;

  if (path === STYLESHEET_PATH) return { strategy: 'stale-while-revalidate', cache: 'assets' };

  // Next's build output is content-hashed, so a cached copy is never a wrong
  // copy — it is a file the current page does not reference.
  if (path.startsWith('/_next/static/')) return { strategy: 'cache-first', cache: 'assets' };
  if (/\.(css|js|woff2?|png|jpe?g|svg|webp|ico|json)$/.test(path)) {
    return { strategy: 'stale-while-revalidate', cache: 'assets' };
  }

  return NEVER_CACHED;
}

/**
 * Whether a response is worth keeping.
 *
 * An opaque cross-origin response has status 0 and a body nothing can read, so
 * caching it stores a hole that later serves as a failure. A partial response
 * is a fragment of something. Neither is an answer.
 */
export function isCacheable(response: { status: number; type?: string }): boolean {
  if (response.type === 'opaque' || response.type === 'error') return false;
  return response.status >= 200 && response.status < 300 && response.status !== 206;
}
