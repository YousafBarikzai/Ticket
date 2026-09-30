'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A create sheet that lives in the URL — `?new=1` (a new item or asset),
 * `?new=class` — which is what the command palette's *New configuration
 * item* and *Add asset* open, and what the page's primary button pushes
 * (SPEC §5.5, D12).
 *
 * The same history rules as a drawer (`useDrawer`): opening pushes, so Back
 * closes; closing goes back when this tab opened it and otherwise replaces
 * the entry, so a pasted link does not strand the reader. `finish` swaps the
 * sheet for the drawer of what it made, in the sheet's own history entry, so
 * Back from there returns to the list rather than to an empty form.
 */
export const NEW_PARAM = 'new';

export function newHref(pathname: string, search: string, value: string | null, open?: string): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(NEW_PARAM);
  else {
    params.delete('open');
    params.set(NEW_PARAM, value);
  }
  if (open) params.set('open', open);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const openedHere = new Set<string>();

export interface NewParam {
  readonly value: string | null;
  open(value?: string): void;
  close(): void;
  /** Closes the sheet onto a drawer, `ci:<id>`, in place of the sheet's history entry. */
  finish(open: string): void;
}

export function useNewParam(): NewParam {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const value = params.get(NEW_PARAM);

  const open = useCallback(
    (next = '1') => {
      const href = newHref(pathname, search, next);
      if (`${window.location.pathname}${window.location.search}` === href) return;
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
    window.history.replaceState(null, '', newHref(pathname, search, null));
  }, [pathname, search]);

  const finish = useCallback(
    (drawer: string) => {
      openedHere.delete(`${window.location.pathname}${window.location.search}`);
      window.history.replaceState(null, '', newHref(pathname, search, null, drawer));
    },
    [pathname, search],
  );

  return useMemo(() => ({ value, open, close, finish }), [value, open, close, finish]);
}
