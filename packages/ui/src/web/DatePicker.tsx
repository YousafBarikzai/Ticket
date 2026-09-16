'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.js';
import { useStableId } from '../a11y/ids.js';
import { IconButton } from './IconButton.js';

/**
 * Date helpers.
 *
 * Everything is computed in UTC and exchanged as an ISO calendar date
 * (`yyyy-mm-dd`). A local-time `Date` shifts by a day either side of midnight
 * for users east or west of the server, which is how "due tomorrow" tickets end
 * up breaching a day early.
 */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface DatePickerProps {
  /** ISO calendar date, or null when empty. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly id?: string;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** BCP-47 tag; drives month and weekday names, and the first day of the week. */
  readonly locale?: string;
  readonly weekStartsOn?: 0 | 1;
  readonly className?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-label'?: string;
}

/**
 * A text field plus a calendar.
 *
 * The text field is the primary input — typing `2026-03-14` is faster than any
 * grid, and it is the only route that works with voice control. The calendar is
 * an optional aid: a `dialog` containing a `grid`, with one tab stop, arrow
 * keys between days, PageUp/PageDown between months, Escape to dismiss, and
 * focus returned to the toggle either way (SC 2.1.2, 2.4.3).
 */
export function DatePicker({
  value,
  onChange,
  id,
  min,
  max,
  disabled = false,
  required = false,
  locale = 'en-GB',
  weekStartsOn = 1,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
}: DatePickerProps): ReactNode {
  const generatedId = useStableId('itsm-datepicker');
  const inputId = id ?? generatedId;
  const dialogId = `${generatedId}-dialog`;
  const captionId = `${generatedId}-caption`;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const selected = parseIsoDate(value);
  const [focusedDate, setFocusedDate] = useState<Date>(() => selected ?? todayUtc());
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);

  useEffect(() => setText(value ?? ''), [value]);

  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const isOutOfRange = (date: Date): boolean =>
    (minDate !== null && date.getTime() < minDate.getTime()) || (maxDate !== null && date.getTime() > maxDate.getTime());

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const weekdayNames = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    // 2024-01-01 was a Monday, which gives a stable anchor for any week start.
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + ((index + (weekStartsOn === 1 ? 0 : 6)) % 7)));
      return { short: short.format(date), long: long.format(date) };
    });
  }, [locale, weekStartsOn]);

  const weeks = useMemo(() => {
    const first = startOfMonth(focusedDate);
    const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
  }, [focusedDate, weekStartsOn]);

  // Moving the focused date moves DOM focus with it, so the screen reader
  // follows the caret through the grid.
  useEffect(() => {
    if (!open) return;
    const iso = formatIsoDate(focusedDate);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${iso}"]`)?.focus();
  }, [open, focusedDate]);

  const closeAndReturnFocus = (): void => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const commit = (date: Date): void => {
    if (isOutOfRange(date)) return;
    onChange(formatIsoDate(date));
    closeAndReturnFocus();
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    let next: Date | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = addDays(focusedDate, 1);
        break;
      case 'ArrowLeft':
        next = addDays(focusedDate, -1);
        break;
      case 'ArrowDown':
        next = addDays(focusedDate, 7);
        break;
      case 'ArrowUp':
        next = addDays(focusedDate, -7);
        break;
      case 'Home':
        next = addDays(focusedDate, -((focusedDate.getUTCDay() - weekStartsOn + 7) % 7));
        break;
      case 'End':
        next = addDays(focusedDate, 6 - ((focusedDate.getUTCDay() - weekStartsOn + 7) % 7));
        break;
      case 'PageUp':
        next = addMonths(focusedDate, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(focusedDate, event.shiftKey ? 12 : 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeAndReturnFocus();
        return;
      default:
        return;
    }
    event.preventDefault();
    setFocusedDate(next);
  };

  return (
    <div className={cx('itsm-DatePicker', className)}>
      <input
        id={inputId}
        className="itsm-Input"
        type="text"
        inputMode="numeric"
        placeholder="yyyy-mm-dd"
        autoComplete="off"
        disabled={disabled}
        required={required}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseIsoDate(event.target.value);
          // Only publish a complete, in-range date: half-typed text must not
          // clear a field the user has not finished editing.
          if (parsed && !isOutOfRange(parsed)) {
            onChange(formatIsoDate(parsed));
            setFocusedDate(parsed);
          } else if (event.target.value === '') {
            onChange(null);
          }
        }}
      />
      <IconButton
        ref={toggleRef}
        size="sm"
        label={open ? 'Close calendar' : 'Choose date from calendar'}
        icon="📅"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setFocusedDate(parseIsoDate(value) ?? todayUtc());
          setOpen((current) => !current);
        }}
      />
      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={captionId}
          className="itsm-DatePicker__panel"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <div className="itsm-DatePicker__header">
            <IconButton
              size="sm"
              label="Previous month"
              icon="‹"
              onClick={() => setFocusedDate(addMonths(focusedDate, -1))}
            />
            {/* aria-live so that changing month is announced without moving focus. */}
            <span className="itsm-DatePicker__month" id={captionId} aria-live="polite">
              {monthFormatter.format(focusedDate)}
            </span>
            <IconButton size="sm" label="Next month" icon="›" onClick={() => setFocusedDate(addMonths(focusedDate, 1))} />
          </div>
          <table
            ref={gridRef}
            role="grid"
            className="itsm-DatePicker__grid"
            aria-labelledby={captionId}
            onKeyDown={onGridKeyDown}
          >
            <thead>
              <tr>
                {weekdayNames.map((weekday) => (
                  <th key={weekday.long} scope="col" abbr={weekday.long}>
                    {weekday.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={formatIsoDate(week[0] as Date)}>
                  {week.map((date) => {
                    const iso = formatIsoDate(date);
                    const isSelected = value === iso;
                    const outside = date.getUTCMonth() !== focusedDate.getUTCMonth();
                    return (
                      <td key={iso} role="gridcell">
                        <button
                          type="button"
                          className="itsm-DatePicker__day"
                          data-date={iso}
                          data-today={formatIsoDate(todayUtc()) === iso}
                          data-outside={outside}
                          aria-selected={isSelected}
                          aria-label={dayFormatter.format(date)}
                          // One tab stop for the whole grid: Tab leaves the
                          // calendar rather than walking 42 days.
                          tabIndex={formatIsoDate(focusedDate) === iso ? 0 : -1}
                          disabled={isOutOfRange(date)}
                          onClick={() => commit(date)}
                        >
                          {date.getUTCDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
