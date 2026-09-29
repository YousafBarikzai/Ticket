'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface RouteProgressProps {
  /** Shown only for navigations slower than this; default 300 ms. */
  readonly delayMs?: number;
  readonly className?: string;
}

/**
 * The 2 px accent line at the top of the window while a navigation is
 * pending. Decorative: Next's route announcer speaks the result.
 *
 * Stub (SPEC §4.9): renders the hidden element; the shell package drives it.
 */
export function RouteProgress({ delayMs = 300, className }: RouteProgressProps): ReactNode {
  return <div aria-hidden="true" className={cx('itsm-RouteProgress', className)} data-delay={delayMs} />;
}
