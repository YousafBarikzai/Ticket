import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  /** Values at or above which the meter turns warning, then danger. */
  readonly thresholds?: { readonly warning: number; readonly danger: number };
  /** A marked point before the limit (a soft quota: "Warn me at"). */
  readonly softLine?: number;
  /** The limit itself. */
  readonly hardLine?: number;
  /** How the numbers are written: `{ style: 'currency', currency: 'GBP' }`, `{ notation: 'compact' }`. */
  readonly format?: Intl.NumberFormatOptions;
  /** The locale the numbers are written in (the signed-in person's; `en-GB` when not given). */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

export type MeterLevel = 'normal' | 'warning' | 'danger';

/**
 * Which band a value is in. Explicit `thresholds` decide; without them the
 * lines do (at the soft line a warning, at the hard line danger), and a value
 * over `max` is always danger — a bar that is full can no longer show how far
 * over it is, so the colour has to.
 */
export function meterLevel({ value, max, thresholds, softLine, hardLine }: Pick<MeterProps, 'value' | 'max' | 'thresholds' | 'softLine' | 'hardLine'>): MeterLevel {
  if (value > max) return 'danger';
  if (thresholds) {
    if (value >= thresholds.danger) return 'danger';
    if (value >= thresholds.warning) return 'warning';
    return 'normal';
  }
  if (hardLine !== undefined && value >= hardLine) return 'danger';
  if (softLine !== undefined && value >= softLine) return 'warning';
  return 'normal';
}

/** The words for a level, which is never left to colour alone (SPEC §1.1). */
function levelText(level: MeterLevel, value: number, limit: number): string | null {
  if (level === 'normal') return null;
  if (value > limit) return 'Over the limit';
  if (value === limit) return 'Limit reached';
  return level === 'danger' ? 'Almost at the limit' : 'Getting close to the limit';
}

function formatter(locale: string | undefined, format: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale ?? 'en-GB', format);
  } catch {
    // A bad locale or option from data should cost the formatting, not the page.
    return new Intl.NumberFormat('en-GB');
  }
}

/** Position of a value along the bar, 0..1. */
function along(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * A measurement within a known range: plan usage, the monthly AI budget.
 * Server-safe.
 *
 * `role="meter"` named by `label`, with the value written out in words as
 * `aria-valuetext` ("3,200 of 5,000, getting close to the limit") and on screen
 * beside the caption, because a bar alone is read by nobody who cannot see it.
 * The fill turns warning, then danger, and at those levels a short sentence
 * with an icon says so — colour is never the only signal.
 *
 * Soft and hard lines are marks on the bar with a small legend under it
 * ("Warn at 4,000 · Limit 5,000"), so a mark is never a mystery.
 */
export function Meter({
  value,
  max,
  label,
  thresholds,
  softLine,
  hardLine,
  format,
  locale,
  className,
  style,
  ref,
  ...rest
}: MeterProps): ReactNode {
  const numbers = formatter(locale, format);
  const level = meterLevel({ value, max, thresholds, softLine, hardLine });
  const limit = hardLine ?? max;
  const status = levelText(level, value, limit);
  const reading = `${numbers.format(value)} of ${numbers.format(max)}`;
  const lines: { kind: 'soft' | 'hard'; at: number; text: string }[] = [];
  if (softLine !== undefined) lines.push({ kind: 'soft', at: softLine, text: `Warn at ${numbers.format(softLine)}` });
  if (hardLine !== undefined) lines.push({ kind: 'hard', at: hardLine, text: `Limit ${numbers.format(hardLine)}` });
  const spoken = [reading, status?.toLowerCase(), ...lines.map((line) => line.text.toLowerCase())].filter(Boolean).join(', ');

  return (
    <div
      {...rest}
      ref={ref}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      // Held inside the range ARIA allows; the words say how far over it is.
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={spoken}
      className={cx('itsm-Meter', className)}
      data-level={level}
      style={style}
    >
      <span className="itsm-Meter__caption" aria-hidden="true">
        <span className="itsm-Meter__label">{label}</span>
        <span className="itsm-Meter__value">{reading}</span>
      </span>
      <span className="itsm-Meter__track" aria-hidden="true">
        <span className="itsm-Meter__bar">
          <span
            className="itsm-Meter__fill"
            // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
            style={{ '--_itsm-meter': String(along(value, max)) } as CSSProperties}
          />
        </span>
        {lines.map((line) => (
          <span
            key={line.kind}
            className="itsm-Meter__line"
            data-kind={line.kind}
            style={{ insetInlineStart: `${(along(line.at, max) * 100).toFixed(2)}%` }}
          />
        ))}
      </span>
      {status || lines.length > 0 ? (
        <span className="itsm-Meter__footer" aria-hidden="true">
          {status ? (
            <span className="itsm-Meter__status">
              <Icon name={level === 'danger' ? 'circle-alert' : 'triangle-alert'} size="xs" />
              {status}
            </span>
          ) : null}
          {lines.length > 0 ? (
            <span className="itsm-Meter__legend">
              {lines.map((line) => (
                <span key={line.kind} className="itsm-Meter__legendItem" data-kind={line.kind}>
                  {line.text}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
