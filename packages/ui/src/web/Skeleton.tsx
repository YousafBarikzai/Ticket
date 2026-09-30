import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx.js';

export interface SkeletonProps {
  /** A length (`'60%'`, `'12rem'`, a token `var()`) or pixels. The full width by default. */
  readonly width?: number | string;
  /** A length or pixels; 16 by default. */
  readonly height?: number | string;
  /** `sm` (default) for text, `md` for blocks, `pill` for chips and controls, `full` for a circle. */
  readonly radius?: 'sm' | 'md' | 'lg' | 'xl' | 'pill' | 'full';
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * A loading placeholder: one bone of a skeleton. Server-safe — skeletons are
 * what a route's `loading.tsx` streams first, before any client JavaScript.
 *
 * Always `aria-hidden`: the shape means nothing to a screen reader, and the
 * region around it says "Loading…" once instead (see `SkeletonPage`), so the
 * person hears it once rather than a stream of empty boxes.
 *
 * It fades in after 200 ms, so a response that arrives quickly never flashes
 * a skeleton at all; the shimmer runs for about ten seconds and then stops —
 * a page that has been loading that long needs words, not motion — and is
 * absent under reduced motion. All of that is CSS: no timer runs.
 */
export function Skeleton({ width = '100%', height = 16, radius = 'sm', className, style }: SkeletonProps): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx('itsm-Skeleton', className)}
      data-radius={radius}
      // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
      style={{ ...style, inlineSize: width, blockSize: height }}
    />
  );
}

export interface SkeletonTextProps {
  readonly lines?: number;
  /** The width of the last line, which is shorter, as the last line of a paragraph is. 60% by default. */
  readonly lastLineWidth?: number | string;
  /** Match a type style's size and rhythm: `body` (default), `callout` or `footnote`. */
  readonly size?: 'body' | 'callout' | 'footnote';
  readonly className?: string;
}

/** Placeholder lines of text at a type style's size and line spacing. */
export function SkeletonText({ lines = 3, lastLineWidth = '60%', size = 'body', className }: SkeletonTextProps): ReactNode {
  const count = Math.max(1, Math.floor(lines));
  return (
    <span aria-hidden="true" className={cx('itsm-SkeletonText', className)} data-size={size}>
      {Array.from({ length: count }, (_, index) => (
        // The line's height comes from the type style in CSS, so only the width is set here.
        <span
          key={index}
          className="itsm-Skeleton itsm-SkeletonText__line"
          data-radius="sm"
          style={{ inlineSize: index === count - 1 && count > 1 ? lastLineWidth : '100%' }}
        />
      ))}
    </span>
  );
}
