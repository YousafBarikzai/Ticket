'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@itsm/sdk';
import { Button, FormField, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';

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
 */
export function ApprovalDecision({ id }: { readonly id: string }): ReactNode {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<null | 'approved' | 'rejected'>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approved' | 'rejected'): Promise<void> {
    if (busy) return;
    if (decision === 'rejected' && comment.trim().length === 0) {
      setError('Say why you are rejecting it. Whoever asked cannot act on "no" alone.');
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await api.decide(id, decision, comment.trim() || undefined);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? 'Somebody else has already decided this one.'
          : failure instanceof ApiError
            ? failure.message
            : 'That did not send. Try again.',
      );
      setBusy(null);
    }
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

      {error ? (
        <p className="itsm-Decision__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
