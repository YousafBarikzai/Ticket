import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
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
  readonly table?: ChartTableMode;
  readonly interactive?: boolean;
  readonly className?: string;
}

/**
 * Part-to-whole with at most six parts. Server-safe static SVG with an
 * optional client layer.
 *
 * Stub (SPEC §4.8): renders the titled figure; the charts package draws it.
 */
export function DonutChart({ title, className }: DonutChartProps): ReactNode {
  return (
    <figure className={cx('itsm-DonutChart', className)}>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
