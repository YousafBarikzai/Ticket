'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { queueable } from '@itsm/sdk';
import { newIdempotencyKey, submitOrQueue } from '@itsm/pwa';
import { Button, FormField, Textarea, VisuallyHidden } from '@itsm/ui';
import { reportSessionEnded } from '../client/useAction.js';

/**
 * Approving or rejecting (SPEC §6.3 `/approvals`).
 *
 * The note is above both buttons and is required for a rejection, optional
 * for an approval. That asymmetry is the whole design: an approval with no
 * note costs nobody anything, and a rejection with no note is a request that
 * stops dead with no way forward — the requester cannot tell whether to
 * change it, escalate it or give up.
 *
 * Neither button is styled as the safe one. An approval is not the default
 * answer, and a screen that makes it the obvious click is a screen that
 * produces approvals nobody read.
 *
 * A decision is queueable offline (ADR-0043). Unlike a reply, a replayed
 * decision is *not* treated as a success: a 409 means somebody else decided
 * while this one waited, and that is news the person has to see rather than a
 * duplicate to swallow.
 *
 * One idempotency key per intent: the same answer with the same note, sent
 * again after a failure, carries the same key (so a reply lost on the way
 * back cannot count twice); a different answer or note is a new intent.
 *
 * By default the parts are stacked where the component is placed. The
 * approval sheet takes them apart (`children`) to put the note in its body
 * and the two buttons in its sticky footer; it also takes over what happens
 * next (`onSettled`) — closing, moving focus on, redrawing the list.
 */

export type Decision = 'approved' | 'rejected';

export type DecisionOutcome =
  | { readonly kind: 'sent'; readonly decision: Decision }
  | { readonly kind: 'queued'; readonly decision: Decision }
  /** Nothing left to decide: somebody else (or this person, elsewhere) got there first, or it is no longer theirs. */
  | { readonly kind: 'conflict' };

export interface DecisionParts {
  /** The note, with whatever went wrong under it. */
  readonly note: ReactNode;
  /** Exactly two buttons, Approve and Reject; null once the decision has been queued. */
  readonly actions: ReactNode | null;
}

export interface ApprovalDecisionProps {
  readonly id: string;
  /** What is being decided, for the buttons' accessible names and the outbox's list ("Approval of New laptop"). */
  readonly title?: string;
  /** Told how it ended. Without it, a sent decision redraws the page. */
  readonly onSettled?: (outcome: DecisionOutcome) => void;
  readonly children?: (parts: DecisionParts) => ReactNode;
}

/** The API refuses a longer note (`decisionSchema`). */
export const NOTE_MAX = 2000;

const REASON_NEEDED = 'Say why you’re rejecting it. Whoever asked cannot act on “no” alone.';

/** A refusal in words, by its status. `null` for one that means there is nothing left to decide. */
function refusal(status: number): string {
  switch (status) {
    case 401:
      return 'Your session ended. Sign in again, then decide — your note is still here.';
    case 403:
      return 'You can’t decide approvals any more. Your IT team can tell you why.';
    case 404:
      return 'This approval isn’t yours to decide any more.';
    case 409:
      return 'This was already decided — by somebody else, or by you on another device.';
    case 422:
      return `The service couldn’t take that note. Keep it under ${NOTE_MAX.toLocaleString('en-GB')} characters and try again.`;
    case 429:
      return 'Too many tries just now. Wait a moment, then try again.';
    default:
      return 'That didn’t send. Try again.';
  }
}

export function ApprovalDecision({ id, title, onSettled, children }: ApprovalDecisionProps): ReactNode {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<{ readonly text: string; readonly field: boolean } | null>(null);
  const [queued, setQueued] = useState(false);
  const intent = useRef<{ readonly body: string; readonly key: string } | null>(null);
  const sending = useRef(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const queuedRef = useRef<HTMLParagraphElement | null>(null);
  const errorId = useId();

  // The buttons leave with the queueing; the sentence that replaces them takes focus, so it is not lost with them.
  useEffect(() => {
    if (queued) queuedRef.current?.focus();
  }, [queued]);

  async function decide(decision: Decision): Promise<void> {
    // A synchronous guard: a double press, or Reject pressed while Approve is on its way, is one call.
    if (sending.current || queued) return;
    const note = comment.trim();
    if (decision === 'rejected' && note.length === 0) {
      setError({ text: REASON_NEEDED, field: true });
      boxRef.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(decision);
    setError(null);

    const request = queueable.decide(id, decision, note || undefined);
    const body = JSON.stringify(request.body);
    if (intent.current?.body !== body) intent.current = { body, key: newIdempotencyKey() };

    try {
      const result = await submitOrQueue({
        action: 'decide-approval',
        path: `/api/proxy${request.path}`,
        body: request.body,
        idempotencyKey: intent.current.key,
        summary: `${decision === 'approved' ? 'Approval' : 'Rejection'} of ${title ? `‘${title}’` : 'a request'}`,
      });

      if (result.queued) {
        setQueued(true);
        onSettled?.({ kind: 'queued', decision });
        return;
      }
      if (result.ok) {
        intent.current = null;
        if (onSettled) onSettled({ kind: 'sent', decision });
        else startRefresh(() => router.refresh());
        return;
      }

      const status = result.response?.status ?? 0;
      setError({ text: refusal(status), field: status === 422 });
      if (status === 401) reportSessionEnded('action');
      if (status === 409 || status === 404) onSettled?.({ kind: 'conflict' });
    } catch {
      setError({ text: refusal(0), field: false });
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  const fieldError = error?.field ? error.text : undefined;
  const note = (
    <div className="app-Decision__note">
      <FormField label="Anything to add?" hint="Required if you’re rejecting it. Whoever asked will see it.">
        {(control) => (
          <Textarea
            {...control}
            ref={boxRef}
            rows={3}
            autoGrow
            maxLength={NOTE_MAX}
            value={comment}
            readOnly={queued}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={[control['aria-describedby'], error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
            onChange={(event) => {
              setComment(event.target.value);
              if (error?.field) setError(null);
            }}
          />
        )}
      </FormField>

      {queued ? (
        <p ref={queuedRef} tabIndex={-1} className="app-Decision__queued" role="status">
          You’re offline, so your decision is saved on this device. It will be sent when you’re back — unless somebody else
          decides first, in which case you’ll be told.
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="app-Decision__error" role="alert">
          {error.text}
        </p>
      ) : null}
    </div>
  );

  const named = title ? <VisuallyHidden>: {title}</VisuallyHidden> : null;
  const actions = queued ? null : (
    <div className="app-Decision__actions">
      <Button variant="primary" loading={busy === 'approved'} loadingLabel="Approving" onClick={() => void decide('approved')}>
        Approve{named}
      </Button>
      <Button variant="dangerTinted" loading={busy === 'rejected'} loadingLabel="Rejecting" onClick={() => void decide('rejected')}>
        Reject{named}
      </Button>
    </div>
  );

  if (children) return children({ note, actions });
  return (
    <div className="app-Decision">
      {note}
      {actions}
    </div>
  );
}
