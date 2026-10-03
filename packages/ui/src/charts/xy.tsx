import type { ReactNode } from 'react';
import { ChartFigure, type ChartFigureTable } from './ChartFigure.js';
import { ChartReader, type ReaderPoint, type ReaderRow } from './ChartReader.js';
import type { ChartBand, ChartCommon, ChartMarker, ChartTarget, SeriesLook, SeriesStyle } from './common.js';
import { MarkerBackdrop, MarkerLayer, layoutMarkers, markerTableColumn, resolveBands, resolveMarkers } from './markers.js';
import { CHART_EMPTY_TEXT, ChartEmpty, ChartLegend, ChartLoading } from './parts.js';
import {
  DEFAULT_LOCALE,
  PATH_WIDTH,
  axisFormatter,
  chartId,
  fraction,
  isolatedPoints,
  linePath,
  monotonePath,
  niceScale,
  numberFormatter,
  parseTimes,
  relaxLabels,
  slotAt,
  tickIndices,
  timeLabels,
  type NiceScale,
  type PlotPoint,
  type SeriesSlot,
} from './scale.js';
import { inferBucket } from './time.js';
import type { ChartTone } from './types.js';

/** How a series' area is filled: not at all, a flat wash, or a wash that fades towards the baseline. */
export type SeriesFill = 'none' | 'wash' | 'gradient';

export interface ChartSeries extends SeriesLook {
  readonly id: string;
  readonly label: string;
  /**
   * v2's reference line — a calibrated diagonal, a fixed threshold drawn as
   * data: thin, dashed, grey, with no end marker or label, and left out of the
   * colour order. For a plan or "raised" to read against, use `style:
   * 'comparison'`; for a single target value, the chart's `target`.
   */
  readonly reference?: boolean;
  /** `y: null` is a gap, not a zero. */
  readonly points: readonly { readonly x: string; readonly y: number | null }[];
  /** Replaces this series' end label ("Forecast 18/day"), or `false` for none. */
  readonly endLabel?: string | false;
  /** This series' fill, over the chart's `fill`. Only an `actual` series is ever filled (stacked areas aside). */
  readonly fill?: SeriesFill;
}

export interface LineChartProps extends ChartCommon {
  readonly series: readonly ChartSeries[];
  readonly xType: 'time' | 'category';
  readonly yFormat?: Intl.NumberFormatOptions;
  /** The plot's height in px, axis labels and marker labels not included. Default 240; 280 for a full-width hero card. */
  readonly height?: number;
  /** `zero` (default) starts the value axis at zero; `auto` fits it to the data. */
  readonly baseline?: 'zero' | 'auto';
  /** A fixed value axis, e.g. `[0, 1]` for a share; data outside it is drawn at the edge, and stated in the table. */
  readonly yDomain?: readonly [number, number];
  readonly stacked?: boolean;
  readonly legend?: 'auto' | 'none';
  /**
   * Labels where each line ends (A8 §4.3.3): `auto` (default) up to four
   * series, nudged apart to 14 px rather than overprinted; `always` for any
   * number; `none`. Narrow cards hide them by container query and the legend
   * carries the series instead.
   */
  readonly endLabels?: 'auto' | 'always' | 'none';
  /** @deprecated v2's name: `end` is `endLabels="auto"`, `none` is `none`. */
  readonly directLabels?: 'end' | 'none';
  /** How `actual` series are filled. `LineChart` default `none`, `AreaChart` default `wash`. */
  readonly fill?: SeriesFill;
  /** `linear` (default) claims nothing between the points; `monotone` is smooth and never overshoots them. */
  readonly curve?: 'linear' | 'monotone';
  /** A horizontal line to read the series against (the SLA target); the value axis stretches to include it. */
  readonly target?: ChartTarget;
  /** "As at", deadlines, milestones and events (A8 §4.3); `{ kind: 'today' }` is placed from `asAt` and `timeZone`. */
  readonly markers?: readonly ChartMarker[];
  /** Shaded spans of the x axis (a freeze, a maintenance window). */
  readonly bands?: readonly ChartBand[];
  /**
   * Known values a series needs before the chart draws it; below that in
   * every series the plot says "Not enough history yet". Default 3 on a time
   * axis (a trend of two points is a line, not a trend) and 1 on a category
   * axis, which has no history.
   */
  readonly minPoints?: number;
  /** The series drawn as the primary one (2.5 px) when several are `actual`. */
  readonly highlight?: string;
  /** Where each x leads: the reader's Enter follows it (the tickets behind a day). */
  readonly hrefs?: Readonly<Record<string, string>>;
  /** The heading of the first column of the table view. Default "Date" or "Category". */
  readonly xLabel?: string;
  /**
   * Keeps `description` for assistive technology only: the card around the
   * chart already shows it as its headline. `ChartCard` sets it with the
   * description it passes down, so the sentence is read once and seen once.
   */
  readonly descriptionHidden?: boolean;
  /**
   * The width of the card the chart sits in, in columns of twelve.
   * `ChartCard` passes its `span`, so marker labels are fitted to the plot
   * they will have (A8 §4.3.4). Default 12.
   */
  readonly span?: number;
}

/** Room above the highest tick, so a marker on it is not cut off. */
const PAD_TOP = 8;
/** End labels closer than this (px) are nudged apart (A8-S5). */
const LABEL_GAP = 14;
/** Interactive charts carry their points to the browser; past this many values one stays static (A8 §5.2). */
const READER_LIMIT = 400;

/** One series, resolved: its colour, style and what it is drawn with. */
interface Look {
  readonly slot: SeriesSlot;
  readonly tone?: ChartTone;
  readonly style: SeriesStyle;
  /** v2's dashed grey reference line. */
  readonly reference: boolean;
  /** For a forecast: the index of the series it continues. */
  readonly parent?: number;
}

/**
 * The colour, style and parent of every series (A8 §4.3.2). Slots follow the
 * series' position among the coloured ones, as in v2, so a filter that
 * removes one keeps the rest's colours when they name their slot; comparison,
 * baseline and reference series are grey and take no position. A forecast
 * with no slot of its own continues the `actual` series before it, in that
 * series' colour (or the one with the slot it names).
 */
function resolveLooks(series: readonly ChartSeries[]): Look[] {
  const looks: Look[] = [];
  let position = 0;
  series.forEach((one, index) => {
    const style: SeriesStyle = one.style ?? 'actual';
    if (one.reference || style === 'comparison' || style === 'baseline') {
      looks.push({ slot: one.slot ?? 'other', style, reference: Boolean(one.reference) });
      return;
    }
    if (style === 'forecast') {
      let parent = -1;
      for (let before = index - 1; before >= 0; before--) {
        const candidate = looks[before]!;
        if (candidate.style === 'actual' && !candidate.reference && (one.slot === undefined || candidate.slot === one.slot)) {
          parent = before;
          break;
        }
      }
      if (parent >= 0) {
        const from = looks[parent]!;
        const tone = one.tone ?? (one.slot === undefined ? from.tone : undefined);
        looks.push({ slot: one.slot ?? from.slot, ...(tone ? { tone } : {}), style, reference: false, parent });
        return;
      }
    }
    looks.push({ slot: one.slot ?? slotAt(position), ...(one.tone ? { tone: one.tone } : {}), style, reference: false });
    position += 1;
  });
  return looks;
}

/**
 * The value axis: nice ticks over the data and the target, or the caller's
 * fixed domain with the nice ticks that fall inside it.
 */
function valueScale(values: readonly number[], baseline: 'zero' | 'auto', domain: readonly [number, number] | undefined): NiceScale {
  if (!domain || !(domain[1] > domain[0])) return niceScale(values, { baseline, count: 4 });
  const [min, max] = domain;
  const nice = niceScale([min, max], { baseline: 'auto', count: 4 });
  const ticks = nice.ticks.filter((tick) => tick >= min && tick <= max);
  return { min, max, step: nice.step, ticks: ticks.length > 0 ? ticks : [min, max] };
}

/**
 * The line and area chart, drawn once for both (SPEC-v3 §8.2, A8 §4.3).
 *
 * **Marks are SVG; words are HTML.** The plot is an SVG as wide as its
 * container and exactly as tall as it needs, with no `viewBox` to scale it:
 * lines and areas sit in an inner layer stretched to the width with
 * `vector-effect: non-scaling-stroke`, so a line is 2 px at any width, and
 * markers are placed by percentage, so they stay round. Axis ticks, end
 * labels, the marker pills and the legend are HTML, laid out by the browser.
 * So nothing needs measuring on the server, and no text ever shrinks with a
 * narrow card.
 *
 * **The PMO recipe** (A8 §3.1): square legend chips above the plot; an
 * accent `actual` line with a soft wash, read against thin grey `comparison`
 * lines; a dashed `forecast` continuing its series from the last actual
 * point; end-of-line labels nudged apart rather than dropped; a dashed target
 * with its label; a dashed "As at 2 Oct" marker with a navy pill, deadlines
 * and milestones on two tiers of labels reserved above the data so a pill
 * never sits on a line.
 *
 * **Honest states:** a gap is a gap, never a drop to zero; a series with too
 * little history says so; the table twin carries every value, a "Marker"
 * column, and forecasts named as such. Deterministic: no clock, no random —
 * "today" is the page's `asAt`, placed in the reader's `timeZone`.
 */
export function XYChart({ kind, props }: { readonly kind: 'line' | 'area'; readonly props: LineChartProps }): ReactNode {
  const {
    title,
    description,
    descriptionHidden = false,
    series,
    xType,
    yFormat,
    height = 240,
    baseline = 'zero',
    yDomain,
    stacked = false,
    legend = 'auto',
    directLabels,
    endLabels = directLabels === 'none' ? 'none' : 'auto',
    fill: chartFill = kind === 'area' ? 'wash' : 'none',
    curve = 'linear',
    target,
    markers = [],
    bands = [],
    minPoints: minPointsProp,
    highlight,
    hrefs,
    table = 'toggle',
    interactive = false,
    emptyText = CHART_EMPTY_TEXT.empty,
    insufficientText = CHART_EMPTY_TEXT.insufficient,
    loading = false,
    locale = DEFAULT_LOCALE,
    timeZone,
    asAt,
    animate = true,
    titleHidden = false,
    xLabel,
    span,
    className,
  } = props;
  const plotHeight = Math.max(80, Math.round(Number.isFinite(height) ? height : 240));
  const rootClass = 'itsm-Chart itsm-XYChart';
  const frame = { title, titleHidden, locale, className };
  const emptyFrame = (body: ReactNode, sentence: string, busy = false): ReactNode => (
    <ChartFigure {...frame} summary={sentence} summaryHidden busy={busy} table={{ columns: [], rows: [] }} tableMode="hidden">
      <div className={rootClass} data-kind={kind}>
        {body}
      </div>
    </ChartFigure>
  );

  if (loading) return emptyFrame(<ChartLoading height={plotHeight} />, 'Loading…', true);

  // The x domain: every x any series has, in order of first appearance, or
  // in time order on a time axis.
  let xs: string[] = [];
  const seen = new Set<string>();
  for (const one of series) {
    for (const point of one.points) {
      if (!seen.has(point.x)) {
        seen.add(point.x);
        xs.push(point.x);
      }
    }
  }
  let times = xType === 'time' ? parseTimes(xs) : null;
  if (times) {
    const order = xs.map((x, index) => ({ x, time: times![index]! })).sort((a, b) => a.time - b.time);
    xs = order.map((entry) => entry.x);
    times = order.map((entry) => entry.time);
  }
  const count = xs.length;
  const values = series.map((one) => {
    const byX = new Map(one.points.map((point) => [point.x, point.y]));
    return xs.map((x) => {
      const y = byX.get(x);
      return typeof y === 'number' && Number.isFinite(y) ? y : null;
    });
  });
  const known = values.map((row) => row.filter((value) => value !== null).length);

  if (count === 0 || known.every((n) => n === 0)) {
    return emptyFrame(<ChartEmpty height={plotHeight} text={emptyText} />, emptyText);
  }
  const minPoints = Math.max(1, Math.floor(minPointsProp ?? (times ? 3 : 1)));
  if (known.every((n) => n < minPoints)) {
    const unit = times ? `${inferBucket(times)}s` : 'points';
    return emptyFrame(
      <ChartEmpty height={plotHeight} reason="insufficient" text={insufficientText} detail={`Charts start once there are ${minPoints} ${unit} of data`} />,
      insufficientText,
    );
  }

  const positions = xs.map((_, index) => {
    if (count === 1) return 0.5;
    if (times) {
      const first = times[0]!;
      const last = times[count - 1]!;
      return last === first ? index / (count - 1) : (times[index]! - first) / (last - first);
    }
    return index / (count - 1);
  });
  const labels = times ? timeLabels(xs, times, locale, timeZone) : { tick: (index: number) => xs[index] ?? '', full: (index: number) => xs[index] ?? '' };
  const looks = resolveLooks(series);
  const multiple = series.length > 1;

  // Markers first: their labels claim rows above the data before anything is scaled.
  const markerAxis = { xs, positions, times };
  const placed = layoutMarkers(resolveMarkers(markers, markerAxis, { locale, ...(asAt === undefined ? {} : { asAt }), ...(timeZone === undefined ? {} : { timeZone }) }), span === undefined ? {} : { span });
  const shaded = resolveBands(bands, markerAxis);
  const top = PAD_TOP + placed.rowHeight;
  const svgHeight = plotHeight + placed.rowHeight;

  // Stacked: each series sits on the ones before it; a missing value adds nothing.
  const tops = stacked
    ? values.reduce<number[][]>((acc, row, seriesIndex) => {
        acc.push(row.map((value, index) => (seriesIndex === 0 ? 0 : acc[seriesIndex - 1]![index]!) + (value ?? 0)));
        return acc;
      }, [])
    : null;
  const targetValue = target && Number.isFinite(target.value) ? target.value : undefined;
  const scaled = [...(tops ? tops.flat() : values.flat().filter((value): value is number => value !== null)), ...(targetValue === undefined ? [] : [targetValue])];
  const scale = valueScale(scaled, baseline, yDomain);
  const toY = (value: number): number => top + (1 - fraction(value, scale)) * (svgHeight - top);
  const floorValue = Math.min(Math.max(0, scale.min), scale.max);
  const floorY = toY(floorValue);
  const format = numberFormatter(locale, yFormat);
  const axis = axisFormatter(locale, yFormat, Math.max(Math.abs(scale.min), Math.abs(scale.max)));

  const drawn: PlotPoint[][] = series.map((_, seriesIndex) =>
    xs.map((_, index) => {
      const value = values[seriesIndex]![index]!;
      if (tops) return { x: positions[index]!, y: toY(tops[seriesIndex]![index]!) };
      return { x: positions[index]!, y: value === null ? null : toY(value) };
    }),
  );
  const lastIndex = values.map((row) => {
    for (let index = row.length - 1; index >= 0; index--) if (row[index] !== null) return index;
    return -1;
  });
  // A forecast starts where its series' actual line stops, so the two read as one line.
  const paths: PlotPoint[][] = drawn.map((points, seriesIndex) => {
    const parent = looks[seriesIndex]!.parent;
    if (parent === undefined || tops) return points;
    const join = lastIndex[parent]!;
    if (join < 0 || points[join]!.y !== null) return points;
    return points.map((point, index) => (index === join ? drawn[parent]![join]! : point));
  });
  const floors: PlotPoint[][] = series.map((_, seriesIndex) =>
    xs.map((_, index) => ({ x: positions[index]!, y: tops && seriesIndex > 0 ? toY(tops[seriesIndex - 1]![index]!) : floorY })),
  );

  // Which series are washed, and how: actual ones only, every one when stacked into areas.
  const fills: SeriesFill[] = series.map((one, seriesIndex) => {
    const look = looks[seriesIndex]!;
    const wanted = one.fill ?? chartFill;
    if (stacked && kind === 'area') return wanted === 'gradient' ? 'gradient' : 'wash';
    return look.style === 'actual' && !look.reference ? wanted : 'none';
  });
  const washed = fills.filter((one) => one !== 'none').length;
  const actuals = looks.filter((look) => look.style === 'actual' && !look.reference).length;
  const primary = (seriesIndex: number): boolean => {
    const look = looks[seriesIndex]!;
    if (look.style !== 'actual' || look.reference) return false;
    return highlight !== undefined ? series[seriesIndex]!.id === highlight : multiple && actuals === 1;
  };
  const id = chartId('xy', [title, ...series.map((one) => one.id)]);
  const path = (points: readonly PlotPoint[]): string => (curve === 'monotone' ? monotonePath(points) : linePath(points));
  const wash = (upper: readonly PlotPoint[], lower: readonly PlotPoint[]): string => {
    // Each run of the line, closed back along its floor by the same curve, so wash and line never part.
    const out: string[] = [];
    let start = -1;
    const close = (end: number): void => {
      if (start < 0 || end - start < 1) return;
      const back = lower.slice(start, end + 1).reverse();
      out.push(`${path(upper.slice(start, end + 1))}${path(back).replace(/^M/, 'L')}Z`);
    };
    upper.forEach((point, index) => {
      const ok = point.y !== null && lower[index]?.y !== null;
      if (ok && start < 0) start = index;
      if (!ok && start >= 0) {
        close(index - 1);
        start = -1;
      }
    });
    if (start >= 0) close(upper.length - 1);
    return out.join('');
  };

  // End labels: every series with a last value that is not a reference, nudged apart.
  const ends = series.flatMap((one, seriesIndex) => {
    const look = looks[seriesIndex]!;
    const at = lastIndex[seriesIndex]!;
    if (look.reference || at < 0 || one.endLabel === false) return [];
    const y = drawn[seriesIndex]![at]!.y ?? floorY;
    const value = format(tops ? (values[seriesIndex]![at] ?? 0) : values[seriesIndex]![at]!);
    return [{ id: one.id, label: one.label, look, at, y, value, override: typeof one.endLabel === 'string' ? one.endLabel : undefined }];
  });
  const showEnds = endLabels === 'always' ? ends.length > 0 : endLabels === 'auto' && series.length <= 4 && ends.length > 0;
  const relaxed = relaxLabels(
    ends.map((end) => end.y),
    LABEL_GAP,
    top,
    svgHeight,
  );
  const showLegend = legend !== 'none' && multiple;

  const gridlines = scale.ticks.map((tick) => ({ tick, y: Math.round(toY(tick)) + 0.5, axis: tick === floorValue }));
  const tickLabels = scale.ticks.map((tick) => axis(tick));
  const longestTick = tickLabels.reduce((a, b) => (b.length > a.length ? b : a), '');
  const endText = (end: (typeof ends)[number]): string => end.override ?? (multiple ? `${end.label} ${end.value}` : end.value);
  const longestEnd = ends.reduce<(typeof ends)[number] | null>((a, b) => (a === null || endText(b).length > endText(a).length ? b : a), null);

  const resolvedMarkers = placed.items;
  const markerColumn = markerTableColumn(resolvedMarkers, count);
  const forecastHeader = (one: ChartSeries, look: Look): string => (look.style === 'forecast' && !/forecast/i.test(one.label) ? `${one.label} (forecast)` : one.label);
  const summary = description ?? summarise(series, values, labels.tick, format);
  const tableData: ChartFigureTable = {
    columns: [
      xLabel ?? (times ? 'Date' : 'Category'),
      ...series.map((one, seriesIndex) => forecastHeader(one, looks[seriesIndex]!)),
      ...(stacked && multiple ? ['Total'] : []),
      ...(markerColumn ? [markerColumn.header] : []),
    ],
    rows: xs.map((_, index) => [
      labels.full(index),
      ...values.map((row) => (row[index] === null ? '—' : format(row[index]!))),
      ...(stacked && multiple ? [format(tops![tops!.length - 1]![index]!)] : []),
      ...(markerColumn ? [markerColumn.cells[index] ?? ''] : []),
    ]),
  };

  const targetY = targetValue === undefined ? undefined : toY(targetValue);
  const gradients = series.flatMap((one, seriesIndex) =>
    fills[seriesIndex] === 'gradient'
      ? [
          <linearGradient
            key={one.id}
            id={`${id}-g${seriesIndex}`}
            className="itsm-XYChart__gradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
            data-slot={looks[seriesIndex]!.slot}
            data-tone={looks[seriesIndex]!.tone}
          >
            <stop offset="0" className="itsm-XYChart__stop" />
            <stop offset="1" className="itsm-XYChart__stop" data-end="" />
          </linearGradient>,
        ]
      : [],
  );

  const plot = (
    <svg className="itsm-XYChart__svg" width="100%" height={svgHeight} aria-hidden="true" focusable="false">
      <MarkerBackdrop bands={shaded} {...(targetY === undefined ? {} : { target: { y: targetY } })} top={top} bottom={svgHeight} />
      {gridlines.map((line) => (
        <line key={line.tick} className="itsm-XYChart__gridline" data-axis={line.axis || undefined} x1="0" x2="100%" y1={line.y} y2={line.y} />
      ))}
      <svg className="itsm-XYChart__paths" viewBox={`0 0 ${PATH_WIDTH} ${svgHeight}`} preserveAspectRatio="none" width="100%" height={svgHeight}>
        {gradients.length > 0 ? <defs>{gradients}</defs> : null}
        {series.map((one, seriesIndex) =>
          fills[seriesIndex] === 'none' ? null : (
            <path
              key={`area:${one.id}`}
              className="itsm-XYChart__area"
              data-slot={looks[seriesIndex]!.slot}
              data-tone={looks[seriesIndex]!.tone}
              data-fill={fills[seriesIndex]}
              data-stacked={stacked || undefined}
              d={wash(paths[seriesIndex]!, floors[seriesIndex]!)}
              {...(fills[seriesIndex] === 'gradient' ? { fill: `url(#${id}-g${seriesIndex})` } : {})}
            />
          ),
        )}
        {series.map((one, seriesIndex) => {
          const look = looks[seriesIndex]!;
          return (
            <path
              key={`line:${one.id}`}
              className="itsm-XYChart__line"
              data-slot={look.slot}
              data-tone={look.tone}
              data-style={look.style === 'actual' ? undefined : look.style}
              data-reference={look.reference || undefined}
              data-primary={primary(seriesIndex) || undefined}
              d={path(paths[seriesIndex]!)}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {series.map((one, seriesIndex) => {
        const look = looks[seriesIndex]!;
        if (look.reference) return null;
        return (
          isolatedPoints(paths[seriesIndex]!)
            // The last one is drawn as the end marker below.
            .filter((point) => point.x !== positions[lastIndex[seriesIndex]!])
            .map((point) => (
              <circle
                key={`dot:${one.id}:${point.x}`}
                className="itsm-XYChart__dot"
                data-slot={look.slot}
                data-tone={look.tone}
                data-style={look.style === 'actual' ? undefined : look.style}
                cx={`${point.x * 100}%`}
                cy={point.y}
                r="3"
              />
            ))
        );
      })}
      {ends
        .filter((end) => end.look.style === 'actual' || end.look.style === 'forecast')
        .map((end) => (
          <circle
            key={`end:${end.id}`}
            className="itsm-XYChart__end"
            data-slot={end.look.slot}
            data-tone={end.look.tone}
            data-style={end.look.style === 'actual' ? undefined : end.look.style}
            cx={`${positions[end.at]! * 100}%`}
            cy={end.y}
            r="4"
          />
        ))}
    </svg>
  );

  const readable = interactive && count * series.length <= READER_LIMIT;
  if (interactive && !readable && typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn(`@itsm/ui: "${title}" has ${count * series.length} values, more than an interactive chart carries (${READER_LIMIT}); it is drawn static.`);
  }
  const points: ReaderPoint[] = readable
    ? xs.map((x, index) => {
        const rows: ReaderRow[] = series.map((one, seriesIndex) => {
          const look = looks[seriesIndex]!;
          const value = values[seriesIndex]![index]!;
          const y = drawn[seriesIndex]![index]!.y;
          return {
            id: one.id,
            label: multiple ? one.label : '',
            value: value === null ? 'No data' : look.style === 'forecast' ? `${format(value)} (forecast)` : format(value),
            slot: look.slot,
            ...(look.tone ? { tone: look.tone } : {}),
            ...(look.style === 'actual' ? {} : { style: look.style }),
            ...(value === null || y === null ? {} : { y: y / svgHeight }),
          };
        });
        if (stacked && multiple) rows.push({ id: '__total', label: 'Total', value: format(tops![tops!.length - 1]![index]!) });
        const href = hrefs?.[x];
        return { key: x, title: labels.full(index), at: [positions[index]!, 0], rows, ...(href ? { href } : {}) };
      })
    : [];

  return (
    <ChartFigure {...frame} summary={summary} summaryHidden={description === undefined || descriptionHidden} table={tableData} tableMode={table}>
      <div
        className={rootClass}
        data-kind={kind}
        data-ends={showEnds || undefined}
        data-washes={washed > 1 && !stacked ? 'several' : undefined}
        data-reveal={animate || undefined}
        style={{ ['--_itsm-plot-h' as string]: `${svgHeight}px` }}
      >
        {showLegend ? (
          <ChartLegend
            className="itsm-XYChart__legend"
            items={series.map((one, index) => {
              const look = looks[index]!;
              return {
                id: one.id,
                label: one.label,
                slot: look.slot,
                ...(look.tone ? { tone: look.tone } : {}),
                ...(look.reference ? { style: 'baseline' as const } : look.style === 'actual' ? {} : { style: look.style }),
              };
            })}
          />
        ) : null}
        <div className="itsm-XYChart__y" aria-hidden="true">
          <span className="itsm-XYChart__sizer">{longestTick}</span>
          {gridlines.map((line, index) => (
            <span key={line.tick} className="itsm-XYChart__yTick" style={{ top: `${line.y}px` }}>
              {tickLabels[index]}
            </span>
          ))}
        </div>
        <div className="itsm-XYChart__plot">
          {readable ? (
            <ChartReader label={title} points={points} mode="crosshair">
              {plot}
            </ChartReader>
          ) : (
            plot
          )}
          <MarkerLayer
            layout={placed}
            bottom={svgHeight}
            bands={shaded}
            {...(targetY === undefined ? {} : { target: { y: targetY, ...(target?.label ? { label: target.label } : {}) } })}
          />
        </div>
        {showEnds ? (
          <div className="itsm-XYChart__ends" aria-hidden="true">
            {longestEnd ? <EndLabel className="itsm-XYChart__sizer" end={longestEnd} multiple={multiple} /> : null}
            {ends.map((end, index) => (
              <EndLabel key={end.id} className="itsm-XYChart__endLabel" end={end} multiple={multiple} top={relaxed[index]!} />
            ))}
          </div>
        ) : null}
        <div className="itsm-XYChart__x" aria-hidden="true">
          {tickIndices(count, 6).map(({ index, wide }) => {
            const at = positions[index]!;
            return (
              <span
                key={xs[index]}
                className="itsm-XYChart__xTick"
                data-wide={wide || undefined}
                data-edge={count > 1 && at <= 0.08 ? 'start' : count > 1 && at >= 0.92 ? 'end' : undefined}
                style={{ left: `${at * 100}%` }}
              >
                {labels.tick(index)}
              </span>
            );
          })}
        </div>
      </div>
    </ChartFigure>
  );
}

/**
 * One end label: a square swatch, the series' name and its last value, or
 * the value alone on a chart of one series (A8 §3.1); a series' own
 * `endLabel` words replace both. The `sizer` copy is invisible and sets the
 * gutter's width to the longest label.
 */
function EndLabel({
  end,
  multiple,
  top,
  className,
}: {
  readonly end: { readonly label: string; readonly value: string; readonly look: Look; readonly override: string | undefined };
  readonly multiple: boolean;
  readonly top?: number;
  readonly className: string;
}): ReactNode {
  const named = multiple || end.override !== undefined;
  return (
    <span className={className} style={top === undefined ? undefined : { top: `${Math.round(top * 100) / 100}px` }}>
      {named ? (
        <>
          <span
            className="itsm-XYChart__endKey"
            data-slot={end.look.tone ? undefined : end.look.slot}
            data-tone={end.look.tone}
            data-style={end.look.style === 'actual' ? undefined : end.look.style}
          />
          <span className="itsm-XYChart__endName">{end.override ?? end.label}</span>
        </>
      ) : null}
      {end.override === undefined ? <span className="itsm-XYChart__endValue">{end.value}</span> : null}
    </span>
  );
}

/**
 * One sentence per series from the data: where it started, where it ended
 * and, when it is neither, its highest point. Written for the figure's
 * caption, where a screen reader meets it before the table.
 */
function summarise(
  series: readonly ChartSeries[],
  values: readonly (readonly (number | null)[])[],
  label: (index: number) => string,
  format: (value: number) => string,
): string {
  const sentences = series.map((one, seriesIndex) => {
    const known = values[seriesIndex]!.map((value, index) => ({ value, index })).filter((entry): entry is { value: number; index: number } => entry.value !== null);
    if (known.length === 0) return `${one.label}: no data.`;
    const first = known[0]!;
    const last = known[known.length - 1]!;
    if (known.length === 1) return `${one.label}: ${format(first.value)} (${label(first.index)}).`;
    const peak = known.reduce((a, b) => (b.value > a.value ? b : a));
    const span = Math.max(Math.abs(first.value), Math.abs(last.value));
    if (Math.abs(last.value - first.value) <= span * 0.02) {
      return `${one.label} held steady at ${format(last.value)} from ${label(first.index)} to ${label(last.index)}.`;
    }
    const verb = last.value > first.value ? 'rose' : 'fell';
    const high = peak.index !== first.index && peak.index !== last.index ? `, highest ${format(peak.value)} (${label(peak.index)})` : '';
    return `${one.label} ${verb} from ${format(first.value)} (${label(first.index)}) to ${format(last.value)} (${label(last.index)})${high}.`;
  });
  return sentences.join(' ');
}

