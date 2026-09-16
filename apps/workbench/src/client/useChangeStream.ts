'use client';

import { useEffect, useRef } from 'react';

/**
 * Watching for change, over the one stream the platform already publishes.
 *
 * The API has had `GET /api/v1/events/stream` since Phase 1 and the ticket
 * service has been publishing notices to it for just as long. Nothing in any
 * application had ever opened it: the workbench refetched on its own actions
 * and polled for an AI job, so a queue only changed when the person changed it
 * and a ticket somebody else moved sat there looking current. ADR-0015 was a
 * decision nothing had acted on.
 *
 * Three properties matter more than the plumbing:
 *
 * **A notice is a nudge, never data.** `{entity, id, version, action}` and
 * nothing else. Whatever the page does with it, it does by refetching through
 * the API, which applies the same permissions it always did. That is what
 * makes it safe for several people with different access to watch the same
 * topic.
 *
 * **Reconnection is the browser's job, and resumption is nobody's.** An
 * `EventSource` reconnects on its own; what it cannot do is tell the page what
 * it missed while disconnected. So `onReconnect` fires a full refetch rather
 * than pretending the gap was empty — a screen that is stale and looks live is
 * worse than one that reloads a little more often than it needed to.
 *
 * **It degrades to nothing, not to broken.** Where `EventSource` is missing,
 * or the stream will not open, the hook stops. Every screen using it still
 * works exactly as it did before: refetching on its own actions. Nothing here
 * is load-bearing for correctness.
 */

export interface ChangeNotice {
  readonly entity: string;
  readonly id: string;
  readonly version?: number;
  readonly action: string;
  readonly at: string;
}

export interface ChangeStreamOptions {
  /** `ticket:<id>`, `group:<id>`, `user:<id>`. Refused topics close the stream. */
  readonly topics: readonly string[];
  readonly onNotice: (notice: ChangeNotice) => void;
  /** Called when the stream comes back after a drop, so the page can resync. */
  readonly onReconnect?: () => void;
  readonly enabled?: boolean;
}

export function useChangeStream({ topics, onNotice, onReconnect, enabled = true }: ChangeStreamOptions): void {
  // Held in refs so a caller passing an inline arrow does not tear the stream
  // down and open a new one on every render — which would be a reconnect per
  // keystroke on any page with state.
  const notice = useRef(onNotice);
  const reconnect = useRef(onReconnect);
  notice.current = onNotice;
  reconnect.current = onReconnect;

  // The dependency is the topic list's content, not its identity, for the same
  // reason.
  const key = [...topics].sort().join(',');

  useEffect(() => {
    if (!enabled || key === '' || typeof EventSource === 'undefined') return;

    // Through the proxy, like every other call from this application: the
    // browser holds an opaque cookie and no token, so the BFF is what turns
    // the one into the other.
    const source = new EventSource(`/api/proxy/api/v1/events/stream?topics=${encodeURIComponent(key)}`);
    // The first `ready` is this connection opening, not a reconnection. Every
    // one after it means the stream dropped and came back, and the page has a
    // gap it cannot see.
    let opened = false;

    source.addEventListener('ready', () => {
      if (opened) reconnect.current?.();
      opened = true;
    });

    source.addEventListener('change', (event) => {
      try {
        notice.current(JSON.parse((event as MessageEvent<string>).data) as ChangeNotice);
      } catch {
        // A notice we cannot read is not worth a broken page. The next one, or
        // the next refetch, will carry the same truth.
      }
    });

    source.onerror = () => {
      // `EventSource` retries by itself while the connection is merely
      // interrupted. A `CLOSED` state means it has given up — the topic was
      // refused, or the session ended — and reopening it from here would be a
      // loop against a server that has already said no.
      if (source.readyState === EventSource.CLOSED) source.close();
    };

    return () => source.close();
  }, [key, enabled]);
}
