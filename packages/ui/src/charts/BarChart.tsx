import type { ReactNode } from 'react';
import { formatPercent } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../types.js';
import { CHART_TABLE_DEFAULTS, ChartFigure, type ChartFigureTable } from './ChartFigure.js';
import { ChartLink } from './ChartLink.js';
import { ChartReader, type ReaderPoint, type ReaderRow } from './ChartReader.js';
import type { ChartCommon, ChartMarker, ChartTarget, SeriesLook } from './common.js';
import { MarkerBackdrop, MarkerLayer, layoutMarkers, markerTableColumn, resolveMarkers } from './markers.js';
import { CHART_EMPTY_TEXT, ChartEmpty, ChartLoading } from './parts.js';
import { DEFAULT_LOCALE, axisFormatter, foldOther, niceScale, numberFormatter, parseTimes, sentenceList, slotAt, tickIndices, type NiceScale, type SeriesSlot } from './scale.js';
import type { ChartSlot, ChartTone } from './types.js';

export interface BarDatum {
  /** The bar's key. For time buckets, the bucket's ISO date (`2026-09-28`), so `markers` can find "today" among them. */
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly href?: string;
  readonly icon?: IconName;
  /** The bar's parts by series id, for `seriesDefs`. */
  readonly series?: Readonly<Record<string, number>>;
  /** A qualifier after the label in list rows: "Brier 0.12". */
  readonly secondary?: string;
  /** One bar's state colour (P1, breached) on a chart of one series; wins over `slot`. */
  readonly tone?: ChartTone;
  /** One bar's identity colour on a chart of one series. Default slot 1, the accent. */
  readonly slot?: ChartSlot;
  /** Hatched in every theme as well as coloured: "unassigned", "overdue". */
  readonly pattern?: 'hatch';
}

/**
 * One series of a stacked, grouped or normalised chart (A8 §4.8): its colour
 * by `slot` (identity: a team) or `tone` (state: P1, which wins), and its
 * `style` — `comparison` (and `baseline`) bars are the grey a plan or
 * "raised" is read against, and take no colour position; a `forecast` part
 * is hatched in its series' colour, because it is not a measurement.
 */
export interface BarSeriesDef extends SeriesLook {
  readonly id: string;
  readonly label: string;
  /** Hatched in every theme as well as coloured: "unassigned", "overdue". */
  readonly pattern?: 'hatch';
}

/** How a chart of several series draws them: one series, parts on parts, side by side, or parts of 100 %. */
export type BarLayout = 'single' | 'stacked' | 'grouped' | 'normalised';

/** Words on the bars: each bar's total at its end, each part inside its part (where there is room), or none. */
export type BarLabels = 'total' | 'segments' | 'none';

export interface BarChartProps extends ChartCommon {
  readonly data: readonly BarDatum[];
  /** `list`: label · bar · value rows, for ranked breakdowns. */
  readonly variant?: 'bars' | 'list';
  /** Default `horizontal`, which suits long category names; `vertical` for time buckets and short ordinal labels. */
  readonly orientation?: 'horizontal' | 'vertical';
  /**
   * Default `stacked` with `seriesDefs`, `single` without. `grouped` sets up
   * to three bars side by side on one baseline, so it is always drawn as
   * columns; `normalised` stacks each bar to 100 % and reads its parts as
   * shares.
   */
  readonly layout?: BarLayout;
  /** The series each datum's `series` holds, in drawing order. */
  readonly seriesDefs?: readonly BarSeriesDef[];
  /**
   * Columns: `total` writes each bar's value at its end (default `none`).
   * Rows always write the value — a row is label, bar and value — so there
   * `total` is the default and `none` changes nothing. `segments` writes each
   * part inside its part, in columns and horizontal bars (a list's bars are
   * too thin), wherever the part is at least 28 px long — decided by
   * container query, never by measuring.
   */
  readonly labels?: BarLabels;
  /** A dashed line to read the bars against; the value axis stretches to include it. On a `normalised` chart, a share (0.9). */
  readonly target?: ChartTarget;
  /** Columns on a time axis: "As at" (`{ kind: 'today' }` with `asAt`), deadlines, events (A8 §4.3). Rows take none. */
  readonly markers?: readonly ChartMarker[];
  /** The emphasis form: this bar in the accent, every other in the neutral grey. One series only. */
  readonly highlight?: string;
  readonly valueFormat?: Intl.NumberFormatOptions;
  /** Default `value` (largest first), except vertical bars, which keep their order (usually time). */
  readonly sort?: 'value' | 'none';
  /** At most this many bars: the smallest of the rest are summed into "Other · n", so only for values that add up (counts, not rates). */
  readonly maxBars?: number;
  /** Columns: the plot's height in px, axis labels not included. Default 220. */
  readonly height?: number;
  /**
   * Keeps `description` for assistive technology only: the card around the
   * chart already shows it as its headline. `ChartCard` sets it with the
   * description it passes down, so the sentence is read once and seen once.
   */
  readonly descriptionHidden?: boolean;
  /** The width of the card, in columns of twelve, so marker labels fit the plot they will have. Default 12. */
  readonly span?: number;
  /** Headings of the table view's columns. Default "Category" and "Value". */
  readonly categoryLabel?: string;
  readonly valueLabel?: string;
}

/** Room above the highest tick of a vertical chart, so the top bar's rounded end is not cut. */
const PAD_TOP = 8;
/** Room above the columns for their totals: one caption line. */
const TOTAL_ROOM = 16;

interface Bar {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly icon?: IconName;
  readonly secondary?: string;
  readonly tone?: ChartTone;
  readonly slot?: ChartSlot;
  readonly pattern?: 'hatch';
  /** The bar's length in data units: its value, or the sum of its parts. */
  readonly value: number;
  /** One per series (one for a chart of one series). */
  readonly parts: readonly number[];
  readonly other: boolean;
}

/** How one mark is painted: the attributes the kit's shared colour rules read. */
interface Look {
  readonly slot?: SeriesSlot;
  readonly tone?: ChartTone;
  readonly style?: 'comparison' | 'baseline';
  readonly hatch?: boolean;
}

const finite = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A mark's colour, style and hatch as attributes: colour is never inline. */
const paint = (look: Look): Record<string, string | undefined> => ({
  'data-slot': look.tone === undefined && look.slot !== undefined ? String(look.slot) : undefined,
  'data-tone': look.tone,
  'data-style': look.style,
  'data-pattern': look.hatch ? 'hatch' : undefined,
});

/**
 * Each series' look (A8 §4.8). Slots follow the series' position among the
 * coloured ones, as on a line chart, so the first measured series is the
 * accent; comparison series are grey and take no position. A tone wins over
 * a slot.
 */
function seriesLooks(defs: readonly BarSeriesDef[]): Look[] {
  let position = 0;
  return defs.map((def): Look => {
    const style = def.style ?? 'actual';
    const hatch = def.pattern === 'hatch' || style === 'forecast';
    if (style === 'comparison' || style === 'baseline') return { style, hatch };
    const slot = def.slot ?? slotAt(position);
    position += 1;
    return def.tone ? { tone: def.tone, hatch } : { slot, hatch };
  });
}

/**
 * Comparisons across categories (SPEC-v3 §8.2, A8 §4.8): vertical columns on
 * a value axis, horizontal bars with the value at each tip, or a `list` of
 * label · bar · value rows. With `seriesDefs` a bar is made of parts:
 * `stacked` (parts on parts, the total its length), `grouped` (up to three
 * bars side by side, 2 px apart, 30 % of each band between groups) or
 * `normalised` (every bar 100 %, its parts read as shares). Server-safe,
 * with an optional client reading layer.
 *
 * **The bars are boxes laid out by CSS, not SVG shapes.** A bar needs a 4 px
 * rounded data end and a square baseline, at most 24 px of thickness in a
 * container of any width, a 2 px surface gap between stacked parts and —
 * with more contrast — a hatch texture; CSS draws all of that exactly at any
 * width, where a server-rendered SVG would have to guess the width it will
 * be shown at. Labels inside a part appear only where the part is at least
 * 28 px long, by container query, so nothing is measured.
 *
 * **Colour carries one thing.** One series is one colour, the accent; a
 * chart coloured by state uses tones (P1 `danger`, P2 `high`, P3 `neutral`,
 * P4 `neutralSoft`), which win over identity slots; `highlight` puts one bar
 * in the accent and the rest in grey. "Other · n" folds are the neutral grey,
 * hatched, so they never read as a category of their own.
 *
 * **Honest and readable:** every value is text, in the rows or in the table
 * twin (with a total column for parts, and a "Marker" column for markers);
 * the generated sentence names the largest bars and the target; a time axis
 * places "As at" from the page's `asAt` in the reader's `timeZone`, never
 * from a clock. One first-paint reveal grows the bars from their baseline,
 * never under reduced motion, and the keys are the bars' ids, so a refetch
 * reconciles into the same nodes and does not replay it.
 */
export function BarChart({
  title,
  data,
  variant = 'bars',
  orientation = 'horizontal',
  layout: layoutProp,
  seriesDefs,
  labels: labelsProp,
  target,
  markers = [],
  highlight,
  valueFormat,
  sort,
  maxBars,
  table,
  interactive = false,
  description,
  descriptionHidden = false,
  height = 220,
  emptyText = CHART_EMPTY_TEXT.empty,
  loading = false,
  locale = DEFAULT_LOCALE,
  timeZone,
  asAt,
  animate = true,
  span,
  titleHidden = false,
  categoryLabel = 'Category',
  valueLabel = 'Value',
  className,
}: BarChartProps): ReactNode {
  const defs = seriesDefs ?? [];
  const layout: BarLayout = defs.length === 0 ? 'single' : layoutProp && layoutProp !== 'single' ? layoutProp : 'stacked';
  const parted = layout !== 'single';
  const grouped = layout === 'grouped';
  const normalised = layout === 'normalised';
  const vertical = grouped || (variant === 'bars' && orientation === 'vertical');
  const shape: 'list' | 'rows' | 'columns' = vertical ? 'columns' : variant === 'list' ? 'list' : 'rows';
  const plotHeight = Math.max(80, Math.round(Number.isFinite(height) ? height : 220));
  const frame = { title, titleHidden, locale, className };

  if (loading) {
    return (
      <ChartFigure {...frame} summary="Loading…" summaryHidden busy table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-BarChart" data-layout={shape}>
          <ChartLoading height={vertical ? plotHeight : Math.min(plotHeight, 160)} />
        </div>
      </ChartFigure>
    );
  }

  if (data.length === 0) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-BarChart" data-layout={shape}>
          <ChartEmpty text={emptyText} height={vertical ? plotHeight : 120} />
        </div>
      </ChartFigure>
    );
  }

  let bars: Bar[] = data.map((datum) => {
    const parts = parted ? defs.map((def) => Math.max(0, finite(datum.series?.[def.id]))) : [finite(datum.value)];
    return {
      id: datum.id,
      label: datum.label,
      ...(datum.href === undefined ? {} : { href: datum.href }),
      ...(datum.icon === undefined ? {} : { icon: datum.icon }),
      ...(datum.secondary === undefined ? {} : { secondary: datum.secondary }),
      ...(datum.tone === undefined ? {} : { tone: datum.tone }),
      ...(datum.slot === undefined ? {} : { slot: datum.slot }),
      ...(datum.pattern === undefined ? {} : { pattern: datum.pattern }),
      value: parted ? parts.reduce((sum, part) => sum + part, 0) : finite(datum.value),
      parts,
      other: false,
    };
  });
  if ((sort ?? (vertical ? 'none' : 'value')) === 'value') bars = [...bars].sort((a, b) => b.value - a.value);
  bars = [
    ...foldOther(bars, maxBars, (value, folded) => ({
      id: '__other',
      label: `Other · ${folded.length}`,
      value,
      parts: parted ? defs.map((_, index) => folded.reduce((sum, bar) => sum + (bar.parts[index] ?? 0), 0)) : [value],
      other: true,
    })),
  ];

  const format = numberFormatter(locale, valueFormat);
  const percent = (fraction: number): string => formatPercent(fraction, { locale });
  const looks = seriesLooks(defs);
  const shareOf = (bar: Bar, index: number): number => (bar.value > 0 ? (bar.parts[index] ?? 0) / bar.value : 0);
  /** A part as it is read: a share of its bar on a normalised chart, a value otherwise. */
  const partText = (bar: Bar, index: number): string => (normalised ? percent(shareOf(bar, index)) : format(bar.parts[index] ?? 0));

  /** One series: the bar's own look — the emphasis form, "Other", a tone, a slot, the accent. */
  const barLook = (bar: Bar): Look => {
    if (highlight !== undefined) return bar.id === highlight ? { slot: 1 } : { tone: 'neutral', hatch: bar.other };
    if (bar.other) return { tone: 'neutral', hatch: true };
    const hatch = bar.pattern === 'hatch';
    return bar.tone ? { tone: bar.tone, hatch } : { slot: bar.slot ?? 1, hatch };
  };
  /** A part's look: its series', hatched as well inside an "Other" bar. */
  const partLook = (bar: Bar, index: number): Look => {
    const look = looks[index] ?? {};
    return bar.other ? { ...look, hatch: true } : look;
  };

  const targetValue = target && Number.isFinite(target.value) ? target.value : undefined;
  const targetNumber = targetValue === undefined ? '' : normalised ? percent(targetValue) : format(targetValue);
  const targetText = target?.label?.trim() ? target.label : `Target ${targetNumber}`;
  // The sentence names it as a target even when the page's words do not ("Approved" → "Target 3,440 (Approved)").
  const targetSaid = /\btarget\b/i.test(targetText) ? targetText : `Target ${targetNumber} (${targetText})`;
  const lengths = grouped ? bars.flatMap((bar) => bar.parts) : bars.map((bar) => bar.value);
  const largest = Math.max(0, ...lengths, targetValue ?? 0);
  const scale: NiceScale = normalised
    ? { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] }
    : niceScale([...lengths.map((value) => Math.max(0, value)), ...(targetValue === undefined ? [] : [targetValue])], { baseline: 'zero', count: 4 });
  // Rows are measured against the largest bar (the longest fills the row); a
  // vertical chart has an axis, so it is measured against the axis; a
  // normalised bar is the whole row or column.
  const extent = normalised ? 1 : shape === 'columns' ? scale.max : largest;
  const share = (value: number): number => (extent > 0 ? Math.min(1, Math.max(0, value) / extent) : 0);
  const length = (bar: Bar): number => (normalised ? (bar.value > 0 ? 1 : 0) : share(bar.value));
  const labels: BarLabels = labelsProp ?? (shape === 'columns' ? 'none' : 'total');
  const inside = labels === 'segments';

  const segment = (key: string, look: Look, grow: number, words: string): ReactNode => (
    <span key={key} className="itsm-BarChart__segment" {...paint(look)} style={{ flexGrow: grow }}>
      {inside ? <span className="itsm-BarChart__segmentLabel">{words}</span> : null}
    </span>
  );
  /** A bar's marks: its parts, or its one segment; nothing for a zero. */
  const fill = (bar: Bar): ReactNode =>
    parted
      ? defs.map((def, index) => ((bar.parts[index] ?? 0) > 0 ? segment(def.id, partLook(bar, index), bar.parts[index]!, partText(bar, index)) : null))
      : bar.value > 0
        ? segment(bar.id, barLook(bar), 1, format(bar.value))
        : null;

  const breakdown = (bar: Bar): string => defs.map((def, index) => `${def.label} ${partText(bar, index)}`).join(', ');
  const summary = description ?? summarise(bars, defs, layout, format, percent, shape === 'columns', targetValue === undefined ? undefined : { value: targetValue, text: targetSaid });
  const forecastHeader = (def: BarSeriesDef): string => (def.style === 'forecast' && !/forecast/i.test(def.label) ? `${def.label} (forecast)` : def.label);
  const tableColumns = [categoryLabel, ...(parted ? defs.map(forecastHeader) : [valueLabel]), ...(parted && !grouped ? ['Total'] : [])];
  const tableRows = bars.map((bar) => [
    bar.label,
    ...(parted ? defs.map((_, index) => partText(bar, index)) : []),
    ...(grouped ? [] : [format(bar.value)]),
  ]);
  const tableMode = table ?? CHART_TABLE_DEFAULTS[shape];

  const lookOf = (look: Look): Pick<ReaderRow, 'slot' | 'tone'> => (look.tone ? { tone: look.tone } : { slot: look.slot ?? 1 });
  const readerRows = (bar: Bar): ReaderRow[] =>
    parted
      ? [
          ...defs.map((def, index) => {
            const look = partLook(bar, index);
            return {
              id: def.id,
              label: def.label,
              value: normalised ? `${percent(shareOf(bar, index))} (${format(bar.parts[index] ?? 0)})` : format(bar.parts[index] ?? 0),
              ...(look.slot === undefined ? {} : { slot: look.slot }),
              ...(look.tone === undefined ? {} : { tone: look.tone }),
              ...(look.style === undefined ? {} : { style: look.style }),
            };
          }),
          ...(grouped ? [] : [{ id: '__total', label: 'Total', value: format(bar.value) }]),
        ]
      : [{ id: bar.id, label: '', value: format(bar.value), ...lookOf(barLook(bar)) }];

  // The key: one chip per series (two or more), and the target's dashed key on rows, where its line has no label of its own.
  const keyed = parted && defs.length >= 2;
  const rowTarget = shape !== 'columns' && targetValue !== undefined;
  const legend =
    keyed || rowTarget ? (
      <ul className="itsm-ChartLegend itsm-BarChart__legend" aria-label="Legend">
        {keyed
          ? defs.map((def, index) => (
              <li key={def.id} className="itsm-ChartLegend__item">
                <span className="itsm-ChartLegend__key" data-mark="chip" {...paint(looks[index]!)} aria-hidden="true" />
                <span className="itsm-ChartLegend__label">{def.label}</span>
              </li>
            ))
          : null}
        {rowTarget ? (
          <li className="itsm-ChartLegend__item">
            <span className="itsm-ChartLegend__key" data-mark="chip" data-style="baseline" aria-hidden="true" />
            <span className="itsm-ChartLegend__label">{targetText}</span>
          </li>
        ) : null}
      </ul>
    ) : null;

  const rootProps = {
    'data-labels': inside ? 'segments' : undefined,
    'data-reveal': animate ? '' : undefined,
  };

  if (shape === 'columns') {
    const count = bars.length;
    const linked = bars.some((bar) => bar.href !== undefined);
    const xs = bars.map((bar) => bar.id);
    const positions = bars.map((_, index) => (index + 0.5) / count);
    const placed = layoutMarkers(
      resolveMarkers(markers, { xs, positions, times: parseTimes(xs) }, { locale, ...(asAt === undefined ? {} : { asAt }), ...(timeZone === undefined ? {} : { timeZone }) }),
      span === undefined ? {} : { span },
    );
    const totals = labels === 'total';
    const top = PAD_TOP + placed.rowHeight + (totals ? TOTAL_ROOM : 0);
    const canvasHeight = plotHeight + top - PAD_TOP;
    const toTop = (value: number): number => top + (1 - share(value)) * (canvasHeight - top);
    const ticks = scale.ticks.map((tick) => ({ tick, top: Math.round(toTop(tick)) }));
    const axis = normalised ? (value: number) => percent(value) : axisFormatter(locale, valueFormat, scale.max);
    const tickText = ticks.map(({ tick }) => axis(tick));
    const targetY = targetValue === undefined ? undefined : Math.round(toTop(targetValue));
    const markerColumn = markerTableColumn(placed.items, count);
    // Every column is labelled while there is room (up to 12); past that an
    // even selection. A narrow card keeps a few, unless there are only a week's worth.
    const shown = new Set(count <= 12 ? bars.map((_, index) => index) : tickIndices(count, 8).map((entry) => entry.index));
    const narrow = new Set(count <= 7 ? bars.map((_, index) => index) : tickIndices(count, 4).map((entry) => entry.index));
    const points: ReaderPoint[] = bars.map((bar, index) => ({
      key: bar.id,
      title: bar.label,
      at: [positions[index]!, toTop(grouped ? Math.max(0, ...bar.parts) : normalised ? (bar.value > 0 ? 1 : 0) : bar.value) / canvasHeight],
      rows: readerRows(bar),
      ...(bar.href ? { href: bar.href } : {}),
    }));
    const column = (bar: Bar): ReactNode =>
      grouped ? (
        <span className="itsm-BarChart__group">
          {defs.map((def, index) => (
            <span key={def.id} className="itsm-BarChart__bar" style={{ ['--_itsm-bar' as string]: share(bar.parts[index] ?? 0) }}>
              {totals ? <span className="itsm-BarChart__total">{format(bar.parts[index] ?? 0)}</span> : null}
              {(bar.parts[index] ?? 0) > 0 ? segment(def.id, partLook(bar, index), 1, format(bar.parts[index]!)) : null}
            </span>
          ))}
        </span>
      ) : (
        <span className="itsm-BarChart__bar" style={{ ['--_itsm-bar' as string]: length(bar) }}>
          {/* First, so the top part stays the bar's last child and keeps its rounded end. */}
          {totals ? <span className="itsm-BarChart__total">{format(bar.value)}</span> : null}
          {fill(bar)}
        </span>
      );
    const canvas = (
      <div className="itsm-BarChart__canvas">
        <div className="itsm-BarChart__grid" aria-hidden="true">
          {ticks.map(({ tick, top: y }) => (
            <span key={tick} className="itsm-BarChart__gridline" data-axis={tick === 0 || undefined} style={{ top: `${y}px` }} />
          ))}
        </div>
        <ol className="itsm-BarChart__columns" aria-hidden="true">
          {bars.map((bar, index) => (
            <li key={bar.id} className="itsm-BarChart__column" data-point={index}>
              {column(bar)}
            </li>
          ))}
        </ol>
        {targetY === undefined ? null : (
          <svg className="itsm-BarChart__overlay" width="100%" height={canvasHeight} aria-hidden="true" focusable="false">
            <MarkerBackdrop target={{ y: targetY }} top={top} bottom={canvasHeight} />
          </svg>
        )}
        <MarkerLayer layout={placed} bottom={canvasHeight} {...(targetY === undefined ? {} : { target: { y: targetY, label: targetText } })} />
      </div>
    );
    return (
      <ChartFigure
        {...frame}
        summary={summary}
        summaryHidden={description === undefined || descriptionHidden}
        table={{
          columns: [...tableColumns, ...(markerColumn ? [markerColumn.header] : [])],
          rows: tableRows.map((row, index) => [...row, ...(markerColumn ? [markerColumn.cells[index] ?? ''] : [])]),
        }}
        tableMode={tableMode}
      >
        <div
          className="itsm-Chart itsm-BarChart"
          data-layout="columns"
          {...rootProps}
          style={{ ['--_itsm-plot-h' as string]: `${canvasHeight}px`, ['--_itsm-plot-top' as string]: `${top}px` }}
        >
          {legend}
          <div className="itsm-BarChart__y" aria-hidden="true">
            <span className="itsm-BarChart__sizer">{tickText.reduce((a, b) => (b.length > a.length ? b : a), '')}</span>
            {ticks.map(({ tick, top: y }, index) => (
              <span key={tick} className="itsm-BarChart__yTick" style={{ top: `${y}px` }}>
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
    ...(bar.href ? { href: bar.href } : {}),
  }));
  const rows = (
    <Rows className="itsm-BarChart__rows">
      {bars.map((bar, index) => (
        <li key={bar.id} className="itsm-BarChart__row" data-point={index} style={{ ['--_itsm-bar' as string]: length(bar) }}>
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
            {parted ? <span className="itsm-visually-hidden">{` (${breakdown(bar)})`}</span> : null}
          </span>
          <span className="itsm-BarChart__track" aria-hidden="true">
            <span className="itsm-BarChart__bar">{fill(bar)}</span>
            {rowTarget ? <span className="itsm-BarChart__target" /> : null}
          </span>
        </li>
      ))}
    </Rows>
  );
  return (
    <ChartFigure {...frame} summary={summary} summaryHidden={description === undefined || descriptionHidden} table={{ columns: tableColumns, rows: tableRows }} tableMode={tableMode}>
      <div
        className="itsm-Chart itsm-BarChart"
        data-layout={shape}
        {...rootProps}
        style={{ ['--_itsm-value-ch' as string]: widest, ...(rowTarget ? { ['--_itsm-target' as string]: share(targetValue!) } : {}) }}
      >
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

/**
 * The chart's point in a sentence, for screen readers when the page gives
 * none: the largest bars ("Largest: Email (42), Portal (30) and Slack
 * (12); smallest: Voice (3); Other · 4 (9)."), or for bars in their own
 * order the highest and lowest; for groups, each series' highest bar; for
 * 100 % stacks, each series' share of everything. A target is said with how
 * many bars reach it.
 */
function summarise(
  bars: readonly Bar[],
  defs: readonly BarSeriesDef[],
  layout: BarLayout,
  format: (value: number) => string,
  percent: (fraction: number) => string,
  ordered: boolean,
  target: { readonly value: number; readonly text: string } | undefined,
): string {
  const describe = (bar: Bar): string => `${bar.label} (${format(bar.value)})`;
  let sentence: string;
  if (layout === 'grouped') {
    const highest = defs.map((def, index) => {
      const top = bars.reduce((best, bar) => ((bar.parts[index] ?? 0) > (best.parts[index] ?? 0) ? bar : best), bars[0]!);
      return `${def.label} highest in ${top.label} (${format(top.parts[index] ?? 0)})`;
    });
    sentence = `${sentenceList(highest)}.`;
  } else if (layout === 'normalised') {
    const total = bars.reduce((sum, bar) => sum + bar.value, 0);
    const shares = defs.map((def, index) => `${def.label} ${percent(total > 0 ? bars.reduce((sum, bar) => sum + (bar.parts[index] ?? 0), 0) / total : 0)}`);
    sentence = `Overall: ${sentenceList(shares)}, of ${format(total)} in all.`;
  } else {
    // "Other · n" is a sum of the smallest, never a contender for largest: it is said after them.
    const ranked = bars.filter((bar) => !bar.other).sort((a, b) => b.value - a.value);
    const other = bars.find((bar) => bar.other);
    const rest = other ? `; ${describe(other)}` : '';
    if (ranked.length === 1) sentence = `${describe(ranked[0]!)}${rest}.`;
    else if (ordered) sentence = `Highest: ${describe(ranked[0]!)}; lowest: ${describe(ranked[ranked.length - 1]!)}${rest}.`;
    else {
      const tail = ranked.length > 3 ? `; smallest: ${describe(ranked[ranked.length - 1]!)}` : '';
      sentence = `Largest: ${sentenceList(ranked.slice(0, 3).map(describe))}${tail}${rest}.`;
    }
  }
  if (!target) return sentence;
  if (layout === 'single' || layout === 'stacked') {
    const reached = bars.filter((bar) => !bar.other && bar.value >= target.value).length;
    const counted = bars.filter((bar) => !bar.other).length;
    return `${sentence} ${target.text}: ${reached} of ${counted} at or above it.`;
  }
  return `${sentence} ${target.text}.`;
}
