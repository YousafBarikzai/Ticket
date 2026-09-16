'use client';

/**
 * Roving tabindex.
 *
 * A composite widget — a tab list, a radio group, a toolbar, a menu — is one
 * tab stop, and the arrow keys move within it (WAI-ARIA Authoring Practices).
 * Getting this wrong is the most common keyboard defect in a design system, so
 * it lives in one hook that Tabs, RadioGroup, Timeline filters and the
 * workbench toolbars all share.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type FocusEvent } from 'react';

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

export interface RovingOptions {
  readonly count: number;
  readonly orientation?: RovingOrientation;
  /** Wrap from the last item to the first. True matches the APG for tabs and radios. */
  readonly loop?: boolean;
  readonly defaultIndex?: number;
  /** Disabled items are skipped by the arrow keys but keep their position. */
  readonly isDisabled?: (index: number) => boolean;
  /** Called when an item is reached by keyboard, for tab lists with automatic activation. */
  readonly onMove?: (index: number) => void;
}

export interface RovingItemProps {
  readonly tabIndex: 0 | -1;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly ref: (node: HTMLElement | null) => void;
}

export interface Roving {
  readonly activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Moves DOM focus as well as the active index — used when a group is entered from outside. */
  focusIndex: (index: number) => void;
  getItemProps: (index: number) => RovingItemProps;
}

function isRtl(node: HTMLElement | null): boolean {
  if (!node) return false;
  const direction = node.ownerDocument.defaultView?.getComputedStyle(node).direction;
  return direction === 'rtl';
}

export function useRovingTabIndex(options: RovingOptions): Roving {
  const { count, orientation = 'horizontal', loop = true, defaultIndex = 0, isDisabled, onMove } = options;
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const items = useRef<(HTMLElement | null)[]>([]);

  // A removed item must not leave the group with no tab stop at all.
  useEffect(() => {
    if (count > 0 && activeIndex > count - 1) setActiveIndex(count - 1);
  }, [count, activeIndex]);

  const enabled = useCallback((index: number) => !isDisabled?.(index), [isDisabled]);

  const step = useCallback(
    (from: number, delta: number): number => {
      if (count === 0) return from;
      let next = from;
      for (let attempt = 0; attempt < count; attempt += 1) {
        next += delta;
        if (next < 0) {
          if (!loop) return from;
          next = count - 1;
        } else if (next > count - 1) {
          if (!loop) return from;
          next = 0;
        }
        if (enabled(next)) return next;
      }
      return from;
    },
    [count, loop, enabled],
  );

  const edge = useCallback(
    (direction: 'first' | 'last'): number => {
      const order = direction === 'first' ? [...Array(count).keys()] : [...Array(count).keys()].reverse();
      return order.find(enabled) ?? activeIndex;
    },
    [count, enabled, activeIndex],
  );

  const focusIndex = useCallback(
    (index: number): void => {
      setActiveIndex(index);
      // Focus after the state change so the item has tabIndex 0 by the time the
      // browser moves the caret; React flushes this synchronously in an event.
      items.current[index]?.focus();
      onMove?.(index);
    },
    [onMove],
  );

  const getItemProps = useCallback(
    (index: number): RovingItemProps => ({
      tabIndex: index === activeIndex ? 0 : -1,
      ref: (node: HTMLElement | null) => {
        items.current[index] = node;
      },
      onFocus: () => {
        // Clicking or shift-tabbing into an item makes it the tab stop.
        setActiveIndex(index);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const horizontal = orientation === 'horizontal' || orientation === 'both';
        const vertical = orientation === 'vertical' || orientation === 'both';
        const rtl = isRtl(items.current[index] ?? null);
        let next: number | null = null;

        switch (event.key) {
          case 'ArrowRight':
            if (horizontal) next = step(index, rtl ? -1 : 1);
            break;
          case 'ArrowLeft':
            if (horizontal) next = step(index, rtl ? 1 : -1);
            break;
          case 'ArrowDown':
            if (vertical) next = step(index, 1);
            break;
          case 'ArrowUp':
            if (vertical) next = step(index, -1);
            break;
          case 'Home':
            next = edge('first');
            break;
          case 'End':
            next = edge('last');
            break;
          default:
            return;
        }

        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        focusIndex(next);
      },
    }),
    [activeIndex, orientation, step, edge, focusIndex],
  );

  return { activeIndex, setActiveIndex, focusIndex, getItemProps };
}
