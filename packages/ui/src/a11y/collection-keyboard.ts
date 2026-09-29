'use client';

import type { FocusEvent, KeyboardEvent } from 'react';

/** How a row was opened: in place (Enter), as a full page (`o`) or in a new tab (mod+Enter). */
export type ActivateHow = 'inPlace' | 'page' | 'newTab';

export interface CollectionKeyboardOptions {
  readonly count: number;
  getRow(index: number): HTMLElement | null;
  /** The controls a row holds, in order; ← and → move between them. */
  readonly columns?: readonly ('select' | 'primary' | 'menu')[];
  onActivate(index: number, how: ActivateHow): void;
  onToggleSelect?(index: number): void;
  onExtendSelect?(from: number, to: number): void;
  onSelectAll?(): void;
  /** `confirm` when more than 3 rows were selected: the caller offers "Selection cleared · Undo". */
  onClearSelection?(): 'cleared' | 'confirm';
  onRowMenu?(index: number): void;
}

/** What the hook hands back: the tab stop, and the handlers for the element that contains the rows. */
export interface CollectionKeyboard {
  /** The row holding the collection's single tab stop. */
  readonly activeIndex: number;
  setActiveIndex(index: number): void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Moves the tab stop to a row that received focus some other way (pointer, Tab). */
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * One keyboard model for every list of rows — the admin `DataTable` and the
 * workbench ticket list — so the two cannot drift (X-64): one tab stop,
 * ↑↓/`j` `k` between rows, ←→ between a row's controls, `x`/Space to select,
 * Shift to extend, mod+A for everything loaded, Enter/`o`/mod+Enter to open,
 * `.` for the row menu, Esc to clear.
 *
 * Stub (SPEC §4.1): returns an inert tab stop on the first row; the
 * foundations package implements the model with its tests.
 */
export function useCollectionKeyboard(options: CollectionKeyboardOptions): CollectionKeyboard {
  void options;
  return inert;
}

const inert: CollectionKeyboard = {
  activeIndex: 0,
  setActiveIndex() {},
  onKeyDown() {},
  onFocus() {},
};
