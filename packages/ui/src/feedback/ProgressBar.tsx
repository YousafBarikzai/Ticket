import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  /** 0..1; absent for indeterminate. Values outside the range are clamped. */
  readonly value?: number;
  /** What is progressing: its accessible name, and the visible caption unless `labelHidden`. */
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** `md` a 4 px bar with its caption; `sm` the 2 px line along a region's top edge while it refetches. */
  readonly size?: 'sm' | 'md';
  /** Shows the percentage beside the caption. */
  readonly showValue?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/** Clamps to 0..1; `NaN` counts as nothing done rather than breaking the bar. */
function fraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Progress of a known or unknown length. Server-safe.
 *
 * A `progressbar` named by `label`, with `aria-valuenow` in percent when the
 * length is known and no value at all when it is not — which is how a screen
 * reader knows to say "busy" rather than "0 percent". The caption and
 * percentage are drawn inside the element, where the role makes them
 * presentational, so assistive technology reads the name and value once.
 *
 * The fill moves with `transform` only (SPEC §3.7): a determinate bar is a
 * full-width fill slid back by the part not yet done, so its rounded end
 * keeps its shape at every value and a change of value animates on the
 * compositor. An indeterminate bar sweeps a segment across; under reduced
 * motion it holds still and pulses instead.
 *
 * `size="sm"` is the refetch line (SPEC §1.10): 2 px, no track, label hidden
 * and indeterminate — the way a region says "updating" without dimming what
 * it shows.
 */
export function ProgressBar({
  value,
  label,
  labelHidden = false,
  tone = 'accent',
  size = 'md',
  showValue = false,
  className,
  style,
  ref,
  ...rest
}: ProgressBarProps): ReactNode {
  const known = typeof value === 'number';
  const done = known ? fraction(value) : 0;
  const percent = Math.round(done * 100);
  const caption = !labelHidden || (showValue && known);

  return (
    <div
      {...rest}
      ref={ref}
      role="progressbar"
      aria-label={label}
      {...(known ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': `${percent}%` } : {})}
      className={cx('itsm-ProgressBar', className)}
      data-tone={tone}
      data-size={size}
      data-state={known ? 'determinate' : 'indeterminate'}
      style={style}
    >
      {caption ? (
        <span className="itsm-ProgressBar__caption" aria-hidden="true">
          {labelHidden ? null : <span className="itsm-ProgressBar__label">{label}</span>}
          {showValue && known ? <span className="itsm-ProgressBar__value">{`${percent}%`}</span> : null}
        </span>
      ) : null}
      <span className="itsm-ProgressBar__track" aria-hidden="true">
        <span
          className="itsm-ProgressBar__fill"
          // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
          style={known ? ({ '--_itsm-progress': String(done) } as CSSProperties) : undefined}
        />
      </span>
    </div>
  );
}
