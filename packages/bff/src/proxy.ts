/**
 * The proxy's rules, as functions rather than as care.
 *
 * Doc 08 §9 says the BFF does exactly two things: exchange the session for a
 * bearer token, and pass the request on unchanged. "Unchanged" is the easy
 * half to write and the easy half to get wrong, because the interesting
 * question is not what to forward but what to refuse to forward:
 *
 *   - A path is rebuilt from validated segments, never concatenated. A
 *     `[...path]` catch-all hands over already-decoded segments, so a `..` that
 *     arrived as `%2e%2e` is a plain `..` by the time it gets here, and a
 *     concatenated path would walk out of `/api/v1/` to whatever else the API
 *     serves — the SCIM token endpoint, the platform console, `/metrics`.
 *   - Request headers are an allow-list. The browser's `cookie` header must
 *     never reach the API (it carries this app's session identifier, which the
 *     API has no use for and no business seeing), and a client-supplied
 *     `authorization` must never survive to be mistaken for the session's.
 *   - Response headers are an allow-list too, and the one that matters is
 *     `set-cookie`: the API is on a different origin in development and the
 *     same one in production, and an API that can set a cookie on this app's
 *     origin can overwrite the session cookie.
 *   - Unsafe methods are refused unless the browser says they came from here.
 *     The session cookie is `SameSite=Lax`, which withholds nothing from a
 *     cross-site form POST's *navigation*; `fetch` from another origin is
 *     stopped by CORS, but a form is not.
 *
 * Every rule below is a pure function so that the test is about the rule and
 * not about standing up a server.
 */

export class ProxyRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProxyRefused';
  }
}

/** Only the versioned tenant API. Everything else the API serves is not the workbench's to reach. */
const REQUIRED_PREFIX = ['api', 'v1'] as const;

/** A segment that is empty, is a path operator, or smuggles a separator or a control character. */
function segmentRefused(segment: string): boolean {
  if (segment.length === 0) return true;
  if (segment === '.' || segment === '..') return true;
  if (segment.includes('/') || segment.includes('\\')) return true;
  return [...segment].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

export function targetPathFor(segments: readonly string[]): string {
  if (segments.length < REQUIRED_PREFIX.length + 1) {
    throw new ProxyRefused(404, 'that is not a path on the versioned API');
  }
  for (const [index, expected] of REQUIRED_PREFIX.entries()) {
    if (segments[index] !== expected) throw new ProxyRefused(404, 'the workbench proxies /api/v1 and nothing else');
  }
  for (const segment of segments) {
    if (segmentRefused(segment)) throw new ProxyRefused(400, 'that path contains a segment the proxy will not forward');
  }
  // Re-encoded on the way out: a segment that is legal but not URL-safe (a
  // space in a search term, say) must arrive as one segment, not as two.
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

export const FORWARDED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Request headers worth carrying. Short on purpose: anything absent from this
 * list has to be argued for, which is the opposite of a deny-list, where
 * anything forgotten is forwarded.
 */
const FORWARD_REQUEST = new Set([
  'accept',
  'accept-language',
  'content-type',
  'if-match',
  'if-none-match',
  'idempotency-key',
  // What a browser sends when an `EventSource` reconnects. Dropping it made
  // every reconnection look like a first connection, which is survivable —
  // the client refetches — but it throws away the only thing that could ever
  // make a resume possible.
  'last-event-id',
  'prefer',
]);

const FORWARD_RESPONSE = new Set([
  'content-type',
  'etag',
  'cache-control',
  'retry-after',
  'link',
  'x-correlation-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);

export function forwardRequestHeaders(incoming: Headers, accessToken: string, correlationId: string): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    if (FORWARD_REQUEST.has(name.toLowerCase())) out.set(name.toLowerCase(), value);
  }
  // Set last, so nothing a caller sent can win.
  out.set('authorization', `Bearer ${accessToken}`);
  out.set('x-correlation-id', correlationId);
  return out;
}

export function forwardResponseHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    if (FORWARD_RESPONSE.has(name.toLowerCase())) out.set(name.toLowerCase(), value);
  }
  return out;
}

/**
 * For an unsafe method, the request has to look like it came from this app.
 *
 * `sec-fetch-site` is the primary signal and every browser this app supports
 * sends it; `origin` is the fallback. A request with neither is refused rather
 * than trusted, because the only clients without either are not browsers, and
 * a non-browser client should be talking to the API directly with its own
 * token.
 */
export function assertSameOrigin(method: string, headers: Headers, appOrigin: string): void {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return;

  const site = headers.get('sec-fetch-site');
  if (site === 'same-origin') return;
  if (site !== null) throw new ProxyRefused(403, 'that request did not come from the workbench');

  const origin = headers.get('origin');
  if (origin && origin === appOrigin) return;
  throw new ProxyRefused(403, 'that request did not come from the workbench');
}

export function assertMethodAllowed(method: string): void {
  if (!FORWARDED_METHODS.has(method.toUpperCase())) throw new ProxyRefused(405, `${method} is not proxied`);
}

/** RFC 9457, so a refusal from the proxy reads the same as a refusal from the API. */
export function refusalBody(error: ProxyRefused, correlationId: string): Record<string, unknown> {
  return {
    type: 'about:blank',
    title: error.status === 403 ? 'Forbidden' : error.status === 405 ? 'Method Not Allowed' : 'Bad Request',
    status: error.status,
    detail: error.message,
    correlationId,
  };
}
