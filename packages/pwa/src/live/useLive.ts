'use client';

import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { LiveContext } from './context.js';
import type { ChangeNotice, LiveState } from './hub.js';

export interface UseLiveOptions {
  /** Only notices about this entity, or these (`ticket`, `ai_job`, `notification`). */
  readonly entity?: string | readonly string[];
  /** Only notices about this one. */
  readonly id?: string;
  /** Topics this needs beyond the page's own, e.g. `ticket:<id>` while an AI job runs. */
  readonly topics?: readonly string[];
  readonly onNotice?: (notice: ChangeNotice) => void;
  /** Notices may have been missed; refetch rather than assume nothing happened. */
  readonly onReconnect?: () => void;
  readonly enabled?: boolean;
}

export interface LiveConnection {
  readonly state: LiveState;
  /** Try again now — the connection pill's Retry. */
  retry(): void;
}

const alwaysLive = (): LiveState => 'live';
const noSubscription = (): (() => void) => () => undefined;
const noRetry = (): void => undefined;

/**
 * Listens to the page's one stream, and reads how it is.
 *
 * `useLive({ entity: 'ticket', onNotice })` hears every ticket notice;
 * `useLive()` with nothing only reads the state, for the connection pill.
 * Outside a `LiveProvider` it hears nothing and reports `live`, which shows
 * nothing: a screen without the live layer works as it always did.
 *
 * The callbacks are held in refs, so an inline arrow does not resubscribe on
 * every render; the subscription follows the entity, id and topic *content*.
 */
export function useLive(options: UseLiveOptions = {}): LiveConnection {
  const hub = useContext(LiveContext);
  const { entity, id, topics, onNotice, onReconnect, enabled = true } = options;

  const notice = useRef(onNotice);
  const reconnect = useRef(onReconnect);
  notice.current = onNotice;
  reconnect.current = onReconnect;

  const entityKey = entity === undefined ? '' : (typeof entity === 'string' ? [entity] : [...entity]).sort().join(',');
  const topicKey = [...(topics ?? [])].sort().join(',');
  const listening = enabled && (onNotice !== undefined || onReconnect !== undefined || topicKey !== '');

  useEffect(() => {
    if (!hub || !listening) return;
    const entities = entityKey === '' ? null : new Set(entityKey.split(','));
    return hub.subscribe({
      topics: topicKey === '' ? [] : topicKey.split(','),
      accepts: (change) => (entities === null || entities.has(change.entity)) && (id === undefined || change.id === id),
      onNotice: (change) => notice.current?.(change),
      onReconnect: () => reconnect.current?.(),
    });
  }, [hub, listening, entityKey, id, topicKey]);

  const state = useSyncExternalStore(hub?.onState ?? noSubscription, hub?.getState ?? alwaysLive, alwaysLive);
  return useMemo(() => ({ state, retry: hub?.retry ?? noRetry }), [state, hub]);
}

/** The connection's state alone — for the pill, the banner, a disabled Send. */
export function useLiveState(): LiveConnection {
  return useLive();
}
