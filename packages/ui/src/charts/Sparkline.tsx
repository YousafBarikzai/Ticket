import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import { linePath, type PlotPoint } from './scale.js';

export interface SparklineProps {
  readonly values: readonly number[];
  /** The trend in words, e.g. "Rising, 12 → 18" — the image's accessible name (`describeTrend` writes one). */
  readonly label: string;
  /** `muted` (default) is the de-emphasis grey a trend beside a number wants; `accent` for a sparkline that is the story. */
  readonly tone?: 'muted' | 'accent';
  /** Marks the latest value with a dot in the accent. Default true. */
  readonly highlightLast?: boolean;
  /** Default 80. */
  readonly width?: number;
  /** Default 28. */
  readonly height?: number;
  readonly className?: string;
}

/** Room for the end dot and its ring, so neither is cut at the edge. */
const INSET = 5;

/**
 * A word-sized trend line (SPEC §4.8): a 2 px line over a one-tenth wash,
 * scaled to its own range, because its job is shape, not size — the number
 * beside it gives the size. Gaps stay gaps. Server-safe static SVG, drawn at
 * its own pixel size (no scaling, so the line stays 2 px and the dot round).
 */
export function Sparkline({ values, label, tone = 'muted', highlightLast = true, width = 80, height = 28, className }: SparklineProps): ReactNode {
  const w = Math.max(2 * INSET + 1, Math.round(width));
  const h = Math.max(2 * INSET + 1, Math.round(height));
  const known = values.filter((value) => Number.isFinite(value));
  const low = known.length > 0 ? Math.min(...known) : 0;
  const high = known.length > 0 ? Math.max(...known) : 0;
  const span = high - low;
  const count = values.length;
  const points: PlotPoint[] = values.map((value, index) => ({
    x: count === 1 ? 0.5 : index / (count - 1),
    y: Number.isFinite(value) ? INSET + (span === 0 ? 0.5 : 1 - (value - low) / span) * (h - 2 * INSET) : null,
  }));
  // Plotted in the drawing's own pixels: x from the fraction, inset at both ends.
  const px = (x: number): number => INSET + x * (w - 2 * INSET);
  const line = linePath(points, px);
  const drawn = points.filter((point): point is { x: number; y: number } => point.y !== null);
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  const wash =
    line && first && last && drawn.length > 1 && drawn.length === points.length
      ? `${line}L${px(last.x)} ${h}L${px(first.x)} ${h}Z`
      : '';
  return (
    <svg
      role="img"
      aria-label={label}
      className={cx('itsm-Sparkline', className)}
      data-tone={tone}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      focusable="false"
    >
      {wash ? <path className="itsm-Sparkline__wash" d={wash} /> : null}
      {line ? <path className="itsm-Sparkline__line" d={line} /> : null}
      {highlightLast && last ? <circle className="itsm-Sparkline__dot" cx={px(last.x)} cy={last.y} r="3" /> : null}
    </svg>
  );
}
