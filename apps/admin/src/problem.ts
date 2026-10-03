import { ApiError } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';

/**
 * An error from the API, as the design system's `Problem` (SPEC §4.0).
 *
 * One mapping for the server (`read()`, the layout's own failure screen) and
 * the browser (`useMutation`), so a failure reads the same wherever it
 * surfaces: `ProblemState` and `describeProblem` word it from the status and
 * the code, never from a stack trace.
 *
 * The API's problem `type` ends in the domain code
 * (`…/problems/tenant_suspended`); that last segment is the `code`. An error
 * that is not an `ApiError` — the network went away, a proxy answered with
 * HTML — becomes a 503 "Can't reach the service", which is what it is to the
 * person looking at it, and is marked retryable.
 */
export function problemFrom(error: unknown, digest?: string): Problem {
  if (error instanceof ApiError) {
    const problem = error.problem;
    const code = problem?.type ? problem.type.split('/').pop() : undefined;
    const fieldErrors = error.fieldErrors;
    return {
      status: error.status,
      ...(code && code !== 'about:blank' ? { code } : {}),
      ...(problem?.title ? { title: problem.title } : {}),
      ...(problem?.detail ? { detail: problem.detail } : {}),
      // A demo cap (429 demo_limit) does not lift with time, so waiting and
      // trying again cannot help, though every other 429 may be retried.
      retryable: code === 'demo_limit' ? false : error.retryable,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      ...(digest ? { digest } : {}),
    };
  }
  return { status: 503, retryable: true, ...(digest ? { digest } : {}) };
}

/** The API refused because this tenant is suspended: every call will, so the frame says so once. */
export function isTenantSuspended(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && (error.problem?.type ?? '').endsWith('/tenant_suspended');
}

/** The session behind the call has ended (expired, revoked, signed out elsewhere). */
export function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
