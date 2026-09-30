'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { SeriesSlot } from './scale.js';

/** One value in a reading: a series at one position, already formatted. */
export interface ReaderRow {
  readonly id: string;
  /** The series name; empty for a chart of one series, whose title already says what it is. */
  readonly label: string;
  readonly value: string;
  readonly slot?: SeriesSlot;
  /** For the crosshair: where the series' marker sits, 0 at the top of the plot and 1 at the bottom. */
  readonly y?: number;
}

/** One position a reader can stop at: a date on a line chart, a bar, a donut segment. */
export interface ReaderPoint {
  readonly key: string;
  /** What the position is: "Tue 3 Sep 2026", "Email". */
  readonly title: string;
  /** Where its tooltip points, as fractions of the plot (x from the left, y from the top). */
  readonly at: readonly [number, number];
  readonly rows: readonly ReaderRow[];
}

export interface ChartReaderProps {
  /** The chart's title: the name of the focusable group. */
  readonly label: string;
  readonly points: readonly ReaderPoint[];
  /** `crosshair` for lines and areas (a hairline and a dot per series); `marks` for bars and segments (the mark lifts). */
  readonly mode: 'crosshair' | 'marks';
  /** The direction the arrow keys move in: along x (← →) or down the rows (↑ ↓ as well). */
  readonly axis?: 'x' | 'y';
  /** Whether a pointer anywhere in the plot reads the nearest position, or only one over a mark. */
  readonly nearest?: boolean;
  /** Where the tooltip sits: beside the anchor (default) or above it. */
  readonly placement?: 'beside' | 'above';
  readonly hint?: string;
  readonly className?: string;
  /** The static plot. Every mark that can be read carries `data-point="<index>"`. */
  readonly children: ReactNode;
}

/** The sentence a reading is spoken as: "Tue 3 Sep 2026: Raised 12, Resolved 9". */
export function readingSentence(point: ReaderPoint): string {
  const values = point.rows.map((row) => (row.label ? `${row.label} ${row.value}` : row.value));
  return `${point.title}: ${values.join(', ')}`;
}

/**
 * The client layer over a static chart: a pointer or the arrow keys pick a
 * position, a tooltip shows every series' value there, and a polite live
 * region reads it to a screen reader (SPEC §4.8, X-69).
 *
 * The chart itself stays the server-rendered SVG it was; this wraps it and
 * adds only what needs a browser. The wrapper is one tab stop, a `group` with
 * `aria-roledescription="chart"` and the hint "Use ← → to read values", so a
 * screen-reader user who lands on it is told how to use it. Browse mode has
 * the table under "View as table" as well.
 *
 * - **Tooltips enhance, never gate**: every value is in the table, and the
 *   keyboard gets exactly what the pointer gets.
 * - The pointer finds the nearest position rather than asking anybody to land
 *   on a 2 px line; bars and segments are their own (full-band) hit targets.
 * - Only keyboard moves are announced. A pointer sweeping across thirty days
 *   would queue thirty sentences.
 * - Tooltip text is React text, never markup: series and category names come
 *   from data.
 */
export function ChartReader({
  label,
  points,
  mode,
  axis = 'x',
  nearest = mode === 'crosshair',
  placement = 'beside',
  hint,
  className,
  children,
}: ChartReaderProps): ReactNode {
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [source, setSource] = useState<'pointer' | 'keyboard' | null>(null);
  const [readout, setReadout] = useState('');
  const point = active === null ? undefined : points[active];

  // The marks are server-rendered and outside React's reach from here, so the
  // active one is marked by attribute; CSS lifts it and quietens the rest.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    for (const mark of element.querySelectorAll('[data-point]')) {
      mark.toggleAttribute('data-active', active !== null && mark.getAttribute('data-point') === String(active));
    }
  }, [active, points]);

  // A shorter data set can leave the reading pointing past its end.
  useEffect(() => {
    if (active !== null && active >= points.length) setActive(null);
  }, [active, points.length]);

  const clear = useCallback(() => {
    setActive(null);
    setSource(null);
    setReadout('');
  }, []);

  const moveTo = (index: number): void => {
    if (points.length === 0) return;
    const next = Math.min(points.length - 1, Math.max(0, index));
    setActive(next);
    setSource('keyboard');
    setReadout(readingSentence(points[next]!));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const forward = event.key === 'ArrowRight' || (axis === 'y' && event.key === 'ArrowDown');
    const backward = event.key === 'ArrowLeft' || (axis === 'y' && event.key === 'ArrowUp');
    if (forward) moveTo(active === null ? 0 : active + 1);
    else if (backward) moveTo(active === null ? points.length - 1 : active - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(points.length - 1);
    else if (event.key === 'Escape' && active !== null) {
      // Only when there was something to clear: otherwise Escape belongs to
      // whatever the chart sits in (a sheet, a dialog).
      event.stopPropagation();
      clear();
    } else return;
    event.preventDefault();
  };

  const hit = (event: PointerEvent<HTMLDivElement>): number | null => {
    const element = root.current;
    if (!element) return null;
    const mark = (event.target as Element | null)?.closest?.('[data-point]');
    if (mark && element.contains(mark)) {
      const index = Number(mark.getAttribute('data-point'));
      if (Number.isInteger(index) && index >= 0 && index < points.length) return index;
    }
    if (!nearest || points.length === 0) return null;
    const box = element.getBoundingClientRect();
    const extent = axis === 'x' ? box.width : box.height;
    if (extent <= 0) return null;
    const along = axis === 'x' ? (event.clientX - box.left) / extent : (event.clientY - box.top) / extent;
    const coordinate = axis === 'x' ? 0 : 1;
    let best = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index]!.at[coordinate] - along) < Math.abs(points[best]!.at[coordinate] - along)) best = index;
    }
    return best;
  };

  const onPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const index = hit(event);
    if (index === null) {
      if (source === 'pointer') clear();
      return;
    }
    if (index !== active || source !== 'pointer') {
      setActive(index);
      setSource('pointer');
    }
  };

  const side = point && point.at[0] > 0.6 ? 'start' : 'end';
  return (
    <div
      ref={root}
      className={cx('itsm-ChartReader', className)}
      role="group"
      aria-roledescription="chart"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      data-mode={mode}
      data-reading={point ? '' : undefined}
      onKeyDown={onKeyDown}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={() => {
        if (source === 'pointer') clear();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clear();
      }}
    >
      {children}
      {/* Hidden: it is the group's description, and browse mode should not read it a second time as content. */}
      <span id={hintId} hidden>
        {hint ?? (axis === 'y' ? 'Use ↑ ↓ to read values' : 'Use ← → to read values')}
      </span>
      <span className="itsm-visually-hidden" aria-live="polite" aria-atomic="true">
        {readout}
      </span>
      {point ? (
        <div className="itsm-ChartReader__overlay" aria-hidden="true">
          {mode === 'crosshair' ? (
            <>
              <span className="itsm-ChartReader__crosshair" style={{ left: `${point.at[0] * 100}%` }} />
              {point.rows.map((row) =>
                row.y === undefined ? null : (
                  <span
                    key={row.id}
                    className="itsm-ChartReader__dot"
                    data-slot={row.slot ?? 1}
                    style={{ left: `${point.at[0] * 100}%`, top: `${row.y * 100}%` }}
                  />
                ),
              )}
            </>
          ) : null}
          <div
            className="itsm-ChartReader__tip"
            data-side={side}
            data-placement={placement}
            style={{ left: `${point.at[0] * 100}%`, top: `${point.at[1] * 100}%` }}
          >
            <p className="itsm-ChartReader__tipTitle">{point.title}</p>
            <ul className="itsm-ChartReader__tipRows">
              {point.rows.map((row) => (
                <li key={row.id} className="itsm-ChartReader__tipRow">
                  {row.slot === undefined ? (
                    <span className="itsm-ChartReader__key" data-empty="" />
                  ) : (
                    <span className="itsm-ChartReader__key" data-slot={row.slot} />
                  )}
                  <span className="itsm-ChartReader__tipValue">{row.value}</span>
                  {row.label ? <span className="itsm-ChartReader__tipLabel">{row.label}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
