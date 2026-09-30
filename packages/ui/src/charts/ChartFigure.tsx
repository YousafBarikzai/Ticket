import type { ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE } from './scale.js';
import type { ChartTableMode } from './types.js';

export interface ChartFigureTable {
  readonly columns: readonly string[];
  /** One row per category or point; the first cell names it. Numbers are formatted in the figure's locale. */
  readonly rows: readonly (readonly (string | number)[])[];
}

export interface ChartFigureProps {
  readonly title: string;
  /** The chart's point in one sentence, for everyone who cannot or does not want to read the picture. */
  readonly summary: string;
  readonly children: ReactNode;
  /** The data behind the chart, rendered on the server under "View as table". */
  readonly table: ChartFigureTable;
  /** `toggle` (default) puts the table behind "View as table"; `visible` shows it; `hidden` leaves it out. */
  readonly tableMode?: ChartTableMode;
  /** The card around the chart already shows the title: keep it for assistive technology only. */
  readonly titleHidden?: boolean;
  /** Keep the summary for assistive technology only (a generated one is, by default). */
  readonly summaryHidden?: boolean;
  /** Marks the figure busy while its data loads. */
  readonly busy?: boolean;
  /** For the numbers in the table. Default `en-GB`. */
  readonly locale?: string;
  readonly className?: string;
}

/**
 * A chart as a figure: title, a one-sentence summary and the data as a table,
 * so no chart is the only way to its numbers (SPEC §4.8, X-69). Server-safe.
 *
 * The table is a real `<table>` inside a `<details>`, rendered on the server:
 * it works with no JavaScript, a screen reader in browse mode reaches it in
 * reading order, and "find in page" finds a number in it. A wide table
 * scrolls inside its own frame, which is focusable so a keyboard can scroll
 * it too.
 */
export function ChartFigure({
  title,
  summary,
  children,
  table,
  tableMode = 'toggle',
  titleHidden = false,
  summaryHidden = false,
  busy = false,
  locale = DEFAULT_LOCALE,
  className,
}: ChartFigureProps): ReactNode {
  const hasTable = tableMode !== 'hidden' && table.rows.length > 0 && table.columns.length > 0;
  const data = hasTable ? <ChartTable title={title} table={table} locale={locale} /> : null;
  return (
    <figure className={cx('itsm-ChartFigure', className)} aria-busy={busy || undefined}>
      <figcaption className={cx('itsm-ChartFigure__caption', titleHidden && summaryHidden && 'itsm-visually-hidden')}>
        <span className={cx('itsm-ChartFigure__title', titleHidden && 'itsm-visually-hidden')}>{title}</span>
        {summary ? (
          <span className={cx('itsm-ChartFigure__summary', summaryHidden && 'itsm-visually-hidden')}>
            {/* Read after the title as one caption, so it needs its own full stop of separation. */}
            {titleHidden || summaryHidden ? <span className="itsm-visually-hidden">. </span> : null}
            {summary}
          </span>
        ) : null}
      </figcaption>
      <div className="itsm-ChartFigure__body">{children}</div>
      {data === null ? null : tableMode === 'visible' ? (
        <div className="itsm-ChartFigure__data">{data}</div>
      ) : (
        <details className="itsm-ChartFigure__data">
          <summary className="itsm-ChartFigure__toggle">View as table</summary>
          {data}
        </details>
      )}
    </figure>
  );
}

/**
 * Whether a cell holds a number, formatted or not ("1,284", "42%", "£3.20",
 * "12k", "—"), so it lines up on the end like the numbers in any table.
 */
function looksNumeric(value: string | number): boolean {
  if (typeof value === 'number') return true;
  return /^[\s+\-−–—]*[£$€]?[\d\s.,]*\d[\d\s.,]*\s*(?:%|[kKMB]|bn)?$|^—$/.test(value.trim());
}

function ChartTable({ title, table, locale }: { readonly title: string; readonly table: ChartFigureTable; readonly locale: string }): ReactNode {
  const cell = (value: string | number): string => (typeof value === 'number' ? formatNumber(value, { locale }) : value);
  return (
    // Focusable so a keyboard can scroll a table wider than its card; a group
    // rather than a region, so each chart does not add a landmark.
    <div className="itsm-ChartFigure__scroll" tabIndex={0} role="group" aria-label={`${title}, data`}>
      <table className="itsm-ChartFigure__table">
        <caption className="itsm-visually-hidden">{title}</caption>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={`${index}:${column}`} scope="col" data-numeric={index > 0 || undefined}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}:${String(row[0])}`}>
              {row.map((value, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell(value)}
                  </th>
                ) : (
                  <td key={index} data-numeric={looksNumeric(value) || undefined}>
                    {cell(value)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
