import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface ChartFigureProps {
  readonly title: string;
  /** The chart's point in one sentence, for everyone who cannot or does not want to read the picture. */
  readonly summary: string;
  readonly children: ReactNode;
  /** The data behind the chart, rendered on the server under "View as table". */
  readonly table: { readonly columns: readonly string[]; readonly rows: readonly (readonly (string | number)[])[] };
  readonly className?: string;
}

/**
 * A chart as a figure: title, a one-sentence summary and the data as a table,
 * so no chart is the only way to its numbers. Server-safe.
 *
 * Stub (SPEC §4.8): renders the figure and caption; the charts package adds
 * the summary and table.
 */
export function ChartFigure({ title, children, className }: ChartFigureProps): ReactNode {
  return (
    <figure className={cx('itsm-ChartFigure', className)}>
      <figcaption>{title}</figcaption>
      {children}
    </figure>
  );
}
