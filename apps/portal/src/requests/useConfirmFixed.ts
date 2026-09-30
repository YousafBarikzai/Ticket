'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { notify, type Problem } from '@itsm/ui';
import { api } from '../client/api.js';
import { reportSessionEnded, toastProblem } from '../client/useAction.js';
import type { ConfirmOutcome } from './resolution.js';

export interface ConfirmFixed {
  confirm(): Promise<ConfirmOutcome | null>;
  /** From the press until the page has redrawn from the server. */
  readonly pending: boolean;
  /** Before PA1: the confirmation went in as a message, and the request closes itself. */
  readonly acknowledged: boolean;
}

/**
 * The rules and the outbox, loaded when a row or card that can be confirmed
 * first mounts and the browser is idle — not in the first load. Home shows
 * "Yes, it's fixed" on a resolved request's row, and eagerly these two cost
 * every Home visit about 6 kB for a button most visits never press. On the
 * request pages they are already loaded by the composer and the card, so the
 * import settles at once.
 */
const loadConfirm = () => Promise.all([import('./resolution.js'), import('@itsm/pwa')]);

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}

/**
 * "Yes, it's fixed" for one request — the hero card's, the list row's and
 * Home's (SPEC §6.3): close it on the version the page read, safely (see
 * `confirmFixed`: a lost answer to a close that landed is success, a
 * conflict is retried once on a fresh read, a request that moved on is
 * said so), thank them, and redraw the page from the server. One press at a
 * time; a failure is a toast with Try again, a lost session is the frame's.
 */
export function useConfirmFixed(
  number: string,
  version: number,
  options: {
    /** Called once it has worked, before the page redraws: where the caller moves focus next. */
    readonly onSettled?: (outcome: ConfirmOutcome) => void;
  } = {},
): ConfirmFixed {
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = useRef(false);
  // One intent, one key: the fallback message always says the same words.
  const key = useRef<string | null>(null);
  const settled = useRef(options.onSettled);
  settled.current = options.onSettled;

  useEffect(() => whenIdle(() => void loadConfirm().catch(() => undefined)), []);

  const confirm = useCallback(async (): Promise<ConfirmOutcome | null> => {
    if (busy.current) return null;
    busy.current = true;
    setCalling(true);
    let problemOfFailure: ((error: unknown) => Problem) | null = null;
    try {
      const [resolution, pwa] = await loadConfirm();
      problemOfFailure = resolution.problemOfFailure;
      key.current ??= pwa.newIdempotencyKey();
      const outcome = await resolution.confirmFixed({ transition: api.transition, ticket: api.ticket, send: pwa.submitOrQueue }, number, version, key.current);
      if (outcome.kind === 'closed') notify('Thanks, we’ve closed it', { tone: 'success' });
      else if (outcome.kind === 'moved') notify('This request has moved on since the page loaded', { tone: 'info' });
      else {
        setAcknowledged(true);
        notify('Thanks for confirming', {
          tone: 'success',
          description: outcome.queued ? 'We’ll tell the service desk when you’re back online.' : 'It will close automatically.',
        });
      }
      settled.current?.(outcome);
      startRefresh(() => router.refresh());
      return outcome;
    } catch (error) {
      // The rules could not even load (offline before they were fetched): nothing was sent.
      const problem: Problem = problemOfFailure ? problemOfFailure(error) : { status: 0, retryable: true };
      if (problem.status === 401) reportSessionEnded('action');
      else toastProblem(problem, () => void confirm());
      return null;
    } finally {
      busy.current = false;
      setCalling(false);
    }
  }, [number, version, router]);

  return { confirm, pending: calling || refreshing, acknowledged };
}
