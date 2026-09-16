import { type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cx } from './cx.js';
import { Skeleton } from './Skeleton.js';

/**
 * A table, rendered on the server.
 *
 * Deliberately *not* a client component, and this is the only file in
 * `web/` that says so on purpose rather than by omission.
 *
 * A column is `{ key, header, cell }` where `cell` is a function, and a
 * function cannot cross the server/client boundary — React refuses it with
 * "Functions cannot be passed directly to Client Components". Every read-only
 * table in the administration console is built by a server component, so while
 * this file carried `'use client'` each of those screens answered 500 the
 * moment it had a row to draw. They looked fine while their lists were empty,
 * which is why it survived a build, a type-check and a test suite.
 *
 * So the interactive half lives in `InteractiveTable`, which is a client
 * component and supplies the two props below. A server component cannot reach
 * them, because it has nothing to put in them.
 *
 * `Skeleton` is a client component and is still used here. That is fine and it
 * is the distinction worth keeping hold of: rendering a client component from
 * a server one is ordinary; passing it a *function* is what fails.
 */

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

/** What a row needs to be reachable and activatable. Only `InteractiveTable` produces these. */
export interface TableRowHandles {
  readonly tabIndex?: number;
  readonly ref?: Ref<HTMLTableRowElement>;
  readonly onFocus?: (event: FocusEvent<HTMLElement>) => void;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onClick?: () => void;
}

export interface TableProps<Row> {
  /** Required: a table without a caption is unnavigable when a screen reader lists the page's tables. */
  readonly caption: string;
  readonly captionHidden?: boolean;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Display only: which column carries `aria-sort`. Changing it is `InteractiveTable`'s job. */
  readonly sort?: TableSort | null;
  readonly selectedKeys?: readonly string[];
  readonly loading?: boolean;
  readonly skeletonRows?: number;
  readonly empty?: ReactNode;
  readonly className?: string;

  /**
   * Supplied by `InteractiveTable`. A server component has no way to produce
   * one, which is the point: the table it renders is text, and text needs no
   * JavaScript shipped to draw it.
   */
  readonly rowHandles?: (row: Row, index: number) => TableRowHandles;
  /** Supplied by `InteractiveTable` to make a sortable header a button. */
  readonly renderHeader?: (column: TableColumn<Row>, label: ReactNode) => ReactNode;
  /** Declares `role="grid"`, which is only true once rows are activatable. */
  readonly grid?: boolean;
}

export function Table<Row>({
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
  rowHandles,
  renderHeader,
  grid = false,
}: TableProps<Row>): ReactNode {
  return (
    <div className="itsm-Table__scroll">
      <table className={cx('itsm-Table', className)} role={grid ? 'grid' : undefined} aria-busy={loading || undefined}>
        <caption className={cx(captionHidden && 'itsm-visually-hidden')}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.columnKey === column.key;
              const label = <span className={cx(column.headerHidden && 'itsm-visually-hidden')}>{column.header}</span>;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width, textAlign: column.align ?? 'start' }}
                  // `aria-sort` belongs on the header cell, not the button, and
                  // only the column actually sorted may carry it.
                  aria-sort={column.sortable && active ? sort.direction : undefined}
                >
                  {renderHeader ? renderHeader(column, label) : label}
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
                const handles = rowHandles?.(row, index);
                return (
                  <tr
                    key={key}
                    aria-selected={selected}
                    tabIndex={handles?.tabIndex}
                    ref={handles?.ref}
                    onFocus={handles?.onFocus}
                    onKeyDown={handles?.onKeyDown}
                    onClick={handles?.onClick}
                    style={handles?.onClick ? { cursor: 'pointer' } : undefined}
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
