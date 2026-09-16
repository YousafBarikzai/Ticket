'use client';

import type { ReactNode } from 'react';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { Table, type TableColumn, type TableProps, type TableSort } from './Table.js';

/**
 * A table whose rows can be opened and whose columns can be sorted.
 *
 * The other half of `Table`. Everything that needs a hook, a handler or a
 * keystroke is here, and everything that is just markup is there — so a screen
 * that only lists things ships no JavaScript for its table, and a screen that
 * is a queue gets the full keyboard behaviour.
 *
 * That split is not a performance nicety. `Table`'s columns carry a `cell`
 * function, and a function cannot be handed from a server component to a
 * client one; while the two were a single client component, every read-only
 * table built on the server failed at render.
 *
 * The keyboard contract is the APG's for a grid: one tab stop for the whole
 * table, Up and Down between rows, Enter or Space to open the focused one.
 * Tabbing through two hundred rows to reach the last is not a contract.
 */
export interface InteractiveTableProps<Row> extends Omit<TableProps<Row>, 'rowHandles' | 'renderHeader' | 'grid'> {
  readonly onSortChange?: (sort: TableSort) => void;
  readonly onRowActivate?: (row: Row) => void;
}

export function InteractiveTable<Row>({
  onSortChange,
  onRowActivate,
  ...props
}: InteractiveTableProps<Row>): ReactNode {
  const { rows, sort } = props;
  const interactive = Boolean(onRowActivate);
  const roving = useRovingTabIndex({ count: rows.length, orientation: 'vertical', loop: false });

  const nextSort = (column: TableColumn<Row>): TableSort => ({
    columnKey: column.key,
    direction: sort?.columnKey === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending',
  });

  return (
    <Table
      {...props}
      grid={interactive}
      renderHeader={
        onSortChange
          ? (column, label) =>
              column.sortable ? (
                <button type="button" className="itsm-Table__sort" onClick={() => onSortChange(nextSort(column))}>
                  {label}
                  <span className="itsm-Table__sortIndicator" aria-hidden="true">
                    {sort?.columnKey === column.key ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              ) : (
                label
              )
          : undefined
      }
      rowHandles={
        interactive
          ? (row, index) => {
              const item = roving.getItemProps(index);
              return {
                tabIndex: item.tabIndex,
                ref: (node: HTMLTableRowElement | null) => item.ref(node),
                onFocus: item.onFocus,
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowActivate?.(row);
                    return;
                  }
                  item.onKeyDown(event);
                },
                onClick: () => onRowActivate?.(row),
              };
            }
          : undefined
      }
    />
  );
}
