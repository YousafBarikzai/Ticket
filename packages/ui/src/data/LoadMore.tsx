'use client';

import type { ReactNode } from 'react';
import type { Plural } from '../types.js';
import { cx } from '../web/cx.js';

export interface LoadMoreProps {
  readonly hasMore: boolean;
  /** Client only. */
  readonly onLoadMore: () => Promise<void> | void;
  readonly loading?: boolean;
  readonly shown: number;
  readonly noun: Plural;
  /** Loads as the end of the list scrolls into view (the workbench list). */
  readonly auto?: boolean;
  readonly className?: string;
}

/**
 * The end of a list without totals: "Showing 100 · more available" and a
 * button that appends the next page (D13), announcing what it added.
 *
 * Stub (SPEC §4.7): renders the caption and button; the data package adds the
 * announcement and auto-loading.
 */
export function LoadMore({ hasMore, onLoadMore, loading = false, shown, noun, className }: LoadMoreProps): ReactNode {
  return (
    <div className={cx('itsm-LoadMore', className)}>
      <p>{hasMore ? `Showing ${shown} · more available` : `${shown} ${shown === 1 ? noun.one : noun.other}`}</p>
      {hasMore ? (
        <button type="button" aria-busy={loading || undefined} onClick={() => void onLoadMore()}>
          Load more
        </button>
      ) : null}
    </div>
  );
}
