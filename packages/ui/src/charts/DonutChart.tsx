import type { ReactNode } from 'react';
import { formatPercent } from '../format/format.js';
import { ChartFigure } from './ChartFigure.js';
import { ChartReader, type ReaderPoint } from './ChartReader.js';
import { ChartEmpty, ChartLegend, ChartLoading } from './parts.js';
import { DEFAULT_LOCALE, arcPath, chartId, foldOther, numberFormatter, sentenceList, slotAt, type SeriesSlot } from './scale.js';
import { TEXTURE_SLOTS, TexturePatterns, textureId } from './texture.js';
import type { ChartSlot, ChartTableMode } from './types.js';

export interface DonutSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly slot?: ChartSlot;
}

export interface DonutChartProps {
  readonly title: string;
  readonly segments: readonly DonutSegment[];
  readonly centerValue?: string;
  readonly centerLabel?: string;
  /** Default 6: a donut is for part-to-whole with few parts, and more become "Other". */
  readonly maxSegments?: number;
  /** Default `hidden`: the legend beside the donut already lists every value and share. */
  readonly table?: ChartTableMode;
  readonly interactive?: boolean;
  readonly description?: string;
  readonly valueFormat?: Intl.NumberFormatOptions;
  readonly emptyText?: string;
  readonly loading?: boolean;
  readonly locale?: string;
  readonly titleHidden?: boolean;
  readonly className?: string;
}

/** The ring's radii in a 100-unit square: a ring rather than a pie, thick enough to read. */
const OUTER = 50;
const INNER = 34;
/** The surface gap between segments, as a fraction of a turn (about 2 px at the drawn size). */
const GAP = 0.006;

interface Slice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly slot: SeriesSlot;
}

/**
 * Part-to-whole with at most six parts (SPEC §4.8). Server-safe static SVG
 * with an optional client layer.
 *
 * A donut is only good at "roughly how much of the whole is each part", so it
 * refuses to be more: past `maxSegments` the smallest parts fold into
 * "Other", and the legend beside it gives every part's value and share in
 * words — the numbers are never left to angle-reading. For close values or
 * many categories, use `BarChart`.
 *
 * With more contrast, each part also gets its own hatch (see `texture.tsx`), so
 * the ring still reads where colour does not.
 */
export function DonutChart({
  title,
  segments,
  centerValue,
  centerLabel,
  maxSegments = 6,
  table = 'hidden',
  interactive = false,
  description,
  valueFormat,
  emptyText = 'No data for this period',
  loading = false,
  locale = DEFAULT_LOCALE,
  titleHidden = false,
  className,
}: DonutChartProps): ReactNode {
  const frame = { title, titleHidden, locale, className };
  if (loading) {
    return (
      <ChartFigure {...frame} summary="Loading…" summaryHidden busy table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-DonutChart">
          <ChartLoading height={160} />
        </div>
      </ChartFigure>
    );
  }

  const cleaned: Slice[] = segments.map((segment, index) => ({
    id: segment.id,
    label: segment.label,
    value: Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0,
    slot: segment.slot ?? slotAt(index),
  }));
  const slices = foldOther(cleaned, maxSegments, (value): Slice => ({ id: '__other', label: 'Other', value, slot: 'other' }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (slices.length === 0 || total <= 0) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-DonutChart">
          <ChartEmpty text={emptyText} height={160} />
        </div>
      </ChartFigure>
    );
  }

  const format = numberFormatter(locale, valueFormat);
  const share = (value: number): string => formatPercent(value / total, { locale });
  const drawn = slices.filter((slice) => slice.value > 0);
  const id = chartId('donut', [title, ...slices.map((slice) => `${slice.id}:${slice.slot}`)]);
  const gap = drawn.length > 1 ? GAP : 0;
  let start = 0;
  const arcs = drawn.map((slice) => {
    const sweep = slice.value / total;
    const from = start + gap / 2;
    const to = start + sweep - gap / 2;
    const middle = start + sweep / 2;
    start += sweep;
    return { slice, d: arcPath(from, Math.max(from, to), OUTER, INNER), middle };
  });
  const usedSlots = [...new Set(drawn.map((slice) => slice.slot))].filter((slot): slot is ChartSlot => slot !== 'other' && TEXTURE_SLOTS.includes(slot));

  const largest = [...slices].sort((a, b) => b.value - a.value);
  const summary =
    description ??
    `${sentenceList(largest.slice(0, 3).map((slice) => `${slice.label} ${share(slice.value)}`))}${largest.length > 3 ? `, and ${largest.length - 3} more` : ''}, of ${format(total)} in all.`;

  const points: ReaderPoint[] = arcs.map(({ slice, middle }) => {
    const angle = middle * 2 * Math.PI - Math.PI / 2;
    const radius = (OUTER + INNER) / 2;
    return {
      key: slice.id,
      title: slice.label,
      at: [(50 + radius * Math.cos(angle)) / 100, (50 + radius * Math.sin(angle)) / 100],
      rows: [{ id: slice.id, label: '', value: `${format(slice.value)} (${share(slice.value)})`, slot: slice.slot }],
    };
  });

  const ring = (
    <div className="itsm-DonutChart__ring">
      <svg className="itsm-DonutChart__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <TexturePatterns id={id} slots={usedSlots} />
        {arcs.map(({ slice, d }, index) => (
          <g key={slice.id} className="itsm-DonutChart__part" data-point={index}>
            <path className="itsm-DonutChart__segment" data-slot={slice.slot} d={d} />
            {slice.slot !== 'other' && TEXTURE_SLOTS.includes(slice.slot) ? (
              <path className="itsm-DonutChart__texture" fill={`url(#${textureId(id, slice.slot)})`} d={d} />
            ) : null}
          </g>
        ))}
      </svg>
      {centerValue || centerLabel ? (
        <span className="itsm-DonutChart__centre" aria-hidden="true">
          {centerValue ? <span className="itsm-DonutChart__centreValue">{centerValue}</span> : null}
          {centerLabel ? <span className="itsm-DonutChart__centreLabel">{centerLabel}</span> : null}
        </span>
      ) : null}
    </div>
  );

  return (
    <ChartFigure
      {...frame}
      summary={summary}
      summaryHidden={description === undefined}
      table={{ columns: ['Part', 'Value', 'Share'], rows: slices.map((slice) => [slice.label, format(slice.value), share(slice.value)]) }}
      tableMode={table}
    >
      <div className="itsm-Chart itsm-DonutChart">
        {interactive ? (
          <ChartReader label={title} points={points} mode="marks" axis="x" nearest={false}>
            {ring}
          </ChartReader>
        ) : (
          ring
        )}
        {centerValue || centerLabel ? (
          <span className="itsm-visually-hidden">{[centerValue, centerLabel].filter(Boolean).join(' ')}</span>
        ) : null}
        <ChartLegend
          className="itsm-DonutChart__legend"
          mark="box"
          items={slices.map((slice) => ({ id: slice.id, label: slice.label, slot: slice.slot, value: format(slice.value), detail: share(slice.value) }))}
        />
      </div>
    </ChartFigure>
  );
}
