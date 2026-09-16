'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@itsm/sdk';
import { Button, Switch, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';

/**
 * Replying on a ticket.
 *
 * The visibility switch is the load-bearing control on this screen. An
 * internal note sent to a requester by accident is the mistake that costs a
 * service desk a customer, so it is stated three times over: the switch says
 * which it is, the button says what will happen ("Reply to requester" versus
 * "Add internal note"), and the composer is tinted when it is internal. None
 * of those alone is enough — an agent typing at speed reads the button, a
 * screen-reader user hears the switch, and a person glancing back at a half-
 * written draft sees the tint.
 *
 * The draft is kept in state and only cleared once the API has accepted it. A
 * composer that empties itself optimistically and then fails has thrown away
 * something a person wrote.
 */

export interface CommentComposerProps {
  readonly ticketNumber: string;
  /** False where the person may reply publicly but not add internal notes, or the reverse. */
  readonly canBeInternal?: boolean;
  /**
   * Controlled, so that accepting a suggestion can put its text here. An
   * uncontrolled composer would mean the suggestion panel reaching into
   * another component's state, which is the shape that ends in a draft being
   * silently replaced while somebody is typing.
   */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}

export function CommentComposer({ ticketNumber, canBeInternal = true, value, onValueChange }: CommentComposerProps): ReactNode {
  const router = useRouter();
  const fieldId = useId();
  const body = value;
  const setBody = onValueChange;
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.comment(ticketNumber, body.trim(), internal);
      setBody('');
      // The timeline is rendered on the server; this is what re-reads it.
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : 'That did not send. Your text is still here — try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="itsm-Composer" onSubmit={submit} data-internal={internal ? 'true' : 'false'}>
      <label className="itsm-Composer__label" htmlFor={fieldId}>
        {internal ? 'Internal note' : 'Reply to the requester'}
      </label>
      <Textarea
        id={fieldId}
        autoGrow
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={internal ? 'Only agents will see this.' : 'The requester will receive this.'}
        aria-describedby={error ? `${fieldId}-error` : undefined}
      />

      <div className="itsm-Composer__actions">
        {canBeInternal ? (
          <Switch
            checked={internal}
            onChange={setInternal}
            label="Internal note"
            description="Not visible to the requester"
          />
        ) : null}
        <Button type="submit" variant="primary" loading={busy} loadingLabel="Sending" disabled={body.trim().length === 0}>
          {internal ? 'Add internal note' : 'Reply to requester'}
        </Button>
      </div>

      {error ? (
        <p className="itsm-Composer__error" id={`${fieldId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
