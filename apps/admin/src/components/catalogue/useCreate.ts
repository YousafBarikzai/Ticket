'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { goBack } from '../../client/address.js';

/**
 * A create sheet that lives in the URL — `?new=request-type`,
 * `?new=service`, `?new=1` — which is what the command palette's *New
 * request type*, *New service*, *New form* and *New field* open (SPEC §5.5).
 * Extra parameters ride along: `&service=<key>` pre-fills the service,
 * `&from=<key>` duplicates.
 *
 * The same history rules as a drawer (`useDrawer`): opening pushes, so Back
 * closes; closing goes back when this tab opened it and otherwise replaces
 * the entry, so a pasted link does not strand the reader.
 */
export const NEW_PARAM = 'new';
/**
 * What belongs to the sheet and goes with it. `service` is not among them:
 * on Services & requests it is also the service the page shows, so the
 * list stays where it was when the sheet closes.
 */
const SHEET_ONLY = ['from'] as const;

export function createHref(pathname: string, search: string, value: string | null, extras: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams(search);
  for (const extra of SHEET_ONLY) params.delete(extra);
  if (value === null) params.delete(NEW_PARAM);
  else {
    params.delete('open');
    params.set(NEW_PARAM, value);
    for (const [name, extra] of Object.entries(extras)) params.set(name, extra);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const openedHere = new Set<string>();

export interface CreateParam {
  /** `request-type`, `service`, `1`… or null when no create sheet is open. */
  readonly value: string | null;
  readonly params: URLSearchParams;
  open(value: string, extras?: Readonly<Record<string, string>>): void;
  close(): void;
}

export function useCreateParam(): CreateParam {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const value = params.get(NEW_PARAM);

  const open = useCallback(
    (next: string, extras: Readonly<Record<string, string>> = {}) => {
      const href = createHref(pathname, search, next, extras);
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
      goBack();
      return;
    }
    window.history.replaceState(null, '', createHref(pathname, search, null));
  }, [pathname, search]);

  return useMemo(() => ({ value, params: new URLSearchParams(search), open, close }), [value, search, open, close]);
}
