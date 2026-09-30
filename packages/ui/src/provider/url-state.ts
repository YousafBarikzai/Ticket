'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useOptimistic, useRef, useTransition } from 'react';
import { useItsm } from './ItsmProvider.js';

/**
 * How a piece of page state lives in the query string. `serialise` returns
 * `undefined` (or an empty string) for a parameter that should be absent, so
 * defaults never clutter a shareable URL.
 */
export interface UrlCodec<T> {
  parse(params: URLSearchParams): T;
  serialise(value: T): Record<string, string | undefined>;
}

export interface UrlStateOptions {
  /**
   * `true` writes with `history.replaceState`/`pushState` and no server
   * render — for drawers, selection and view-only state (D12). Otherwise the
   * app router replaces the URL inside a transition, for state the server
   * reads (filters, sort, search).
   */
  readonly shallow?: boolean;
  /** `push` adds a history entry, so Back undoes the change (opening a drawer). `replace` by default. */
  readonly history?: 'replace' | 'push';
}

export type UrlStateSetter<T> = (next: Partial<T>) => void;

/** The pagination cursor. A new filter starts from the first page, so any other change drops it. */
const CURSOR = 'cursor';

/** The keys a codec writes, with `''` normalised to absent. */
function serialised<T>(codec: UrlCodec<T>, value: T): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const [key, raw] of Object.entries(codec.serialise(value))) out.set(key, raw === '' ? undefined : raw);
  return out;
}

/**
 * The next query string after a partial change: the codec's keys rewritten,
 * every other parameter (another component's state, a drawer, UTM tags) kept
 * where it was, and the cursor dropped when anything but the cursor changed.
 * `null` when nothing changes, so a no-op never costs a navigation.
 */
export function nextSearch<T>(codec: UrlCodec<T>, currentSearch: string, patch: Partial<T>): string | null {
  const params = new URLSearchParams(currentSearch);
  const current = codec.parse(params);
  const before = serialised(codec, current);
  const after = serialised(codec, { ...current, ...patch });

  let changed = false;
  let filterChanged = false;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key);
    const now = after.get(key);
    if (now === undefined) params.delete(key);
    else params.set(key, now);
    if (was !== now) {
      changed = true;
      if (key !== CURSOR) filterChanged = true;
    }
  }
  if (!changed) return null;
  if (filterChanged && before.get(CURSOR) === after.get(CURSOR)) params.delete(CURSOR);
  return params.toString();
}

/**
 * Updates the setter's view of the latest props before any effect runs — a
 * child's effect runs before its parent's, and one that calls the setter on
 * mount must not see the previous render's URL. A layout effect does not run
 * on the server, where there is nothing to update.
 */
const useLatestEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function withSearch(pathname: string, search: string, hash: string): string {
  return `${pathname}${search ? `?${search}` : ''}${hash}`;
}

/**
 * Page state kept in the URL, so every filtered list is shareable and Back
 * does what people expect. Changing any filter drops the pagination `cursor`.
 *
 * Returns the value, a setter that takes a partial, and `isPending` while a
 * router navigation is in flight (for the 2 px refetch line). The value
 * reflects a change at once — optimistically, while the server renders the
 * new list — so a segmented control or a filter chip never snaps back for
 * the length of a round trip; it settles on the URL's value when the
 * navigation commits.
 *
 * Two writes in one event (a filter and a sort) both land: each builds on the
 * one before it, not on the URL the page was rendered with.
 *
 * `useSearchParams` is the app's hook, called here — in a leaf, inside the
 * page's Suspense boundary — and never by the provider (Y-1.3.1).
 */
export function useUrlState<T>(
  codec: UrlCodec<T>,
  options: UrlStateOptions = {},
): [T, UrlStateSetter<T>, { isPending: boolean }] {
  const { useSearchParams, usePathname, router } = useItsm();
  const search = useSearchParams().toString();
  const pathname = usePathname();
  const { shallow = false, history = 'replace' } = options;

  const [isPending, startTransition] = useTransition();
  const [shownSearch, showSearch] = useOptimistic(search);

  // The latest of everything the setter reads, so it can keep one identity
  // for the life of the component (a stable dependency for callers' effects).
  const latest = useRef({ codec, search, pathname, shallow, history, router });
  useLatestEffect(() => {
    latest.current = { codec, search, pathname, shallow, history, router };
  });
  // A router write not yet reflected in `useSearchParams`: the base for the
  // next write, until the navigation commits (and `search` moves on).
  const pendingWrite = useRef<{ readonly from: string; readonly to: string } | null>(null);

  const value = useMemo(
    () => latest.current.codec.parse(new URLSearchParams(shownSearch)),
    // `codec` is often an object literal, new on every render; the query
    // string is what the value depends on.
    [shownSearch],
  );

  const set = useCallback<UrlStateSetter<T>>((patch) => {
    const { codec: currentCodec, search: committed, pathname: routePath, shallow: isShallow, history: mode, router: appRouter } =
      latest.current;
    const inBrowser = typeof window !== 'undefined';
    const base = isShallow && inBrowser
      ? window.location.search.replace(/^\?/, '')
      : pendingWrite.current && pendingWrite.current.from === committed
        ? pendingWrite.current.to
        : committed;
    const next = nextSearch(currentCodec, base, patch);
    if (next === null) return;
    const hash = inBrowser ? window.location.hash : '';

    startTransition(() => {
      showSearch(next);
      if (isShallow && inBrowser) {
        // `null` state, as the Next.js docs show: its history patch keeps the
        // router's own entry state and syncs `useSearchParams` from the URL.
        const href = withSearch(window.location.pathname, next, hash);
        if (mode === 'push') window.history.pushState(null, '', href);
        else window.history.replaceState(null, '', href);
        return;
      }
      pendingWrite.current = { from: committed, to: next };
      const href = withSearch(routePath, next, hash);
      if (mode === 'push') appRouter.push(href, { scroll: false });
      else appRouter.replace(href, { scroll: false });
    });
  }, []);

  return [value, set, { isPending }];
}
