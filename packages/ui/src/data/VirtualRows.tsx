'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export interface VirtualRowsProps {
  readonly count: number;
  /** A row's height before it is measured: the density's row height. */
  readonly estimateSize: number;
  readonly colSpan: number;
  /** Draws row `index`; `measure` goes on the row so its real height is used. */
  renderRow(index: number, measure: (element: HTMLTableRowElement | null) => void): ReactNode;
  /** Filled with a function that scrolls a row into existence — the keyboard's `onActiveChange`. */
  readonly scrollTo: RefObject<((index: number) => void) | null>;
  /** After every render of the window: a row the keyboard moved to may have just appeared. */
  onRendered?(): void;
}

/**
 * The rows of a long table, windowed against the page's own scroll (the
 * window scrolls in every frame, SPEC §4.9): only the rows near the viewport
 * are in the DOM, with a spacer row above and below standing in for the rest.
 *
 * The default export, so the table can load it with `React.lazy` — TanStack
 * Virtual is fetched only by a table that asks for `virtual` and has the rows
 * to need it. The table sets `aria-rowcount` and each row its
 * `aria-rowindex`, so a screen reader still hears "row 812 of 2,000".
 */
export default function VirtualRows({ count, estimateSize, colSpan, renderRow, scrollTo, onRendered }: VirtualRowsProps): ReactNode {
  const marker = useRef<HTMLTableRowElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the body starts on the page: the window's scroll is measured from there.
  useLayoutEffect(() => {
    const body = marker.current?.parentElement;
    if (!body) return;
    const measure = (): void => setScrollMargin(body.getBoundingClientRect().top + window.scrollY);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => estimateSize,
    overscan: 8,
    scrollMargin,
  });

  useEffect(() => {
    scrollTo.current = (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' });
    return () => {
      scrollTo.current = null;
    };
  }, [scrollTo, virtualizer]);

  useEffect(() => {
    onRendered?.();
  });

  const items = virtualizer.getVirtualItems();
  const before = items.length > 0 ? Math.max(0, items[0]!.start - scrollMargin) : 0;
  const after = items.length > 0 ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1]!.end - scrollMargin)) : 0;

  return (
    <>
      <tr ref={marker} className="itsm-DataTable__spacer" aria-hidden="true" style={{ blockSize: before }}>
        <td colSpan={colSpan} />
      </tr>
      {items.map((item) => renderRow(item.index, virtualizer.measureElement))}
      <tr className="itsm-DataTable__spacer" aria-hidden="true" style={{ blockSize: after }}>
        <td colSpan={colSpan} />
      </tr>
    </>
  );
}
