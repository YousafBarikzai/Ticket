import type { ReactNode } from 'react';
import { formatPercent } from '../format/format.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE } from './scale.js';

export interface ProgressRingProps {
  /** 0..1. */
  readonly value: number;
  readonly label: string;
  readonly size?: 32 | 48 | 64 | 96;
  /**
   * `auto` goes from accent to warning (from 75 %) to danger (from 90 %) as
   * the value rises, for time used against a limit. `neutral` is for a
   * stopped clock.
   */
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger' | 'auto' | 'neutral';
  /** A few characters in the middle ("62%", "2 h"). Visual only: the label and value are the ring's name. */
  readonly centerText?: string;
  /** For the percentage in the name. Default `en-GB`. */
  readonly locale?: string;
  readonly className?: string;
}

/** Stroke per size: thick enough to read at 32 px, never heavy at 96. */
const STROKE: Readonly<Record<NonNullable<ProgressRingProps['size']>, number>> = { 32: 3, 48: 4, 64: 5, 96: 7 };

/** The tone `auto` resolves to for a value. */
export function ringTone(value: number): 'accent' | 'warning' | 'danger' {
  if (value >= 0.9) return 'danger';
  if (value >= 0.75) return 'warning';
  return 'accent';
}

/**
 * A fraction as a ring: SLA time used, attainment. Server-safe static SVG.
 *
 * An image whose name states the value ("SLA time used: 62%"), so the ring is
 * never the only way to the number. The arc starts at twelve o'clock and runs
 * clockwise with round ends, on a track in the same weight; it moves to a new
 * value in `normal` time, and not at all under reduced motion.
 */
export function ProgressRing({ value, label, size = 48, tone = 'accent', centerText, locale = DEFAULT_LOCALE, className }: ProgressRingProps): ReactNode {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const resolved = tone === 'auto' ? ringTone(clamped) : tone;
  const stroke = STROKE[size] ?? 4;
  const centre = size / 2;
  const radius = (size - stroke) / 2;
  return (
    <span
      role="img"
      aria-label={`${label}: ${formatPercent(clamped, { locale })}`}
      className={cx('itsm-ProgressRing', className)}
      data-size={size}
      data-tone={resolved}
      style={{ ['--_itsm-ring-size' as string]: `${size}px` }}
    >
      <svg className="itsm-ProgressRing__svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="itsm-ProgressRing__track" cx={centre} cy={centre} r={radius} strokeWidth={stroke} />
        {clamped > 0 ? (
          <circle
            className="itsm-ProgressRing__arc"
            cx={centre}
            cy={centre}
            r={radius}
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray={`${Math.round(clamped * 1000) / 10} 100`}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        ) : null}
      </svg>
      {centerText ? <span className="itsm-ProgressRing__text">{centerText}</span> : null}
    </span>
  );
}
