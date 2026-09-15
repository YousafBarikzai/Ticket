'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@itsm/sdk';
import { Button, Select } from '@itsm/ui';
import { api } from '../client/api.js';
import { stateLabel } from '../queue/presentation.js';

/**
 * Moving a ticket, and taking it.
 *
 * Two things here are not decoration.
 *
 * **The version rides as `If-Match` on the move.** Two agents on the same
 * major incident is the normal case, not the race condition nobody hits. The
 * API answers 409 when the ticket moved underneath this page, and the message
 * says so in words a person can act on — "somebody else changed this" —
 * rather than showing a status code. Assignment carries no version because
 * the API's assign endpoint does not read one; taking a ticket somebody else
 * just took is therefore silent, which is a gap in the API rather than
 * something to simulate here.
 *
 * **Only legal transitions are offered.** The state machine already knows
 * which moves exist (MOD-04); offering all nine and letting the API refuse
 * six of them teaches an agent that the buttons lie.
 */

export interface TicketActionsProps {
  readonly ticketNumber: string;
  readonly version: number;
  readonly currentStatus: string;
  readonly allowedTransitions: readonly string[];
  readonly assignedToMe: boolean;
  readonly canAssign: boolean;
  readonly myUserId: string | null;
}

export function TicketActions({
  ticketNumber,
  version,
  currentStatus,
  allowedTransitions,
  assignedToMe,
  canAssign,
  myUserId,
}: TicketActionsProps): ReactNode {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<null | 'move' | 'assign'>(null);
  const [error, setError] = useState<string | null>(null);

  const describe = (failure: unknown): string => {
    if (failure instanceof ApiError && failure.status === 409) {
      return 'Somebody else changed this ticket while you were reading it. Reload to see what they did.';
    }
    if (failure instanceof ApiError && failure.status === 428) {
      return 'This page is out of date. Reload before changing the ticket.';
    }
    return failure instanceof ApiError ? failure.message : 'That did not work. Try again.';
  };

  async function move(): Promise<void> {
    if (!target || busy) return;
    setBusy('move');
    setError(null);
    try {
      await api.transition(ticketNumber, target, version);
      setTarget('');
      router.refresh();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(null);
    }
  }

  async function take(): Promise<void> {
    if (busy || !myUserId) return;
    setBusy('assign');
    setError(null);
    try {
      await api.assign(ticketNumber, assignedToMe ? null : myUserId);
      router.refresh();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="itsm-TicketActions">
      {allowedTransitions.length > 0 ? (
        <div className="itsm-TicketActions__move">
          <Select
            aria-label={`Move from ${stateLabel(currentStatus)} to`}
            placeholder="Move to…"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            options={allowedTransitions.map((state) => ({ value: state, label: stateLabel(state) }))}
          />
          <Button variant="primary" onClick={move} loading={busy === 'move'} loadingLabel="Moving" disabled={!target}>
            Move
          </Button>
        </div>
      ) : (
        <p className="itsm-TicketActions__final">This ticket is finished. Raise a new one instead of reopening it.</p>
      )}

      {canAssign && myUserId ? (
        <Button variant="secondary" onClick={take} loading={busy === 'assign'} loadingLabel="Saving">
          {assignedToMe ? 'Give it back to the queue' : 'Assign it to me'}
        </Button>
      ) : null}

      {error ? (
        <p className="itsm-TicketActions__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
