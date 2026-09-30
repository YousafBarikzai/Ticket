'use client';

import { useState, type ReactNode } from 'react';
import { Button, DescriptionList, EmptyState, IconButton, InlineAlert, RelativeTime, StatusPill, useItsm } from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { JsonView } from '../JsonView.js';
import { DELIVERY_LOOK, type DeliveryView } from './presentation.js';

/**
 * One failed delivery (SPEC §6.1, `?open=delivery:<id>`): the whole error,
 * where it came from, the idempotency key a replay will reuse, how many
 * times it was tried, and the payload it carried — with values that look
 * like secrets hidden. An open failure offers **Replay** (the same request,
 * the same key, so nothing the first attempt did is repeated) and
 * **Dismiss…** (with a reason; somebody will ask later).
 *
 * The list is the only read the API has, so the drawer shows the row itself;
 * a link to a delivery that has since left this list says so.
 */
export interface DeliveryDrawerProps {
  readonly id: string | null;
  readonly row: DeliveryView | undefined;
  readonly canReplay: boolean;
  readonly online: boolean;
  /** The error from a replay in this session that failed again, which the queue itself does not record. */
  readonly lastError?: string;
  readonly replaying: boolean;
  onClose(): void;
  onReplay(row: DeliveryView): Promise<void>;
  onDismiss(row: DeliveryView, reason: string): Promise<void>;
}

const OFFLINE = 'You’re offline — changes can’t be saved.';

export function DeliveryDrawer({ id, row, canReplay, online, lastError, replaying, onClose, onReplay, onDismiss }: DeliveryDrawerProps): ReactNode {
  const { Link } = useItsm();
  const [dismissing, setDismissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = row?.status === 'open';
  const look = row ? DELIVERY_LOOK[row.status] : null;

  const replayReason = !row?.replayable
    ? 'This failure didn’t come from an action, so there is nothing to send again.'
    : !online
      ? OFFLINE
      : undefined;

  const copyKey = (): void => {
    if (!row) return;
    void navigator.clipboard?.writeText(row.idempotencyKey).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <>
      <Sheet
        open={id !== null}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        size="md"
        title={row ? row.actionName : 'Failed delivery'}
        {...(row ? { description: row.from } : {})}
        {...(look ? { headerMeta: <StatusPill size="sm" tone={look.tone} label={look.label} srPrefix="Status" /> } : {})}
        {...(row && open && canReplay
          ? {
              footer: (
                <>
                  <Button variant="secondary" onClick={() => setDismissing(true)} {...(online ? {} : { disabledReason: OFFLINE })}>
                    Dismiss…
                  </Button>
                  <Button
                    variant="primary"
                    iconStart="refresh-cw"
                    loading={replaying}
                    loadingLabel="Replaying…"
                    {...(replayReason ? { disabledReason: replayReason } : {})}
                    onClick={() => void onReplay(row)}
                  >
                    Replay
                  </Button>
                </>
              ),
            }
          : {})}
      >
        {id !== null && !row ? (
          <EmptyState
            size="sm"
            title="That delivery isn’t in this list"
            description="It may have been replayed or dismissed since the link was made. Check the other tabs."
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={onClose}
          />
        ) : row ? (
          <div className="app-Delivery">
            {lastError ? (
              <InlineAlert tone="danger">
                Replayed just now and failed again: <span className="app-Delivery__mono">{lastError}</span>
              </InlineAlert>
            ) : null}
            <div className="app-Delivery__section">
              <h3 id="delivery-error" className="app-Delivery__heading">
                What went wrong
              </h3>
              <pre className="app-Delivery__error">{row.error}</pre>
            </div>
            <DescriptionList
              layout="inline"
              dense
              items={[
                {
                  id: 'from',
                  label: 'From',
                  value: row.fromHref ? <Link href={row.fromHref}>{row.from}</Link> : row.from,
                },
                { id: 'action', label: 'Action', value: row.actionKey ? row.actionName : 'None — this failure didn’t come from an action' },
                { id: 'attempts', label: 'Attempts', value: `${row.attempts}` },
                { id: 'first', label: 'First failed', value: <RelativeTime date={row.createdAt} mode="absolute" absoluteStyle="datetime" /> },
                ...(row.resolvedAt
                  ? [
                      {
                        id: 'resolved',
                        label: row.status === 'dismissed' ? 'Dismissed' : 'Delivered',
                        value: (
                          <>
                            <RelativeTime date={row.resolvedAt} mode="absolute" absoluteStyle="datetime" />
                            {row.resolvedBy ? ` by ${row.resolvedByName ?? 'someone no longer listed'}` : ''}
                          </>
                        ),
                      },
                    ]
                  : []),
                ...(row.dismissedReason ? [{ id: 'reason', label: 'Why', value: row.dismissedReason }] : []),
                {
                  id: 'key',
                  label: 'Idempotency key',
                  value: (
                    <span className="app-Delivery__key">
                      <code className="app-Delivery__mono">{row.idempotencyKey}</code>
                      <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied the idempotency key' : 'Copy the idempotency key'} size="sm" variant="ghost" onClick={copyKey} />
                    </span>
                  ),
                  hint: 'A replay sends this key again, so the far end can tell it is the same request.',
                },
              ]}
            />
            <div className="app-Delivery__section">
              <h3 id="delivery-payload" className="app-Delivery__heading">
                Payload
              </h3>
              <p className="app-Delivery__note">Values that look like secrets are hidden.</p>
              <JsonView value={row.payload} label="Payload" openDepth={1} />
            </div>
          </div>
        ) : null}
      </Sheet>
      {row ? (
        <ConfirmDialog
          open={dismissing}
          onOpenChange={setDismissing}
          spec={{
            title: row.actionKey ? `Dismiss this ${row.actionName} failure?` : 'Dismiss this failure?',
            body: 'It leaves the open list and is not sent again. The failure and your reason stay on record.',
            confirmLabel: 'Dismiss failure',
            requireReason: { label: 'Why', hint: 'Somebody will ask later: “sent by hand”, “the far end fixed it”.' },
          }}
          onConfirm={async (reason) => {
            await onDismiss(row, reason ?? '');
          }}
        />
      ) : null}
    </>
  );
}
