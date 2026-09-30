import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface StatGridProps {
  readonly children: ReactNode;
  /** Minimum card width in px before another column is added, default 180. */
  readonly min?: number;
  /**
   * `4`: two columns, then four once all four fit (a KPI row). `2`: always
   * two. Unset: as many as fit at `min`, never fewer than two.
   */
  readonly columns?: 2 | 4;
  readonly className?: string;
}

/**
 * A responsive grid of stat cards: two by two on a phone, never a sideways
 * carousel (X-94) — a carousel hides three of four numbers behind a gesture
 * nobody knows to make. Server-safe.
 *
 * It adapts to its container, not the viewport (SPEC §3.3 rule 5), so four
 * stats in a narrow dashboard card fold two by two as they would on a phone.
 * Every column has the same width, so the values line up.
 */
export function StatGrid({ children, min, columns, className }: StatGridProps): ReactNode {
  const floor = typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : undefined;
  return (
    <div
      className={cx('itsm-StatGrid', className)}
      data-columns={columns}
      style={floor === undefined ? undefined : { ['--_itsm-stat-min' as string]: `${floor / 16}rem` }}
    >
      <div className="itsm-StatGrid__items">{children}</div>
    </div>
  );
}
