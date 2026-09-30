'use client';

import { useEffect, useSyncExternalStore } from 'react';
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

/*
 * The registry of page commands: module-level, like the keyboard, because a
 * page has one palette. Each registration is a token holding one component's
 * list; the snapshot is rebuilt only when a registration changes, so the
 * palette's `useSyncExternalStore` sees a stable array between changes.
 */

interface Registration {
  readonly items: readonly CommandItem[];
}

const registrations: Registration[] = [];
const listeners = new Set<() => void>();
const NONE: readonly CommandItem[] = Object.freeze([]);
let snapshot: readonly CommandItem[] = NONE;

function rebuild(): void {
  // Most recent first: a drawer's commands are more specific to what the
  // person is looking at than the page's underneath it.
  const seen = new Set<string>();
  const items: CommandItem[] = [];
  for (let index = registrations.length - 1; index >= 0; index--) {
    for (const item of registrations[index]!.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  snapshot = items.length === 0 ? NONE : items;
  for (const listener of [...listeners]) listener();
}

/**
 * Adds commands to the palette until the returned function is called. The
 * hook is the usual way in; this is for code outside React.
 */
export function registerCommands(items: readonly CommandItem[]): () => void {
  const registration: Registration = { items };
  registrations.push(registration);
  rebuild();
  return () => {
    const index = registrations.indexOf(registration);
    if (index < 0) return;
    registrations.splice(index, 1);
    rebuild();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Adds page-specific commands to the palette while the calling component is
 * mounted ("Resolve this ticket" on a ticket page). `deps` works as an
 * effect's does: the list is re-registered when one of them changes, so a
 * command that closes over the current ticket is never stale.
 *
 * Page commands appear under the palette's "Suggested" heading when the query
 * is empty, and rank with the rest when it is not. The most recently mounted
 * component's commands come first, and a later registration of the same id
 * shadows an earlier one.
 */
export function useRegisterCommands(items: readonly CommandItem[], deps: readonly unknown[]): void {
  useEffect(
    () => registerCommands(items),
    // The caller's dependencies, as with `useEffect` itself.
    deps as unknown[],
  );
}

/** The registered page commands, most recent first — for the palette. Empty on the server. */
export function useRegisteredCommands(): readonly CommandItem[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => NONE);
}
