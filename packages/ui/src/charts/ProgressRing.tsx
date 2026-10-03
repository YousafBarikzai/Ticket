import type { ReactNode } from 'react';
import { formatPercent } from '../format/format.js';
import { cx } from '../web/cx.js';
import { DEFAULT_LOCALE } from './scale.js';

export interface ProgressRingProps {
  /** 0..1. */
  readonly value: number;
  readonly label: string;
  /** 140 is the war room's ring: a 12 px stroke and the stat numeral in the middle. */
  readonly size?: 32 | 48 | 64 | 96 | 140;
  /** A fraction of 1, drawn as a tick across the ring (A8 §4.7) and named: "Updates on time: 15%, target 17%". */
  readonly target?: number;
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
const STROKE: Readonly<Record<NonNullable<ProgressRingProps['size']>, number>> = { 32: 3, 48: 4, 64: 5, 96: 7, 140: 12 };

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
 * value in `normal` time, and not at all under reduced motion. A `target` is
 * a 2 px tick in the marker navy across the ring, and part of its name.
 */
export function ProgressRing({ value, label, size = 48, target, tone = 'accent', centerText, locale = DEFAULT_LOCALE, className }: ProgressRingProps): ReactNode {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const resolved = tone === 'auto' ? ringTone(clamped) : tone;
  const stroke = STROKE[size] ?? 4;
  const centre = size / 2;
  const radius = (size - stroke) / 2;
  const goal = target !== undefined && Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : undefined;
  // The tick runs across the stroke and 2 px past it each side, at the target's angle from twelve o'clock.
  const tick =
    goal === undefined
      ? null
      : [radius - stroke / 2 - 2, radius + stroke / 2 + 2].map((r) => {
          const angle = goal * 2 * Math.PI;
          return [Math.round((centre + r * Math.sin(angle)) * 100) / 100, Math.round((centre - r * Math.cos(angle)) * 100) / 100] as const;
        });
  return (
    <span
      role="img"
      aria-label={`${label}: ${formatPercent(clamped, { locale })}${goal === undefined ? '' : `, target ${formatPercent(goal, { locale })}`}`}
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
        {tick ? <line className="itsm-ProgressRing__target" x1={tick[0]![0]} y1={tick[0]![1]} x2={tick[1]![0]} y2={tick[1]![1]} /> : null}
      </svg>
      {centerText ? <span className="itsm-ProgressRing__text">{centerText}</span> : null}
    </span>
  );
}
