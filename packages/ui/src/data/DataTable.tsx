'use client';

import type { ReactNode } from 'react';
import type { ActionSpec, EmptySpec, Plural, Problem } from '../types.js';
import { cx } from '../web/cx.js';
import type { ColumnSpec, DataTableScope, FilterSpec } from './types.js';

export type DataTablePagination =
  | { readonly mode: 'loadMore'; readonly hasMore: boolean; onLoadMore(): Promise<void> | void; readonly loading?: boolean }
  | { readonly mode: 'olderNewer'; readonly olderHref?: string; readonly newerHref?: string; readonly firstHref?: string }
  /** Complete client-side sets only: the API has no totals to page against. */
  | { readonly mode: 'pages'; readonly pageSize: number }
  | { readonly mode: 'none' };

export type DataTableActivate =
  | { readonly kind: 'link' }
  | { readonly kind: 'drawer'; readonly openKind: string; readonly keyField: string }
  | { readonly kind: 'callback' };

export interface DataTableProps<Row extends Record<string, unknown>> {
  readonly caption: string;
  readonly captionHidden?: boolean;
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly Row[];
  /** The field that identifies a row. */
  readonly rowKey: string;
  /** Namespaces the table's sort, search and filters in the URL. */
  readonly urlKey?: string;
  readonly sort?: { readonly columnId: string; readonly direction: 'ascending' | 'descending' } | null;
  readonly search?:
    | { readonly placeholder: string; readonly mode: 'client' | 'server'; readonly param?: string; readonly shortcut?: '/' }
    | false;
  readonly filters?: readonly FilterSpec[];
  /** Rendered as a `SegmentedControl mode="nav"`. */
  readonly scope?: DataTableScope;
  /** `false` when only some rows are loaded, so a page-sorted table says "Sorted within the 50 loaded". */
  readonly dataComplete?: boolean;
  readonly selection?: 'none' | 'single' | 'multiple';
  readonly bulkActions?: readonly ActionSpec[];
  /** The ⋯ menu and context menu; Move up and Move down are added when `reorderable`. */
  readonly rowActions?: readonly ActionSpec[];
  /** Client parent only (no Server Actions). */
  onAction?(actionId: string, rows: Row[]): void | Promise<void>;
  readonly activate?: DataTableActivate;
  /** Client parent only. */
  onActivate?(row: Row): void;
  readonly pagination?: DataTablePagination;
  readonly countNoun?: Plural;
  readonly density?: 'comfortable' | 'compact';
  readonly viewMenu?: { readonly density?: boolean; readonly columns?: boolean; readonly sort?: boolean };
  /** A refetch in flight: `aria-busy` and a 2 px line, never dimmed rows (X-74). */
  readonly refreshing?: boolean;
  readonly loading?: boolean;
  readonly skeletonRows?: number;
  readonly empty?: EmptySpec;
  readonly noResults?: EmptySpec;
  readonly problem?: Problem;
  onRetry?(): void;
  readonly virtual?: boolean;
  /** Container width in px below which rows become cards; default 640. */
  readonly cardBelow?: number;
  /** Rows to flash after a live update (at most 5, only in view). */
  readonly highlightKeys?: readonly string[];
  /** Reordering by menu and Alt+↑/↓; there is no drag. */
  readonly reorderable?: { onMove(key: string, direction: 'up' | 'down'): Promise<void> };
  /** Sticky group headers, e.g. rules by event. */
  readonly groupBy?: { readonly field: string; label(row: Row): string };
  /** Client parent only: custom cell renderers by column id. */
  readonly cells?: Partial<Record<string, (row: Row) => ReactNode>>;
  readonly toolbarEnd?: ReactNode;
  readonly className?: string;
}

/**
 * The admin list: a real `<table>` with a caption, sortable headers,
 * selection, bulk and row actions, filters, honest pagination without totals,
 * a keyboard model shared with the workbench list, and cards in narrow
 * containers. Built on TanStack Table, which is why it lives in
 * `@itsm/ui/data` rather than the root.
 *
 * Stub (SPEC §4.7): renders the caption and column headers; the data package
 * builds the table.
 */
export function DataTable<Row extends Record<string, unknown>>({
  caption,
  columns,
  className,
}: DataTableProps<Row>): ReactNode {
  return (
    <table className={cx('itsm-DataTable', className)}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
    </table>
  );
}
