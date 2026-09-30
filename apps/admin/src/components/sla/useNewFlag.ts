'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A create sheet that lives in the URL as `?new=1` — what the command
 * palette's *New SLA policy* and *New calendar* open, and what the page's
 * primary button pushes (SPEC §5.5, D12).
 *
 * The same history rules as a drawer (`useDrawer`): opening pushes an entry
 * with `history.pushState`, so Back closes the sheet; closing goes back when
 * this tab opened it, and otherwise replaces the entry, so a pasted link
 * does not strand the reader. No server round trip either way — Next keeps
 * `useSearchParams` in step.
 */
export const NEW_PARAM = 'new';
/** `?new=1&from=<key>`: the create sheet, filled in from an existing item (*Duplicate…*). */
export const FROM_PARAM = 'from';

export function newHref(pathname: string, search: string, open: boolean): string {
  const params = new URLSearchParams(search);
  if (open) params.set(NEW_PARAM, '1');
  else {
    params.delete(NEW_PARAM);
    // What a duplicate was made from belongs to the sheet, and goes with it.
    params.delete(FROM_PARAM);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const openedHere = new Set<string>();

export interface NewFlag {
  readonly isOpen: boolean;
  /** The key the sheet duplicates, when it was opened by *Duplicate…*. */
  readonly from: string | null;
  open(): void;
  /**
   * Opens the sheet filled in from `key`, in place of any drawer: Back (or
   * Cancel) returns to the drawer it was opened from.
   */
  openFrom(key: string): void;
  close(): void;
}

export function useNewFlag(): NewFlag {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const isOpen = params.get(NEW_PARAM) !== null;
  const from = isOpen ? params.get(FROM_PARAM) : null;

  const open = useCallback(() => {
    const href = newHref(pathname, search, true);
    if (`${window.location.pathname}${window.location.search}` === href) return;
    window.history.pushState(null, '', href);
    openedHere.add(href);
  }, [pathname, search]);

  const openFrom = useCallback(
    (key: string) => {
      const params = new URLSearchParams(search);
      params.delete('open');
      params.set(NEW_PARAM, '1');
      params.set(FROM_PARAM, key);
      const href = `${pathname}?${params.toString()}`;
      window.history.pushState(null, '', href);
      openedHere.add(href);
    },
    [pathname, search],
  );

  const close = useCallback(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    if (openedHere.has(here)) {
      openedHere.delete(here);
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', newHref(pathname, search, false));
  }, [pathname, search]);

  return useMemo(() => ({ isOpen, from, open, openFrom, close }), [isOpen, from, open, openFrom, close]);
}
