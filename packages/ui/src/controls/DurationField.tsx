'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { joinIds, useIds } from '../a11y/ids.js';
import { formatDuration, parseDuration, type DurationUnit } from '../format/duration.js';
import { formatList } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';
import { Input } from '../web/Input.js';

export interface DurationFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'prefix' | 'min' | 'max' | 'children'
  > {
  /** Minutes, or null when empty. */
  readonly value: number | null;
  /** Minutes once the text reads as an allowed duration; `null` while it is empty or does not. */
  readonly onChange: (value: number | null) => void;
  /** The units a person may type and the value is written back in. Default all three. */
  readonly units?: readonly DurationUnit[];
  /** Says the duration is counted in business hours, not wall-clock time. */
  readonly businessTime?: boolean;
  /** Default 1: a zero-minute target is a mistake, said inline rather than saved. */
  readonly min?: number;
  /** Default 525600 (a year). */
  readonly max?: number;
  readonly size?: Size;
  /** When not inside a `FormField`, which otherwise names it. */
  readonly label?: string;
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
  readonly className?: string;
}

const ALL_UNITS: readonly DurationUnit[] = ['d', 'h', 'm'];
const UNIT_NAMES: Readonly<Record<DurationUnit, string>> = { d: 'days', h: 'hours', m: 'minutes' };
const UNIT_WORDS: Readonly<Record<string, DurationUnit>> = {
  d: 'd',
  day: 'd',
  days: 'd',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
};
/** How long typing must pause before the reading is spoken. */
const SPEAK_AFTER_MS = 700;

/** The units a piece of text is written in ("1:30" is hours and minutes). */
function unitsIn(text: string): Set<DurationUnit> {
  const found = new Set<DurationUnit>();
  if (/\d:\d/.test(text)) {
    found.add('h');
    found.add('m');
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const unit = UNIT_WORDS[word];
    if (unit) found.add(unit);
  }
  return found;
}

/** "Enter a duration like 4h, 1d 2h or 90", with examples in the units allowed. */
function examples(units: readonly DurationUnit[]): string {
  const has = (unit: DurationUnit): boolean => units.includes(unit);
  const list: string[] = [];
  if (has('h')) list.push('4h');
  if (has('d') && has('h')) list.push('1d 2h');
  else if (has('h') && has('m')) list.push('2h 30m');
  else if (has('d') && has('m')) list.push('1d 30m');
  else if (has('d')) list.push('2d');
  const smallest = units[units.length - 1] ?? 'm';
  list.push(smallest === 'm' ? '90' : smallest === 'h' ? '36' : '5');
  // The copy around these is English, so the list is joined the British way (no serial comma).
  return formatList(list, { type: 'disjunction', locale: 'en-GB' });
}

interface Reading {
  readonly minutes: number | null;
  readonly error: string | null;
}

/**
 * A duration typed the way people say it — "4h", "1d 2h", "90" — shown back
 * normalised ("4 h"). Replaces the admin `DurationInput` and its
 * `Number(x) || 60` fallback, which turned a typo into an hour.
 *
 * While the text is not yet in the normal form, the field shows what it reads
 * it as ("= 1 h 30 min") at its end, and a screen reader hears the same once
 * typing pauses. Leaving the field writes the normal form back. Anything it
 * cannot read, a unit that is not allowed, zero, and values out of range are
 * said in words under the field — after the person leaves it, never while
 * they are half-way through typing "1d 2h".
 */
export function DurationField({
  value,
  onChange,
  units = ALL_UNITS,
  businessTime = false,
  min = 1,
  max = 525600,
  size = 'md',
  label,
  invalid,
  className,
  onBlur,
  onFocus,
  ref,
  ...rest
}: DurationFieldProps): ReactNode {
  const locale = useOptionalItsm()?.locale;
  const ids = useIds('itsm-duration', ['error', 'business'] as const);
  const allowed = ALL_UNITS.filter((unit) => units.includes(unit));
  const effective = allowed.length > 0 ? allowed : ALL_UNITS;
  const format = (minutes: number, style: 'short' | 'long' = 'short'): string =>
    formatDuration(minutes, { units: effective, style, ...(locale ? { locale } : {}) });

  const read = (input: string): Reading => {
    const trimmed = input.trim();
    if (trimmed === '') return { minutes: null, error: null };
    const outside = [...unitsIn(trimmed)].filter((unit) => !effective.includes(unit));
    if (outside.length > 0) {
      return { minutes: null, error: `Use ${formatList(effective.map((unit) => UNIT_NAMES[unit]), { locale: 'en-GB' })} only, like ${examples(effective)}.` };
    }
    const minutes = parseDuration(trimmed, { defaultUnit: effective[effective.length - 1] ?? 'm' });
    if (minutes === null) return { minutes: null, error: `Enter a duration like ${examples(effective)}.` };
    if (minutes < min) {
      return { minutes: null, error: min <= 1 ? 'Enter a duration longer than zero.' : `Enter at least ${format(min)}.` };
    }
    if (minutes > max) return { minutes: null, error: `Enter ${format(max)} or less.` };
    return { minutes, error: null };
  };

  const [text, setText] = useState(() => (value === null ? '' : format(value)));
  const [showError, setShowError] = useState(false);
  const [spoken, setSpoken] = useState('');
  const focused = useRef(false);
  const reading = read(text);

  // A value set from outside replaces the text, unless the text already reads as it.
  useEffect(() => {
    setText((current) => {
      const now = read(current).minutes;
      if (now === value) return current;
      return value === null ? '' : format(value);
    });
    // `read` and `format` follow the props they close over.
  }, [value]);

  // Say what the field reads the text as, once typing pauses.
  const canonical = reading.minutes === null ? null : format(reading.minutes);
  const differs = canonical !== null && canonical !== text.trim();
  useEffect(() => {
    if (!focused.current || !differs || reading.minutes === null) {
      setSpoken('');
      return;
    }
    const minutes = reading.minutes;
    const timer = setTimeout(() => setSpoken(`Reads as ${format(minutes, 'long')}`), SPEAK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [text, differs, reading.minutes]);

  const errorShown = showError && reading.error !== null;
  // Always given, even when empty, so the input never moves in or out of the
  // field box (and loses focus) as the reading appears.
  const suffix = (
    <>
      {differs ? (
        <span className="itsm-DurationField__chip" aria-hidden="true">
          {canonical}
        </span>
      ) : null}
      {businessTime ? (
        <span className="itsm-DurationField__business" id={ids.business}>
          Business hours
        </span>
      ) : null}
    </>
  );

  return (
    <div className={cx('itsm-DurationField', className)}>
      <Input
        {...rest}
        ref={ref}
        type="text"
        size={size}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={text}
        invalid={invalid || errorShown}
        {...(label && !rest['aria-label'] ? { 'aria-label': label } : {})}
        aria-describedby={joinIds(rest['aria-describedby'], errorShown && ids.error, businessTime && ids.business)}
        suffix={suffix}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const now = read(next);
          // A fixed mistake stops being reported at once; a new one waits for blur.
          if (now.error === null) setShowError(false);
          if (now.minutes !== value) onChange(now.minutes);
        }}
        onFocus={(event) => {
          focused.current = true;
          onFocus?.(event);
        }}
        onBlur={(event) => {
          focused.current = false;
          setSpoken('');
          const now = read(event.currentTarget.value);
          setShowError(now.error !== null);
          if (now.minutes !== null) setText(format(now.minutes));
          onBlur?.(event);
        }}
      />
      <span className="itsm-visually-hidden" role="status">
        {spoken}
      </span>
      {errorShown ? (
        <span className="itsm-Field__error itsm-DurationField__error" id={ids.error}>
          <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
          <span>{reading.error}</span>
        </span>
      ) : null}
    </div>
  );
}
