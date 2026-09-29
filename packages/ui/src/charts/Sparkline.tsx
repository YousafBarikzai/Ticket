import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface SparklineProps {
  readonly values: readonly number[];
  /** The trend in words, e.g. "Rising, 12 → 18" — the image's accessible name. */
  readonly label: string;
  readonly tone?: 'muted' | 'accent';
  readonly highlightLast?: boolean;
  readonly width?: number;
  /** Default 28. */
  readonly height?: number;
  readonly className?: string;
}

/**
 * A word-sized trend line. Server-safe static SVG.
 *
 * Stub (SPEC §4.8): renders the labelled image frame; the charts package draws the line.
 */
export function Sparkline({ label, tone = 'muted', width = 80, height = 28, className }: SparklineProps): ReactNode {
  return (
    <svg
      role="img"
      aria-label={label}
      className={cx('itsm-Sparkline', className)}
      data-tone={tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    />
  );
}
