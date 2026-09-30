import { ApiError, createClient, workbench, type Workbench } from '@itsm/sdk';
import type { DeskCounts } from '../inbox/counts.js';

/**
 * The API, from the browser.
 *
 * Base URL `/api/proxy`, never the API's own origin: the token lives in the
 * session store and the browser has only an opaque cookie, so a request that
 * went straight to the API would arrive unauthenticated. There is deliberately
 * no way to configure this to point elsewhere — a `NEXT_PUBLIC_API_URL` would
 * be exactly the escape hatch that undoes the token-handler pattern the first
 * time somebody is in a hurry.
 *
 * No `token` is passed, and that is the point: this client cannot hold one.
 */
export const api: Workbench = workbench(
  createClient({
    baseUrl: '/api/proxy',
    // Same-origin, so the session cookie rides along without `credentials`
    // being spelled out — and `no-store` because every one of these calls is
    // asking what is true *now*.
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  }),
);

/**
 * A read from one of this app's own aggregation handlers (`/api/desk/*`,
 * SPEC D16). They answer JSON, and problem JSON on failure — a 401 when the
 * session has ended, never a redirect a `fetch` would follow into the
 * identity provider's HTML. Failures become `ApiError`s, so a caller handles
 * them exactly as it handles the SDK's.
 */
export async function deskGet<T>(path: `/api/desk/${string}`, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store', ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, null, 'The network is unavailable.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body && typeof body === 'object' && 'status' in body ? (body as ConstructorParameters<typeof ApiError>[1]) : null;
    throw new ApiError(response.status, problem, problem?.detail ?? problem?.title ?? response.statusText);
  }
  return body as T;
}

/** The sidebar's counts, for the teams named (their ids are only filters; the API scopes the answer). */
export function fetchDeskCounts(teamIds: readonly string[], signal?: AbortSignal): Promise<DeskCounts> {
  const query = teamIds.length > 0 ? `?teams=${encodeURIComponent(teamIds.join(','))}` : '';
  return deskGet<DeskCounts>(`/api/desk/counts${query}`, signal);
}
