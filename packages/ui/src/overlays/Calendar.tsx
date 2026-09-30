'use client';

import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '../web/IconButton.js';
import { addDays, addMonths, formatIsoDate, sameDay, startOfMonth, todayUtc } from './calendar-dates.js';

/** How a day relates to what is chosen: the one date, or a range's ends and middle. */
export type DayMark = 'single' | 'start' | 'end' | 'middle' | null;

export interface CalendarProps {
  /** The day the keyboard cursor is on; its month is the month shown. */
  readonly focusedDate: Date;
  readonly onFocusedDateChange: (date: Date) => void;
  readonly onSelect: (date: Date) => void;
  readonly mark: (date: Date) => DayMark;
  readonly isDisabled?: (date: Date) => boolean;
  /** Pointer over a day, for a range's preview. */
  readonly onHover?: (date: Date | null) => void;
  readonly locale: string;
  /** 0 Sunday, 1 Monday. Defaults to the locale's own first day where the runtime knows it, else Monday. */
  readonly weekStartsOn?: 0 | 1;
  /** Increment (from 1) to move focus onto the focused day — on opening. */
  readonly focusRequest?: number;
}

function localeWeekStart(locale: string): 0 | 1 {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return firstDay === 7 ? 0 : 1;
  } catch {
    return 1;
  }
}

/**
 * One month as a keyboard grid (the APG date-picker pattern): one tab stop,
 * arrow keys between days, Home/End to the week's ends, Page Up/Down between
 * months and with Shift between years, Enter or Space to choose. The month
 * caption is a polite live region, so paging is heard without moving focus.
 *
 * Each day is a `gridcell` carrying `aria-selected`, `aria-current="date"`
 * for today and its full date as its name; days outside the month are shown
 * muted and remain reachable, since a week does not stop at a month's edge.
 */
export function Calendar({ focusedDate, onFocusedDateChange, onSelect, mark, isDisabled, onHover, locale, weekStartsOn, focusRequest = 0 }: CalendarProps): ReactNode {
  const captionId = useId();
  const gridRef = useRef<HTMLTableElement | null>(null);
  const firstDay = weekStartsOn ?? localeWeekStart(locale);
  const today = todayUtc();

  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }), [locale]);
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    // 2024-01-01 was a Monday, a stable anchor for either week start.
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(2024, 0, 1 + ((index + (firstDay === 1 ? 0 : 6)) % 7)));
      return { short: short.format(date), long: long.format(date) };
    });
  }, [locale, firstDay]);

  const weeks = useMemo(() => {
    const first = startOfMonth(focusedDate);
    const offset = (first.getUTCDay() - firstDay + 7) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
  }, [focusedDate, firstDay]);

  // Focus follows the cursor while the keyboard is in the grid, and lands on
  // it when the calendar asks (opening) — never when the month is paged with
  // the buttons, where focus belongs on the button.
  // (A key that pages to another month removes the focused cell from the
  // page, so "the keyboard is in the grid" is remembered from the key press
  // rather than read from where focus is afterwards.)
  const lastRequest = useRef(0);
  const follow = useRef(false);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const requested = focusRequest !== lastRequest.current;
    lastRequest.current = focusRequest;
    const moved = follow.current;
    follow.current = false;
    if (!requested && !moved) return;
    grid.querySelector<HTMLElement>(`[data-date="${formatIsoDate(focusedDate)}"]`)?.focus();
  }, [focusedDate, focusRequest]);

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    const column = (focusedDate.getUTCDay() - firstDay + 7) % 7;
    let next: Date | null = null;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    switch (event.key) {
      case 'ArrowRight':
        next = addDays(focusedDate, rtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        next = addDays(focusedDate, rtl ? 1 : -1);
        break;
      case 'ArrowDown':
        next = addDays(focusedDate, 7);
        break;
      case 'ArrowUp':
        next = addDays(focusedDate, -7);
        break;
      case 'Home':
        next = addDays(focusedDate, -column);
        break;
      case 'End':
        next = addDays(focusedDate, 6 - column);
        break;
      case 'PageUp':
        next = addMonths(focusedDate, event.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = addMonths(focusedDate, event.shiftKey ? 12 : 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!isDisabled?.(focusedDate)) onSelect(focusedDate);
        return;
      default:
        return;
    }
    event.preventDefault();
    follow.current = true;
    onFocusedDateChange(next);
  };

  return (
    <div className="itsm-Calendar">
      <div className="itsm-Calendar__header">
        <IconButton size="sm" variant="ghost" label="Previous month" icon="chevron-left" onClick={() => onFocusedDateChange(addMonths(focusedDate, -1))} />
        <span className="itsm-Calendar__caption" id={captionId} aria-live="polite">
          {monthFormatter.format(focusedDate)}
        </span>
        <IconButton size="sm" variant="ghost" label="Next month" icon="chevron-right" onClick={() => onFocusedDateChange(addMonths(focusedDate, 1))} />
      </div>
      <table ref={gridRef} role="grid" className="itsm-Calendar__grid" aria-labelledby={captionId} onKeyDown={onKeyDown} onPointerLeave={() => onHover?.(null)}>
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th key={weekday.long} scope="col" abbr={weekday.long} className="itsm-Calendar__weekday">
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={formatIsoDate(week[0]!)}>
              {week.map((date) => {
                const iso = formatIsoDate(date);
                const state = mark(date);
                const disabled = isDisabled?.(date) ?? false;
                return (
                  <td
                    key={iso}
                    role="gridcell"
                    className="itsm-Calendar__day"
                    data-date={iso}
                    data-mark={state ?? undefined}
                    data-outside={date.getUTCMonth() !== focusedDate.getUTCMonth() || undefined}
                    aria-selected={state !== null}
                    aria-current={sameDay(date, today) ? 'date' : undefined}
                    aria-disabled={disabled || undefined}
                    aria-label={dayFormatter.format(date)}
                    // One tab stop for the whole grid: Tab leaves the calendar
                    // rather than walking 42 days.
                    tabIndex={sameDay(date, focusedDate) ? 0 : -1}
                    onClick={() => {
                      if (disabled) return;
                      onFocusedDateChange(date);
                      onSelect(date);
                    }}
                    onPointerEnter={() => onHover?.(date)}
                  >
                    <span className="itsm-Calendar__number">{date.getUTCDate()}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
