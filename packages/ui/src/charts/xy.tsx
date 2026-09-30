import type { ReactNode } from 'react';
import { ChartFigure, type ChartFigureTable } from './ChartFigure.js';
import { ChartReader, type ReaderPoint, type ReaderRow } from './ChartReader.js';
import { ChartEmpty, ChartLegend, ChartLoading } from './parts.js';
import {
  DEFAULT_LOCALE,
  PATH_WIDTH,
  areaPath,
  axisFormatter,
  fraction,
  isolatedPoints,
  linePath,
  niceScale,
  numberFormatter,
  parseTimes,
  slotAt,
  tickIndices,
  timeLabels,
  type PlotPoint,
  type SeriesSlot,
} from './scale.js';
import type { ChartSlot, ChartTableMode } from './types.js';

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  /** The series' colour. Give it explicitly when a filter can remove series, so the rest keep theirs. */
  readonly slot?: ChartSlot;
  /** `y: null` is a gap, not a zero. */
  readonly points: readonly { readonly x: string; readonly y: number | null }[];
}

export interface LineChartProps {
  readonly title: string;
  /** The chart's point in a sentence. Without it the chart writes one from the data, for screen readers only. */
  readonly description?: string;
  readonly series: readonly ChartSeries[];
  readonly xType: 'time' | 'category';
  readonly yFormat?: Intl.NumberFormatOptions;
  /** The plot's height in px, axis labels not included. Default 220. */
  readonly height?: number;
  /** `zero` (default) starts the value axis at zero; `auto` fits it to the data. */
  readonly baseline?: 'zero' | 'auto';
  readonly stacked?: boolean;
  readonly legend?: 'auto' | 'none';
  /** `end` labels each line where it ends (up to four series, when they do not collide). */
  readonly directLabels?: 'end' | 'none';
  readonly table?: ChartTableMode;
  /** Adds the client hover and keyboard layer; without it the chart is static server-rendered SVG. */
  readonly interactive?: boolean;
  readonly emptyText?: string;
  readonly loading?: boolean;
  /** For numbers and dates. Default `en-GB`: a server component has no provider to ask. */
  readonly locale?: string;
  /** For timestamps with a time of day; whole dates (`2026-09-01`) are read as dates. Default UTC. */
  readonly timeZone?: string;
  /** The card around the chart already shows the title. */
  readonly titleHidden?: boolean;
  /** The heading of the first column of the table view. Default "Date" or "Category". */
  readonly xLabel?: string;
  readonly className?: string;
}

/** Room above the highest tick, so a marker on it is not cut off. */
const PAD_TOP = 8;
/** Direct labels closer than this (px) would read as one; the legend takes over instead. */
const LABEL_CLEARANCE = 18;

/**
 * The line and area chart, drawn once for both (SPEC §4.8).
 *
 * **Marks are SVG; words are HTML.** The plot is an SVG as wide as its
 * container and exactly `height` tall, with no `viewBox` to scale it: lines
 * and areas sit in an inner layer stretched to the width with
 * `vector-effect: non-scaling-stroke`, so a line is 2 px at any width, and
 * markers are placed by percentage, so they stay round. Axis ticks and direct
 * labels are HTML beside and under the plot, laid out by the browser. So
 * nothing needs measuring on the server, and no text ever shrinks with a
 * narrow card — the failure mode of a chart drawn in a scaled `viewBox`.
 */
export function XYChart({ kind, props }: { readonly kind: 'line' | 'area'; readonly props: LineChartProps }): ReactNode {
  const {
    title,
    description,
    series,
    xType,
    yFormat,
    height = 220,
    baseline = 'zero',
    stacked = false,
    legend = 'auto',
    directLabels = 'end',
    table = 'toggle',
    interactive = false,
    emptyText = 'No data for this period',
    loading = false,
    locale = DEFAULT_LOCALE,
    timeZone,
    titleHidden = false,
    xLabel,
    className,
  } = props;
  const plotHeight = Math.max(80, Math.round(Number.isFinite(height) ? height : 220));
  const rootClass = 'itsm-Chart itsm-XYChart';
  const frame = { title, titleHidden, locale, className };

  if (loading) {
    return (
      <ChartFigure {...frame} summary="Loading…" summaryHidden busy table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className={rootClass} data-kind={kind}>
          <ChartLoading height={plotHeight} />
        </div>
      </ChartFigure>
    );
  }

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

  if (count === 0 || !values.some((row) => row.some((value) => value !== null))) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className={rootClass} data-kind={kind}>
          <ChartEmpty text={emptyText} height={plotHeight} />
        </div>
      </ChartFigure>
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
  const slots: SeriesSlot[] = series.map((one, index) => one.slot ?? slotAt(index));

  // Stacked: each series sits on the ones before it; a missing value adds nothing.
  const tops = stacked
    ? values.reduce<number[][]>((acc, row, seriesIndex) => {
        acc.push(row.map((value, index) => (seriesIndex === 0 ? 0 : acc[seriesIndex - 1]![index]!) + (value ?? 0)));
        return acc;
      }, [])
    : null;
  const scale = niceScale(tops ? tops.flat() : values.flat().filter((value): value is number => value !== null), { baseline, count: 4 });
  const toY = (value: number): number => PAD_TOP + (1 - fraction(value, scale)) * (plotHeight - PAD_TOP);
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
  const floors: PlotPoint[][] = series.map((_, seriesIndex) =>
    xs.map((_, index) => ({ x: positions[index]!, y: tops && seriesIndex > 0 ? toY(tops[seriesIndex - 1]![index]!) : floorY })),
  );

  // Where each series ends, for the end marker and the direct label.
  const ends = series.map((one, seriesIndex) => {
    const row = values[seriesIndex]!;
    let last = -1;
    for (let index = row.length - 1; index >= 0; index--) {
      if (row[index] !== null) {
        last = index;
        break;
      }
    }
    if (last < 0) return null;
    return { id: one.id, label: one.label, slot: slots[seriesIndex]!, index: last, y: drawn[seriesIndex]![last]!.y ?? floorY, value: format(row[last]!) };
  });
  const present = ends.filter((end): end is NonNullable<typeof end> => end !== null);
  const sorted = [...present].sort((a, b) => a.y - b.y);
  const clear = sorted.every((end, index) => index === 0 || end.y - sorted[index - 1]!.y >= LABEL_CLEARANCE);
  const showEnds = directLabels === 'end' && series.length <= 4 && present.length > 0 && clear;
  const showLegend = legend !== 'none' && series.length >= 2;
  const multiple = series.length > 1;

  const gridlines = scale.ticks.map((tick) => ({ tick, y: Math.round(toY(tick)) + 0.5, axis: tick === floorValue }));
  const tickLabels = scale.ticks.map((tick) => axis(tick));
  const longestTick = tickLabels.reduce((a, b) => (b.length > a.length ? b : a), '');
  const endText = (end: (typeof present)[number]): string => (multiple ? `${end.label} ${end.value}` : end.value);
  const longestEnd = present.reduce<(typeof present)[number] | null>((a, b) => (a === null || endText(b).length > endText(a).length ? b : a), null);

  const summary = description ?? summarise(series, values, labels.tick, format);
  const tableData: ChartFigureTable = {
    columns: [xLabel ?? (times ? 'Date' : 'Category'), ...series.map((one) => one.label), ...(stacked && multiple ? ['Total'] : [])],
    rows: xs.map((_, index) => [
      labels.full(index),
      ...values.map((row) => (row[index] === null ? '—' : format(row[index]!))),
      ...(stacked && multiple ? [format(tops![tops!.length - 1]![index]!)] : []),
    ]),
  };

  const plot = (
    <svg className="itsm-XYChart__svg" width="100%" height={plotHeight} aria-hidden="true" focusable="false">
      {gridlines.map((line) => (
        <line key={line.tick} className="itsm-XYChart__gridline" data-axis={line.axis || undefined} x1="0" x2="100%" y1={line.y} y2={line.y} />
      ))}
      <svg className="itsm-XYChart__paths" viewBox={`0 0 ${PATH_WIDTH} ${plotHeight}`} preserveAspectRatio="none" width="100%" height={plotHeight}>
        {kind === 'area'
          ? series.map((one, seriesIndex) => (
              <path
                key={`area:${one.id}`}
                className="itsm-XYChart__area"
                data-slot={slots[seriesIndex]}
                data-stacked={stacked || undefined}
                d={areaPath(drawn[seriesIndex]!, floors[seriesIndex]!)}
              />
            ))
          : null}
        {series.map((one, seriesIndex) => (
          <path
            key={`line:${one.id}`}
            className="itsm-XYChart__line"
            data-slot={slots[seriesIndex]}
            d={linePath(drawn[seriesIndex]!)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {series.map((one, seriesIndex) =>
        isolatedPoints(drawn[seriesIndex]!)
          // The last one is drawn as the end marker below.
          .filter((point) => point.x !== positions[ends[seriesIndex]?.index ?? -1])
          .map((point) => (
            <circle key={`dot:${one.id}:${point.x}`} className="itsm-XYChart__dot" data-slot={slots[seriesIndex]} cx={`${point.x * 100}%`} cy={point.y} r="3" />
          )),
      )}
      {present.map((end) => (
        <circle key={`end:${end.id}`} className="itsm-XYChart__end" data-slot={end.slot} cx={`${positions[end.index]! * 100}%`} cy={end.y} r="4" />
      ))}
    </svg>
  );

  const points: ReaderPoint[] = xs.map((x, index) => {
    const rows: ReaderRow[] = series.map((one, seriesIndex) => {
      const value = values[seriesIndex]![index]!;
      const y = drawn[seriesIndex]![index]!.y;
      return {
        id: one.id,
        label: multiple ? one.label : '',
        value: value === null ? 'No data' : format(value),
        slot: slots[seriesIndex]!,
        ...(value === null || y === null ? {} : { y: y / plotHeight }),
      };
    });
    if (stacked && multiple) rows.push({ id: '__total', label: 'Total', value: format(tops![tops!.length - 1]![index]!) });
    return { key: x, title: labels.full(index), at: [positions[index]!, 0], rows };
  });

  return (
    <ChartFigure {...frame} summary={summary} summaryHidden={description === undefined} table={tableData} tableMode={table}>
      <div
        className={rootClass}
        data-kind={kind}
        data-ends={showEnds || undefined}
        style={{ ['--_itsm-plot-h' as string]: `${plotHeight}px` }}
      >
        {showLegend ? (
          <ChartLegend
            className="itsm-XYChart__legend"
            mark={kind === 'area' ? 'box' : 'line'}
            items={series.map((one, index) => ({ id: one.id, label: one.label, slot: slots[index]! }))}
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
          {interactive ? (
            <ChartReader label={title} points={points} mode="crosshair">
              {plot}
            </ChartReader>
          ) : (
            plot
          )}
        </div>
        {showEnds ? (
          <div className="itsm-XYChart__ends" aria-hidden="true">
            {longestEnd ? <EndLabel className="itsm-XYChart__sizer" end={longestEnd} multiple={multiple} /> : null}
            {present.map((end) => (
              <EndLabel key={end.id} className="itsm-XYChart__endLabel" end={end} multiple={multiple} top={end.y} />
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

function EndLabel({
  end,
  multiple,
  top,
  className,
}: {
  readonly end: { readonly label: string; readonly value: string; readonly slot: SeriesSlot };
  readonly multiple: boolean;
  readonly top?: number;
  readonly className: string;
}): ReactNode {
  return (
    <span className={className} style={top === undefined ? undefined : { top: `${top}px` }}>
      {multiple ? (
        <>
          <span className="itsm-XYChart__endKey" data-slot={end.slot} />
          <span className="itsm-XYChart__endName">{end.label}</span>
        </>
      ) : null}
      <span className="itsm-XYChart__endValue">{end.value}</span>
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
