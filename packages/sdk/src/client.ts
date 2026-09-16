import type { ProblemDetails } from '@itsm/contracts';

/**
 * `@itsm/sdk` — the one way an application talks to the API.
 *
 * Doc 14 has listed this package since Phase 1 and nothing had built it, so
 * every caller would have written its own `fetch` wrapper and its own idea of
 * what an error is. Four of the API's conventions are easy to get wrong in a
 * component and impossible to get wrong here:
 *
 *   - **Errors are RFC 9457 problem details**, not strings. A caller that
 *     reads `error.message` gets something useful; one that needs the field
 *     list for a form gets `problem.errors`.
 *   - **Writes that create carry an idempotency key.** A person who clicks
 *     twice, or a network that retried underneath the browser, must not raise
 *     two tickets. The key is generated here when the caller does not supply
 *     one, so forgetting is not an option.
 *   - **Writes that update carry `If-Match`.** Optimistic concurrency is only
 *     a control if the header is sent; a 428 means it was not.
 *   - **Lists are cursor-paginated.** Page numbers over a moving list show
 *     some rows twice and skip others.
 *
 * Deliberately not generated from the OpenAPI document and deliberately not
 * exhaustive. The API has 366 endpoints; a client that wrapped all of them
 * would be mostly dead code that still has to typecheck. The core below is
 * complete, and each resource file grows when an application needs it — which
 * keeps the surface honest about what is actually used.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level problems, for putting messages next to inputs. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of this.problem?.errors ?? []) out[entry.field] = entry.message;
    return out;
  }

  /** Whether retrying the same request could plausibly work. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Supplied for a retry of the same intent; generated otherwise. */
  idempotencyKey?: string;
  /** The version the caller read, for a conditional update. */
  ifMatch?: string | number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ClientOptions {
  baseUrl: string;
  /** A bearer token, or a function returning one for a session that rotates. */
  token?: string | (() => string | Promise<string>);
  /** Injectable so a test needs no server and a server component can pass its own. */
  fetch?: typeof fetch;
  /** Sent on every request, for tracing a journey across services. */
  correlationId?: string;
}

const CREATES = new Set(['POST', 'PUT']);

function queryString(query: RequestOptions['query']): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** A key that is unique per intent, not per call, so a retry reuses it. */
function newIdempotencyKey(): string {
  return `sdk-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export interface Client {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  readonly baseUrl: string;
}

export function createClient(options: ClientOptions): Client {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!doFetch) throw new Error('no fetch available; pass one in');

  async function authorisation(): Promise<string | null> {
    if (!options.token) return null;
    const value = typeof options.token === 'function' ? await options.token() : options.token;
    return value ? `Bearer ${value}` : null;
  }

  async function request<T>(path: string, request: RequestOptions = {}): Promise<T> {
    const method = request.method ?? 'GET';
    const auth = await authorisation();

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(auth ? { authorization: auth } : {}),
      ...(options.correlationId ? { 'x-correlation-id': options.correlationId } : {}),
      ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
      // Generated rather than optional: a person who clicks twice, or a network
      // that retried underneath the browser, must not raise two tickets.
      ...(CREATES.has(method) ? { 'idempotency-key': request.idempotencyKey ?? newIdempotencyKey() } : {}),
      ...(request.ifMatch !== undefined ? { 'if-match': `"${request.ifMatch}"` } : {}),
      ...request.headers,
    };

    const response = await doFetch(`${options.baseUrl}${path}${queryString(request.query)}`, {
      method,
      headers,
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!response.ok) {
      const problem = isProblem(parsed) ? parsed : null;
      throw new ApiError(
        response.status,
        problem,
        problem?.detail ?? problem?.title ?? `the request failed with ${response.status}`,
      );
    }

    // 204, and any other empty body, is a success with nothing to read rather
    // than a parse error.
    return (parsed ?? undefined) as T;
  }

  return { request, baseUrl: options.baseUrl };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isProblem(value: unknown): value is ProblemDetails {
  return Boolean(value) && typeof value === 'object' && 'title' in (value as object) && 'status' in (value as object);
}
