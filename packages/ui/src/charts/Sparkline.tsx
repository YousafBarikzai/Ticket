import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import { PATH_WIDTH, linePath, monotonePath, runs, type PlotPoint } from './scale.js';
import type { ChartTone } from './types.js';

export interface SparklineProps {
  /** One value per period, oldest first. `null` is a gap: no data is not zero, and is never drawn as one. */
  readonly values: readonly (number | null)[];
  /** The trend in words, e.g. "Rising, 12 → 18" — the image's accessible name (`describeTrend` writes one). */
  readonly label: string;
  /**
   * `muted` (default) is the de-emphasis grey a trend beside a number wants;
   * `accent` for a sparkline that is the story (a KPI tile passes it); a
   * `ChartTone` when the trend is a state's (breaches in danger).
   */
  readonly tone?: 'muted' | 'accent' | ChartTone;
  /** A one-tenth wash under the line. Default true. */
  readonly area?: boolean;
  /** `linear` (default) claims nothing between the points; `monotone` is smooth and never overshoots (the landing's). */
  readonly curve?: 'linear' | 'monotone';
  /** `auto` (default) fits the line to its own range — its job is shape; `zero` keeps zero at the bottom. */
  readonly baseline?: 'auto' | 'zero';
  /** A dashed hairline at this value, e.g. the SLA target. It is kept inside the drawing. */
  readonly reference?: number;
  /** Marks the latest value with a dot. Default true. */
  readonly highlightLast?: boolean;
  /** A size in px (default 80), or `fill` to take the whole width of its parent (a KPI tile's spark row). */
  readonly width?: number | 'fill';
  /** Default 40. */
  readonly height?: number;
  readonly className?: string;
}

/** Room above and below for the end dot and its ring, so neither is cut at the edge. */
const INSET = 5;

/** What a sparkline with nothing to show says it is: the words a KPI tile shows for the same state. */
const NO_TREND = 'No trend yet';

/**
 * A word-sized trend line (A8 §4.2): a thin line over a one-tenth wash,
 * scaled to its own range, because its job is shape, not size — the number
 * beside it gives the size. Gaps stay gaps. Server-safe static SVG.
 *
 * Two drawings, one look:
 *
 * - **A number width** is drawn at its own pixel size, as v2 did: no scaling,
 *   so the line stays 2 px and the dot round.
 * - **`fill`** stretches to its parent's width, which nobody knows on the
 *   server. The line is drawn in a stretched layer (`preserveAspectRatio:
 *   none`) with `vector-effect: non-scaling-stroke`, so it is 1.75 px at any
 *   width, and the end dot is an HTML span positioned by percentage, so it
 *   stays round however far the layer stretches. Nothing is measured and
 *   nothing moves when the page hydrates.
 *
 * Fewer than two known values is not a trend: the drawing is a dashed rule
 * at mid-height named "No trend yet", never a single dot that reads as data.
 */
export function Sparkline({
  values,
  label,
  tone = 'muted',
  area = true,
  curve = 'linear',
  baseline = 'auto',
  reference,
  highlightLast = true,
  width = 80,
  height = 40,
  className,
}: SparklineProps): ReactNode {
  const fill = width === 'fill';
  const w = fill ? PATH_WIDTH : Math.max(2 * INSET + 1, Math.round(Number.isFinite(width) ? width : 80));
  const h = Math.max(2 * INSET + 1, Math.round(Number.isFinite(height) ? height : 40));
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const sizing = fill ? { blockSize: `${h}px` } : { inlineSize: `${w}px`, blockSize: `${h}px` };

  if (known.length < 2) {
    return (
      <span
        role="img"
        aria-label={NO_TREND}
        className={cx('itsm-Sparkline', className)}
        data-tone={tone}
        data-width={fill ? 'fill' : undefined}
        data-empty=""
        style={sizing}
      />
    );
  }

  const hasReference = reference !== undefined && Number.isFinite(reference);
  const bounds = hasReference ? [...known, reference] : known;
  const low = baseline === 'zero' ? Math.min(0, ...bounds) : Math.min(...bounds);
  const high = baseline === 'zero' ? Math.max(0, ...bounds) : Math.max(...bounds);
  const span = high - low;
  const toY = (value: number): number => INSET + (span === 0 ? 0.5 : 1 - (value - low) / span) * (h - 2 * INSET);
  const count = values.length;
  const points: PlotPoint[] = values.map((value, index) => ({
    x: count === 1 ? 0.5 : index / (count - 1),
    y: value !== null && Number.isFinite(value) ? toY(value) : null,
  }));
  // A fixed drawing is inset at both ends so the dot fits; a stretched one is
  // inset by the padding of its box instead (the stylesheet), in real pixels.
  const toX = fill ? (x: number): number => x * PATH_WIDTH : (x: number): number => INSET + x * (w - 2 * INSET);
  const path = curve === 'monotone' ? monotonePath : linePath;
  const line = path(points, toX);
  const wash = area ? washPath(points, h, (run) => path(run, toX), toX) : '';
  const referenceY = hasReference ? Math.round(toY(reference) * 100) / 100 : null;
  const drawn = points.filter((point): point is { x: number; y: number } => point.y !== null);
  const last = highlightLast ? drawn[drawn.length - 1] : undefined;

  const marks = (
    <>
      {wash ? <path className="itsm-Sparkline__wash" d={wash} /> : null}
      {referenceY !== null ? (
        <line className="itsm-Sparkline__reference" x1={toX(0)} x2={toX(1)} y1={referenceY} y2={referenceY} vectorEffect="non-scaling-stroke" />
      ) : null}
      <path className="itsm-Sparkline__line" d={line} vectorEffect={fill ? 'non-scaling-stroke' : undefined} />
    </>
  );

  if (!fill) {
    return (
      <svg role="img" aria-label={label} className={cx('itsm-Sparkline', className)} data-tone={tone} width={w} height={h} viewBox={`0 0 ${w} ${h}`} focusable="false">
        {marks}
        {last ? <circle className="itsm-Sparkline__dot" cx={toX(last.x)} cy={last.y} r="3" /> : null}
      </svg>
    );
  }

  return (
    <span role="img" aria-label={label} className={cx('itsm-Sparkline', className)} data-tone={tone} data-width="fill" style={sizing}>
      <span className="itsm-Sparkline__plot">
        <svg className="itsm-Sparkline__svg" width="100%" height={h} viewBox={`0 0 ${PATH_WIDTH} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {marks}
        </svg>
        {last ? (
          <span
            className="itsm-Sparkline__dot"
            style={{ left: `${Math.round(last.x * 10000) / 100}%`, top: `${Math.round(last.y * 100) / 100}px` }}
          />
        ) : null}
      </span>
    </span>
  );
}

/**
 * The wash: each run of the line, closed down to the bottom edge along the
 * same curve the line takes, so wash and line never part. A gap in the line
 * is a gap in the wash; a point alone between gaps has no area to fill.
 */
function washPath(points: readonly PlotPoint[], bottom: number, draw: (run: readonly PlotPoint[]) => string, toX: (x: number) => number): string {
  const fixed = (value: number): string => (Math.round(value * 100) / 100).toString();
  return runs(points)
    .filter((run) => run.length > 1)
    .map((run) => `${draw(run)}L${fixed(toX(run[run.length - 1]!.x))} ${fixed(bottom)}L${fixed(toX(run[0]!.x))} ${fixed(bottom)}Z`)
    .join('');
}
