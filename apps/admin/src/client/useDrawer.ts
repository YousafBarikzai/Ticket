'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A drawer that lives in the URL: `?open=<kind>:<key>` (SPEC §4.10, D12).
 *
 * `?open=rule:vip-requester` can be pasted into a chat and opens the same
 * drawer for the next person; Back closes it, as it does on a phone. Opening
 * *pushes* a history entry with `history.pushState` — no server round trip,
 * and Next keeps `useSearchParams` in step — so Back (and the Android back
 * gesture) closes the drawer instead of leaving the page. Closing goes *back*
 * when this page opened the drawer, and otherwise replaces the entry, so a
 * drawer that arrived in a pasted link does not strand the reader on a page
 * they never visited.
 *
 * One drawer at a time per page: every kind shares the `open` parameter, and
 * opening one replaces another. Every other query parameter — filters, sort,
 * search — is kept.
 *
 * ```tsx
 * const drawer = useDrawer('rule');
 * <DataTable activate={{ kind: 'drawer', openKind: 'rule', keyField: 'key' }} onActivate={(row) => drawer.open(row.key)} … />
 * <Sheet open={drawer.key !== null} onOpenChange={(next) => !next && drawer.close()} …>
 * ```
 */

export const DRAWER_PARAM = 'open';

/** `rule:vip-requester` → `{ kind: 'rule', key: 'vip-requester' }`; the key may itself contain colons. */
export function parseDrawer(value: string | null): { readonly kind: string; readonly key: string } | null {
  if (!value) return null;
  const at = value.indexOf(':');
  if (at <= 0 || at === value.length - 1) return null;
  return { kind: value.slice(0, at), key: value.slice(at + 1) };
}

/** The same URL with the drawer set to `kind:key`, or removed when `key` is null. */
export function drawerHref(pathname: string, search: string, kind: string, key: string | null): string {
  const params = new URLSearchParams(search);
  if (key === null) params.delete(DRAWER_PARAM);
  else params.set(DRAWER_PARAM, `${kind}:${key}`);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export interface Drawer {
  /** The open key of this kind, or null. */
  readonly key: string | null;
  open(key: string): void;
  close(): void;
  /** A link that opens it, for an `<a>` a person can copy or open in a new tab. */
  href(key: string): string;
}

/** Drawers this tab opened itself, by URL — so closing knows whether Back leads somewhere sensible. */
const openedHere = new Set<string>();

export function useDrawer(kind: string): Drawer {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const current = parseDrawer(params.get(DRAWER_PARAM));
  const key = current?.kind === kind ? current.key : null;
  const anyOpen = current !== null;

  const open = useCallback(
    (next: string) => {
      const href = drawerHref(pathname, search, kind, next);
      // A `DataTable` with `activate: { kind: 'drawer' }` has already pushed
      // this address before calling `onActivate`; pushing it again would
      // leave two identical entries, and closing (which goes Back) would land
      // on the second and leave the drawer open.
      if (`${window.location.pathname}${window.location.search}` === href) {
        openedHere.add(href);
        return;
      }
      if (anyOpen) {
        // One drawer at a time: move from one to the next without piling up history.
        window.history.replaceState(null, '', href);
      } else {
        window.history.pushState(null, '', href);
      }
      openedHere.add(href);
    },
    [anyOpen, kind, pathname, search],
  );

  const close = useCallback(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    if (openedHere.has(here)) {
      openedHere.delete(here);
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', drawerHref(pathname, search, kind, null));
  }, [kind, pathname, search]);

  const href = useCallback((next: string) => drawerHref(pathname, search, kind, next), [kind, pathname, search]);

  return useMemo(() => ({ key, open, close, href }), [key, open, close, href]);
}
