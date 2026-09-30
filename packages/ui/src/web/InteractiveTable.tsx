'use client';

import { useMemo, type ReactNode } from 'react';
import { DataTable } from '../data/DataTable.js';
import type { DataTableSort } from '../data/model.js';
import type { ColumnSpec } from '../data/types.js';
import type { TableColumn, TableProps, TableSort } from './Table.js';

/**
 * @deprecated Use `DataTable` from `@itsm/ui/data` (SPEC §4.11). Kept, as a
 * thin wrapper over it, until nothing imports it; Stage 5 removes it.
 *
 * The old contract, unchanged: columns with `cell` functions, a `rowKey`
 * function, `onSortChange` for a parent that sorts, `onRowActivate` for rows
 * that open. Underneath it is now the data table, so the rows gain its
 * keyboard model and semantics: the first column holds the row's button (a
 * real control, not a focusable `<tr>`), ↑↓ and `j`/`k` move between rows,
 * Enter or Space opens one, and a click anywhere on a row opens it unless
 * text is being selected.
 */
export interface InteractiveTableProps<Row> extends Omit<TableProps<Row>, 'rowHandles' | 'renderHeader' | 'grid'> {
  readonly onSortChange?: (sort: TableSort) => void;
  readonly onRowActivate?: (row: Row) => void;
}

/** A row as the data table sees it: the caller's row under a string key. */
interface Wrapped<Row> extends Record<string, unknown> {
  readonly key: string;
  readonly row: Row;
}

/** `'7rem'` / `'120px'` → pixels; anything else (a percentage) is left to the browser. */
function pixels(width: string | undefined): number | undefined {
  if (!width) return undefined;
  const value = Number.parseFloat(width);
  if (!Number.isFinite(value)) return undefined;
  if (width.endsWith('rem') || width.endsWith('em')) return value * 16;
  if (width.endsWith('px') || /^\d+(\.\d+)?$/.test(width)) return value;
  return undefined;
}

export function InteractiveTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  sort,
  selectedKeys,
  loading = false,
  skeletonRows = 5,
  empty,
  className,
  onSortChange,
  onRowActivate,
}: InteractiveTableProps<Row>): ReactNode {
  const wrapped = useMemo<Wrapped<Row>[]>(() => rows.map((row) => ({ key: rowKey(row), row })), [rows, rowKey]);

  const specs = useMemo<ColumnSpec[]>(
    () =>
      columns.map((column) => {
        const width = pixels(column.width);
        return {
          id: column.key,
          header: typeof column.header === 'string' ? column.header : column.key,
          field: `row.${column.key}`,
          // The parent sorts: the table reports the request and draws `aria-sort`.
          sortable: column.sortable && onSortChange ? ('server' as const) : false,
          ...(column.align ? { align: column.align } : {}),
          ...(width ? { width } : {}),
          ...(column.headerHidden ? { headerHidden: true } : {}),
          hideable: false,
        };
      }),
    [columns, onSortChange],
  );

  const cells = useMemo(() => {
    const out: Record<string, (row: Wrapped<Row>) => ReactNode> = {};
    for (const column of columns as readonly TableColumn<Row>[]) out[column.key] = (wrapped) => column.cell(wrapped.row);
    return out;
  }, [columns]);

  const dataSort: DataTableSort | null = sort ? { columnId: sort.columnKey, direction: sort.direction } : null;

  return (
    <DataTable<Wrapped<Row>>
      caption={caption}
      captionHidden={captionHidden}
      columns={specs}
      rows={wrapped}
      rowKey="key"
      sort={dataSort}
      cells={cells}
      loading={loading}
      skeletonRows={skeletonRows}
      viewMenu={{ density: false, columns: false, sort: false }}
      cardBelow={0}
      {...(className ? { className } : {})}
      {...(selectedKeys ? { currentKeys: selectedKeys } : {})}
      {...(onRowActivate ? { activate: { kind: 'callback' as const }, onActivate: (wrappedRow: Wrapped<Row>) => onRowActivate(wrappedRow.row) } : {})}
      {...(onSortChange
        ? {
            onSortChange: (next: DataTableSort | null) => {
              if (next) onSortChange({ columnKey: next.columnId, direction: next.direction });
            },
          }
        : {})}
      {...(empty === undefined || empty === null ? {} : typeof empty === 'string' ? { empty: { title: empty } } : { emptyContent: empty })}
    />
  );
}
