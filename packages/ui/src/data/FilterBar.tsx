'use client';

import type { ReactNode } from 'react';
import type { Plural } from '../types.js';
import { cx } from '../web/cx.js';
import type { DataTableScope, FilterSpec, FilterValue } from './types.js';

interface FilterBarBaseProps {
  readonly search?: { readonly value: string; readonly placeholder: string; readonly shortcut?: '/' };
  readonly scope?: DataTableScope;
  readonly filters: readonly FilterSpec[];
  readonly values: Readonly<Record<string, FilterValue>>;
  /** The table's View menu, placed at the end of the row. */
  readonly viewMenu?: ReactNode;
  readonly resultCount?: { readonly shown: number; readonly hasMore: boolean; readonly noun: Plural };
  readonly end?: ReactNode;
  readonly className?: string;
}

/**
 * Filter state lives either with a client parent (`onChange`) or in the URL
 * under a namespace (`urlKey`) — one or the other, never both.
 */
export type FilterBarProps = FilterBarBaseProps &
  (
    | { onChange(values: Record<string, FilterValue>): void; readonly urlKey?: never }
    | { readonly urlKey: string; readonly onChange?: never }
  );

/**
 * One row above a list: search, scope, pinned filter chips, "+ Filter",
 * "Clear all" and the result count. Every active filter is a visible chip —
 * none hides in the URL.
 *
 * Stub (SPEC §4.7): renders the region; the data package builds the controls.
 */
export function FilterBar({ className }: FilterBarProps): ReactNode {
  return <div className={cx('itsm-FilterBar', className)} />;
}
