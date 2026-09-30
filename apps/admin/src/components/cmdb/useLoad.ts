'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem } from '@itsm/ui';
import { problemFrom } from '../../problem.js';

/**
 * One read for a drawer's tab, remembered while the drawer is open.
 *
 * `Tabs` renders only the chosen panel, so a tab mounts again each time it is
 * chosen; the answer is kept in the drawer's `cache` under `key` (the item,
 * the tab and a version the drawer bumps after a change), so moving between
 * tabs asks the API once, and a change — a new relationship, a new status —
 * makes the next look ask again.
 */
export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly problem: Problem };

export type LoadCache = Map<string, LoadState<unknown>>;

export function useLoad<T>(cache: LoadCache, key: string, load: () => Promise<T>): { readonly state: LoadState<T>; retry(): void } {
  const cached = cache.get(key) as LoadState<T> | undefined;
  const [state, setState] = useState<LoadState<T>>(cached && cached.status === 'ready' ? cached : { status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const known = cache.get(key) as LoadState<T> | undefined;
    if (known?.status === 'ready' && attempt === 0) {
      setState(known);
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    latest.current().then(
      (value) => {
        const next: LoadState<T> = { status: 'ready', value };
        cache.set(key, next);
        if (live) setState(next);
      },
      (error: unknown) => {
        if (live) setState({ status: 'failed', problem: problemFrom(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [cache, key, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}
