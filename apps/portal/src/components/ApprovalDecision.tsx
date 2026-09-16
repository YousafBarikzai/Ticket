'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { queueable } from '@itsm/sdk';
import { submitOrQueue } from '@itsm/pwa';
import { Button, FormField, Textarea } from '@itsm/ui';

/**
 * Approving or rejecting.
 *
 * The comment box is above both buttons and is required for a rejection,
 * optional for an approval. That asymmetry is the whole design: an approval
 * with no note costs nobody anything, and a rejection with no note is a
 * request that stops dead with no way forward — the requester cannot tell
 * whether to change it, escalate it or give up.
 *
 * Neither button is styled as the safe one. An approval is not the default
 * answer, and a screen that makes it the obvious click is a screen that
 * produces approvals nobody read.
 *
 * A decision is queueable offline (doc 14 §5). Unlike a reply, a replayed
 * decision is *not* treated as a success: a 409 means somebody else decided
 * while this one waited, and that is news the person has to see rather than a
 * duplicate to swallow.
 */
export function ApprovalDecision({ id }: { readonly id: string }): ReactNode {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approved' | 'rejected'>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function decide(decision: 'approved' | 'rejected'): Promise<void> {
    if (busy) return;
    if (decision === 'rejected' && comment.trim().length === 0) {
      setError('Say why you are rejecting it. Whoever asked cannot act on "no" alone.');
      return;
    }
    setBusy(decision);
    setError(null);

    const request = queueable.decide(id, decision, comment.trim() || undefined);
    const result = await submitOrQueue({
      action: 'decide-approval',
      path: `/api/proxy${request.path}`,
      body: request.body,
      summary: `${decision === 'approved' ? 'Approval' : 'Rejection'} of a request`,
    });

    if (result.queued) {
      setQueued(true);
    } else if (result.ok) {
      router.refresh();
      return;
    } else {
      setError(
        result.response?.status === 409
          ? 'Somebody else has already decided this one.'
          : 'That did not send. Try again.',
      );
    }
    setBusy(null);
  }

  return (
    <div className="itsm-Decision">
      <FormField label="Anything to add?" hint="Required if you are rejecting.">
        {(control) => (
          <Textarea {...control} rows={2} autoGrow value={comment} onChange={(event) => setComment(event.target.value)} />
        )}
      </FormField>

      <div className="itsm-Decision__actions">
        <Button variant="primary" loading={busy === 'approved'} loadingLabel="Approving" onClick={() => decide('approved')}>
          Approve
        </Button>
        <Button variant="danger" loading={busy === 'rejected'} loadingLabel="Rejecting" onClick={() => decide('rejected')}>
          Reject
        </Button>
      </div>

      {queued ? (
        <p className="itsm-Decision__queued" role="status">
          You are offline. Your decision is saved on this device and will be sent when you are back — unless somebody
          else decides first, in which case you will be told.
        </p>
      ) : null}

      {error ? (
        <p className="itsm-Decision__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
