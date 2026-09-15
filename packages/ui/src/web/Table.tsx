import { type ReactNode } from 'react';
import { cx } from './cx.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { Skeleton } from './Skeleton.js';

export type SortDirection = 'ascending' | 'descending';

export interface TableSort {
  readonly columnKey: string;
  readonly direction: SortDirection;
}

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: 'start' | 'end';
  readonly width?: string;
  /** For action columns, where a visible header would only add noise. */
  readonly headerHidden?: boolean;
}

export interface TableProps<Row> {
  /** Required: a table without a caption is unnavigable when a screen reader lists the page's tables. */
  readonly caption: string;
  readonly captionHidden?: boolean;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: TableSort | null;
  readonly onSortChange?: (sort: TableSort) => void;
  readonly selectedKeys?: readonly string[];
  /**
   * Makes rows activatable. The table then declares `role="grid"` and rows
   * become one tab stop with Up/Down between them — the queue list in the
   * workbench, where reaching row 200 by Tab is not an option.
   */
  readonly onRowActivate?: (row: Row) => void;
  readonly loading?: boolean;
  readonly skeletonRows?: number;
  readonly empty?: ReactNode;
  readonly className?: string;
}

export function Table<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  selectedKeys,
  onRowActivate,
  loading = false,
  skeletonRows = 5,
  empty,
  className,
}: TableProps<Row>): ReactNode {
  const interactive = Boolean(onRowActivate);
  const roving = useRovingTabIndex({ count: rows.length, orientation: 'vertical', loop: false });

  const nextSort = (column: TableColumn<Row>): TableSort => ({
    columnKey: column.key,
    direction: sort?.columnKey === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending',
  });

  return (
    <div className="itsm-Table__scroll">
      <table className={cx('itsm-Table', className)} role={interactive ? 'grid' : undefined} aria-busy={loading || undefined}>
        <caption className={cx(captionHidden && 'itsm-visually-hidden')}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.columnKey === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width, textAlign: column.align ?? 'start' }}
                  // `aria-sort` belongs on the header cell, not the button, and
                  // only the column actually sorted may carry it.
                  aria-sort={column.sortable && active ? sort.direction : undefined}
                >
                  {column.sortable && onSortChange ? (
                    <button type="button" className="itsm-Table__sort" onClick={() => onSortChange(nextSort(column))}>
                      <span className={cx(column.headerHidden && 'itsm-visually-hidden')}>{column.header}</span>
                      <span className="itsm-Table__sortIndicator" aria-hidden="true">
                        {active ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    <span className={cx(column.headerHidden && 'itsm-visually-hidden')}>{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <Skeleton />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => {
                const key = rowKey(row);
                const selected = selectedKeys?.includes(key);
                const itemProps = interactive ? roving.getItemProps(index) : null;
                return (
                  <tr
                    key={key}
                    aria-selected={selected}
                    tabIndex={itemProps?.tabIndex}
                    ref={itemProps ? (node: HTMLTableRowElement | null) => itemProps.ref(node) : undefined}
                    onFocus={itemProps?.onFocus}
                    onKeyDown={
                      itemProps
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onRowActivate?.(row);
                              return;
                            }
                            itemProps.onKeyDown(event);
                          }
                        : undefined
                    }
                    onClick={onRowActivate ? () => onRowActivate(row) : undefined}
                    style={onRowActivate ? { cursor: 'pointer' } : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.key} style={{ textAlign: column.align ?? 'start' }}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{empty ?? 'Nothing to show'}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
