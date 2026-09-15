/**
 * Which caching strategy a request gets.
 *
 * Pure, and separate from the worker, because "what should happen to this
 * request" is the part that is easy to get subtly wrong and impossible to
 * debug once it is wrong: a service worker that caches the wrong thing serves
 * it to somebody for as long as their browser keeps it, and they cannot tell
 * the difference between a stale page and a broken one.
 *
 * Four rules, in order of how much damage getting them wrong does:
 *
 * **Nothing about a session is ever cached.** `/api/session/*` mints, refreshes
 * and destroys sessions. A cached sign-in response is somebody else's session
 * served to the next person on a shared machine.
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

export function routeFor(request: { method: string; url: string; mode?: string }): Routed {
  const url = new URL(request.url, 'http://localhost');
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // Never anything to do with a session, whatever the method.
  if (path.startsWith('/api/session/')) return NEVER_CACHED;

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
