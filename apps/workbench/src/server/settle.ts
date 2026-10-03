import { unstable_rethrow } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';

/**
 * A read that is allowed to fail (A6 §3.2 rule 2, SPEC §7.0.2).
 *
 * A Service Desk page is a set of cards, each its own async server component
 * inside `<Suspense>`, each waiting only on its own read. One card's read
 * failing must cost that card and nothing else: the card renders
 * `CardProblem` and the hero, the KPI tiles and every other card stand. So no
 * loader throws into a page — it settles, and the card decides what to draw.
 *
 * The portal's `home/settle.ts` pattern, with the failure kept rather than
 * dropped: the card needs it to say *what* went wrong ("The demo is paused or
 * being prepared" is not "Couldn't load your queue"), and a page needs the
 * code to tell a missing permission (render nothing, D9) from an outage.
 *
 * Never throws for a failed read — an `ApiError`, a network error, a bug in
 * the loader, a rejected non-error, a loader that throws before returning its
 * promise. The one thing it does let through is Next's own control flow
 * (`redirect()`, `notFound()` and the dynamic-rendering signals), through
 * `unstable_rethrow`: those are thrown on purpose by the session helpers —
 * `currentMe()` redirects a session the API no longer honours — and a card
 * that swallowed one would draw "Something went wrong" over a page that
 * should have gone to sign-in.
 */

/**
 * The design system's `Problem`, with the shared demo's extension members
 * when the API sent them (ADR-0054): a page can lock the one control a
 * `demo_disabled` names, or word a `demo_limit` from its category, without
 * parsing the sentence.
 */
export interface SettledProblem extends Problem {
  readonly feature?: string;
  readonly category?: string;
  readonly limit?: number;
  readonly reason?: string;
}

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: SettledProblem };

/**
 * Any failure as a `SettledProblem`. An `ApiError` keeps its status, code,
 * prose, field errors, wait and the demo's members; anything else is the
 * service being out of reach (503), which is what it is from where the person
 * sits — a server render that could not reach the API is not *their*
 * connection.
 */
export function problemFrom(error: unknown): SettledProblem {
  if (!(error instanceof ApiError)) return { status: 503, retryable: true };
  const body = error.problem;
  const code = error.code;
  const fieldErrors = error.fieldErrors;
  return {
    status: error.status,
    ...(code ? { code } : {}),
    ...(body?.title ? { title: body.title } : {}),
    ...(body?.detail ? { detail: body.detail } : {}),
    // A demo limit is a 429 that waiting does not cure: a retry would only be refused again.
    retryable: code === 'demo_limit' ? false : error.retryable,
    ...(typeof body?.retryAfterSec === 'number' ? { retryAfterSeconds: body.retryAfterSec } : {}),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(body?.feature ? { feature: body.feature } : {}),
    ...(body?.category ? { category: body.category } : {}),
    ...(typeof body?.limit === 'number' ? { limit: body.limit } : {}),
    ...(body?.reason ? { reason: body.reason } : {}),
  };
}

/**
 * `{ ok: true, value }` or `{ ok: false, problem }`, never a rejection. Pass
 * the promise, or a function that makes it — the function form also catches
 * a loader that throws before it has a promise to return.
 */
export async function settle<T>(work: Promise<T> | (() => T | Promise<T>)): Promise<Settled<T>> {
  try {
    const value = await (typeof work === 'function' ? work() : work);
    return { ok: true, value };
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof ApiError)) {
      // An API refusal is an answer; anything else is a failure nobody would
      // otherwise hear about, because the card covers it. Log it on the server.
      console.error('[settle] a read failed without an API answer', error);
    }
    return { ok: false, problem: problemFrom(error) };
  }
}

/**
 * The value, or `null` when the API refused for a permission or scope (403)
 * — D9: a card whose permission is missing is not rendered, and a refusal
 * such as "you are not in a team" is a 403 too. Any other failure stays a
 * failure, for `CardProblem`.
 */
export function orNullWhenForbidden<T>(settled: Settled<T>): Settled<T | null> {
  if (!settled.ok && settled.problem.status === 403 && settled.problem.code !== 'tenant_suspended') return { ok: true, value: null };
  return settled;
}
