'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Problem } from '@itsm/ui';
import { problemFrom } from '../problem.js';

/**
 * "Load more" for a cursor-paged list (SPEC D13): the server renders the
 * first page, the browser appends the next ones.
 *
 * The API has no totals and no "page 3", only `nextCursor`, so the honest
 * control is *Load 50 more* and a caption that says "Showing 100 · more
 * available" — never a range or a count it cannot know. This hook holds the
 * appended rows and hands `DataTable`'s `pagination` exactly what it asks for:
 *
 * ```tsx
 * const list = useLoadMore({ rows, nextCursor, load: (cursor) => api.observe.tickets({ ...filter, cursor }) });
 * <DataTable rows={list.rows} pagination={{ mode: 'loadMore', ...list.pagination }} … />
 * ```
 *
 * When the server renders a new first page — a filter changed, the page was
 * refreshed after a write — `rows` changes identity and the appended pages are
 * dropped: they belonged to the old query. A failed load keeps what is shown
 * and reports the problem, so the button can say "Couldn't load more · Retry".
 */

export interface LoadMoreOptions<T> {
  /** The first page, from the server. */
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
  /** Client only: the next page after `cursor`, through `client/api.ts`. */
  load(cursor: string): Promise<{ readonly data: readonly T[]; readonly nextCursor: string | null }>;
  /** A key that, when it changes, starts again from the server's page (defaults to `rows`' identity). */
  readonly resetKey?: string;
  /** Rows the next page may repeat (a new ticket shifts the cursor): kept once, by this field. */
  readonly keyOf?: (row: T) => string;
}

export interface LoadMore<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly problem: Problem | null;
  loadMore(): Promise<void>;
  /** What `DataTable`'s `pagination: { mode: 'loadMore' }` takes. */
  readonly pagination: { readonly hasMore: boolean; readonly loading: boolean; onLoadMore(): Promise<void> };
}

export function useLoadMore<T>({ rows, nextCursor, load, resetKey, keyOf }: LoadMoreOptions<T>): LoadMore<T> {
  const [extra, setExtra] = useState<readonly T[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const loader = useRef(load);
  loader.current = load;
  // Which first page the appended rows belong to; a load that finishes after
  // the query changed is dropped rather than appended to the wrong list.
  const generation = useRef(0);

  const identity = resetKey ?? rows;
  useEffect(() => {
    generation.current += 1;
    setExtra([]);
    setCursor(nextCursor);
    setProblem(null);
    setLoading(false);
    // `nextCursor` belongs to the same first page, so resetting on `identity` covers it.
  }, [identity]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!cursor || loading) return;
    const mine = generation.current;
    setLoading(true);
    setProblem(null);
    try {
      const page = await loader.current(cursor);
      if (mine !== generation.current) return;
      setExtra((current) => [...current, ...page.data]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (mine === generation.current) setProblem(problemFrom(error));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [cursor, loading]);

  let all: readonly T[] = extra.length === 0 ? rows : [...rows, ...extra];
  if (keyOf && extra.length > 0) {
    const seen = new Set<string>();
    all = all.filter((row) => {
      const key = keyOf(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const hasMore = cursor !== null;
  return { rows: all, hasMore, loading, problem, loadMore, pagination: { hasMore, loading, onLoadMore: loadMore } };
}
