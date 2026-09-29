import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface ProgressRingProps {
  /** 0..1. */
  readonly value: number;
  readonly label: string;
  readonly size?: 32 | 48 | 64 | 96;
  /** `auto` goes from accent to warning to danger as the value rises. */
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger' | 'auto';
  readonly centerText?: string;
  readonly className?: string;
}

/**
 * A fraction as a ring. Server-safe static SVG.
 *
 * Stub (SPEC §4.8): renders the labelled image frame; the charts package draws the ring.
 */
export function ProgressRing({ label, size = 48, tone = 'accent', className }: ProgressRingProps): ReactNode {
  return (
    <svg
      role="img"
      aria-label={label}
      className={cx('itsm-ProgressRing', className)}
      data-tone={tone}
      width={size}
      height={size}
      viewBox="0 0 48 48"
    />
  );
}
