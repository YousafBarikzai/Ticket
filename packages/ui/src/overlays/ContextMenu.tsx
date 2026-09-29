'use client';

import type { ReactElement, ReactNode } from 'react';
import type { MenuItemSpec } from './Menu.js';

export interface ContextMenuProps {
  readonly items: readonly MenuItemSpec[];
  /** The region that opens it on right-click, long-press or the ContextMenu key. */
  readonly children: ReactElement;
  /** Default true on rows that are links, where iOS long-press belongs to the link (X-95). */
  readonly disabledOnCoarse?: boolean;
}

/**
 * The right-click menu. Always mirrors a visible ⋯ button — a hidden gesture
 * is never the only way to an action.
 *
 * Stub (SPEC §4.3): renders its children alone; the overlays package builds it
 * on the Radix context-menu primitive.
 */
export function ContextMenu({ children }: ContextMenuProps): ReactNode {
  return children;
}
