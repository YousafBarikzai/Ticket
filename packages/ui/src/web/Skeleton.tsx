import type { ReactNode } from 'react';
import { cx } from './cx.js';

export interface SkeletonProps {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly radius?: 'sm' | 'md' | 'pill';
  readonly className?: string;
}

/**
 * A loading placeholder. Always `aria-hidden`: the shape means nothing to a
 * screen reader, and the surrounding region carries `aria-busy` instead, so the
 * user hears "loading" once rather than a stream of empty boxes.
 */
export function Skeleton({ width = '100%', height = 16, radius = 'sm', className }: SkeletonProps): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx('itsm-Skeleton', className)}
      style={{ inlineSize: width, blockSize: height, borderRadius: `var(--itsm-radius-${radius})` }}
    />
  );
}

export interface SkeletonTextProps {
  readonly lines?: number;
  readonly className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps): ReactNode {
  return (
    <span className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--itsm-space-2xs)' }}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}
