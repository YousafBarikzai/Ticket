'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { Button, VisuallyHidden } from '@itsm/ui';
import { useConfirmFixed } from '../requests/useConfirmFixed.js';

/**
 * "Is it fixed?" on Home's row for a resolved request (SPEC §6.3, §6.4:
 * "resolution guesswork → two buttons"): *Yes, it's fixed* closes it there
 * and then (PA1: `closed` from `resolved`, with `If-Match`); *No* opens the
 * request, where "What's still happening?" reopens it with their words.
 *
 * The close is My requests' and the request page's (`useConfirmFixed` over
 * `confirmFixed`), so Home decides the awkward cases the same way they do:
 *
 *   - a 409/428 reads the request again and closes the fresh version once,
 *     or says it has moved on;
 *   - a close that landed but whose answer was lost (the connection dropped
 *     on the way back) is read again and counted as done, not as a failure
 *     with a Try again that would find nothing left to close;
 *   - an API that will not let a requester close (403 while still resolved)
 *     gets the "Confirmed fixed" message instead, and the row thanks them.
 *
 * Offline, the button says it needs a connection: a transition is never
 * queued (ADR-0043).
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

export interface ResolutionActionsProps {
  readonly number: string;
  readonly version: number;
  /** The request's title, so each row's buttons are told apart by a screen reader. */
  readonly title: string;
}

export function ResolutionActions({ number, version, title }: ResolutionActionsProps): ReactNode {
  const online = useOnline();
  const fixed = useConfirmFixed(number, version);

  if (fixed.acknowledged) {
    return (
      <p className="app-Home__thanks" role="status">
        Thanks for confirming
      </p>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="tinted"
        loading={fixed.pending}
        loadingLabel="Closing"
        {...(online ? {} : { disabledReason: 'Needs a connection' })}
        onClick={() => void fixed.confirm()}
      >
        Yes, it’s fixed<VisuallyHidden>: {title}</VisuallyHidden>
      </Button>
      <Button size="sm" variant="secondary" href={`/tickets/${encodeURIComponent(number)}?fixed=no`}>
        No<VisuallyHidden>, {title} is still broken</VisuallyHidden>
      </Button>
    </>
  );
}
