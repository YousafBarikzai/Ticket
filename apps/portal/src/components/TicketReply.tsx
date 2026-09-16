'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@itsm/sdk';
import { Button, FormField, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * Replying, and saying "no, this is not fixed".
 *
 * One box with two buttons rather than two boxes, because they are the same
 * sentence: a person who has been told their ticket is resolved and disagrees
 * types *why* and then presses the button that says so. Making them write it
 * twice, or making "reopen" a bare button with no reason attached, produces a
 * reopened ticket nobody can act on.
 *
 * `canReopen` comes from the state machine, not from a guess: MOD-04 allows
 * `resolved → reopened` and allows nothing at all out of `closed`. A closed
 * ticket gets a new linked one, and the screen says that instead of offering a
 * button the API would refuse.
 *
 * Every message a requester writes is public. There is no internal note here
 * and no switch to get wrong — which is the one thing this screen has that the
 * agent's composer does not.
 */

export interface TicketReplyProps {
  readonly ticketNumber: string;
  readonly version: number;
  readonly status: string;
  readonly canReopen: boolean;
}

export function TicketReply({ ticketNumber, version, status, canReopen }: TicketReplyProps): ReactNode {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<null | 'reply' | 'reopen'>(null);
  const [error, setError] = useState<string | null>(null);

  const finished = status === 'closed' || status === 'cancelled';

  function describe(failure: unknown): string {
    if (failure instanceof ApiError && (failure.status === 409 || failure.status === 428)) {
      return 'This ticket changed while you were typing. Reload the page and your message will still be here.';
    }
    return failure instanceof ApiError ? failure.message : 'That did not send. Your text is still here — try again.';
  }

  async function reply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy('reply');
    setError(null);
    try {
      await api.comment(ticketNumber, body.trim());
      setBody('');
      router.refresh();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(null);
    }
  }

  async function reopen(): Promise<void> {
    if (busy) return;
    const reason = body.trim();
    if (!reason) {
      setError('Tell us what is still wrong, then reopen it.');
      return;
    }
    setBusy('reopen');
    setError(null);
    try {
      // The reason rides with the transition *and* stays as a message, because
      // the transition's reason is recorded in the audit trail where the
      // requester will never see it again, and the conversation is where they
      // will look for what they said.
      await api.comment(ticketNumber, reason);
      await api.reopen(ticketNumber, version, reason);
      setBody('');
      router.refresh();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(null);
    }
  }

  if (finished) {
    return (
      <p className="itsm-Reply__closed">
        This ticket is closed. If it happens again, report it and we will link the two.
      </p>
    );
  }

  return (
    <form className="itsm-Reply" onSubmit={reply}>
      <FormField
        label={canReopen ? 'Is it sorted?' : 'Add a message'}
        hint={
          canReopen
            ? 'If it is, you can leave this. If not, tell us what is still happening and reopen it.'
            : 'Anything else we should know goes here.'
        }
      >
        {(control) => (
          <Textarea
            {...control}
            autoGrow
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
      </FormField>

      <div className="itsm-Reply__actions">
        <Button type="submit" variant="primary" loading={busy === 'reply'} loadingLabel="Sending" disabled={!body.trim()}>
          Send
        </Button>
        {canReopen ? (
          <Button variant="secondary" onClick={reopen} loading={busy === 'reopen'} loadingLabel="Reopening">
            It is not fixed — reopen it
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="itsm-Reply__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
