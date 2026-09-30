'use client';

import { useRef, useState, type ReactNode } from 'react';
import { queueable } from '@itsm/sdk';
import { submitOrQueue } from '@itsm/pwa';
import { Button } from '@itsm/ui';
import { Dialog } from '@itsm/ui/overlays';
import { reportSessionEnded } from '../client/useAction.js';
import { whatLine, type ApprovalItem, type BulkResult } from './model.js';

/**
 * "Approve 3" (SPEC §6.3): a confirmation that lists what is about to be
 * approved, then the approvals one at a time — sequential, so the service
 * sees them in order and a failure part-way leaves a clear account of which
 * went. Each carries its own idempotency key (`keyFor`), kept by the page for
 * a retry of the ones that did not send. Offline, each one queues like a
 * single decision does.
 *
 * Loaded on first use; nothing here is in the page's first load.
 */

export interface BulkApproveProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly items: readonly ApprovalItem[];
  readonly keyFor: (id: string) => string;
  readonly onDone: (results: readonly BulkResult[]) => void;
}

function requests(count: number): string {
  return count === 1 ? '1 request' : `${count} requests`;
}

export default function BulkApprove({ open, onOpenChange, items, keyFor, onDone }: BulkApproveProps): ReactNode {
  const [running, setRunning] = useState<{ readonly done: number } | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const started = useRef(false);
  // What the dialog lists is what it approves: fixed when it opens, not whatever is ticked by the time Approve is pressed.
  const [batch, setBatch] = useState(items);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setBatch(items);
  }

  const run = async (): Promise<void> => {
    if (started.current) return;
    started.current = true;
    const results: BulkResult[] = [];
    try {
      for (const [index, item] of batch.entries()) {
        setRunning({ done: index });
        const request = queueable.decide(item.id, 'approved');
        let outcome: BulkResult['outcome'];
        try {
          const result = await submitOrQueue({
            action: 'decide-approval',
            path: `/api/proxy${request.path}`,
            body: request.body,
            idempotencyKey: keyFor(item.id),
            summary: `Approval of ‘${item.title}’`,
          });
          const status = result.response?.status ?? 0;
          if (result.queued) outcome = 'queued';
          else if (result.ok) outcome = 'sent';
          else if (status === 409 || status === 404) outcome = 'conflict';
          else {
            if (status === 401) {
              // The session is gone: nothing further will go either. The rest stay ticked, for after signing in.
              reportSessionEnded('action');
              results.push({ id: item.id, title: item.title, outcome: 'failed' });
              for (const rest of batch.slice(index + 1)) results.push({ id: rest.id, title: rest.title, outcome: 'failed' });
              break;
            }
            outcome = 'failed';
          }
        } catch {
          outcome = 'failed';
        }
        results.push({ id: item.id, title: item.title, outcome });
      }
    } finally {
      started.current = false;
      setRunning(null);
    }
    onDone(results);
  };

  const count = batch.length;
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!running) onOpenChange(false);
      }}
      dismissible={!running}
      size="sm"
      title={`Approve ${requests(count)}?`}
      description="Each is approved without a note. To add a note, or to reject one, open it instead."
      initialFocusRef={confirmRef}
      className="app-BulkApprove"
      footer={
        <>
          <Button variant="secondary" disabledReason={running ? 'Approving now' : undefined} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant="primary"
            loading={running !== null}
            loadingLabel={running ? `Approving ${Math.min(running.done + 1, count)} of ${count}` : 'Approving'}
            onClick={() => void run()}
          >
            Approve {count}
          </Button>
        </>
      }
    >
      <ul className="app-BulkApprove__list">
        {batch.map((item) => {
          const what = whatLine(item);
          return (
            <li key={item.id} className="app-BulkApprove__item">
              <span className="app-BulkApprove__title">{item.title}</span>
              {what ? <span className="app-BulkApprove__what">{what}</span> : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
