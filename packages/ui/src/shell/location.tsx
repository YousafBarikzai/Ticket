'use client';

import { Suspense, useSyncExternalStore, type ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { SearchLike } from './match.js';

/*
 * Where the page is, as the frame reads it.
 *
 * Inside `ItsmProvider` these call the application's own hooks — Next's
 * `usePathname` and `useSearchParams`, handed over as references because the
 * design system never imports Next. Outside it (a test, a status page) they
 * read `window.location`, and render nothing location-specific on the server.
 *
 * Each call site uses exactly one of the two hooks for its whole life (a
 * component is either inside the provider or not), so the rules of hooks
 * hold even though the hook is chosen at run time.
 */

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

function useBrowserPathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '');
}

const EMPTY_SEARCH = new URLSearchParams();

function useBrowserSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return search === '' ? EMPTY_SEARCH : new URLSearchParams(search);
}

/** The current pathname: the application's `usePathname`, or the browser's outside the provider. */
export function usePathnameSafe(): string {
  const read = useOptionalItsm()?.usePathname ?? useBrowserPathname;
  return read();
}

function SearchReader({ children }: { readonly children: (search: SearchLike) => ReactNode }): ReactNode {
  const read = useOptionalItsm()?.useSearchParams ?? useBrowserSearch;
  return children(read());
}

/**
 * Renders `children` with the current query, inside its own Suspense
 * boundary. Next makes a statically rendered page fall back to client
 * rendering up to the nearest boundary when something reads the query, so the
 * frame reads it only in the few leaves that need it (a nav item that matches
 * on `?assignee=`), and shows `fallback` — the same leaf without the query —
 * in the static HTML.
 */
export function WithSearch({
  fallback,
  children,
}: {
  readonly fallback: ReactNode;
  readonly children: (search: SearchLike) => ReactNode;
}): ReactNode {
  return (
    <Suspense fallback={fallback}>
      <SearchReader>{children}</SearchReader>
    </Suspense>
  );
}
