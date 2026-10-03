'use client';

import { useEffect, useLayoutEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ReaderCoreProps, ReaderPoint } from './ChartReader.js';

/**
 * Written on the chart once the core is running, and so present in this
 * module's chunk: `check-bundles --async` finds the lazy chunk by it, holds it
 * to its budget, and fails if it ever turns up in a first-load file (A8 §8.2).
 */
export const READER_CORE_MARK = 'itsm-reader-core';

/** The sentence a reading is spoken as: "Tue 3 Sep 2026: Raised 12, Resolved 9". */
export function readingSentence(point: ReaderPoint): string {
  return `${point.title}: ${point.rows.map((row) => (row.label ? `${row.label} ${row.value}` : row.value)).join(', ')}`;
}

/**
 * The reading itself, loaded by `ChartReader` on the first sign of intent
 * (A8 §5.2): a pointer or the arrow keys pick a position, a tooltip shows
 * every series' value there, and the island's polite live region says it.
 *
 * - **Tooltips enhance, never gate**: every value is in the table twin, and
 *   the keyboard gets exactly what the pointer gets.
 * - The pointer finds the nearest position rather than asking anybody to land
 *   on a 2 px line; bars and segments are their own (full-band) hit targets.
 * - Only keyboard moves are announced. A pointer sweeping across thirty days
 *   would queue thirty sentences.
 * - Enter follows the position's link, through the application's router.
 * - Tooltip text is React text, never markup: series and category names come
 *   from data.
 *
 * The marks are server-rendered and outside React's reach from here, so the
 * active one is marked by attribute (`data-active`), the group by
 * `data-reading`; CSS lifts the one and quietens the rest.
 */
export function ReaderCore({ points, mode, axis = 'x', nearest = mode === 'crosshair', placement = 'beside', root, handlers, queued, say }: ReaderCoreProps): ReactNode {
  const router = useOptionalItsm()?.router;
  const [active, setActive] = useState<number | null>(null);
  const [source, setSource] = useState<'pointer' | 'keyboard' | null>(null);
  const point = active === null ? undefined : points[active];
  const last = points.length - 1;

  /** Where a key moves from `from`; `undefined` for a key that does not read. */
  const step = (from: number | null, key: string): number | undefined => {
    if (last < 0) return undefined;
    if (key === 'ArrowRight' || (axis === 'y' && key === 'ArrowDown')) return from === null ? 0 : Math.min(last, from + 1);
    if (key === 'ArrowLeft' || (axis === 'y' && key === 'ArrowUp')) return from === null ? last : Math.max(0, from - 1);
    if (key === 'Home') return 0;
    if (key === 'End') return last;
    return undefined;
  };

  const read = (index: number): void => {
    setActive(index);
    setSource('keyboard');
    say(readingSentence(points[index]!));
  };

  const clear = (): void => {
    setActive(null);
    setSource(null);
    say('');
  };

  // The keys pressed while this module was on its way, replayed in order.
  useEffect(() => {
    let at: number | null = null;
    for (const key of queued.splice(0)) at = step(at, key) ?? at;
    if (at !== null) read(at);
    root.current?.setAttribute('data-reader-core', READER_CORE_MARK);
    // Once, when the core arrives: later keys come through the handlers.
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    element.toggleAttribute('data-reading', point !== undefined);
    for (const mark of element.querySelectorAll('[data-point]')) {
      mark.toggleAttribute('data-active', active !== null && mark.getAttribute('data-point') === String(active));
    }
  }, [active, point, points, root]);

  // A shorter data set can leave the reading pointing past its end.
  useEffect(() => {
    if (active !== null && active > last) clear();
  }, [active, last]);

  const hit = (event: PointerEvent<HTMLDivElement>): number | null => {
    const element = root.current;
    if (!element) return null;
    const mark = (event.target as Element | null)?.closest?.('[data-point]');
    if (mark && element.contains(mark)) {
      const index = Number(mark.getAttribute('data-point'));
      if (Number.isInteger(index) && index >= 0 && index <= last) return index;
    }
    if (!nearest || last < 0) return null;
    const box = element.getBoundingClientRect();
    const extent = axis === 'x' ? box.width : box.height;
    if (extent <= 0) return null;
    const along = axis === 'x' ? (event.clientX - box.left) / extent : (event.clientY - box.top) / extent;
    const coordinate = axis === 'x' ? 0 : 1;
    let best = 0;
    for (let index = 1; index <= last; index++) {
      if (Math.abs(points[index]!.at[coordinate] - along) < Math.abs(points[best]!.at[coordinate] - along)) best = index;
    }
    return best;
  };

  // Fresh handlers after every render, so each event sees the current reading.
  useLayoutEffect(() => {
    handlers.current = {
      key(event: KeyboardEvent<HTMLDivElement>) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = step(active, event.key);
        if (next !== undefined) read(next);
        else if (event.key === 'Enter' && point?.href) {
          if (router) router.push(point.href);
          else window.location.assign(point.href);
        } else if (event.key === 'Escape' && active !== null) {
          // Only when there was something to clear: otherwise Escape belongs to
          // whatever the chart sits in (a sheet, a dialog).
          event.stopPropagation();
          clear();
        } else return;
        event.preventDefault();
      },
      pointer(event) {
        const index = hit(event);
        if (index === null) {
          if (source === 'pointer') clear();
        } else if (index !== active || source !== 'pointer') {
          setActive(index);
          setSource('pointer');
        }
      },
      leave() {
        if (source === 'pointer') clear();
      },
      blur(event) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clear();
      },
    };
  });

  if (!point) return null;
  const side = point.at[0] > 0.6 ? 'start' : 'end';
  const left = `${point.at[0] * 100}%`;
  return (
    <div className="itsm-ChartReader__overlay" aria-hidden="true">
      {mode === 'crosshair' ? (
        <>
          <span className="itsm-ChartReader__crosshair" style={{ left }} />
          {point.rows.map((row) =>
            row.y === undefined ? null : (
              <span key={row.id} className="itsm-ChartReader__dot" data-slot={row.tone ? undefined : (row.slot ?? 1)} data-tone={row.tone} data-style={row.style} style={{ left, top: `${row.y * 100}%` }} />
            ),
          )}
        </>
      ) : null}
      <div className="itsm-ChartReader__tip" data-side={side} data-placement={placement} style={{ left, top: `${point.at[1] * 100}%` }}>
        <p className="itsm-ChartReader__tipTitle">{point.title}</p>
        <ul className="itsm-ChartReader__tipRows">
          {point.rows.map((row) => (
            <li key={row.id} className="itsm-ChartReader__tipRow">
              <span
                className="itsm-ChartReader__key"
                data-empty={row.slot === undefined && row.tone === undefined ? '' : undefined}
                data-slot={row.tone ? undefined : row.slot}
                data-tone={row.tone}
                data-style={row.style}
              />
              <span className="itsm-ChartReader__tipValue">{row.value}</span>
              {row.label ? <span className="itsm-ChartReader__tipLabel">{row.label}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
