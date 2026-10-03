import type { ReactNode } from 'react';
import { formatPercent } from '../format/format.js';
import { CHART_TABLE_DEFAULTS, ChartFigure } from './ChartFigure.js';
import { ChartReader, type ReaderPoint } from './ChartReader.js';
import type { ChartCommon } from './common.js';
import { CHART_EMPTY_TEXT, ChartEmpty, ChartLoading } from './parts.js';
import { DEFAULT_LOCALE, arcPath, chartId, foldOther, numberFormatter, sentenceList, slotAt, type SeriesSlot } from './scale.js';
import { TEXTURE_SLOTS, TEXTURE_TONES, TexturePatterns, textureId } from './texture.js';
import type { ChartSlot, ChartTone } from './types.js';

export interface DonutSegment {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** An identity colour (a channel, a category). Default the slots in order. */
  readonly slot?: ChartSlot;
  /** A state's colour (open, breached, on track); wins over `slot`, for status donuts. */
  readonly tone?: ChartTone;
  /** Hatched in every theme as well as coloured: "unassigned", "not set". */
  readonly pattern?: 'hatch';
}

export interface DonutChartProps extends ChartCommon {
  readonly segments: readonly DonutSegment[];
  readonly centerValue?: string;
  readonly centerLabel?: string;
  /** Parts drawn before the rest fold into "Other · n". Default and most 6: a donut is for part-to-whole with few parts. */
  readonly maxSegments?: number;
  /** `auto` (default): beside the ring in a card at least 22.5 rem wide, below it otherwise, by container query. */
  readonly legendPosition?: 'auto' | 'side' | 'bottom';
  /** The ring's diameter: `md` 160 px (default), `lg` 200 px. */
  readonly size?: 'md' | 'lg';
  readonly valueFormat?: Intl.NumberFormatOptions;
  /**
   * Keeps `description` for assistive technology only: the card around the
   * chart already shows it as its headline. `ChartCard` sets it with the
   * description it passes down, so the sentence is read once and seen once.
   */
  readonly descriptionHidden?: boolean;
}

/** The ring's radii in a 100-unit square: a ring rather than a pie, thick enough to read. */
const OUTER = 50;
const INNER = 34;
/** The surface gap between parts: 1.5°, as a fraction of a turn (A8 §4.9). */
const GAP = 1.5 / 360;
/** Never more parts than this, whatever is asked: past six, angles stop being comparable. */
const MOST = 6;

interface Slice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly slot: SeriesSlot;
  readonly tone?: ChartTone;
  readonly hatch: boolean;
}

/**
 * The texture a part wears: the plain hatch (slot 2's, as on bars and legend
 * keys) for a hatched part, otherwise its tone's or slot's, shown only with
 * more contrast; `null` for the parts that stay solid (slot 1, `success`).
 */
function textureKey(slice: Slice): ChartSlot | ChartTone | null {
  if (slice.hatch) return 2;
  if (slice.tone) return TEXTURE_TONES.includes(slice.tone) ? slice.tone : null;
  return slice.slot !== 'other' && TEXTURE_SLOTS.includes(slice.slot) ? slice.slot : null;
}

/**
 * Part-to-whole with at most six parts (SPEC-v3 §8.2, A8 §4.9). Server-safe
 * static SVG with an optional client reading layer.
 *
 * A donut is only good at "roughly how much of the whole is each part", so it
 * refuses to be more: past six parts the smallest fold into "Other · n" —
 * the neutral grey, hatched, so it never reads as a category of its own —
 * and the legend gives every part its value in bold and its share in words;
 * the numbers are never left to angle-reading. For close values or many
 * categories, use `BarChart`.
 *
 * Parts are coloured by slot (identity) or by tone (state, which wins), with
 * a 1.5° surface gap between them; the centre holds one figure in the stat
 * numeral and a muted word. The legend sits beside the ring in a card wide
 * enough for both and below it otherwise — a container query, so nothing is
 * measured. One reveal fades the ring in on first paint, never under reduced
 * motion. With more contrast each part also shows its hatch (`texture.tsx`),
 * so the ring still reads where colour does not.
 */
export function DonutChart({
  title,
  segments,
  centerValue,
  centerLabel,
  maxSegments = MOST,
  legendPosition = 'auto',
  size = 'md',
  table = CHART_TABLE_DEFAULTS.donut,
  interactive = false,
  description,
  descriptionHidden = false,
  valueFormat,
  emptyText = CHART_EMPTY_TEXT.empty,
  loading = false,
  locale = DEFAULT_LOCALE,
  animate = true,
  titleHidden = false,
  className,
}: DonutChartProps): ReactNode {
  const frame = { title, titleHidden, locale, className };
  const ringHeight = size === 'lg' ? 200 : 160;
  if (loading) {
    return (
      <ChartFigure {...frame} summary="Loading…" summaryHidden busy table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-DonutChart">
          <ChartLoading height={ringHeight} />
        </div>
      </ChartFigure>
    );
  }

  const cleaned: Slice[] = segments.map((segment, index) => ({
    id: segment.id,
    label: segment.label,
    value: Number.isFinite(segment.value) ? Math.max(0, segment.value) : 0,
    slot: segment.slot ?? slotAt(index),
    ...(segment.tone ? { tone: segment.tone } : {}),
    hatch: segment.pattern === 'hatch',
  }));
  const limit = Math.min(MOST, Number.isFinite(maxSegments) ? Math.floor(maxSegments) : MOST);
  const slices = foldOther(cleaned, limit, (value, folded): Slice => ({ id: '__other', label: `Other · ${folded.length}`, value, slot: 'other', tone: 'neutral', hatch: true }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (slices.length === 0 || total <= 0) {
    return (
      <ChartFigure {...frame} summary={emptyText} summaryHidden table={{ columns: [], rows: [] }} tableMode="hidden">
        <div className="itsm-Chart itsm-DonutChart">
          <ChartEmpty text={emptyText} height={ringHeight} />
        </div>
      </ChartFigure>
    );
  }

  const format = numberFormatter(locale, valueFormat);
  const share = (value: number): string => formatPercent(value / total, { locale });
  const drawn = slices.filter((slice) => slice.value > 0);
  const id = chartId('donut', [title, ...slices.map((slice) => `${slice.id}:${slice.tone ?? slice.slot}`)]);
  const gap = drawn.length > 1 ? GAP : 0;
  let start = 0;
  const arcs = drawn.map((slice) => {
    const sweep = slice.value / total;
    const from = start + gap / 2;
    const to = start + sweep - gap / 2;
    const middle = start + sweep / 2;
    start += sweep;
    return { slice, d: arcPath(from, Math.max(from, to), OUTER, INNER), middle, texture: textureKey(slice) };
  });
  const textures = [...new Set(arcs.map((arc) => arc.texture).filter((key): key is ChartSlot | ChartTone => key !== null))];
  const paint = (slice: Slice): Record<string, string | undefined> => ({
    'data-slot': slice.tone ? undefined : String(slice.slot),
    'data-tone': slice.tone,
    'data-pattern': slice.hatch ? 'hatch' : undefined,
  });

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
      rows: [{ id: slice.id, label: '', value: `${format(slice.value)} (${share(slice.value)})`, ...(slice.tone ? { tone: slice.tone } : { slot: slice.slot }) }],
    };
  });

  const ring = (
    <div className="itsm-DonutChart__ring" data-size={size}>
      <svg className="itsm-DonutChart__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <TexturePatterns
          id={id}
          slots={textures.filter((key): key is ChartSlot => typeof key === 'number')}
          tones={textures.filter((key): key is ChartTone => typeof key === 'string')}
        />
        {arcs.map(({ slice, d, texture }, index) => (
          <g key={slice.id} className="itsm-DonutChart__part" data-point={index}>
            <path className="itsm-DonutChart__segment" {...paint(slice)} d={d} />
            {texture === null ? null : (
              <path className="itsm-DonutChart__texture" data-pattern={slice.hatch ? 'hatch' : undefined} fill={`url(#${textureId(id, texture)})`} d={d} />
            )}
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
      summaryHidden={description === undefined || descriptionHidden}
      table={{ columns: ['Part', 'Value', 'Share'], rows: slices.map((slice) => [slice.label, format(slice.value), share(slice.value)]) }}
      tableMode={table}
    >
      <div className="itsm-Chart itsm-DonutChart" data-legend={legendPosition} data-reveal={animate ? '' : undefined}>
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
        {/* The legend is the data: every part, its value in bold and its share, keyed by a chip like its part. */}
        <ul className="itsm-ChartLegend itsm-DonutChart__legend" aria-label="Legend">
          {slices.map((slice) => (
            <li key={slice.id} className="itsm-ChartLegend__item">
              <span className="itsm-ChartLegend__key" data-mark="chip" {...paint(slice)} aria-hidden="true" />
              <span className="itsm-ChartLegend__label">{slice.label}</span>
              <span className="itsm-ChartLegend__value">{format(slice.value)}</span>
              <span className="itsm-ChartLegend__detail">{share(slice.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFigure>
  );
}
