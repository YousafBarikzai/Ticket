import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface StatGridProps {
  readonly children: ReactNode;
  /** Minimum card width in px before another column is added, default 180. Applies when `columns` is unset. */
  readonly min?: number;
  /**
   * How many tiles a row holds once the grid is wide enough; every count
   * folds to two on a phone (v3 §2.13):
   *
   * - `6`: the dashboard's KPI row — six from 60 rem, three from 35 rem, two below.
   * - `4`: two, then four from 48 rem.
   * - `3`: three, two below 35 rem.
   * - `2`: always two.
   *
   * Unset: as many as fit at `min`, never fewer than two.
   */
  readonly columns?: 2 | 3 | 4 | 6;
  readonly className?: string;
}

/**
 * A responsive grid of stat cards: two by two on a phone, never a sideways
 * carousel (X-94) — a carousel hides four of six numbers behind a gesture
 * nobody knows to make. Server-safe.
 *
 * It adapts to its container, not the viewport, so six tiles in a narrow
 * pane fold three and then two across as they would on a smaller screen.
 * Every column has the same width, so the values line up, and every tile in
 * a row stretches to the row's height, so their captions line up too.
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
