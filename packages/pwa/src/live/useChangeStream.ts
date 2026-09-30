'use client';

import { useContext, useEffect, useRef } from 'react';
import { LiveContext } from './context.js';
import { createLiveHub, type ChangeNotice } from './hub.js';

/**
 * Watching for change — the workbench's original hook, kept to its contract.
 *
 * Inside a `LiveProvider` its topics join the page's one stream (see
 * `hub.ts`). Outside one it opens a stream of its own, as it always did, but
 * with the hub's rules: retried with backoff after a drop instead of dying
 * silently, and stopped by a 401 instead of looping against it.
 *
 * Three properties of the original stand:
 *
 * **A notice is a nudge, never data.** Whatever the page does with it, it
 * does by refetching through the API, which applies the same permissions it
 * always did.
 *
 * **A gap is reported.** `onReconnect` fires after a drop, so the page
 * refetches rather than pretending the gap was empty.
 *
 * **It degrades to nothing, not to broken.** No topics, or no
 * `EventSource`, and nothing is opened; every screen using it still refetches
 * on its own actions.
 */

export type { ChangeNotice } from './hub.js';

export interface ChangeStreamOptions {
  /** `ticket:<id>`, `group:<id>`, `user:<id>`. A refused topic is left out, not retried for ever. */
  readonly topics: readonly string[];
  readonly onNotice: (notice: ChangeNotice) => void;
  /** Called when the stream comes back after a drop, so the page can resync. */
  readonly onReconnect?: () => void;
  readonly enabled?: boolean;
}

export function useChangeStream({ topics, onNotice, onReconnect, enabled = true }: ChangeStreamOptions): void {
  const shared = useContext(LiveContext);

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
    if (!enabled || key === '') return;
    const listener = {
      onNotice: (change: ChangeNotice) => notice.current(change),
      onReconnect: () => reconnect.current?.(),
    };

    if (shared) return shared.subscribe({ ...listener, topics: key.split(',') });

    if (typeof EventSource === 'undefined') return;
    const own = createLiveHub({ topics: key.split(',') });
    const unsubscribe = own.subscribe(listener);
    own.start();
    return () => {
      unsubscribe();
      own.stop();
    };
  }, [shared, key, enabled]);
}
