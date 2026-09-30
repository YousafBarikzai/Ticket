'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LiveContext } from './context.js';
import { createLiveHub } from './hub.js';

export interface LiveProviderProps {
  /**
   * The page's own topics: `group:<id>` for each of the person's teams in the
   * workbench, nothing in the portal. The person's `user:` topic is always
   * included by the API, so passing it spends one of the twenty for nothing.
   */
  readonly topics?: readonly string[];
  /** Off, and no stream is opened: for a signed-out frame, say. */
  readonly enabled?: boolean;
  readonly children?: ReactNode;
}

const none: readonly string[] = [];

/**
 * One live connection for everything under it (see `hub.ts`).
 *
 * Mounted once per app, in the group layout's client providers — never the
 * root layout, so `/offline` and the sign-in pages open no stream. Every
 * prop is serialisable; the hub is created here, on the client, and never
 * crosses the server boundary. Nothing touches the network until the effect
 * runs, so rendering it on the server is safe.
 */
export function LiveProvider({ topics = none, enabled = true, children }: LiveProviderProps) {
  const [hub] = useState(() => createLiveHub({ topics }));

  // The content of the list, not its identity: a server component hands a
  // new array on every render, and a reconnect per render is no stream at all.
  const key = [...topics].sort().join(',');
  useEffect(() => {
    hub.setTopics(key === '' ? [] : key.split(','));
  }, [hub, key]);

  // After the listeners below have subscribed (effects run child first), so
  // the first stream already asks for their topics.
  useEffect(() => {
    if (!enabled) return;
    hub.start();
    return () => hub.stop();
  }, [hub, enabled]);

  return <LiveContext.Provider value={hub}>{children}</LiveContext.Provider>;
}
