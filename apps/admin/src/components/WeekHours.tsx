'use client';

import { type ReactNode } from 'react';
import { Button, IconButton, Switch, TimeField } from '@itsm/ui';

/**
 * A week of opening hours: SLA business calendars and workforce shifts
 * (B §2.7).
 *
 * Seven rows, Monday first (the product is `en-GB`, and business weeks start
 * on Monday). Each day has an *Open* switch and one or more time ranges, with
 * *Add hours* for a split day (09:00–12:30, 13:30–17:30) and × to remove one.
 * *Copy Monday to weekdays* fills Tuesday to Friday — the edit most calendars
 * need and the one that took five of everything else.
 *
 * The value is the business-time shape the SLA API stores,
 * `{ mon: [{ start: '09:00', end: '17:30' }] }` (a closed day is absent);
 * shifts, which say `from`/`to`, convert with `fromShiftPattern` /
 * `toShiftPattern`. An end of `24:00` means midnight at the end of the day.
 *
 * `compact` draws the read-only summary instead: seven small bars, one per
 * day, filled across the hours that are open, with the hours written out for
 * screen readers and on hover.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface OpenPeriod {
  readonly start: string;
  readonly end: string;
}
export type WeekHoursValue = Partial<Record<Weekday, readonly OpenPeriod[]>>;

export const WEEKDAYS: readonly { readonly id: Weekday; readonly label: string; readonly short: string }[] = [
  { id: 'mon', label: 'Monday', short: 'Mon' },
  { id: 'tue', label: 'Tuesday', short: 'Tue' },
  { id: 'wed', label: 'Wednesday', short: 'Wed' },
  { id: 'thu', label: 'Thursday', short: 'Thu' },
  { id: 'fri', label: 'Friday', short: 'Fri' },
  { id: 'sat', label: 'Saturday', short: 'Sat' },
  { id: 'sun', label: 'Sunday', short: 'Sun' },
];

const DEFAULT_PERIOD: OpenPeriod = { start: '09:00', end: '17:30' };

/** Minutes since midnight; `24:00` is 1440. */
export function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * What is wrong with a day's hours, in words, or null: an end before its
 * start, or two ranges that overlap. The API would refuse both, later and
 * less clearly.
 */
export function dayProblem(periods: readonly OpenPeriod[]): string | null {
  const sorted = [...periods].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (const period of sorted) {
    const start = minutesOf(period.start);
    const end = minutesOf(period.end);
    if (Number.isNaN(start) || Number.isNaN(end)) return 'Enter a start and an end time.';
    if (end <= start) return `${period.end} is not after ${period.start}.`;
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (minutesOf(sorted[index]!.start) < minutesOf(sorted[index - 1]!.end)) return 'These hours overlap.';
  }
  return null;
}

/** Monday's hours on Tuesday to Friday. */
export function copyMondayToWeekdays(value: WeekHoursValue): WeekHoursValue {
  const monday = value.mon;
  const next: Record<string, readonly OpenPeriod[]> = { ...value };
  for (const day of ['tue', 'wed', 'thu', 'fri'] as const) {
    if (monday && monday.length > 0) next[day] = monday.map((period) => ({ ...period }));
    else delete next[day];
  }
  return next as WeekHoursValue;
}

/** "09:00–17:30, 18:00–20:00", or "Closed". */
export function describeDay(periods: readonly OpenPeriod[] | undefined): string {
  if (!periods || periods.length === 0) return 'Closed';
  return periods.map((period) => `${period.start}–${period.end}`).join(', ');
}

/** A shift pattern (`from`/`to`) as week hours. */
export function fromShiftPattern(pattern: Partial<Record<Weekday, readonly { from: string; to: string }[]>> | null | undefined): WeekHoursValue {
  const out: Record<string, OpenPeriod[]> = {};
  for (const { id } of WEEKDAYS) {
    const spans = pattern?.[id];
    if (spans && spans.length > 0) out[id] = spans.map((span) => ({ start: span.from, end: span.to }));
  }
  return out as WeekHoursValue;
}

/** Week hours as a shift pattern. */
export function toShiftPattern(value: WeekHoursValue): Partial<Record<Weekday, { from: string; to: string }[]>> {
  const out: Partial<Record<Weekday, { from: string; to: string }[]>> = {};
  for (const { id } of WEEKDAYS) {
    const periods = value[id];
    if (periods && periods.length > 0) out[id] = periods.map((period) => ({ from: period.start, to: period.end }));
  }
  return out;
}

export interface WeekHoursProps {
  /** The group's name: "Business hours". */
  readonly label: string;
  readonly value: WeekHoursValue;
  /** Client only. Absent with `readOnly` or `compact`. */
  readonly onChange?: (value: WeekHoursValue) => void;
  readonly readOnly?: boolean;
  /** The seven-bar summary, read-only. */
  readonly compact?: boolean;
  /** Minutes between times offered. Default 15. */
  readonly step?: number;
  readonly className?: string;
}

function CompactWeek({ label, value, className }: { readonly label: string; readonly value: WeekHoursValue; readonly className?: string }): ReactNode {
  return (
    <ul className={className ? `app-WeekStrip ${className}` : 'app-WeekStrip'} aria-label={label}>
      {WEEKDAYS.map((day) => {
        const periods = value[day.id] ?? [];
        const text = describeDay(periods);
        return (
          <li key={day.id} className="app-WeekStrip__day" title={`${day.label}: ${text}`}>
            <span className="app-WeekStrip__name" aria-hidden="true">
              {day.short.charAt(0)}
            </span>
            <span className="app-WeekStrip__bar" aria-hidden="true">
              {periods.map((period, index) => {
                const start = Math.max(0, minutesOf(period.start));
                const end = Math.min(1440, minutesOf(period.end));
                return (
                  <span
                    key={index}
                    className="app-WeekStrip__fill"
                    // Geometry from data: where in the day the hours fall.
                    style={{ insetInlineStart: `${(start / 1440) * 100}%`, inlineSize: `${(Math.max(0, end - start) / 1440) * 100}%` }}
                  />
                );
              })}
            </span>
            <span className="itsm-visually-hidden">
              {day.label}: {text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function WeekHours({ label, value, onChange, readOnly = false, compact = false, step = 15, className }: WeekHoursProps): ReactNode {
  if (compact) return <CompactWeek label={label} value={value} {...(className ? { className } : {})} />;
  const editable = !readOnly && onChange !== undefined;

  const setDay = (day: Weekday, periods: readonly OpenPeriod[]): void => {
    if (!onChange) return;
    const next: Record<string, readonly OpenPeriod[]> = { ...value };
    if (periods.length === 0) delete next[day];
    else next[day] = periods;
    onChange(next as WeekHoursValue);
  };

  return (
    <fieldset className={className ? `app-WeekHours ${className}` : 'app-WeekHours'} disabled={!editable}>
      <legend className="app-WeekHours__legend">{label}</legend>
      <ul className="app-WeekHours__days">
        {WEEKDAYS.map((day) => {
          const periods = value[day.id] ?? [];
          const open = periods.length > 0;
          const problem = open ? dayProblem(periods) : null;
          return (
            <li key={day.id} className="app-WeekHours__day" data-open={open ? '' : undefined}>
              <Switch
                label={day.label}
                size="sm"
                checked={open}
                disabled={!editable}
                onChange={(checked) => setDay(day.id, checked ? [DEFAULT_PERIOD] : [])}
              />
              {open ? (
                <div className="app-WeekHours__periods">
                  {periods.map((period, index) => (
                    <div key={index} className="app-WeekHours__period">
                      <TimeField
                        label={`${day.label}, opens${periods.length > 1 ? ` (hours ${index + 1})` : ''}`}
                        value={period.start}
                        step={step}
                        disabled={!editable}
                        invalid={problem !== null}
                        onChange={(next) => setDay(day.id, periods.map((entry, position) => (position === index ? { ...entry, start: next ?? '' } : entry)))}
                      />
                      <span className="app-WeekHours__to" aria-hidden="true">
                        –
                      </span>
                      <TimeField
                        label={`${day.label}, closes${periods.length > 1 ? ` (hours ${index + 1})` : ''}`}
                        value={period.end}
                        step={step}
                        disabled={!editable}
                        invalid={problem !== null}
                        onChange={(next) => setDay(day.id, periods.map((entry, position) => (position === index ? { ...entry, end: next ?? '' } : entry)))}
                      />
                      {editable && periods.length > 1 ? (
                        <IconButton
                          icon="x"
                          variant="ghost"
                          size="sm"
                          label={`Remove ${day.label} hours ${period.start}–${period.end}`}
                          onClick={() => setDay(day.id, periods.filter((_, position) => position !== index))}
                        />
                      ) : null}
                    </div>
                  ))}
                  {editable && periods.length < 4 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconStart="plus"
                      onClick={() => {
                        const last = periods[periods.length - 1];
                        const start = last && minutesOf(last.end) < 23 * 60 ? last.end : '18:00';
                        setDay(day.id, [...periods, { start, end: minutesOf(start) + 60 <= 1440 ? toTime(minutesOf(start) + 60) : '24:00' }]);
                      }}
                    >
                      Add hours
                    </Button>
                  ) : null}
                  {problem ? (
                    <p className="app-WeekHours__problem" role="alert">
                      {problem}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="app-WeekHours__closed">Closed</span>
              )}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <Button variant="secondary" size="sm" onClick={() => onChange?.(copyMondayToWeekdays(value))} disabled={!value.mon || value.mon.length === 0}>
          Copy Monday to weekdays
        </Button>
      ) : null}
    </fieldset>
  );
}

function toTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
