import type { ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE } from './scale.js';
import type { ChartTableMode } from './types.js';

/** One cell of a chart's table twin. `null` is "no data", shown as a dash — never as zero. */
export type ChartTableCell = string | number | null;

export interface ChartFigureTable {
  readonly columns: readonly string[];
  /** One row per category or point; the first cell names it. Numbers are formatted in the figure's locale. */
  readonly rows: readonly (readonly ChartTableCell[])[];
  /**
   * Whether the first cell of each row is the row's header (default true):
   * a matrix (a heat map, a calendar) is read by row and column at once, a
   * plain list of values may have no name column at all.
   */
  readonly rowHeaders?: boolean;
  /**
   * A header row above the columns that groups them — "Monday" over its
   * hours — for a matrix whose columns come in sets. Spans add up to the
   * column count; an empty label leaves a gap over the row headers.
   */
  readonly columnGroups?: readonly { readonly label: string; readonly span: number }[];
}

export interface ChartFigureProps {
  readonly title: string;
  /**
   * The chart's point in one sentence, for everyone who cannot or does not
   * want to read the picture. Written from the data when the page gives no
   * headline.
   */
  readonly summary?: string;
  /**
   * The headline the card around this chart already shows (A8-S6). When
   * given it is the figure's summary — the page's own words outrank a
   * generated sentence — and it is kept for assistive technology only, since
   * it is already on screen once.
   */
  readonly headline?: string;
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

/** Kinds of chart, for the table twin's default (A8 §4.15). */
export type ChartTableKind = 'xy' | 'columns' | 'rows' | 'list' | 'donut' | 'heatmap' | 'calendar' | 'gauge' | 'distribution' | 'bullet' | 'timeline';

/**
 * Where each kind of chart keeps its table by default (A8 §4.15). A chart
 * whose marks are positions — lines, columns, a heat map — offers its table
 * behind "View as table"; one whose text already says every value — rows of
 * labelled bars, a gauge's figure, a distribution's legend — leaves it out,
 * because a second copy of the same numbers is noise to a screen reader.
 */
export const CHART_TABLE_DEFAULTS: Readonly<Record<ChartTableKind, ChartTableMode>> = Object.freeze({
  xy: 'toggle',
  columns: 'toggle',
  rows: 'hidden',
  list: 'hidden',
  donut: 'toggle',
  heatmap: 'toggle',
  calendar: 'toggle',
  gauge: 'hidden',
  distribution: 'hidden',
  bullet: 'hidden',
  timeline: 'toggle',
});

/**
 * A chart as a figure: title, a one-sentence summary and the data as a table,
 * so no chart is the only way to its numbers (SPEC-v3 §8.5, X-69). Server-safe.
 *
 * The table is a real `<table>` inside a `<details>`, rendered on the server:
 * it works with no JavaScript, a screen reader in browse mode reaches it in
 * reading order, and "find in page" finds a number in it. A wide table
 * scrolls inside its own frame, which is focusable so a keyboard can scroll
 * it too. A matrix keeps its headers both ways (`scope="row"` on each row's
 * first cell, `scope="col"` and `scope="colgroup"` above), so each value is
 * announced with its row and its column.
 */
export function ChartFigure({
  title,
  summary,
  headline,
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
  const sentence = headline?.trim() ? headline : (summary ?? '');
  const sentenceHidden = headline?.trim() ? true : summaryHidden;
  return (
    <figure className={cx('itsm-ChartFigure', className)} aria-busy={busy || undefined}>
      <figcaption className={cx('itsm-ChartFigure__caption', titleHidden && (sentenceHidden || !sentence) && 'itsm-visually-hidden')}>
        <span className={cx('itsm-ChartFigure__title', titleHidden && 'itsm-visually-hidden')}>{title}</span>
        {sentence ? (
          <span className={cx('itsm-ChartFigure__summary', sentenceHidden && 'itsm-visually-hidden')}>
            {/* Read after the title as one caption, so it needs its own full stop of separation. */}
            {titleHidden || sentenceHidden ? <span className="itsm-visually-hidden">. </span> : null}
            {sentence}
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
function looksNumeric(value: ChartTableCell): boolean {
  if (value === null || typeof value === 'number') return true;
  return /^[\s+\-−–—]*[£$€]?[\d\s.,]*\d[\d\s.,]*\s*(?:%|[kKMB]|bn)?$|^—$/.test(value.trim());
}

function ChartTable({ title, table, locale }: { readonly title: string; readonly table: ChartFigureTable; readonly locale: string }): ReactNode {
  const cell = (value: ChartTableCell): string => (value === null ? '—' : typeof value === 'number' ? formatNumber(value, { locale }) : value);
  const rowHeaders = table.rowHeaders ?? true;
  const groups = table.columnGroups?.filter((group) => group.span > 0) ?? [];
  return (
    // Focusable so a keyboard can scroll a table wider than its card; a group
    // rather than a region, so each chart does not add a landmark.
    <div className="itsm-ChartFigure__scroll" tabIndex={0} role="group" aria-label={`${title}, data`}>
      <table className="itsm-ChartFigure__table">
        <caption className="itsm-visually-hidden">{title}</caption>
        <thead>
          {groups.length > 0 ? (
            <tr className="itsm-ChartFigure__groups">
              {groups.map((group, index) =>
                group.label ? (
                  <th key={`${index}:${group.label}`} scope="colgroup" colSpan={group.span}>
                    {group.label}
                  </th>
                ) : (
                  <td key={`${index}:`} colSpan={group.span} />
                ),
              )}
            </tr>
          ) : null}
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
                index === 0 && rowHeaders ? (
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
