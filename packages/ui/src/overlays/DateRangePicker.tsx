'use client';

import * as RadixPopover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Size } from '../types.js';
import { cx } from '../web/cx.js';
import { Calendar, type DayMark } from './Calendar.js';
import { datePattern, displayIsoDate, formatIsoDate, formatLocaleDate, parseIsoDate, parseLocaleDate, sameDay, todayUtc } from './calendar-dates.js';

/** A span of ISO calendar dates, both ends inclusive. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** A named shortcut ("Last 7 days"): one date for `DatePicker`, a range for `DateRangePicker`. */
export interface DatePreset {
  readonly label: string;
  readonly value: string | DateRange;
}

export interface DateRangePickerProps {
  readonly value: DateRange | null;
  readonly onChange: (value: DateRange | null) => void;
  readonly presets?: readonly DatePreset[];
  /** The group's name. Default "Date range". */
  readonly label?: string;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  /** Defaults to the provider's. */
  readonly locale?: string;
  readonly weekStartsOn?: 0 | 1;
  readonly size?: Size;
  readonly className?: string;
}

function ordered(a: Date, b: Date): readonly [Date, Date] {
  return a.getTime() <= b.getTime() ? [a, b] : [b, a];
}

function rangeOf(preset: DatePreset): DateRange {
  return typeof preset.value === 'string' ? { from: preset.value, to: preset.value } : preset.value;
}

/**
 * Two dates, typed or picked on one calendar, with presets.
 *
 * The fields come first: "From" and "To" in one box, read in the locale's way
 * of writing a date (like `DatePicker`), published once both are real days,
 * in order. The calendar button opens presets and a month grid in a Radix
 * popover: the first day chosen anchors the range, the pointer previews it,
 * the second day completes it (either order). A short line under the grid
 * says which end is being chosen, politely announced. A preset applies at
 * once. Escape closes the popover and focus returns to the button.
 */
export function DateRangePicker({
  value,
  onChange,
  presets,
  label = 'Date range',
  min,
  max,
  disabled = false,
  locale: localeProp,
  weekStartsOn,
  size = 'md',
  className,
}: DateRangePickerProps): ReactNode {
  const itsm = useOptionalItsm();
  const locale = localeProp ?? itsm?.locale ?? 'en-GB';
  const id = useId();
  const [fromText, setFromText] = useState(() => displayIsoDate(value?.from, locale));
  const [toText, setToText] = useState(() => displayIsoDate(value?.to, locale));
  const [editing, setEditing] = useState(false);
  const [unreadable, setUnreadable] = useState<{ from: boolean; to: boolean }>({ from: false, to: false });
  const [open, setOpen] = useState(false);
  const [focusedDate, setFocusedDate] = useState<Date>(() => parseIsoDate(value?.from) ?? todayUtc());
  const [focusRequest, setFocusRequest] = useState(0);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // The fields follow the value when it changes from outside — not while the
  // person is typing, and not for a change these fields made themselves.
  const key = value ? `${value.from}/${value.to}` : '';
  const own = useRef<string | null>(null);
  const seen = useRef({ key, locale });
  useEffect(() => {
    if (seen.current.key === key && seen.current.locale === locale) return;
    seen.current = { key, locale };
    if (own.current === key) {
      own.current = null;
      return;
    }
    own.current = null;
    if (editing) return;
    setFromText(displayIsoDate(value?.from, locale));
    setToText(displayIsoDate(value?.to, locale));
    setUnreadable({ from: false, to: false });
  }, [key, locale, editing, value?.from, value?.to]);

  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const outOfRange = (date: Date): boolean =>
    (minDate !== null && date.getTime() < minDate.getTime()) || (maxDate !== null && date.getTime() > maxDate.getTime());

  const publish = (next: DateRange | null): void => {
    if (next?.from === value?.from && next?.to === value?.to) return;
    own.current = next ? `${next.from}/${next.to}` : '';
    onChange(next);
  };

  const read = (text: string): Date | null | 'empty' => {
    if (text.trim() === '') return 'empty';
    const parsed = parseLocaleDate(text, locale);
    return parsed && !outOfRange(parsed) ? parsed : null;
  };

  /** Takes both fields as final once focus has left the pair. */
  const settle = (): void => {
    const from = read(fromText);
    const to = read(toText);
    if (from === 'empty' && to === 'empty') {
      setUnreadable({ from: false, to: false });
      publish(null);
      return;
    }
    if (from instanceof Date && to instanceof Date) {
      const [start, end] = ordered(from, to);
      setUnreadable({ from: false, to: false });
      setFromText(formatLocaleDate(start, locale));
      setToText(formatLocaleDate(end, locale));
      publish({ from: formatIsoDate(start), to: formatIsoDate(end) });
      return;
    }
    setUnreadable({ from: !(from instanceof Date), to: !(to instanceof Date) });
  };

  const setOpenState = (next: boolean): void => {
    if (next) {
      setFocusedDate(parseIsoDate(value?.from) ?? todayUtc());
      setFocusRequest((count) => count + 1);
      setAnchor(null);
      setHover(null);
      setOpen(true);
      return;
    }
    if (popoverRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    setOpen(false);
  };

  const commit = (range: DateRange): void => {
    setUnreadable({ from: false, to: false });
    const from = parseIsoDate(range.from);
    const to = parseIsoDate(range.to);
    setFromText(from ? formatLocaleDate(from, locale) : '');
    setToText(to ? formatLocaleDate(to, locale) : '');
    publish(range);
    toggleRef.current?.focus();
    setOpen(false);
  };

  const onSelect = (date: Date): void => {
    if (outOfRange(date)) return;
    if (!anchor) {
      setAnchor(date);
      return;
    }
    const [start, end] = ordered(anchor, date);
    setAnchor(null);
    commit({ from: formatIsoDate(start), to: formatIsoDate(end) });
  };

  const mark = (date: Date): DayMark => {
    let start: Date | null = null;
    let end: Date | null = null;
    if (anchor) {
      // The range as it would be: to the day under the pointer, or under the keyboard cursor.
      [start, end] = ordered(anchor, hover ?? focusedDate);
    } else if (value) {
      start = parseIsoDate(value.from);
      end = parseIsoDate(value.to);
    }
    if (!start || !end) return null;
    if (sameDay(start, end)) return sameDay(date, start) ? 'single' : null;
    if (sameDay(date, start)) return 'start';
    if (sameDay(date, end)) return 'end';
    return date.getTime() > start.getTime() && date.getTime() < end.getTime() ? 'middle' : null;
  };

  const onFieldChange = (which: 'from' | 'to', text: string): void => {
    if (which === 'from') setFromText(text);
    else setToText(text);
    setUnreadable((current) => ({ ...current, [which]: false }));
    const from = read(which === 'from' ? text : fromText);
    const to = read(which === 'to' ? text : toText);
    // Both ends real days, written out with a year: take it as typed.
    const complete = /\d{4}/.test(which === 'from' ? text : fromText) && /\d{4}/.test(which === 'to' ? text : toText);
    if (complete && from instanceof Date && to instanceof Date) {
      const [start, end] = ordered(from, to);
      publish({ from: formatIsoDate(start), to: formatIsoDate(end) });
    }
  };

  const onGroupBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (groupRef.current?.contains(next) || popoverRef.current?.contains(next))) return;
    setEditing(false);
    settle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      setOpenState(true);
    } else if (event.key === 'Enter') {
      settle();
    }
  };

  const placeholder = datePattern(locale);
  const hint = anchor ? 'Now choose the last day' : 'Choose the first day';

  return (
    <RadixPopover.Root open={open && !disabled} onOpenChange={setOpenState}>
      <RadixPopover.Anchor asChild>
        <div
          ref={groupRef}
          role="group"
          aria-label={label}
          className={cx('itsm-InputGroup', 'itsm-DateRangePicker', size !== 'md' && `itsm-InputGroup--${size}`, className)}
          data-disabled={disabled ? '' : undefined}
          data-invalid={unreadable.from || unreadable.to ? '' : undefined}
          onFocus={() => setEditing(true)}
          onBlur={onGroupBlur}
        >
          <input
            id={`${id}-from`}
            className="itsm-InputGroup__input itsm-DateRangePicker__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="From"
            aria-invalid={unreadable.from || undefined}
            placeholder={placeholder}
            disabled={disabled}
            value={fromText}
            onChange={(event) => onFieldChange('from', event.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="itsm-DateRangePicker__dash" aria-hidden="true">
            –
          </span>
          <input
            id={`${id}-to`}
            className="itsm-InputGroup__input itsm-DateRangePicker__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="To"
            aria-invalid={unreadable.to || undefined}
            placeholder={placeholder}
            disabled={disabled}
            value={toText}
            onChange={(event) => onFieldChange('to', event.target.value)}
            onKeyDown={onKeyDown}
          />
          <RadixPopover.Trigger asChild>
            <button ref={toggleRef} type="button" className="itsm-DatePicker__toggle" aria-label="Choose dates" disabled={disabled}>
              <Icon name="calendar" size="sm" />
            </button>
          </RadixPopover.Trigger>
        </div>
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          ref={popoverRef}
          className="itsm-DatePicker__popover itsm-DateRangePicker__popover"
          aria-label="Choose dates"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {presets && presets.length > 0 ? (
            <div className="itsm-DatePicker__presets" role="group" aria-label="Quick picks">
              {presets.map((preset) => {
                const range = rangeOf(preset);
                const from = parseIsoDate(range.from);
                const to = parseIsoDate(range.to);
                const unavailable = !from || !to || outOfRange(from) || outOfRange(to);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className="itsm-DatePicker__preset"
                    aria-pressed={range.from === value?.from && range.to === value?.to}
                    disabled={unavailable}
                    onClick={() => commit(range)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="itsm-DateRangePicker__calendar">
            <Calendar
              focusedDate={focusedDate}
              onFocusedDateChange={setFocusedDate}
              onSelect={onSelect}
              onHover={anchor ? setHover : undefined}
              mark={mark}
              isDisabled={outOfRange}
              locale={locale}
              weekStartsOn={weekStartsOn}
              focusRequest={focusRequest}
            />
            <p className="itsm-Calendar__hint" aria-live="polite">
              {hint}
            </p>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
