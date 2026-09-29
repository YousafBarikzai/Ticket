'use client';

import type { IconName } from '../types.js';

/**
 * One command in the palette: a place to go (`href`), a thing to do (`run`),
 * or a page of further commands (`children`).
 *
 * A superset of the in-house palette's `CommandItem`, so the commands the
 * applications build today remain valid when the palette moves to this shape.
 */
export interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconName;
  /** Trailing detail, e.g. a ticket's status. */
  readonly meta?: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  readonly group?: string;
  readonly disabled?: boolean;
  readonly tone?: 'default' | 'danger';
  readonly href?: string;
  run?(): void | Promise<void>;
  /** Opens a nested page ("Assign to…" → people). */
  children?(): readonly CommandItem[] | Promise<readonly CommandItem[]>;
}

/**
 * A source of palette commands: a static group, or a search that runs as the
 * person types (tickets, people, articles). `match` pins an exact hit first,
 * so "INC-123" offers "Open INC-000123" before any fuzzy result.
 */
export interface CommandProvider {
  readonly id: string;
  readonly group: string;
  readonly items?: readonly CommandItem[];
  search?(query: string, signal: AbortSignal): Promise<readonly CommandItem[]>;
  readonly minQuery?: number;
  /** At most 200 (the type-ahead debounce everywhere). */
  readonly debounceMs?: number;
  readonly limit?: number;
  readonly match?: RegExp;
}

/**
 * Adds page-specific commands to the palette while the calling component is
 * mounted ("Resolve this ticket" on a ticket page).
 *
 * Stub (SPEC §4.1): registers nothing yet; the foundations package adds the
 * registry to `ItsmProvider`.
 */
export function useRegisterCommands(items: readonly CommandItem[], deps: readonly unknown[]): void {
  void items;
  void deps;
}
