import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export interface DashboardGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** `GridItem`s, each spanning some of the twelve columns. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

export type GridSpan = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;

export interface GridItemProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Columns of twelve: 12 (default) is the full width, 6 a half, 4 a third. */
  readonly span?: GridSpan;
  /** `section` for a cell that is a named region of its own; `div` by default. */
  readonly as?: 'div' | 'section';
  readonly children?: ReactNode;
  readonly className?: string;
  readonly ref?: Ref<HTMLElement>;
}

/**
 * The twelve-column grid a dashboard's cards sit in (v3 §2.13, G4–G7): the
 * Overview's "Raised vs resolved" at span 7 beside "Needs attention" at 5,
 * three chart cards at span 4.
 *
 * Server-safe. It adapts to the width it is given, not the window's — a
 * container query on `itsm-dash` — so the same grid inside a split pane or
 * beside an open inspector folds when the pane is narrow: gaps of 20 at 60 rem
 * and wider, 16 from 45 rem, 12 below, and below 45 rem every item takes the
 * whole row whatever its span, so a phone reads one card at a time.
 *
 * The outer element is the container and the inner one the grid, because a
 * container query styles what is inside the container, never the container
 * itself, and the gap belongs to the grid.
 */
export function DashboardGrid({ children, className, ref, ...rest }: DashboardGridProps): ReactNode {
  return (
    <div {...rest} ref={ref} className={cx('itsm-DashboardGrid', className)}>
      <div className="itsm-DashboardGrid__grid">{children}</div>
    </div>
  );
}

/** One cell of a `DashboardGrid`. Server-safe. */
export function GridItem({ span = 12, as: Tag = 'div', children, className, ref, ...rest }: GridItemProps): ReactNode {
  return (
    <Tag {...rest} ref={ref as Ref<HTMLDivElement>} className={cx('itsm-GridItem', className)} data-span={span}>
      {children}
    </Tag>
  );
}
