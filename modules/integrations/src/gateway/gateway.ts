import { type TenantContext, ValidationError, logger, metrics, newId, transaction } from '@itsm/platform';
import { checkDestination } from './address-guard.js';
import { CircuitOpenError, breakers } from './circuit-breaker.js';
import { redactBody, redactHeaders, redactUrl } from './redact.js';

/**
 * The only way out of the platform (docs/architecture/07 §4).
 *
 * Every outbound call a tenant's configuration can cause goes through here, so
 * that the four things that must be true of such a call are true once rather
 * than in each caller: the destination is checked, the credential is attached
 * without ever being logged, a failing endpoint stops consuming workers, and
 * the whole exchange is recorded in a form somebody can read afterwards.
 *
 * "Only way out" is the load-bearing part. A module that calls `fetch` directly
 * gets none of this, and gets it silently — so the module contract check treats
 * a bare `fetch` outside this folder as a boundary violation.
 */

export interface GatewayRequest {
  /** Which connector this is, for the breaker and the log. */
  connector: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Attached as `Idempotency-Key`, so a retry is not a second request. */
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Resolved from the credential store by the caller; never logged. */
  credential?: { header: string; value: string };
  /** What caused this, for the log: a workflow run, a rule, a sync job. */
  cause?: { kind: string; id: string };
}

export interface GatewayResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

export class GatewayRefusedError extends ValidationError {}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;

/** One row as it would be written to `integration_log`, after redaction. */
export interface GatewayLogEntry {
  connector: string;
  direction: 'outbound';
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
  durationMs: number;
  error: string | null;
}

export interface GatewayDeps {
  fetchImpl?: typeof fetch;
  resolver?: Parameters<typeof checkDestination>[1];
  now?: () => number;
  /**
   * Where the log goes. Injectable so a test can assert what was written —
   * which is the single most valuable assertion about this file, because the
   * credential reaching the log is the failure that would be invisible in
   * production until somebody read a support export.
   */
  sink?: (entry: GatewayLogEntry) => Promise<void>;
}

/**
 * Makes one outbound call.
 *
 * Throws `GatewayRefusedError` when the call must not be made at all — a
 * refused destination is a configuration error to show an administrator, not a
 * transient failure to retry — and an ordinary error when the call was made and
 * failed, which is retryable.
 */
export async function call(
  ctx: TenantContext,
  request: GatewayRequest,
  deps: GatewayDeps = {},
): Promise<GatewayResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  const verdict = await checkDestination(request.url, deps.resolver);
  if (!verdict.allowed) {
    // Logged and recorded, because a refused destination is usually somebody
    // mis-typing an internal hostname — and occasionally somebody probing.
    await record(ctx, request, { status: 0, error: `refused: ${verdict.reason}`, durationMs: 0 }, deps);
    metrics.increment('gateway_refused_total', { connector: request.connector });
    throw new GatewayRefusedError(`this connector cannot call that address: ${verdict.reason}`);
  }

  breakers.assertClosed(ctx.tenantId, request.connector, now());

  const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'itsm-platform/1.0 (+integration-gateway)',
    ...request.headers,
    ...(request.idempotencyKey ? { 'idempotency-key': request.idempotencyKey } : {}),
    ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
  };

  // Attached last and never merged into anything that gets logged. The log
  // below is built from `request.headers`, which has never seen this.
  const sent = request.credential ? { ...headers, [request.credential.header]: request.credential.value } : headers;

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: sent,
      signal: controller.signal,
      // Redirects are not followed. A 302 to 169.254.169.254 would walk
      // straight past the destination check, which was performed on the URL
      // the administrator configured rather than on wherever it points today.
      redirect: 'manual',
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
    });

    const durationMs = now() - started;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const text = await readCapped(response);
    let body: unknown = text;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // Not JSON; the text is what the caller gets, and what the log shows.
    }

    if (response.status >= 300 && response.status < 400) {
      breakers.recordFailure(ctx.tenantId, request.connector, now());
      await record(ctx, request, { status: response.status, durationMs, error: 'redirect refused', body }, deps);
      throw new GatewayRefusedError(
        `that endpoint redirected to ${responseHeaders.location ?? 'somewhere else'}; connectors must point at their final address`,
      );
    }

    // 4xx is the endpoint saying no, not the endpoint being broken. Opening
    // the breaker on a 404 would pause a connector whose URL is simply wrong,
    // and hide the one message that would fix it.
    const isServerFailure = response.status >= 500;
    if (isServerFailure) breakers.recordFailure(ctx.tenantId, request.connector, now());
    else breakers.recordSuccess(ctx.tenantId, request.connector);

    await record(ctx, request, { status: response.status, durationMs, body }, deps);
    metrics.observe('gateway_duration_ms', durationMs, { connector: request.connector });
    metrics.increment('gateway_calls_total', {
      connector: request.connector,
      outcome: response.ok ? 'ok' : String(response.status),
    });

    return { status: response.status, headers: responseHeaders, body, durationMs };
  } catch (error) {
    if (error instanceof GatewayRefusedError || error instanceof CircuitOpenError) throw error;

    const durationMs = now() - started;
    const aborted = error instanceof Error && error.name === 'AbortError';
    const message = aborted ? `no response within ${timeoutMs}ms` : error instanceof Error ? error.message : String(error);

    breakers.recordFailure(ctx.tenantId, request.connector, now());
    await record(ctx, request, { status: 0, durationMs, error: message }, deps);
    metrics.increment('gateway_calls_total', { connector: request.connector, outcome: aborted ? 'timeout' : 'error' });

    throw new Error(`the call to ${request.connector} failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the response with a cap.
 *
 * An endpoint returning a gigabyte — by accident or otherwise — must not take
 * the worker with it. The cap is on what is read, not on what is logged, so
 * the caller still gets a useful error rather than an out-of-memory one.
 */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`that endpoint returned more than ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

/**
 * Writes the exchange to `integration_log`.
 *
 * Its own transaction, and its failure never fails the call: a log that can
 * take down the thing it is logging is worse than no log. The body and headers
 * go through `redact` first, and the credential never reaches this function at
 * all — it is attached after the logged copy is built.
 */
async function record(
  ctx: TenantContext,
  request: GatewayRequest,
  outcome: { status: number; durationMs: number; body?: unknown; error?: string },
  deps: GatewayDeps,
): Promise<void> {
  // Built from `request.headers`, which has never held the credential: it is
  // merged in only at the point of sending. There is no redaction step to
  // forget, because the secret is not in the object being redacted.
  const entry: GatewayLogEntry = {
    connector: request.connector,
    direction: 'outbound' as const,
    method: request.method,
    url: redactUrl(request.url),
    requestHeaders: redactHeaders(request.headers ?? {}),
    requestBody: redactBody(request.body),
    status: outcome.status,
    responseBody: redactBody(outcome.body),
    durationMs: outcome.durationMs,
    error: outcome.error ?? null,
  };

  try {
    if (deps.sink) {
      await deps.sink(entry);
      return;
    }
    await transaction(ctx, (tx) =>
      tx.integrationLog.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          ...entry,
          requestHeaders: entry.requestHeaders as never,
          requestBody: entry.requestBody as never,
          responseBody: entry.responseBody as never,
          correlationId: ctx.correlationId ?? null,
          causeKind: request.cause?.kind ?? null,
          causeId: request.cause?.id ?? null,
        },
      }),
    );
  } catch (error) {
    logger.warn('an outbound call could not be logged', {
      connector: request.connector,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export { CircuitOpenError, breakers } from './circuit-breaker.js';
export { checkDestination, refuseAddress } from './address-guard.js';
export { redactBody, redactHeaders, redactUrl } from './redact.js';
