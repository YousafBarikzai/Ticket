import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../types.js';
import { ChartFigure, type ChartFigureTable } from './ChartFigure.js';
import { ChartLink } from './ChartLink.js';
import { ChartReader, type ReaderPoint, type ReaderRow } from './ChartReader.js';
import { ChartEmpty, ChartLegend, ChartLoading } from './parts.js';
import { DEFAULT_LOCALE, axisFormatter, foldOther, niceScale, numberFormatter, sentenceList, tickIndices, type SeriesSlot } from './scale.js';
import type { ChartSlot, ChartTableMode } from './types.js';

export interface BarDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly href?: string;
  readonly icon?: IconName;
  /** Stacked parts by series id, for `seriesDefs`. */
  readonly series?: Readonly<Record<string, number>>;
  /** A qualifier after the label in list rows: "Brier 0.12". */
  readonly secondary?: string;
}

export interface BarChartProps {
  readonly title: string;
  readonly data: readonly BarDatum[];
  /** `list`: label · bar · value rows, for ranked breakdowns. */
  readonly variant?: 'bars' | 'list';
  /** Default `horizontal`, which suits long category names; `vertical` for time buckets and short ordinal labels. */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Makes the bars stacked, one segment per series. */
  readonly seriesDefs?: readonly { readonly id: string; readonly label: string; readonly slot: ChartSlot }[];
  readonly valueFormat?: Intl.NumberFormatOptions;
  /** Default `value` (largest first), except vertical bars, which keep their order (usually time). */
  readonly sort?: 'value' | 'none';
  /** At most this many bars: the smallest of the rest are summed into "Other", so only for values that add up (counts, not rates). */
  readonly maxBars?: number;
  /**
   * Default `toggle` for vertical bars. Rows (`list`, horizontal `bars`) show
   * every value as text already, so their table is `hidden` unless asked for.
   */
  readonly table?: ChartTableMode;
  readonly interactive?: boolean;
  /** The chart's point in a sentence. Without it the chart writes one, for screen readers only. */
  readonly description?: string;
  /** Vertical bars: the plot's height in px. Default 220. */
  readonly height?: number;
  readonly emptyText?: string;
  readonly loading?: boolean;
  /** For the numbers. Default `en-GB`. */
  readonly locale?: string;
  readonly titleHidden?: boolean;
  /** Headings of the table view's columns. Default "Category" and "Value". */
  readonly categoryLabel?: string;
  readonly valueLabel?: string;
  readonly className?: string;
}

/** Room above the highest tick of a vertical chart, so the top bar's rounded end is not cut. */
const PAD_TOP = 8;

interface Bar {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly icon?: IconName;
  readonly secondary?: string;
  /** The bar's length: its value, or the sum of its parts. */
  readonly value: number;
  readonly parts: readonly number[];
  readonly other: boolean;
}

const finite = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * Comparisons across categories (SPEC §4.8): vertical bars with a value axis,
 * horizontal bars with the value at each tip, or a `list` of label · bar ·
 * value rows (the drafts' `BarList`). `seriesDefs` stacks each bar from its
 * parts (the drafts' `StackedBar`). Server-safe, with an optional client
 * layer.
 *
 * **The bars are boxes laid out by CSS, not SVG shapes.** A bar needs a 4 px
 * rounded data end and a square baseline, at most 24 px of thickness in a
 * container of any width, a 2 px surface gap between stacked parts and — with
 * more contrast — a hatch texture; CSS draws all of that exactly at any
 * width, where a server-rendered SVG would have to guess the width it will be
 * shown at. Every value is text (or in the table), so the picture is never
 * the only way to a number.
 *
 * One series is one colour: every bar in slot 1, because colouring bars by
 * size would spend the only free channel on what their length already says.
 * "Other" is the de-emphasis grey.
 */
export function BarChart({
  title,
  data,
  variant = 'bars',
  orientation = 'horizontal',
  seriesDefs,
  valueFormat,
  sort,
  maxBars,
  table,
  interactive = false,
  description,
  height = 220,
  emptyText = 'No data for this period',
  loading = false,
  locale = DEFAULT_LOCALE,
  titleHidden = false,
  categoryLabel = 'Category',
  valueLabel = 'Value',
  className,
}: BarChartProps): ReactNode {
  const vertical = variant === 'bars' && orientation === 'vertical';
  const layout: 'list' | 'rows' | 'columns' = variant === 'list' ? 'list' : vertical ? 'columns' : 'rows';
  const plotHeight = Math.max(80, Math.round(Number.isFinite(height) ? height : 220));
  const frame = { title, titleHidden, locale, className };
  const stacked = seriesDefs !== undefined && seriesDefs.length > 0;
  const defs = seriesDefs ?? [];

  if (loading) {
    return (
      <ChartFigure {...frame} summary="Loading…" summaryHidden busy table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-BarChart" data-layout={layout}>
          <ChartLoading height={vertical ? plotHeight : Math.min(plotHeight, 160)} />
        </div>
      </ChartFigure>
    );
  }

  if (data.length === 0) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-BarChart" data-layout={layout}>
          <ChartEmpty text={emptyText} height={vertical ? plotHeight : 120} />
        </div>
      </ChartFigure>
    );
  }

  let bars: Bar[] = data.map((datum) => {
    const parts = stacked ? defs.map((def) => Math.max(0, finite(datum.series?.[def.id]))) : [finite(datum.value)];
    return {
      id: datum.id,
      label: datum.label,
      ...(datum.href === undefined ? {} : { href: datum.href }),
      ...(datum.icon === undefined ? {} : { icon: datum.icon }),
      ...(datum.secondary === undefined ? {} : { secondary: datum.secondary }),
      value: stacked ? parts.reduce((sum, part) => sum + part, 0) : finite(datum.value),
      parts,
      other: false,
    };
  });
  if ((sort ?? (vertical ? 'none' : 'value')) === 'value') bars = [...bars].sort((a, b) => b.value - a.value);
  bars = [
    ...foldOther(bars, maxBars, (value, folded) => ({
      id: '__other',
      label: 'Other',
      value,
      parts: stacked ? defs.map((_, index) => folded.reduce((sum, bar) => sum + (bar.parts[index] ?? 0), 0)) : [value],
      other: true,
    })),
  ];

  const format = numberFormatter(locale, valueFormat);
  const largest = Math.max(0, ...bars.map((bar) => bar.value));
  const scale = niceScale(bars.map((bar) => Math.max(0, bar.value)), { baseline: 'zero', count: 4 });
  // Rows are measured against the largest bar (the longest fills the row); a
  // vertical chart has an axis, so it is measured against the axis.
  const extent = layout === 'columns' ? scale.max : largest;
  const share = (value: number): number => (extent > 0 ? Math.min(1, Math.max(0, value) / extent) : 0);
  const slotOf = (bar: Bar): SeriesSlot => (bar.other ? 'other' : 1);
  const breakdown = (bar: Bar): string => defs.map((def, index) => `${def.label} ${format(bar.parts[index] ?? 0)}`).join(', ');

  const fill = (bar: Bar): ReactNode =>
    stacked ? (
      defs.map((def, index) =>
        (bar.parts[index] ?? 0) > 0 ? (
          <span key={def.id} className="itsm-BarChart__segment" data-slot={def.slot} style={{ flexGrow: bar.parts[index] }} />
        ) : null,
      )
    ) : bar.value > 0 ? (
      <span className="itsm-BarChart__segment" data-slot={slotOf(bar)} style={{ flexGrow: 1 }} />
    ) : null;

  const summary = description ?? summarise(bars, format, layout === 'columns');
  const tableData: ChartFigureTable = {
    columns: [categoryLabel, ...(stacked ? [...defs.map((def) => def.label), 'Total'] : [valueLabel])],
    rows: bars.map((bar) => [bar.label, ...(stacked ? bar.parts.map((part) => format(part)) : []), format(bar.value)]),
  };
  const tableMode = table ?? (layout === 'columns' ? 'toggle' : 'hidden');

  const readerRows = (bar: Bar): ReaderRow[] =>
    stacked
      ? [
          ...defs.map((def, index) => ({ id: def.id, label: def.label, value: format(bar.parts[index] ?? 0), slot: def.slot })),
          { id: '__total', label: 'Total', value: format(bar.value) },
        ]
      : [{ id: bar.id, label: '', value: format(bar.value), slot: slotOf(bar) }];

  const legend = stacked && defs.length >= 2 ? (
    <ChartLegend className="itsm-BarChart__legend" mark="box" items={defs.map((def) => ({ id: def.id, label: def.label, slot: def.slot }))} />
  ) : null;

  if (layout === 'columns') {
    const count = bars.length;
    const linked = bars.some((bar) => bar.href !== undefined);
    const toTop = (value: number): number => PAD_TOP + (1 - share(value)) * (plotHeight - PAD_TOP);
    const ticks = scale.ticks.map((tick) => ({ tick, top: Math.round(toTop(tick)) }));
    const axis = axisFormatter(locale, valueFormat, scale.max);
    const tickText = ticks.map(({ tick }) => axis(tick));
    // Every column is labelled while there is room (up to 12); past that an
    // even selection. A narrow card keeps a few, unless there are only a week's worth.
    const shown = new Set(count <= 12 ? bars.map((_, index) => index) : tickIndices(count, 8).map((entry) => entry.index));
    const narrow = new Set(count <= 7 ? bars.map((_, index) => index) : tickIndices(count, 4).map((entry) => entry.index));
    const points: ReaderPoint[] = bars.map((bar, index) => ({
      key: bar.id,
      title: bar.label,
      at: [(index + 0.5) / count, toTop(bar.value) / plotHeight],
      rows: readerRows(bar),
    }));
    const canvas = (
      <div className="itsm-BarChart__canvas">
        <div className="itsm-BarChart__grid" aria-hidden="true">
          {ticks.map(({ tick, top }) => (
            <span key={tick} className="itsm-BarChart__gridline" data-axis={tick === 0 || undefined} style={{ top: `${top}px` }} />
          ))}
        </div>
        <ol className="itsm-BarChart__columns" aria-hidden="true">
          {bars.map((bar, index) => (
            <li key={bar.id} className="itsm-BarChart__column" data-point={index}>
              <span className="itsm-BarChart__bar" style={{ ['--_itsm-bar' as string]: share(bar.value) }}>
                {fill(bar)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
    return (
      <ChartFigure {...frame} summary={summary} summaryHidden={description === undefined} table={tableData} tableMode={tableMode}>
        <div className="itsm-Chart itsm-BarChart" data-layout="columns" style={{ ['--_itsm-plot-h' as string]: `${plotHeight}px` }}>
          {legend}
          <div className="itsm-BarChart__y" aria-hidden="true">
            <span className="itsm-BarChart__sizer">{tickText.reduce((a, b) => (b.length > a.length ? b : a), '')}</span>
            {ticks.map(({ tick, top }, index) => (
              <span key={tick} className="itsm-BarChart__yTick" style={{ top: `${top}px` }}>
                {tickText[index]}
              </span>
            ))}
          </div>
          <div className="itsm-BarChart__plot">
            {interactive ? (
              <ChartReader label={title} points={points} mode="marks" axis="x" nearest>
                {canvas}
              </ChartReader>
            ) : (
              canvas
            )}
          </div>
          {/* Plain ticks are decoration (the table has the names); linked ones are how a column is opened. */}
          <div className="itsm-BarChart__x" aria-hidden={linked ? undefined : 'true'}>
            {bars.map((bar, index) => (
              <span
                key={bar.id}
                className="itsm-BarChart__xTick"
                data-hidden={shown.has(index) ? undefined : ''}
                data-wide={shown.has(index) && !narrow.has(index) ? '' : undefined}
              >
                {bar.href ? (
                  <ChartLink href={bar.href} className="itsm-BarChart__link">
                    {bar.label}
                  </ChartLink>
                ) : (
                  bar.label
                )}
              </span>
            ))}
          </div>
        </div>
      </ChartFigure>
    );
  }

  // Rows: the list, or horizontal bars with the value at the tip.
  const Rows = (sort ?? 'value') === 'value' ? 'ol' : 'ul';
  const widest = bars.reduce((most, bar) => Math.max(most, format(bar.value).length), 1);
  const points: ReaderPoint[] = bars.map((bar, index) => ({
    key: bar.id,
    title: bar.label,
    at: [0.5, index / bars.length],
    rows: readerRows(bar),
  }));
  const rows = (
    <Rows className="itsm-BarChart__rows">
      {bars.map((bar, index) => (
        <li key={bar.id} className="itsm-BarChart__row" data-point={index} style={{ ['--_itsm-bar' as string]: share(bar.value) }}>
          <span className="itsm-BarChart__label">
            {bar.icon ? <Icon name={bar.icon} size="sm" className="itsm-BarChart__icon" /> : null}
            {bar.href ? (
              <ChartLink href={bar.href} className="itsm-BarChart__name itsm-BarChart__link">
                {bar.label}
              </ChartLink>
            ) : (
              <span className="itsm-BarChart__name">{bar.label}</span>
            )}
            {bar.secondary ? <span className="itsm-BarChart__secondary">{bar.secondary}</span> : null}
          </span>
          <span className="itsm-BarChart__value">
            {format(bar.value)}
            {stacked ? <span className="itsm-visually-hidden">{` (${breakdown(bar)})`}</span> : null}
          </span>
          <span className="itsm-BarChart__track" aria-hidden="true">
            <span className="itsm-BarChart__bar">{fill(bar)}</span>
          </span>
        </li>
      ))}
    </Rows>
  );
  return (
    <ChartFigure {...frame} summary={summary} summaryHidden={description === undefined} table={tableData} tableMode={tableMode}>
      <div className="itsm-Chart itsm-BarChart" data-layout={layout} style={{ ['--_itsm-value-ch' as string]: widest }}>
        {legend}
        {interactive ? (
          <ChartReader label={title} points={points} mode="marks" axis="y" placement="above">
            {rows}
          </ChartReader>
        ) : (
          rows
        )}
      </div>
    </ChartFigure>
  );
}

/** "Largest: Email (42), Portal (30) and Slack (12); smallest: Voice (3)." Or, for bars in their own order, the highest and lowest. */
function summarise(bars: readonly Bar[], format: (value: number) => string, ordered: boolean): string {
  const ranked = [...bars].sort((a, b) => b.value - a.value);
  const describe = (bar: Bar): string => `${bar.label} (${format(bar.value)})`;
  if (ranked.length === 1) return `${describe(ranked[0]!)}.`;
  if (ordered) return `Highest: ${describe(ranked[0]!)}; lowest: ${describe(ranked[ranked.length - 1]!)}.`;
  const top = ranked.slice(0, 3).map(describe);
  const tail = ranked.length > 3 ? `; smallest: ${describe(ranked[ranked.length - 1]!)}` : '';
  return `Largest: ${sentenceList(top)}${tail}.`;
}
