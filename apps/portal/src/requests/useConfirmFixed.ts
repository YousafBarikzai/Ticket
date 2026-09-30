'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitOrQueue } from '@itsm/pwa';
import { notify } from '@itsm/ui';
import { api } from '../client/api.js';
import { reportSessionEnded, toastProblem } from '../client/useAction.js';
import { useIntentKey } from './hooks.js';
import { CONFIRMED_MESSAGE, confirmFixed, problemOfFailure, type ConfirmOutcome } from './resolution.js';

export interface ConfirmFixed {
  confirm(): Promise<ConfirmOutcome | null>;
  /** From the press until the page has redrawn from the server. */
  readonly pending: boolean;
  /** Before PA1: the confirmation went in as a message, and the request closes itself. */
  readonly acknowledged: boolean;
}

/**
 * "Yes, it's fixed" for one request — the hero card's and the list row's
 * (SPEC §6.3): close it on the version the page read, safely (see
 * `confirmFixed`), thank them, and redraw the page from the server. One
 * press at a time; a failure is a toast with Try again, a lost session is
 * the frame's.
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
  const { keyFor } = useIntentKey();
  const settled = useRef(options.onSettled);
  settled.current = options.onSettled;

  const confirm = useCallback(async (): Promise<ConfirmOutcome | null> => {
    if (busy.current) return null;
    busy.current = true;
    setCalling(true);
    try {
      const outcome = await confirmFixed({ transition: api.transition, ticket: api.ticket, send: submitOrQueue }, number, version, keyFor(CONFIRMED_MESSAGE));
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
      const problem = problemOfFailure(error);
      if (problem.status === 401) reportSessionEnded('action');
      else toastProblem(problem, () => void confirm());
      return null;
    } finally {
      busy.current = false;
      setCalling(false);
    }
  }, [number, version, keyFor, router]);

  return { confirm, pending: calling || refreshing, acknowledged };
}
