'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { detectOs, type OsName } from '../theme/prefs.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { isTextEntry } from './hotkeys.js';
import { scrollIntoViewIfPossible } from './motion.js';

/** How a row was opened: in place (Enter), as a full page (`o`) or in a new tab (mod+Enter). */
export type ActivateHow = 'inPlace' | 'page' | 'newTab';

/** The controls a row can hold, in the order ← and → visit them. */
export type CollectionColumn = 'select' | 'primary' | 'menu';

export interface CollectionKeyboardOptions {
  readonly count: number;
  /** The element for row `index`, or `null` when it is not rendered (a virtual list scrolled away). */
  getRow(index: number): HTMLElement | null;
  /** The controls a row holds, in order; ← and → move between them. `['select', 'primary', 'menu']` by default. */
  readonly columns?: readonly CollectionColumn[];
  onActivate(index: number, how: ActivateHow): void;
  onToggleSelect?(index: number): void;
  /** Shift with ↑↓ or `j`/`k`: select the range from the anchor row to `to`, both included. */
  onExtendSelect?(from: number, to: number): void;
  onSelectAll?(): void;
  /**
   * Escape. Return `confirm` when more than 3 rows were selected (the caller
   * offers "Selection cleared · Undo"), `cleared` otherwise, or `none` when
   * nothing was selected — then Escape is left for whatever contains the
   * list (leaving a pane, closing a drawer).
   */
  onClearSelection?(): 'cleared' | 'confirm' | 'none' | void;
  onRowMenu?(index: number): void;
  /**
   * The current row changed, by keyboard, pointer or `setActiveIndex`. A
   * virtual list scrolls it into existence here; the workbench's detail pane
   * follows it.
   */
  onActiveChange?(index: number): void;
  /** The row that holds the tab stop at first. */
  readonly defaultIndex?: number;
}

/** Props for one of a row's controls: its place in the single tab stop, and how the hook finds it. */
export interface CollectionControlProps {
  readonly tabIndex: 0 | -1;
  readonly 'data-itsm-control': CollectionColumn;
  readonly 'data-itsm-row': number;
}

/** What the hook hands back: the tab stop, and the handlers for the element that contains the rows. */
export interface CollectionKeyboard {
  /** The row holding the collection's single tab stop. */
  readonly activeIndex: number;
  /** Which of the row's controls holds it. */
  readonly activeColumn: CollectionColumn;
  /** Moves the tab stop, and focus with it when `focus` is set. */
  setActiveIndex(index: number, options?: { readonly focus?: boolean }): void;
  /** Spread on each row control: `{...getControlProps(i, 'primary')}` on the row's link. */
  getControlProps(index: number, column: CollectionColumn): CollectionControlProps;
  /** Spread on each row element, so a click anywhere in it is traced back to its index. */
  getRowProps(index: number): { readonly 'data-itsm-row': number };
  /** Puts focus back on the current row — after a row menu or dialog closes (X-63). */
  focusActive(): void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Moves the tab stop to a row that received focus some other way (pointer, Tab). */
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

const DEFAULT_COLUMNS: readonly CollectionColumn[] = ['select', 'primary', 'menu'];

/** A layout effect in the browser, nothing on the server. */
const useLatestEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function platform(): OsName {
  return typeof navigator === 'undefined' ? 'other' : detectOs(navigator);
}

/** The control for `column` in a row: marked with `data-itsm-control`, or found by what it is. */
function controlIn(row: HTMLElement, column: CollectionColumn): HTMLElement | null {
  // A row that is its own control (a focusable `<tr>`, a whole-row link).
  if (row.getAttribute('data-itsm-control') === column) return row;
  const marked = row.querySelector<HTMLElement>(`[data-itsm-control="${column}"]`);
  if (marked) return marked;
  switch (column) {
    case 'select':
      return row.querySelector<HTMLElement>('input[type="checkbox"]');
    case 'primary':
      return row.querySelector<HTMLElement>('a[href], button:not([aria-haspopup])');
    case 'menu':
      return row.querySelector<HTMLElement>('button[aria-haspopup]');
  }
}

function isButtonLike(element: Element): boolean {
  return element instanceof HTMLButtonElement || element.getAttribute('role') === 'button';
}

function isCheckbox(element: Element): boolean {
  return (element instanceof HTMLInputElement && element.type === 'checkbox') || element.getAttribute('role') === 'checkbox';
}

/**
 * One keyboard model for every list of rows — the admin `DataTable` and the
 * workbench ticket list — so the two cannot drift (X-64, SPEC §5.6):
 *
 *   - one tab stop, on the current row's primary control;
 *   - ↑↓ and `j`/`k` between rows, keeping the column; Home and End;
 *   - ←→ between the row's controls (checkbox ↔ link ↔ ⋯), mirrored in RTL;
 *   - `x` or Space to select, Shift with ↑↓/`j`/`k` to extend from the anchor;
 *   - mod+A for everything loaded;
 *   - Enter to open in place, `o` as a page, mod+Enter in a new tab;
 *   - `.`, Shift+F10 or the Menu key for the row's menu;
 *   - Escape to clear the selection.
 *
 * Native behaviour is left alone where it is the right answer: Space and
 * Enter on the row's checkbox or ⋯ button do what those controls do, and
 * nothing here fires while a field inside a row (an inline edit) is being
 * typed in. The letter keys follow the person's "single-key shortcuts"
 * switch; arrows, Space and Enter always work.
 *
 * Rows may be virtual: moving to a row that is not rendered calls
 * `onActiveChange` (scroll it in) and focuses it once it appears.
 */
export function useCollectionKeyboard(options: CollectionKeyboardOptions): CollectionKeyboard {
  const { count, defaultIndex = 0 } = options;
  const [activeIndex, setActive] = useState(() => Math.max(0, Math.min(defaultIndex, count - 1)));
  const [activeColumn, setActiveColumn] = useState<CollectionColumn>('primary');
  const { prefs } = useTheme();
  const lettersOn = prefs.shortcuts !== 'off';

  const latest = useRef({ options, activeIndex, activeColumn, lettersOn });
  useLatestEffect(() => {
    latest.current = { options, activeIndex, activeColumn, lettersOn };
  });
  /** Shift-selection starts here. Cleared by any move without Shift. */
  const anchor = useRef<number | null>(null);
  /** A row to focus once it is rendered (virtual lists). */
  const pendingFocus = useRef<{ index: number; column: CollectionColumn } | null>(null);

  // A shrinking list must not leave the tab stop on a row that is gone.
  useEffect(() => {
    if (count > 0 && activeIndex > count - 1) setActive(count - 1);
  }, [count, activeIndex]);

  const columnsOf = useCallback((row: HTMLElement): CollectionColumn[] => {
    const order = latest.current.options.columns ?? DEFAULT_COLUMNS;
    return order.filter((column) => controlIn(row, column) !== null);
  }, []);

  /** Focuses a row's control, the nearest available column if that one is missing. Returns false when the row is not rendered. */
  const focusControl = useCallback(
    (index: number, column: CollectionColumn): boolean => {
      const row = latest.current.options.getRow(index);
      if (!row) return false;
      const available = columnsOf(row);
      const chosen = available.includes(column) ? column : available.includes('primary') ? 'primary' : available[0];
      const control = chosen ? controlIn(row, chosen) : row.tabIndex >= 0 || row.hasAttribute('tabindex') ? row : null;
      if (!control) return false;
      control.focus();
      scrollIntoViewIfPossible(control, { block: 'nearest', inline: 'nearest' });
      if (chosen) setActiveColumn(chosen);
      return true;
    },
    [columnsOf],
  );

  const moveTo = useCallback(
    (index: number, column: CollectionColumn, focus: boolean): void => {
      const { options: current } = latest.current;
      if (current.count <= 0) return;
      const next = Math.max(0, Math.min(index, current.count - 1));
      const previous = latest.current.activeIndex;
      setActive(next);
      setActiveColumn(column);
      latest.current = { ...latest.current, activeIndex: next, activeColumn: column };
      if (next !== previous) current.onActiveChange?.(next);
      if (!focus) return;
      if (!focusControl(next, column)) pendingFocus.current = { index: next, column };
    },
    [focusControl],
  );

  // A virtual row the keyboard moved to has rendered: give it focus.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending && focusControl(pending.index, pending.column)) pendingFocus.current = null;
  });

  const setActiveIndex = useCallback(
    (index: number, setOptions?: { readonly focus?: boolean }) => moveTo(index, latest.current.activeColumn, setOptions?.focus ?? false),
    [moveTo],
  );

  const focusActive = useCallback(() => {
    const { activeIndex: index, activeColumn: column } = latest.current;
    if (!focusControl(index, column)) pendingFocus.current = { index, column };
  }, [focusControl]);

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const holder = target.closest<HTMLElement>('[data-itsm-row]');
    let index = holder ? Number(holder.getAttribute('data-itsm-row')) : Number.NaN;
    if (!Number.isInteger(index)) {
      const { options: current } = latest.current;
      index = -1;
      for (let candidate = 0; candidate < current.count; candidate++) {
        if (current.getRow(candidate)?.contains(target)) {
          index = candidate;
          break;
        }
      }
    }
    if (index < 0) return;
    const control = target.closest<HTMLElement>('[data-itsm-control]');
    const column = (control?.getAttribute('data-itsm-control') as CollectionColumn | null) ?? latest.current.activeColumn;
    const previous = latest.current.activeIndex;
    if (index !== previous || column !== latest.current.activeColumn) {
      setActive(index);
      setActiveColumn(column);
      latest.current = { ...latest.current, activeIndex: index, activeColumn: column };
      if (index !== previous) latest.current.options.onActiveChange?.(index);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const target = event.target as HTMLElement;
      // Typing in a field inside a row (an inline edit) is typing.
      if (isTextEntry(target) && !target.hasAttribute('data-itsm-control')) return;

      const { options: current, activeIndex: index, activeColumn: column, lettersOn: letters } = latest.current;
      if (current.count === 0) return;
      const apple = platform() === 'apple';
      const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const letter = (name: string): boolean => letters && plain && key === name;

      const handled = (): void => {
        event.preventDefault();
        event.stopPropagation();
      };

      const move = (to: number): void => {
        if (event.shiftKey && current.onExtendSelect) {
          anchor.current ??= index;
          const next = Math.max(0, Math.min(to, current.count - 1));
          moveTo(next, column, true);
          current.onExtendSelect(anchor.current, next);
        } else {
          anchor.current = null;
          moveTo(to, column, true);
        }
        handled();
      };

      if (plain && (key === 'ArrowDown' || letter('j'))) return move(index + 1);
      if (plain && (key === 'ArrowUp' || letter('k'))) return move(index - 1);
      if ((plain || mod) && !event.shiftKey && key === 'Home') {
        anchor.current = null;
        moveTo(0, column, true);
        return handled();
      }
      if ((plain || mod) && !event.shiftKey && key === 'End') {
        anchor.current = null;
        moveTo(current.count - 1, column, true);
        return handled();
      }

      if (plain && !event.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        const row = current.getRow(index);
        if (!row) return;
        const available = columnsOf(row);
        const position = available.indexOf(column);
        const rtl = row.ownerDocument.defaultView?.getComputedStyle(row).direction === 'rtl';
        const step = (key === 'ArrowRight') !== rtl ? 1 : -1;
        const nextColumn = available[position + step];
        if (position >= 0 && nextColumn) {
          moveTo(index, nextColumn, true);
          return handled();
        }
        return;
      }

      if (letter('x') && !event.shiftKey && current.onToggleSelect) {
        anchor.current = index;
        current.onToggleSelect(index);
        return handled();
      }
      if (key === ' ' && plain && !event.shiftKey && current.onToggleSelect) {
        // The checkbox toggles itself and the ⋯ button opens its menu; doing
        // it here as well would undo the one or double the other.
        if (isCheckbox(target) || isButtonLike(target)) return;
        anchor.current = index;
        current.onToggleSelect(index);
        return handled();
      }

      if (mod && !event.shiftKey && !event.altKey && key === 'a' && current.onSelectAll) {
        current.onSelectAll();
        return handled();
      }

      if (key === 'Enter') {
        if (mod && !event.shiftKey && !event.altKey) {
          current.onActivate(index, 'newTab');
          return handled();
        }
        if (plain && !event.shiftKey) {
          if (isButtonLike(target)) return;
          current.onActivate(index, 'inPlace');
          return handled();
        }
        return;
      }
      if (letter('o') && !event.shiftKey) {
        current.onActivate(index, 'page');
        return handled();
      }

      const menuKey =
        (plain && !event.shiftKey && key === '.' && letters) ||
        (plain && event.shiftKey && key === 'F10') ||
        key === 'ContextMenu';
      if (menuKey && current.onRowMenu) {
        current.onRowMenu(index);
        return handled();
      }

      if (key === 'Escape' && plain && !event.shiftKey && current.onClearSelection) {
        const result = current.onClearSelection();
        anchor.current = null;
        if (result === 'cleared' || result === 'confirm') handled();
      }
    },
    [columnsOf, moveTo],
  );

  const getControlProps = useCallback(
    (index: number, column: CollectionColumn): CollectionControlProps => ({
      tabIndex: index === activeIndex && column === activeColumn ? 0 : -1,
      'data-itsm-control': column,
      'data-itsm-row': index,
    }),
    [activeIndex, activeColumn],
  );
  const getRowProps = useCallback((index: number) => ({ 'data-itsm-row': index }), []);

  return useMemo(
    () => ({ activeIndex, activeColumn, setActiveIndex, getControlProps, getRowProps, focusActive, onKeyDown, onFocus }),
    [activeIndex, activeColumn, setActiveIndex, getControlProps, getRowProps, focusActive, onKeyDown, onFocus],
  );
}
