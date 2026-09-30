'use client';

import { useCallback, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { afterAddressSettles } from './address.js';
import { describeProblem, notify, type Problem } from '@itsm/ui';
import { isSessionEnded, problemFrom } from '../problem.js';

/**
 * The console's one write path (B §2.4; SPEC §4.10).
 *
 * A page calls the SDK through `useMutation(fn, options)` and gets back
 * `run`, `pending`, the `problem` and its `fieldErrors`. What happens after the
 * call is the same everywhere, so it is written once:
 *
 * | Answer | What the person sees |
 * |---|---|
 * | success | the success toast (with *Undo* when the caller has a safe inverse), then — once the caller's address change has landed (`address.ts`) — the server data refreshes in a transition |
 * | 422 | nothing global: `fieldErrors` go to the form, which focuses its summary |
 * | 409 | nothing global: the caller opens `ConflictDialog` from `problem` |
 * | 401 | the "Your session ended" dialog, with *Sign in again* back to this page |
 * | 403 suspended | the page refreshes, and the frame shows the suspended screen |
 * | 403 | a toast naming what is missing; the page refreshes its permissions |
 * | 402 | "Your organisation has reached a plan limit", with a way to Usage |
 * | 429 | "Try again in 20 s", Retry disabled until then |
 * | 5xx / no answer | the failure with *Retry* — safe, because SDK writes carry idempotency keys |
 *
 * `run` never throws: it resolves `{ ok: true, value }` or `{ ok: false,
 * problem }`, so a form's submit handler can hand `fieldErrors` straight back
 * to `Form` without a try/catch.
 */

export type MutationResult<R> = { readonly ok: true; readonly value: R } | { readonly ok: false; readonly problem: Problem };

export interface MutationOptions<R> {
  /** The success toast: "Rule published". Omit for a change the screen already shows. */
  readonly success?: string | ((value: R) => string);
  /** A safe inverse, offered as *Undo* for 8 seconds (and ⌘Z while the toast shows). */
  readonly undo?: (value: R) => Promise<void>;
  /** What failed, for the error toast: "Couldn't publish the rule". */
  readonly failure?: string;
  /** Refresh the server-rendered data afterwards. Default true. */
  readonly refresh?: boolean;
  onSuccess?(value: R): void;
  onError?(problem: Problem): void;
}

export interface Mutation<A extends unknown[], R> {
  run(...args: A): Promise<MutationResult<R>>;
  readonly pending: boolean;
  readonly problem: Problem | null;
  /** Keyed by the API's field names, which are the form controls' `name`s. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  reset(): void;
}

/* -------------------------------------------------------------------------
 * "Your session ended" — one dialog for the frame, raised from anywhere
 * ---------------------------------------------------------------------- */

let sessionEnded = false;
const sessionListeners = new Set<() => void>();

/** Asks the frame to show "Your session ended" (a 401 on a write the person made). */
export function reportSessionEnded(): void {
  if (sessionEnded) return;
  sessionEnded = true;
  for (const listener of [...sessionListeners]) listener();
}

/** For the frame's dialog: whether a write found the session gone, and a way to dismiss it. */
export function useSessionEnded(): [boolean, () => void] {
  const ended = useSyncExternalStore(
    (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    () => sessionEnded,
    () => false,
  );
  const dismiss = useCallback(() => {
    sessionEnded = false;
    for (const listener of [...sessionListeners]) listener();
  }, []);
  return [ended, dismiss];
}

/* -------------------------------------------------------------------------
 * The pure part: what to do with a failure
 * ---------------------------------------------------------------------- */

export type FailureResponse =
  | { readonly kind: 'fields' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'session' }
  | { readonly kind: 'suspended' }
  | { readonly kind: 'toast'; readonly title: string; readonly description?: string; readonly retry: boolean; readonly retryAt?: number; readonly usage?: boolean; readonly refresh?: boolean };

/**
 * How the console answers a failed write — kept apart from the hook so the
 * table above is a tested function rather than a comment.
 */
export function respondTo(problem: Problem, failure?: string, now: number = Date.now()): FailureResponse {
  if (problem.status === 422 && problem.fieldErrors && Object.keys(problem.fieldErrors).length > 0) return { kind: 'fields' };
  if (problem.status === 409 || problem.status === 428) return { kind: 'conflict' };
  if (problem.status === 401) return { kind: 'session' };
  if (problem.status === 403 && problem.code === 'tenant_suspended') return { kind: 'suspended' };
  const described = describeProblem(problem);
  if (problem.status === 402) return { kind: 'toast', title: 'Your organisation has reached a plan limit', description: described.body, retry: false, usage: true };
  if (problem.status === 429) {
    const seconds = problem.retryAfterSeconds ?? 20;
    return { kind: 'toast', title: failure ?? described.title, description: `Try again in ${seconds} s.`, retry: true, retryAt: now + seconds * 1000 };
  }
  if (problem.status === 403) return { kind: 'toast', title: failure ?? described.title, description: described.body, retry: false, refresh: true };
  const retry = problem.status === 0 || problem.status >= 500 || problem.retryable === true;
  return { kind: 'toast', title: failure ?? described.title, description: described.body, retry };
}

/* -------------------------------------------------------------------------
 * The hook
 * ---------------------------------------------------------------------- */

const NO_FIELDS: Readonly<Record<string, string>> = Object.freeze({});

export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>, options: MutationOptions<R> = {}): Mutation<A, R> {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The latest callbacks without re-creating `run` on every render.
  const latest = useRef({ fn, options });
  latest.current = { fn, options };

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const run = useCallback(
    async (...args: A): Promise<MutationResult<R>> => {
      const { fn: call, options: opts } = latest.current;
      setPending(true);
      setProblem(null);
      try {
        const value = await call(...args);
        setPending(false);
        if (opts.success) {
          const message = typeof opts.success === 'function' ? opts.success(value) : opts.success;
          const undo = opts.undo;
          notify(message, {
            tone: 'success',
            ...(undo
              ? {
                  undo: async () => {
                    await undo(value);
                    if (opts.refresh !== false) refresh();
                  },
                }
              : {}),
          });
        }
        opts.onSuccess?.(value);
        // After the caller has closed its sheet or opened the new record: a refresh begun for
        // the old address would bring that address back when it lands (`address.ts`).
        if (opts.refresh !== false) afterAddressSettles(refresh);
        return { ok: true, value };
      } catch (error) {
        const failed = problemFrom(error);
        setPending(false);
        setProblem(failed);
        opts.onError?.(failed);
        const response = respondTo(failed, opts.failure);
        if (response.kind === 'session' || isSessionEnded(error)) reportSessionEnded();
        else if (response.kind === 'suspended') refresh();
        else if (response.kind === 'toast') {
          notify(response.title, {
            tone: 'danger',
            ...(response.description ? { description: response.description } : {}),
            ...(response.retryAt ? { retryAt: response.retryAt } : {}),
            ...(response.retry ? { action: { label: 'Retry', onClick: () => void run(...args) } } : {}),
            ...(response.usage ? { action: { label: 'See usage', onClick: () => router.push('/settings/usage') } } : {}),
          });
          if (response.refresh) refresh();
        }
        return { ok: false, problem: failed };
      }
    },
    [refresh, router],
  );

  const reset = useCallback(() => setProblem(null), []);

  return { run, pending, problem, fieldErrors: problem?.fieldErrors ?? NO_FIELDS, reset };
}
