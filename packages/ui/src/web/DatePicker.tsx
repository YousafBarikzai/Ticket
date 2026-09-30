'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../icons/Icon.js';
import {
  datePattern,
  displayIsoDate,
  formatIsoDate,
  formatLocaleDate,
  parseIsoDate,
  parseLocaleDate,
  todayUtc,
} from '../overlays/calendar-dates.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Size } from '../types.js';
import { cx } from './cx.js';
import { mergeFieldProps, useFieldControl } from './FormField.js';
import { useEscapeBeforeLayer, usePopoverLayer } from './popover-layer.js';
import { useMergedRefs } from './refs.js';

export { formatIsoDate, parseIsoDate } from '../overlays/calendar-dates.js';

export interface DatePickerProps {
  /** ISO calendar date, or null when empty. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly id?: string;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** BCP-47 tag; drives how dates are typed and shown, and month and weekday names. Defaults to the provider's. */
  readonly locale?: string;
  /** 0 Sunday, 1 Monday. Defaults to the locale's. */
  readonly weekStartsOn?: 0 | 1;
  /** Named shortcuts beside the calendar ("Today", "End of the month"). */
  readonly presets?: readonly { readonly label: string; readonly value: string }[];
  /** Defaults to the locale's pattern, "dd/mm/yyyy". */
  readonly placeholder?: string;
  readonly size?: Size;
  readonly className?: string;
  readonly ref?: Ref<HTMLInputElement>;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
}

/** Whether typed text already says which year it means, so it can be taken as the person types. */
function hasYear(text: string): boolean {
  return /\d{4}/.test(text) || text.trim().split(/[\s/.,\-]+/).filter(Boolean).length === 3;
}

/**
 * A date field with a calendar beside it.
 *
 * The text field is the primary input — typing is faster than any grid and is
 * the only route that works with voice control — and it reads dates the way
 * the person's locale writes them (`14/03/2026`, `14 Mar 2026`, or ISO), then
 * shows them back in the locale's medium style once they leave the field.
 * What is exchanged is always an ISO calendar date. Text that is not one real
 * day is kept as typed, marked invalid, and reported as no date — never
 * silently guessed.
 *
 * The calendar is an aid, in a Radix popover anchored to the field: a
 * `dialog` holding a keyboard grid (`Calendar`), with presets when given,
 * opened by the calendar button or Alt+↓, closed by Escape (as the top
 * layer, so the dialog around it stays open), and focus back on the button
 * either way (SC 2.1.2, 2.4.3). The popover and the calendar arrive after
 * the field (`popover-layer.ts`), fetched when the field or the button takes
 * focus or the pointer reaches the button, so a form with a date in it does
 * not carry them in its first load; a calendar asked for before they land
 * opens as soon as they do.
 */
export function DatePicker({
  value,
  onChange,
  id,
  min,
  max,
  disabled = false,
  required = false,
  locale: localeProp,
  weekStartsOn,
  presets,
  placeholder,
  size = 'md',
  className,
  ref,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: DatePickerProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = localeProp ?? itsm?.locale ?? 'en-GB';
  const field = useFieldControl();
  const wired = mergeFieldProps(field, { id, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, required });

  const [text, setText] = useState(() => displayIsoDate(value, locale));
  const [editing, setEditing] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [open, setOpen] = useState(false);
  const [focusedDate, setFocusedDate] = useState<Date>(() => parseIsoDate(value) ?? todayUtc());
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref, inputRef);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popoverId = `${useId()}-calendar`;
  const showing = open && !disabled;
  const { layer, preload } = usePopoverLayer(showing);

  // The field follows the value when it changes from outside — not while the
  // person is typing, and not for a change this field made itself (its text
  // already says it, including text kept because it could not be read).
  const own = useRef<{ readonly value: string | null } | null>(null);
  const seen = useRef({ value, locale });
  useEffect(() => {
    if (seen.current.value === value && seen.current.locale === locale) return;
    seen.current = { value, locale };
    if (own.current && own.current.value === value) {
      own.current = null;
      return;
    }
    own.current = null;
    if (editing) return;
    setText(displayIsoDate(value, locale));
    setUnreadable(false);
  }, [value, locale, editing]);

  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const outOfRange = (date: Date): boolean =>
    (minDate !== null && date.getTime() < minDate.getTime()) || (maxDate !== null && date.getTime() > maxDate.getTime());

  const publish = (next: string | null): void => {
    if (next === value) return;
    own.current = { value: next };
    onChange(next);
  };

  /** Reads what is in the field as final: on leaving it, or on Enter. */
  const settle = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setUnreadable(false);
      publish(null);
      return;
    }
    const parsed = parseLocaleDate(trimmed, locale);
    if (parsed && !outOfRange(parsed)) {
      setUnreadable(false);
      setText(formatLocaleDate(parsed, locale));
      publish(formatIsoDate(parsed));
    } else {
      setUnreadable(true);
      publish(null);
    }
  };

  const setOpenState = (next: boolean): void => {
    if (next) {
      setFocusedDate(parseIsoDate(value) ?? todayUtc());
      setFocusRequest((count) => count + 1);
      setOpen(true);
      return;
    }
    // Back to the button, in the same frame, when focus was in the calendar.
    if (popoverRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    setOpen(false);
  };

  const commit = (date: Date): void => {
    if (outOfRange(date)) return;
    setUnreadable(false);
    setText(formatLocaleDate(date, locale));
    publish(formatIsoDate(date));
    toggleRef.current?.focus();
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      setOpenState(true);
    } else if (event.key === 'Enter') {
      settle();
    }
  };

  // The calendar is wanted and its layer is still on its way: Escape is still the calendar's.
  useEscapeBeforeLayer(
    showing && !layer,
    (target) => target === inputRef.current || target === toggleRef.current,
    () => setOpen(false),
  );

  const invalid = wired['aria-invalid'] === true || unreadable;

  return (
    <>
      <div
        ref={anchorRef}
        className={cx('itsm-InputGroup', 'itsm-DatePicker', size !== 'md' && `itsm-InputGroup--${size}`, className)}
        data-disabled={disabled ? '' : undefined}
        data-invalid={invalid ? '' : undefined}
      >
        <input
          ref={mergedRef}
          id={wired.id}
          className="itsm-InputGroup__input itsm-DatePicker__input"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? datePattern(locale)}
          disabled={disabled}
          required={wired.required}
          aria-required={wired.required || undefined}
          aria-describedby={wired['aria-describedby']}
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          value={text}
          onFocus={() => {
            setEditing(true);
            preload();
          }}
          onBlur={() => {
            setEditing(false);
            settle();
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            setUnreadable(false);
            if (next.trim() === '') {
              publish(null);
              return;
            }
            // A complete date is taken as it is typed; one without a year
            // waits until the field is left, when "14/3" means this year.
            if (!hasYear(next)) return;
            const parsed = parseLocaleDate(next, locale);
            if (parsed && !outOfRange(parsed)) {
              publish(formatIsoDate(parsed));
              setFocusedDate(parsed);
            }
          }}
          onKeyDown={onKeyDown}
        />
        <button
          ref={toggleRef}
          type="button"
          className="itsm-DatePicker__toggle"
          aria-label="Choose date"
          aria-haspopup="dialog"
          aria-expanded={showing}
          aria-controls={showing && layer ? popoverId : undefined}
          data-state={showing ? 'open' : 'closed'}
          disabled={disabled}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') preload();
          }}
          onFocus={preload}
          onClick={() => setOpenState(!open)}
        >
          <Icon name="calendar" size="sm" />
        </button>
      </div>
      {layer ? (
        <layer.PopoverLayer
          open={showing}
          onOpenChange={setOpenState}
          anchorRef={anchorRef}
          ref={popoverRef}
          id={popoverId}
          className="itsm-DatePicker__popover"
          aria-label="Choose date"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // A press on the button toggles the calendar itself; it is not "outside".
            if (event.target instanceof Node && toggleRef.current?.contains(event.target)) event.preventDefault();
          }}
        >
          {presets && presets.length > 0 ? (
            <div className="itsm-DatePicker__presets" role="group" aria-label="Quick picks">
              {presets.map((preset) => {
                const date = parseIsoDate(preset.value);
                const unavailable = !date || outOfRange(date);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className="itsm-DatePicker__preset"
                    aria-pressed={preset.value === value}
                    disabled={unavailable}
                    onClick={() => date && commit(date)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <layer.Calendar
            focusedDate={focusedDate}
            onFocusedDateChange={setFocusedDate}
            onSelect={commit}
            mark={(date) => (value === formatIsoDate(date) ? 'single' : null)}
            isDisabled={outOfRange}
            locale={locale}
            weekStartsOn={weekStartsOn}
            focusRequest={focusRequest}
          />
        </layer.PopoverLayer>
      ) : null}
    </>
  );
}
