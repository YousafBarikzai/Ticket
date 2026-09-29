'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface BottomDockProps {
  readonly tabBar?: ReactNode;
  /** Exactly one contextual bar: form actions, the bulk bar, or the composer. */
  readonly bar?: ReactNode;
  readonly className?: string;
}

/**
 * Owns the phone's bottom edge so its occupants never overlap: the tab bar,
 * then one contextual bar, then toasts above both (X-92). Publishes
 * `--itsm-bottom-dock-height` so the page scrolls clear of it.
 *
 * Stub (SPEC §4.9): renders both slots; the shell package docks and measures them.
 */
export function BottomDock({ tabBar, bar, className }: BottomDockProps): ReactNode {
  return (
    <div className={cx('itsm-BottomDock', className)}>
      {bar}
      {tabBar}
    </div>
  );
}
