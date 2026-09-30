'use client';

import { useEffect, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { joinIds, useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';
import { useFieldControl } from '../web/FormField.js';
import { Input } from '../web/Input.js';

export interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'size' | 'prefix' | 'children'
  > {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly min?: number;
  readonly max?: number;
  /** The amount − and + (and the arrow keys) move by. Default 1. */
  readonly step?: number;
  /** Shown after the value, e.g. "%" or "tickets", and read as the field's description. */
  readonly unit?: string;
  /** When not inside a `FormField`, which otherwise names it. */
  readonly label?: string;
  readonly size?: Size;
  /** The stepper buttons' names. Default "Decrease" and "Increase", followed by the label when there is one. */
  readonly decrementLabel?: string;
  readonly incrementLabel?: string;
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
  readonly className?: string;
}

function decimalsOf(n: number): number {
  const text = String(n);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let next = n;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

function parse(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * A number, typed or stepped: a native `type=number` (so assistive technology
 * meets a spinbutton, and the arrow keys step it) with the browser's tiny
 * spinners hidden and a pair of real − / + buttons beside it.
 *
 * The buttons are out of the tab order — the field already steps with the
 * arrow keys, and two extra tab stops per number would slow every form — but
 * they are named, so pointer, touch and voice-control users can use them.
 * Page Up and Page Down step ten at a time; Home and End go to the bounds.
 *
 * Typing is reported as it happens, unclamped, so a half-typed "1" on the way
 * to "12" is never corrected under the person's fingers; the value is pulled
 * into range when they leave the field.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  label,
  size = 'md',
  decrementLabel,
  incrementLabel,
  invalid,
  disabled,
  readOnly,
  className,
  onBlur,
  onKeyDown,
  ref,
  ...rest
}: NumberFieldProps): ReactNode {
  const field = useFieldControl();
  const fallbackId = useStableId('itsm-number');
  const unitId = useStableId('itsm-number-unit');
  const inputId = rest.id ?? field?.id ?? fallbackId;
  const [text, setText] = useState(value === null ? '' : String(value));

  // A value set from outside replaces the text, unless the text already says it ("1.0" and 1).
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : value === null ? '' : String(value)));
  }, [value]);

  const precision = Math.max(decimalsOf(step), value === null ? 0 : decimalsOf(value));
  const round = (n: number): number => Number(n.toFixed(Math.min(precision, 10)));

  const set = (next: number | null): void => {
    setText(next === null ? '' : String(next));
    if (next !== value) onChange(next);
  };

  const stepBy = (count: number): void => {
    if (disabled || readOnly) return;
    const base = value ?? clamp(0, min, max);
    set(clamp(round(value === null ? base : base + count * step), min, max));
  };

  const atMin = value !== null && min !== undefined && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;
  const name = label ? ` ${label}` : '';

  return (
    <span className={cx('itsm-NumberField', `itsm-NumberField--${size}`, className)}>
      <Input
        {...rest}
        ref={ref}
        id={inputId}
        type="number"
        size={size}
        inputMode={Number.isInteger(step) && (min === undefined || min >= 0) ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
        invalid={invalid}
        aria-label={field ? rest['aria-label'] : (rest['aria-label'] ?? label)}
        aria-describedby={joinIds(rest['aria-describedby'], unit && unitId)}
        className="itsm-NumberField__field"
        value={text}
        suffix={unit ? <span id={unitId}>{unit}</span> : undefined}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setText(raw);
          const next = parse(raw);
          if (next !== value) onChange(next);
        }}
        onBlur={(event) => {
          const parsed = parse(event.currentTarget.value);
          if (parsed !== null) {
            const next = clamp(parsed, min, max);
            set(next);
          }
          onBlur?.(event);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            stepBy(event.key === 'PageUp' ? 10 : -10);
          } else if (event.key === 'Home' && min !== undefined) {
            event.preventDefault();
            set(min);
          } else if (event.key === 'End' && max !== undefined) {
            event.preventDefault();
            set(max);
          }
        }}
      />
      <span className="itsm-NumberField__steppers">
        <button
          type="button"
          tabIndex={-1}
          className="itsm-NumberField__step"
          aria-label={`${decrementLabel ?? 'Decrease'}${decrementLabel ? '' : name}`}
          aria-controls={inputId}
          disabled={disabled || readOnly || atMin}
          onClick={() => stepBy(-1)}
        >
          <Icon name="minus" size="sm" />
        </button>
        <span className="itsm-NumberField__divider" aria-hidden="true" />
        <button
          type="button"
          tabIndex={-1}
          className="itsm-NumberField__step"
          aria-label={`${incrementLabel ?? 'Increase'}${incrementLabel ? '' : name}`}
          aria-controls={inputId}
          disabled={disabled || readOnly || atMax}
          onClick={() => stepBy(1)}
        >
          <Icon name="plus" size="sm" />
        </button>
      </span>
    </span>
  );
}
