'use client';

import { useEffect, type ReactNode } from 'react';
import { registerServiceWorker, useOutbox, type OutboxItem } from '@itsm/pwa';
import { Badge, Button } from '@itsm/ui';

/**
 * What the offline queue looks like to a person.
 *
 * Three states, and each says something different:
 *
 * **Offline.** Said plainly and continuously, because somebody who does not
 * know they are offline reads every empty list as the service being broken.
 *
 * **Waiting to send.** A count. This is the promise the queue makes — the
 * thing you wrote is not lost — and it is worthless unless it is visible.
 *
 * **Needs you.** A conflict or something that gave up. These are the only
 * items with a button, because they are the only ones a person can do
 * anything about. Dismissing is offered next to retrying: something that was
 * refused because the ticket closed is not something to keep in a list
 * for ever.
 *
 * `role="status"` rather than `alert`: being offline is news, not an
 * emergency, and an assertive region interrupts whatever is being read at the
 * moment the connection drops.
 */

function Item({
  item,
  onRetry,
  onDismiss,
}: {
  readonly item: OutboxItem;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <li className="itsm-Outbox__item">
      <span className="itsm-Outbox__what">{item.summary}</span>
      <span className="itsm-Outbox__why">{item.problem}</span>
      <span className="itsm-Outbox__actions">
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Discard
        </Button>
      </span>
    </li>
  );
}

export function OfflineStatus(): ReactNode {
  const outbox = useOutbox();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  if (outbox.online && outbox.pending === 0 && outbox.attention.length === 0) return null;

  return (
    <section className="itsm-Outbox" aria-label="Connection and unsent work">
      {!outbox.online ? (
        <p className="itsm-Outbox__offline" role="status">
          You are offline. You can still report something — it will be sent when you are back.
        </p>
      ) : null}

      {outbox.pending > 0 ? (
        <p className="itsm-Outbox__pending" role="status">
          <Badge intent="info">{outbox.pending}</Badge>{' '}
          {outbox.pending === 1 ? 'thing is waiting to be sent.' : 'things are waiting to be sent.'}
        </p>
      ) : null}

      {outbox.attention.length > 0 ? (
        <>
          <h2 className="itsm-Outbox__heading">These did not send</h2>
          <ul className="itsm-Outbox__list">
            {outbox.attention.map((item) => (
              <Item
                key={item.id}
                item={item}
                onRetry={() => void outbox.retry(item.id)}
                onDismiss={() => void outbox.dismiss(item.id)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
