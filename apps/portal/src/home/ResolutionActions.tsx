'use client';

import { useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { Button, VisuallyHidden, notify } from '@itsm/ui';
import { api } from '../client/api.js';
import { problemOf, reportSessionEnded, toastProblem } from '../client/useAction.js';

/**
 * "Is it fixed?" on Home's row for a resolved request (SPEC §6.3, §6.4:
 * "resolution guesswork → two buttons"): *Yes, it's fixed* closes it there
 * and then (PA1: `closed` from `resolved`, with `If-Match`); *No* opens the
 * request, where "What's still happening?" reopens it with their words.
 *
 * A request that changed since the page was drawn (409 or 428) is read again
 * and, if it is still waiting for this answer, closed on the fresh version —
 * once. If it has moved on, the page is redrawn and they are told so rather
 * than shown an error. Offline, the button says it needs a connection: a
 * transition is never queued (ADR-0043).
 */

function useOnline(): boolean {
  return useSyncExternalStore(
    (change) => {
      window.addEventListener('online', change);
      window.addEventListener('offline', change);
      return () => {
        window.removeEventListener('online', change);
        window.removeEventListener('offline', change);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Closes a resolved request: `closed` on the version the page read, and on a
 * 409/428 once more on a fresh read — or `moved` when the request is no
 * longer waiting for this answer.
 */
export async function closeResolved(number: string, version: number): Promise<'closed' | 'moved'> {
  try {
    await api.transition(number, 'closed', version);
    return 'closed';
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 428)) throw error;
  }
  const fresh = await api.ticket(number);
  if (fresh.status !== 'resolved') return 'moved';
  await api.transition(number, 'closed', fresh.version);
  return 'closed';
}

export interface ResolutionActionsProps {
  readonly number: string;
  readonly version: number;
  /** The request's title, so each row's buttons are told apart by a screen reader. */
  readonly title: string;
}

export function ResolutionActions({ number, version, title }: ResolutionActionsProps): ReactNode {
  const router = useRouter();
  const online = useOnline();
  const [calling, setCalling] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const confirm = async (): Promise<void> => {
    if (calling) return;
    setCalling(true);
    try {
      const outcome = await closeResolved(number, version);
      notify(outcome === 'closed' ? 'Thanks, we’ve closed it' : 'This request has moved on since the page loaded', {
        tone: outcome === 'closed' ? 'success' : 'info',
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      const problem = problemOf(error);
      if (problem.status === 401) reportSessionEnded('action');
      else toastProblem(problem, () => void confirm());
    } finally {
      setCalling(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="tinted"
        loading={calling || refreshing}
        loadingLabel="Closing"
        {...(online ? {} : { disabledReason: 'Needs a connection' })}
        onClick={() => void confirm()}
      >
        Yes, it’s fixed<VisuallyHidden>: {title}</VisuallyHidden>
      </Button>
      <Button size="sm" variant="secondary" href={`/tickets/${encodeURIComponent(number)}?fixed=no`}>
        No<VisuallyHidden>, {title} is still broken</VisuallyHidden>
      </Button>
    </>
  );
}
