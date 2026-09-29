'use client';

import type { RefObject } from 'react';

export interface HotkeyOptions {
  /** `mod+k`, `g m` (a chord), `/`, `?`, `shift+j`. Matched on `event.key`, so `/` and `?` work on every layout. */
  readonly keys: string;
  handler(event: KeyboardEvent): void;
  /** The whole document, or only while focus is inside an element. */
  readonly scope?: 'global' | RefObject<HTMLElement | null>;
  /**
   * Also fire while typing in a field. Only for `mod+k`, `mod+enter`,
   * `mod+shift+enter`, `mod+s` and `escape` — a single-key shortcut that fires
   * inside a text field eats the letter the person meant to type.
   */
  readonly allowInFields?: boolean;
  /** Listed in the shortcuts dialog. */
  readonly description: string;
  readonly group: string;
  readonly enabled?: boolean;
}

/**
 * Binds a keyboard shortcut and lists it in the shortcuts dialog.
 *
 * Single-character keys never fire inside text fields, menus, listboxes,
 * grids, radio groups, sliders or comboboxes, nor when the person has switched
 * single-key shortcuts off (WCAG 2.1.4, X-63).
 *
 * Stub (SPEC §4.1): binds nothing yet; the foundations package implements the
 * matching, chords and registry, with tests.
 */
export function useHotkey(options: HotkeyOptions): void {
  void options;
}
