import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface StatGridProps {
  readonly children: ReactNode;
  /** Minimum card width in px, default 180. */
  readonly min?: number;
  readonly columns?: 2 | 4;
  readonly className?: string;
}

/**
 * A responsive grid of stat cards: two by two on a phone, never a sideways
 * carousel (X-94). Server-safe.
 *
 * Stub (SPEC §4.8): the container; the charts package lays it out.
 */
export function StatGrid({ children, columns, className }: StatGridProps): ReactNode {
  return (
    <div className={cx('itsm-StatGrid', className)} data-columns={columns}>
      {children}
    </div>
  );
}
