'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { describeProblem, notify, type Problem } from '@itsm/ui';

/**
 * The portal's one way to change something (C §1.4): call the SDK, then let
 * the server components redraw from the truth — `router.refresh()` inside a
 * transition, so the page stays put and interactive while the new render
 * streams in, and `pending` covers both halves.
 *
 * Failures come back as a `Problem`, worded the way `ProblemState` words
 * them, and are handled by kind (SPEC §4.10):
 *
 *   - **422** and **409** are the caller's: field errors belong next to their
 *     fields, and "this changed while you were writing" next to the text.
 *   - **401** is the frame's: an action the person just took found their
 *     session gone, so the frame asks them to sign in again (an alert dialog
 *     — they are waiting on this answer) and keeps whatever they typed.
 *   - Anything else is a toast: 402 "Your organisation has reached a plan
 *     limit", 429 with Retry held until it may work, a 5xx or a dropped
 *     connection with *Try again* (safe: the SDK's writes carry idempotency
 *     keys, and the same call is repeated with the same arguments).
 */

export type ActionResult<R> = { readonly ok: true; readonly value: R } | { readonly ok: false; readonly problem: Problem };

export interface UseActionOptions<R> {
  /** A toast on success: "Saved", "Thanks, we've closed it". */
  readonly success?: string | ((value: R) => string);
  /** Redraw the page's server components afterwards. Default true. */
  readonly refresh?: boolean;
  /** Toast failures that are not the caller's to show (see above). Default true. */
  readonly toastErrors?: boolean;
}

export interface ActionState<A extends readonly unknown[], R> {
  run(...args: A): Promise<ActionResult<R>>;
  /** From the call starting until the refreshed page has rendered. */
  readonly pending: boolean;
  /** The last failure, until the next run or `clear()`. */
  readonly problem: Problem | null;
  clear(): void;
}

/** An SDK failure as the design system's `Problem`. A thrown non-API error is a network failure. */
export function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    const type = error.problem?.type ?? '';
    const code = type.includes('/problems/') ? type.slice(type.lastIndexOf('/') + 1) : undefined;
    const fieldErrors = error.fieldErrors;
    return {
      status: error.status,
      ...(code ? { code } : {}),
      ...(error.problem?.title ? { title: error.problem.title } : {}),
      ...(error.problem?.detail ? { detail: error.problem.detail } : {}),
      // A demo cap (429 demo_limit) does not lift with time, so waiting and
      // trying again cannot help, though every other 429 may be retried.
      retryable: code === 'demo_limit' ? false : error.retryable,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    };
  }
  return { status: 0, retryable: true };
}

/* --------------------------------------------------------- Session ended */

/**
 * `action`: something the person did came back 401 — ask, now. `background`:
 * a read or the live stream heard it — a banner, nothing that steals focus
 * (D15).
 */
export type SessionEndedHow = 'action' | 'background';

const sessionListeners = new Set<(how: SessionEndedHow) => void>();

/** Tells the frame the session has ended. */
export function reportSessionEnded(how: SessionEndedHow): void {
  for (const listener of [...sessionListeners]) listener(how);
}

/** The frame's subscription; returns the unsubscribe. */
export function onSessionEnded(listener: (how: SessionEndedHow) => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/* ------------------------------------------------------------ Error toast */

/** Whether a failure is the caller's to show inline rather than a toast's. */
export function isInlineProblem(problem: Problem): boolean {
  return problem.status === 422 || problem.status === 409 || problem.status === 428;
}

/** The toast for a failure nobody shows inline. `retry` repeats the same call. */
export function toastProblem(problem: Problem, retry?: () => void): void {
  const described = describeProblem(problem);
  const retryAt = problem.status === 429 && problem.retryAfterSeconds ? Date.now() + problem.retryAfterSeconds * 1000 : undefined;
  notify(described.title, {
    tone: problem.status === 429 || problem.status === 402 ? 'warning' : 'danger',
    description: described.body,
    ...(retry && (problem.retryable || problem.status === 0) ? { action: { label: 'Try again', onClick: retry } } : {}),
    ...(retryAt ? { retryAt } : {}),
  });
}

/* ------------------------------------------------------------------- Hook */

export function useAction<A extends readonly unknown[], R>(
  call: (...args: A) => Promise<R>,
  options: UseActionOptions<R> = {},
): ActionState<A, R> {
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<Problem | null>(null);

  // The latest call and options, so `run` keeps one identity across renders.
  const latest = useRef({ call, options });
  latest.current = { call, options };
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<ActionResult<R>> => {
      const { call: current, options: settings } = latest.current;
      setCalling(true);
      setProblem(null);
      try {
        const value = await current(...args);
        if (settings.success) notify(typeof settings.success === 'function' ? settings.success(value) : settings.success, { tone: 'success' });
        if (settings.refresh !== false) startRefresh(() => router.refresh());
        return { ok: true, value };
      } catch (error) {
        const failure = problemOf(error);
        if (live.current) setProblem(failure);
        if (failure.status === 401) reportSessionEnded('action');
        else if (settings.toastErrors !== false && !isInlineProblem(failure)) toastProblem(failure, () => void run(...args));
        return { ok: false, problem: failure };
      } finally {
        if (live.current) setCalling(false);
      }
    },
    [router],
  );

  const clear = useCallback(() => setProblem(null), []);
  return { run, pending: calling || refreshing, problem, clear };
}
