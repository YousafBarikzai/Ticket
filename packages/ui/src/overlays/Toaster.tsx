'use client';

import type { ReactNode } from 'react';

export interface ToasterProps {
  /** The region's name, "Notifications" by default. */
  readonly label?: string;
}

/**
 * Where `notify()` toasts appear: bottom-end at md and up, above the bottom
 * dock below it, three at most, pausing on hover and focus, Alt+T to reach.
 * Mounted once, lazily, by `ItsmProvider`.
 *
 * Stub (SPEC §4.3): renders nothing and leaves `notify()`'s queue waiting;
 * the overlays package builds it on sonner and subscribes to the queue.
 */
export function Toaster(props: ToasterProps): ReactNode {
  void props;
  return null;
}
