'use client';

import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { announce } from '../a11y/announcer.js';
import { useCollectionKeyboard, type ActivateHow, type CollectionColumn } from '../a11y/collection-keyboard.js';
import { InlineAlert } from '../feedback/InlineAlert.js';
import { inSentence } from '../feedback/problem.js';
import { ProblemState } from '../feedback/ProblemState.js';
import { ProgressBar } from '../feedback/ProgressBar.js';
import { formatCount, formatNumber } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { ConfirmDialog } from '../overlays/ConfirmDialog.js';
import { ContextMenu } from '../overlays/ContextMenu.js';
import { Menu, type MenuItemSpec } from '../overlays/Menu.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { notify } from '../provider/notify.js';
import { useTheme } from '../theme/ThemeProvider.js';
import type { ActionSpec, EmptySpec, Plural, Problem } from '../types.js';
import { Button } from '../web/Button.js';
import { Checkbox } from '../web/Checkbox.js';
import { cx } from '../web/cx.js';
import { EmptyState } from '../web/EmptyState.js';
import { IconButton } from '../web/IconButton.js';
import { Skeleton } from '../web/Skeleton.js';
import { BulkActionBar, type ActionDetails } from './BulkActionBar.js';
import { renderCell, type CellContext } from './cells/index.js';
import { FilterBar } from './FilterBar.js';
import { useIsomorphicLayoutEffect, useLatest } from './latest.js';
import { LoadMore } from './LoadMore.js';
import {
  alignsEnd,
  compareSortKeys,
  fillTemplate,
  isFilterActive,
  matchesFilter,
  matchesSearch,
  nounFor,
  rowKeyOf,
  searchTextOf,
  sortKeyOf,
  sortsDescendingFirst,
  textOf,
  valueAt,
  type DataTableParamsConfig,
  type DataTableSort,
  type DataTableViewState,
} from './model.js';
import { OlderNewer } from './OlderNewer.js';
import type { CellKind, ColumnSpec, DataTableScope, FilterSpec, FilterValue } from './types.js';
import { useLocalView, useUrlView, type ServerParts, type ViewStateResult } from './view-state.js';
import { viewMenuItems, ViewMenu, type Density, type ViewMenuColumn } from './ViewMenu.js';

export type DataTablePagination =
  | { readonly mode: 'loadMore'; readonly hasMore: boolean; onLoadMore(): Promise<void> | void; readonly loading?: boolean; readonly pageSize?: number }
  | { readonly mode: 'olderNewer'; readonly olderHref?: string; readonly newerHref?: string; readonly firstHref?: string }
  /** Complete client-side sets only: the API has no totals to page against. */
  | { readonly mode: 'pages'; readonly pageSize: number }
  | { readonly mode: 'none' };

export type DataTableActivate =
  | { readonly kind: 'link' }
  | { readonly kind: 'drawer'; readonly openKind: string; readonly keyField: string }
  | { readonly kind: 'callback' };

export type { DataTableSort } from './model.js';

export interface DataTableProps<Row extends Record<string, unknown>> {
  readonly caption: string;
  readonly captionHidden?: boolean;
  readonly columns: readonly ColumnSpec[];
  readonly rows: readonly Row[];
  /** The field that identifies a row. */
  readonly rowKey: string;
  /**
   * Namespaces the table's sort, search and filters in the URL (see
   * `readDataTableParams`); `''` for the page's one main list. Without it the
   * table keeps them itself.
   */
  readonly urlKey?: string;
  /** The sort in force when the URL names none (and the sort a client parent controls, with `onSortChange`). */
  readonly sort?: DataTableSort | null;
  readonly search?:
    | { readonly placeholder: string; readonly mode: 'client' | 'server'; readonly param?: string; readonly shortcut?: '/' }
    | false;
  readonly filters?: readonly FilterSpec[];
  /** Rendered as a `SegmentedControl mode="nav"`. */
  readonly scope?: DataTableScope;
  /** `false` when only some rows are loaded, so a page-sorted table says "Sorted within the 50 loaded". Worked out from `pagination` when not given. */
  readonly dataComplete?: boolean;
  readonly selection?: 'none' | 'single' | 'multiple';
  readonly bulkActions?: readonly ActionSpec[];
  /** The ⋯ menu and context menu; Move up and Move down are added when `reorderable`. */
  readonly rowActions?: readonly ActionSpec[];
  /**
   * Client parent only: one row's ⋯ menu, in place of `rowActions`, for
   * actions that depend on the row's state — *Publish* on a draft,
   * *Reactivate* on a retired row. Every row still has the menu.
   */
  rowActionsFor?(row: Row): readonly ActionSpec[];
  /** Client parent only (no Server Actions). `details` carries a reason a confirmation asked for. */
  onAction?(actionId: string, rows: Row[], details?: ActionDetails): void | Promise<void>;
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
  /** Windows long lists (> 100 rows) with TanStack Virtual, loaded only when needed. Not with `groupBy`. */
  readonly virtual?: boolean;
  /** Container width in px below which rows become cards; default 640, `0` never. */
  readonly cardBelow?: number;
  /** Rows to flash after a live update (at most 5, only in view). */
  readonly highlightKeys?: readonly string[];
  /** Reordering by menu and Alt+↑/↓; there is no drag. */
  readonly reorderable?: { onMove(key: string, direction: 'up' | 'down'): Promise<void> };
  /** Sticky group headers, e.g. rules by event. */
  readonly groupBy?: { readonly field: string; label(row: Row): string };
  /** Client parent only: custom cell renderers by column id. The primary column's must hold no controls of its own. */
  readonly cells?: Partial<Record<string, (row: Row) => ReactNode>>;
  readonly toolbarEnd?: ReactNode;
  readonly className?: string;

  /* Additions to the §4.7 contract, all optional. */

  /** Client parent only: the sort changed (header, View menu). With it, `sort` is the parent's to hold. */
  onSortChange?(sort: DataTableSort | null): void;
  /** Client parent only: the search text changed (debounced). */
  onSearchChange?(query: string): void;
  /** Client parent only: a filter changed. */
  onFiltersChange?(values: Record<string, FilterValue>): void;
  /**
   * Rows drawn as current (`surface.selected`, the accent bar, `aria-current`):
   * the row whose drawer is open. A drawer table works this out from `?open=`
   * after hydration; passing it makes the server render agree.
   */
  readonly currentKeys?: readonly string[];
  /** Client parent only: an empty state of its own instead of `empty` (the deprecated `InteractiveTable`'s node). */
  readonly emptyContent?: ReactNode;
}

/* -------------------------------------------------------------------------
 * Constants and small helpers
 * ---------------------------------------------------------------------- */

const DEFAULT_NOUN: Plural = { one: 'item', other: 'items' };
const NO_FILTERS: readonly FilterSpec[] = [];
const NO_ACTIONS: readonly ActionSpec[] = [];
/** "Load all" stops here: a page past two hundred rows wants the server's filters, not the browser's. */
const LOAD_ALL_LIMIT = 200;
/** Windowing starts past this many rows. */
const VIRTUAL_FROM = 100;
const SEARCH_COLUMN = '__search';
const FILTER_PREFIX = '__filter:';
const HINT_KEY = 'itsm-datatable-hint';
/** Escape clearing more than this many rows offers Undo. */
const UNDO_CLEAR_FROM = 3;
/** Rows that flash at once after a live update, at most. */
const MAX_FLASH = 5;
const FLASH_MS = 1200;
/** Card layouts the stylesheet draws with a container query; any other `cardBelow` is measured. */
const CSS_CARD_BREAKPOINTS: readonly number[] = [640];

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

type Features = typeof features;
type AnyRow = Record<string, unknown>;

const LOCATION_EVENT = 'itsm:location';

function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(LOCATION_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(LOCATION_EVENT, onChange);
  };
}
const readLocationSearch = (): string => window.location.search;
const serverLocationSearch = (): string => '';

/** The column that names a row: the `title` column, else the first that links, else the first. */
function primaryOf(columns: readonly ColumnSpec[]): ColumnSpec | undefined {
  return columns.find((column) => column.kind === 'title') ?? columns.find((column) => column.href !== undefined) ?? columns[0];
}

/** Where a column goes when rows are cards. */
function cardRoleOf(column: ColumnSpec, primary: ColumnSpec | undefined, badgeId: string | undefined): NonNullable<ColumnSpec['cardRole']> {
  if (column.cardRole) return column.cardRole;
  if (column.id === primary?.id) return 'title';
  if (column.id === badgeId) return 'badge';
  return 'meta';
}

const BADGE_KINDS: ReadonlySet<CellKind> = new Set(['status', 'badge', 'priority']);

/** The words for a sort's two directions, by what the column holds. */
function directionLabels(kind: CellKind | undefined): { ascending: string; descending: string } {
  if (kind === 'date' || kind === 'datetime' || kind === 'relative') return { ascending: 'Oldest first', descending: 'Newest first' };
  if (kind === 'number' || kind === 'percent' || kind === 'currency' || kind === 'duration' || kind === 'progress') {
    return { ascending: 'Smallest first', descending: 'Largest first' };
  }
  if (kind === undefined || kind === 'text' || kind === 'title' || kind === 'mono' || kind === 'link' || kind === 'person') {
    return { ascending: 'A to Z', descending: 'Z to A' };
  }
  return { ascending: 'Ascending', descending: 'Descending' };
}

/** A card breakpoint the stylesheet knows, or `measure` for one it does not. */
function cardMode(cardBelow: number): { readonly attribute: string | undefined; readonly measure: boolean } {
  if (cardBelow <= 0) return { attribute: undefined, measure: false };
  if (CSS_CARD_BREAKPOINTS.includes(cardBelow)) return { attribute: String(cardBelow), measure: false };
  return { attribute: undefined, measure: true };
}

/** A column's width as inline geometry (the one thing inline style is for). */
function widthStyle(column: ColumnSpec, totalFr: number): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (typeof column.width === 'number') style.inlineSize = `${column.width}px`;
  else if (typeof column.width === 'string' && column.width.endsWith('fr') && totalFr > 0) {
    style.inlineSize = `${(Number.parseFloat(column.width) / totalFr) * 100}%`;
  }
  if (column.minWidth) style.minInlineSize = `${column.minWidth}px`;
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Whether an element is on screen (jsdom, with no layout, says yes). */
function inViewport(element: Element | null | undefined): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom >= 0 && rect.top <= height;
}

/** Focusable things a cell can hold besides the row's own three controls. */
const SECONDARY_FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="menuitem"], [role="option"], [contenteditable="true"]';

const VirtualRows = lazy(() => import('./VirtualRows.js'));

/* -------------------------------------------------------------------------
 * State hosts: the URL's, or the component's own
 * ---------------------------------------------------------------------- */

function initialView<Row extends AnyRow>(props: DataTableProps<Row>): DataTableViewState {
  const filters: Record<string, FilterValue> = {};
  for (const spec of props.filters ?? []) filters[spec.id] = spec.defaultValue ?? null;
  return { q: '', sort: props.sort ?? null, filters };
}

function UrlDataTable<Row extends AnyRow>(props: DataTableProps<Row> & { readonly urlKey: string }): ReactNode {
  const { urlKey, search, filters, columns, sort } = props;
  const config = useMemo<DataTableParamsConfig>(
    () => ({ urlKey, searchParam: (search && search.param) || 'q', filters: filters ?? [], columns, defaultSort: sort ?? null }),
    [urlKey, search, filters, columns, sort],
  );
  const server = useMemo<ServerParts>(
    () => ({
      search: Boolean(search && search.mode === 'server'),
      sort: (columnId) => columns.find((column) => column.id === columnId)?.sortable === 'server',
      filter: (id) => (filters ?? []).find((spec) => spec.id === id)?.mode === 'server',
    }),
    [search, columns, filters],
  );
  const state = useUrlView(config, server);
  return <DataTableView {...props} state={state} />;
}

function LocalDataTable<Row extends AnyRow>(props: DataTableProps<Row>): ReactNode {
  const state = useLocalView(initialView(props));
  // A parent that holds the sort (with `onSortChange`) changes it here.
  const sortKey = JSON.stringify(props.sort ?? null);
  const [seenSort, setSeenSort] = useState(sortKey);
  if (seenSort !== sortKey) {
    setSeenSort(sortKey);
    state.setView({ sort: props.sort ?? null });
  }
  return <DataTableView {...props} state={state} />;
}

/**
 * The admin list: a real `<table>` with a caption, sortable headers,
 * selection, bulk and row actions, filters, honest pagination without totals,
 * the keyboard model it shares with the workbench list, and cards in narrow
 * containers. Built on TanStack Table (sorting, filtering, selection,
 * visibility, paging state), which is why it lives in `@itsm/ui/data` and the
 * portal never loads it.
 *
 * - **Semantics.** Not `role=grid`: a `<table>` with `th[scope]`, `aria-sort`
 *   and a row header. Each row holds its checkbox, its primary link (or
 *   button) and its ⋯ as siblings — never one control inside another (X-62).
 *   A click elsewhere on the row goes to the primary control unless text is
 *   selected, so a title can be copied without opening it.
 * - **Keyboard** (X-64). One tab stop in the body; ↑↓ or `j`/`k` between
 *   rows, ←→ between a row's controls, `x`/Space to select, Shift to extend,
 *   mod+A for everything loaded, Enter to open, `o` as a page, mod+Enter in a
 *   new tab, `.` for the row's menu, Alt+↑/↓ to reorder, Escape to clear.
 * - **Honesty.** A sort within the loaded rows says so ("Sorted within the 50
 *   loaded", with "Load all (up to 200)"); counts never invent totals.
 * - **Refetch** is `aria-busy` and a 2 px line on the top edge — rows are
 *   never dimmed (X-74); skeleton rows are for the first load only.
 * - **Narrow containers** turn rows into cards (a container query, so it
 *   works inside a sheet as well as on a phone), keeping the checkbox and ⋯.
 */
export function DataTable<Row extends Record<string, unknown>>(props: DataTableProps<Row>): ReactNode {
  const itsm = useOptionalItsm();
  if (props.urlKey !== undefined && itsm) return <UrlDataTable {...props} urlKey={props.urlKey} />;
  return <LocalDataTable {...props} />;
}

/* -------------------------------------------------------------------------
 * The table
 * ---------------------------------------------------------------------- */

interface RowEntry<Row> {
  readonly row: Row;
  readonly key: string;
  readonly index: number;
}

interface PendingConfirm<Row> {
  readonly action: ActionSpec;
  readonly rows: Row[];
}

function DataTableView<Row extends AnyRow>(props: DataTableProps<Row> & { readonly state: ViewStateResult }): ReactNode {
  const {
    caption,
    captionHidden = false,
    rows,
    rowKey,
    search = false,
    filters = NO_FILTERS,
    scope,
    selection = 'none',
    bulkActions = NO_ACTIONS,
    rowActions = NO_ACTIONS,
    rowActionsFor,
    onAction,
    onActivate,
    pagination = { mode: 'none' },
    countNoun = DEFAULT_NOUN,
    density,
    viewMenu,
    refreshing = false,
    loading = false,
    skeletonRows = 5,
    empty,
    noResults,
    problem,
    onRetry,
    virtual = false,
    cardBelow = 640,
    highlightKeys,
    reorderable,
    groupBy,
    cells,
    toolbarEnd,
    className,
    onSortChange,
    onSearchChange,
    onFiltersChange,
    currentKeys,
    emptyContent,
    state,
  } = props;
  const { view, setView, isPending } = state;
  // Column specs are plain data, often a fresh array literal on every render
  // of the page's view component: keyed by their contents, so TanStack's row
  // models are rebuilt when a column changes rather than on every render.
  const columnsKey = JSON.stringify(props.columns);
  const columns = useMemo(() => props.columns, [columnsKey]);

  const itsm = useOptionalItsm();
  const { prefs, setPrefs } = useTheme();
  const locale = itsm?.locale ?? 'en-GB';
  const timeZone = itsm?.timeZone ?? 'UTC';
  const messages = itsm?.messages ?? defaultMessages;
  const cellContext = useMemo<CellContext>(
    () => ({ locale, timeZone, notSet: messages.notSet, Link: itsm?.Link ?? null }),
    [locale, timeZone, messages.notSet, itsm?.Link],
  );
  const ids = useId();
  const hintId = `${ids}-hint`;
  const noteId = `${ids}-note`;

  /* ---------------------------------------------------------------- columns */

  const primary = primaryOf(columns);
  const [hiddenColumns, setHiddenColumns] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(columns.map((column) => [column.id, column.defaultHidden === true])),
  );
  const isHidden = (column: ColumnSpec): boolean => hiddenColumns[column.id] ?? column.defaultHidden === true;
  const shownColumns = columns.filter(
    (column) => column.id === primary?.id || (!isHidden(column) && (!column.technical || prefs.showKeys)),
  );
  const badgeId = shownColumns.find((column) => column.id !== primary?.id && column.kind !== undefined && BADGE_KINDS.has(column.kind))?.id;
  const totalFr = shownColumns.reduce((sum, column) => sum + (typeof column.width === 'string' ? Number.parseFloat(column.width) || 0 : 0), 0);

  const activate: DataTableActivate | undefined =
    props.activate ?? (onActivate ? { kind: 'callback' } : primary?.href ? { kind: 'link' } : undefined);

  /* ------------------------------------------------------------ the model */

  const clientSearch = search !== false && search.mode === 'client';
  // Keyed by what shapes the model (not `loadOptions`, which only the chip calls).
  const filtersKey = JSON.stringify(filters.map(({ id, type, mode, field }) => [id, type, mode, field]));
  const clientFilters = useMemo(() => filters.filter((spec) => (spec.mode ?? 'client') === 'client'), [filtersKey]);
  const sortColumn = view.sort ? columns.find((column) => column.id === view.sort?.columnId && column.sortable) : undefined;
  const serverSorted = sortColumn?.sortable === 'server';

  const tableColumns = useMemo<ColumnDef<Features, Row>[]>(
    () => [
      ...columns.map<ColumnDef<Features, Row>>((spec) => ({
        id: spec.id,
        accessorFn: (row: Row) => sortKeyOf(spec, row),
        sortFn: (a, b, id) => compareSortKeys(a.getValue(id) as number | string | undefined, b.getValue(id) as number | string | undefined),
        sortUndefined: 'last',
        enableSorting: spec.sortable === 'page' || spec.sortable === 'server',
        enableGlobalFilter: false,
        enableColumnFilter: false,
      })),
      {
        id: SEARCH_COLUMN,
        accessorFn: (row: Row) => searchTextOf(columns, row),
        enableSorting: false,
        enableGlobalFilter: true,
        enableColumnFilter: false,
      },
      ...clientFilters.map<ColumnDef<Features, Row>>((spec) => {
        const field = spec.field ?? columns.find((column) => column.id === spec.id)?.field ?? spec.id;
        return {
          id: `${FILTER_PREFIX}${spec.id}`,
          accessorFn: (row: Row) => valueAt(row, field),
          filterFn: (row, id, value) => matchesFilter(spec.type, value as FilterValue, row.getValue(id), timeZone),
          enableSorting: false,
          enableGlobalFilter: false,
          enableColumnFilter: true,
        };
      }),
    ],
    [columns, clientFilters, timeZone],
  );

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const paged = pagination.mode === 'pages';

  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = { [SEARCH_COLUMN]: false };
    for (const column of columns) visibility[column.id] = shownColumns.includes(column);
    for (const spec of clientFilters) visibility[`${FILTER_PREFIX}${spec.id}`] = false;
    return visibility;
  }, [columns, shownColumns, clientFilters]);

  const rowSelection = useMemo(() => Object.fromEntries([...selected].map((key) => [key, true as const])), [selected]);

  // Each slice keeps its identity while its contents do, so the row models
  // TanStack memoises are rebuilt only when something they depend on changed.
  const sortDirection = view.sort?.direction;
  const sortId = sortColumn ? view.sort?.columnId : undefined;
  const sorting = useMemo(() => (sortId ? [{ id: sortId, desc: sortDirection === 'descending' }] : []), [sortId, sortDirection]);
  const filterSignature = JSON.stringify(view.filters);
  const columnFilters = useMemo(
    () =>
      clientFilters
        .filter((spec) => isFilterActive(view.filters[spec.id] ?? null))
        .map((spec) => ({ id: `${FILTER_PREFIX}${spec.id}`, value: view.filters[spec.id] })),
    // The filters' contents, not the object that holds them.
    [clientFilters, filterSignature],
  );
  const pageSize = paged ? pagination.pageSize : Math.max(1, rows.length);
  const paginationState = useMemo(() => ({ pageIndex, pageSize }), [pageIndex, pageSize]);
  const getRowId = useCallback((row: Row) => rowKeyOf(row, rowKey), [rowKey]);

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows as Row[],
    getRowId,
    state: {
      sorting,
      globalFilter: clientSearch ? view.q : '',
      columnFilters,
      rowSelection,
      columnVisibility,
      pagination: paginationState,
    },
    manualSorting: serverSorted,
    manualPagination: !paged,
    enableMultiSort: false,
    enableRowSelection: selection !== 'none',
    enableMultiRowSelection: selection === 'multiple',
    getColumnCanGlobalFilter: (column) => column.id === SEARCH_COLUMN,
    globalFilterFn: (row, id, query) => matchesSearch(String(row.getValue(id) ?? ''), String(query ?? '')),
    autoResetPageIndex: false,
  });

  const keyOf = getRowId;
  /** Every row that passes the search and filters, in order — what "select all" and the count mean. */
  const matchedModel = table.getPrePaginatedRowModel().rows;
  const matched = useMemo(() => matchedModel.map((row) => row.original), [matchedModel]);
  const pageModel = table.getRowModel().rows;

  // Grouping: rows of a group together, groups in the order they first
  // appear; each row keeps its place in the one keyboard order.
  const { ordered, groups } = useMemo(() => {
    const pageRows = pageModel.map((row) => row.original);
    if (!groupBy) {
      return { ordered: pageRows.map((row, index): RowEntry<Row> => ({ row, key: keyOf(row), index })), groups: null };
    }
    const order: string[] = [];
    const byValue = new Map<string, { label: string; rows: Row[] }>();
    for (const row of pageRows) {
      const value = String(valueAt(row, groupBy.field) ?? '');
      let group = byValue.get(value);
      if (!group) {
        group = { label: groupBy.label(row), rows: [] };
        byValue.set(value, group);
        order.push(value);
      }
      group.rows.push(row);
    }
    let index = 0;
    const grouped = order.map((value) => {
      const group = byValue.get(value)!;
      return { value, label: group.label, entries: group.rows.map((row): RowEntry<Row> => ({ row, key: keyOf(row), index: index++ })) };
    });
    return { ordered: grouped.flatMap((group) => group.entries), groups: grouped };
  }, [pageModel, groupBy, keyOf]);

  /* ------------------------------------------------------------ honesty */

  const complete =
    props.dataComplete ??
    (pagination.mode === 'loadMore' ? !pagination.hasMore : pagination.mode === 'olderNewer' ? !pagination.olderHref && !pagination.newerHref : true);
  const narrowing = (clientSearch && view.q.trim() !== '') || clientFilters.some((spec) => isFilterActive(view.filters[spec.id] ?? null));
  const loadedWords = `the ${formatNumber(rows.length, { locale })} loaded`;
  const countText = narrowing
    ? complete
      ? formatCount(matched.length, false, countNoun, locale)
      : `${formatNumber(matched.length, { locale })} ${matched.length === 1 ? 'match' : 'matches'} in ${loadedWords}`
    : formatCount(rows.length, !complete, countNoun, locale);
  const pageSorted = sortColumn?.sortable === 'page' && !complete && rows.length > 0;
  const sortNote = pageSorted ? `Sorted within ${loadedWords}` : undefined;
  const canLoadAll = pageSorted && pagination.mode === 'loadMore' && pagination.hasMore && rows.length < LOAD_ALL_LIMIT;

  /* ------------------------------------------------------------ selection */

  const selectable = selection !== 'none';
  const multiple = selection === 'multiple';
  const selectedRows = matched.filter((row) => selected.has(keyOf(row)));
  const anySelected = selectedRows.length > 0;
  const [selectMode, setSelectMode] = useState(false);
  const anchor = useRef<number | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sayCount = (next: ReadonlySet<string>): void => {
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      const count = matched.filter((row) => next.has(keyOf(row))).length;
      announce(count === 0 ? 'Selection cleared' : `${formatNumber(count, { locale })} selected`);
    }, 300);
  };
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const commitSelection = (next: ReadonlySet<string>, options: { readonly quiet?: boolean } = {}): void => {
    setSelected(next);
    if (options.quiet) clearTimeout(announceTimer.current);
    else sayCount(next);
  };

  const toggle = (index: number): void => {
    const entry = ordered[index];
    if (!entry || !selectable) return;
    anchor.current = index;
    const next = new Set(multiple ? selected : []);
    if (selected.has(entry.key)) next.delete(entry.key);
    else next.add(entry.key);
    commitSelection(next);
  };
  const extend = (from: number, to: number): void => {
    if (!multiple) return;
    const [low, high] = from <= to ? [from, to] : [to, from];
    const next = new Set(selected);
    for (let index = low; index <= high; index++) {
      const entry = ordered[index];
      if (entry) next.add(entry.key);
    }
    commitSelection(next);
  };
  const selectAll = (): void => {
    if (!multiple) return;
    commitSelection(new Set(matched.map(keyOf)));
  };
  const clearSelection = (): 'cleared' | 'confirm' | 'none' => {
    const previous = selected;
    const count = selectedRows.length;
    if (count === 0) return 'none';
    // Past three rows the toast says it (and offers Undo); the live region stays quiet.
    commitSelection(new Set(), { quiet: count > UNDO_CLEAR_FROM });
    if (count > UNDO_CLEAR_FROM) {
      notify(messages.selectionCleared, {
        undo: async () => {
          setSelected(previous);
          sayCount(previous);
        },
      });
      return 'confirm';
    }
    return 'cleared';
  };

  /* ------------------------------------------------------------ activation */

  const locationSearch = useSyncExternalStore(subscribeLocation, readLocationSearch, serverLocationSearch);
  const openParam = new URLSearchParams(locationSearch).get('open');
  const Link = itsm?.Link ?? null;

  const primaryHref = (row: Row): string | undefined => (primary?.href ? fillTemplate(primary.href, row) : undefined);
  const drawerValue = (row: Row): string | undefined =>
    activate?.kind === 'drawer' ? `${activate.openKind}:${String(valueAt(row, activate.keyField) ?? keyOf(row))}` : undefined;
  const drawerHref = (row: Row): string => {
    const params = new URLSearchParams(locationSearch);
    params.set('open', drawerValue(row) ?? '');
    return `?${params.toString()}`;
  };
  const isCurrent = (row: Row, key: string): boolean =>
    (currentKeys?.includes(key) ?? false) || (activate?.kind === 'drawer' && openParam !== null && openParam === drawerValue(row));

  const rowElements = useRef<(HTMLTableRowElement | null)[]>([]);

  const openDrawer = (row: Row): void => {
    const value = drawerValue(row);
    if (!value) return;
    const params = new URLSearchParams(window.location.search);
    const alreadyOpen = params.has('open');
    params.set('open', value);
    const href = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    // Opening pushes, so Back closes it; switching rows with one open replaces,
    // so Back does not step through every row looked at (SPEC §4.10).
    if (alreadyOpen) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    window.dispatchEvent(new Event(LOCATION_EVENT));
    onActivate?.(row);
  };

  const navigate = (href: string, index: number): void => {
    const anchorElement = rowElements.current[index]?.querySelector<HTMLAnchorElement>('a[data-itsm-control="primary"]');
    if (anchorElement && anchorElement.getAttribute('href') === href) anchorElement.click();
    else if (itsm) itsm.router.push(href);
    else window.location.assign(href);
  };

  const activateRow = (index: number, how: ActivateHow): void => {
    const entry = ordered[index];
    if (!entry || !activate) return;
    const { row } = entry;
    switch (activate.kind) {
      case 'link': {
        const href = primaryHref(row);
        if (!href) return;
        if (how === 'newTab') window.open(href, '_blank', 'noopener');
        else navigate(href, index);
        return;
      }
      case 'drawer': {
        if (how === 'newTab') {
          window.open(drawerHref(row), '_blank', 'noopener');
          return;
        }
        const page = primaryHref(row);
        if (how === 'page' && page) {
          navigate(page, index);
          return;
        }
        openDrawer(row);
        return;
      }
      case 'callback':
        onActivate?.(row);
        return;
    }
  };

  /* ------------------------------------------------------------ actions */

  const [confirming, setConfirming] = useState<PendingConfirm<Row> | null>(null);
  const [lastConfirm, setLastConfirm] = useState<PendingConfirm<Row> | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const kbRef = useRef<ReturnType<typeof useCollectionKeyboard> | null>(null);

  const runAction = async (action: ActionSpec, targets: Row[], details?: ActionDetails): Promise<void> => {
    await onAction?.(action.id, targets, details);
  };
  const requestRowAction = (action: ActionSpec, row: Row): void => {
    if (action.disabled) return;
    if (action.confirm) {
      // After the menu has closed and handed focus back to the row.
      setTimeout(() => {
        const pending = { action, rows: [row] };
        setConfirming(pending);
        setLastConfirm(pending);
      }, 0);
      return;
    }
    void Promise.resolve(runAction(action, [row])).catch(() => undefined);
  };
  const runBulk = async (id: string, details?: ActionDetails): Promise<void> => {
    const action = bulkActions.find((candidate) => candidate.id === id);
    if (!action) return;
    const targets = selectedRows;
    setBulkBusy(`${action.label}…`);
    try {
      await runAction(action, targets, details);
      // Done: the bar goes with the selection, and focus goes back to the rows.
      commitSelection(new Set(), { quiet: true });
      setTimeout(() => kbRef.current?.focusActive(), 0);
    } finally {
      setBulkBusy(null);
    }
  };

  /* ------------------------------------------------------------ reordering */

  const sorted = view.sort !== null;
  const reorderBlocked = !reorderable
    ? undefined
    : sorted
      ? 'Clear the sort to reorder'
      : narrowing || view.q.trim() !== '' || filters.some((spec) => isFilterActive(view.filters[spec.id] ?? null))
        ? 'Clear the filters to reorder'
        : undefined;
  const moving = useRef(false);
  const followKey = useRef<string | null>(null);

  const siblingsOf = (index: number): { first: boolean; last: boolean } => {
    const entry = ordered[index];
    if (!entry) return { first: true, last: true };
    if (groups && groupBy) {
      const value = String(valueAt(entry.row, groupBy.field) ?? '');
      const members = ordered.filter((candidate) => String(valueAt(candidate.row, groupBy.field) ?? '') === value);
      return { first: members[0]?.key === entry.key, last: members[members.length - 1]?.key === entry.key };
    }
    return { first: index === 0, last: index === ordered.length - 1 };
  };

  const move = async (index: number, direction: 'up' | 'down'): Promise<void> => {
    const entry = ordered[index];
    if (!entry || !reorderable || reorderBlocked || moving.current) return;
    const edge = siblingsOf(index);
    if ((direction === 'up' && edge.first) || (direction === 'down' && edge.last)) return;
    moving.current = true;
    followKey.current = entry.key;
    try {
      await reorderable.onMove(entry.key, direction);
    } catch {
      followKey.current = null;
    } finally {
      moving.current = false;
    }
  };

  // The moved row keeps focus, and its new place is said.
  useEffect(() => {
    const key = followKey.current;
    if (!key) return;
    const index = ordered.findIndex((entry) => entry.key === key);
    if (index < 0) return;
    followKey.current = null;
    kbRef.current?.setActiveIndex(index, { focus: true });
    const name = nameOf(ordered[index]!.row);
    announce(`${name} moved to position ${formatNumber(index + 1, { locale })} of ${formatNumber(ordered.length, { locale })}`);
    // Runs when the order changes; the rest it reads is this render's.
  }, [ordered]);

  /* ------------------------------------------------------------ menus */

  const nameOf = (row: Row): string => (primary ? textOf(primary, valueAt(row, primary.field)) : '') || keyOf(row);
  const hasMenu = rowActions.length > 0 || rowActionsFor !== undefined || reorderable !== undefined;
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const [contextKey, setContextKey] = useState<string | null>(null);

  const itemFor = (action: ActionSpec, row: Row): MenuItemSpec => {
    const href = action.href ? fillTemplate(action.href, row) : undefined;
    return {
      id: action.id,
      label: action.label,
      ...(action.icon ? { icon: action.icon } : {}),
      ...(action.shortcut ? { shortcut: action.shortcut } : {}),
      ...(action.tone ? { tone: action.tone } : {}),
      ...(href ? { href } : {}),
      ...(action.disabled || (action.href && !href) ? { disabled: true } : {}),
      ...(action.disabledReason ? { disabledReason: action.disabledReason } : {}),
      ...(href ? {} : { onSelect: () => requestRowAction(action, row) }),
    };
  };

  const menuItemsFor = (entry: RowEntry<Row>): MenuItemSpec[] => {
    const actions = rowActionsFor ? rowActionsFor(entry.row) : rowActions;
    const safe = actions.filter((action) => action.tone !== 'danger').map((action) => itemFor(action, entry.row));
    const danger = actions.filter((action) => action.tone === 'danger').map((action) => itemFor(action, entry.row));
    const items: MenuItemSpec[] = [...safe];
    if (reorderable) {
      const edge = siblingsOf(entry.index);
      if (items.length > 0) items.push({ type: 'separator' });
      items.push(
        {
          id: 'move-up',
          label: 'Move up',
          icon: 'arrow-up',
          shortcut: 'alt+up',
          ...(reorderBlocked || edge.first ? { disabled: true, ...(reorderBlocked ? { disabledReason: reorderBlocked } : {}) } : {}),
          onSelect: () => void move(entry.index, 'up'),
        },
        {
          id: 'move-down',
          label: 'Move down',
          icon: 'arrow-down',
          shortcut: 'alt+down',
          ...(reorderBlocked || edge.last ? { disabled: true, ...(reorderBlocked ? { disabledReason: reorderBlocked } : {}) } : {}),
          onSelect: () => void move(entry.index, 'down'),
        },
      );
    }
    if (danger.length > 0) {
      if (items.length > 0) items.push({ type: 'separator' });
      items.push(...danger);
    }
    return items;
  };

  /* ------------------------------------------------------------ keyboard */

  // A link table whose title column has no link template has no primary control to move to.
  const hasPrimaryControl = activate !== undefined && primary !== undefined && (activate.kind !== 'link' || primary.href !== undefined);
  const keyboardColumns: CollectionColumn[] = [
    ...(selectable ? (['select'] as const) : []),
    ...(hasPrimaryControl ? (['primary'] as const) : []),
    ...(hasMenu ? (['menu'] as const) : []),
  ];
  const kb = useCollectionKeyboard({
    count: ordered.length,
    getRow: (index) => rowElements.current[index] ?? null,
    columns: keyboardColumns,
    onActivate: activateRow,
    ...(selectable ? { onToggleSelect: toggle, onClearSelection: clearSelection } : {}),
    ...(multiple ? { onExtendSelect: extend, onSelectAll: selectAll } : {}),
    ...(hasMenu
      ? {
          onRowMenu: (index: number) => {
            const entry = ordered[index];
            if (!entry) return;
            menuReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setMenuKey(entry.key);
          },
        }
      : {}),
    onActiveChange: (index) => {
      if (!virtualScroll.current || rowElements.current[index]) return;
      awaitingRow.current = index;
      virtualScroll.current(index);
    },
  });
  useIsomorphicLayoutEffect(() => {
    kbRef.current = kb;
  });

  // Anything else focusable in a row — a link in another column, a people
  // stack's disclosure, a control in a custom cell — joins the tab order only
  // in the current row: Tab from the row's link reaches it, and the next Tab
  // leaves the table, rather than walking every row (X-64).
  useIsomorphicLayoutEffect(() => {
    rowElements.current.forEach((row, index) => {
      if (!row) return;
      for (const element of row.querySelectorAll<HTMLElement>(SECONDARY_FOCUSABLE)) {
        if (element.hasAttribute('data-itsm-control')) continue;
        element.tabIndex = index === kb.activeIndex ? 0 : -1;
      }
    });
  });

  const [hintDone, setHintDone] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(HINT_KEY)) setHintDone(true);
    } catch {
      // Storage blocked: the hint shows on focus, which is harmless.
    }
  }, []);
  const dismissHint = (): void => {
    if (hintDone) return;
    setHintDone(true);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      // As above.
    }
  };

  const onBodyKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement;
    const holder = target.closest<HTMLElement>('tbody [data-itsm-row]');
    if (!holder) return;
    if (event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && reorderable) {
      event.preventDefault();
      void move(Number(holder.getAttribute('data-itsm-row')), event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'j', 'k', 'x', ' '].includes(event.key)) dismissHint();
    kb.onKeyDown(event);
  };

  // In development, say so when a custom cell puts a control inside the
  // row's primary link or button: invalid HTML that screen readers flatten
  // (X-62), and nothing else would notice it.
  useEffect(() => {
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'development') return;
    const nested = frame.current?.querySelector('.itsm-DataTable__primary :is(a[href], button, input, select, textarea, [role="button"])');
    if (nested) {
      console.warn(`@itsm/ui DataTable "${caption}": a cell renderer put a control inside the row's primary ${activate?.kind === 'callback' ? 'button' : 'link'}. Keep the primary column to text; give other controls a column of their own.`);
    }
  });

  /* ------------------------------------------------------------ live flash */

  const [flashing, setFlashing] = useState<ReadonlyMap<string, number>>(() => new Map());
  const flashTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const highlightSignature = JSON.stringify(highlightKeys ?? []);
  useEffect(() => {
    const keys = (JSON.parse(highlightSignature) as string[])
      .filter((key) => inViewport(rowElements.current[ordered.findIndex((entry) => entry.key === key)]))
      .slice(0, MAX_FLASH);
    if (keys.length === 0) return;
    setFlashing((current) => {
      const next = new Map(current);
      for (const key of keys) next.set(key, (current.get(key) ?? 0) + 1);
      return next;
    });
    // Not cancelled by the next update: a flash that has started runs its course.
    const timer = setTimeout(() => {
      flashTimers.current.delete(timer);
      setFlashing((current) => {
        const next = new Map(current);
        for (const key of keys) next.delete(key);
        return next;
      });
    }, FLASH_MS);
    flashTimers.current.add(timer);
    // Only a new set of keys flashes; a re-render with the same set does not.
  }, [highlightSignature]);
  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /* ------------------------------------------------------------ geometry */

  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  const [stuck, setStuck] = useState(false);
  const { attribute: cardAttribute, measure: measureCards } = cardMode(cardBelow);
  const [measuredCards, setMeasuredCards] = useState(false);

  // Horizontal scrolling only when the table is wider than its box: a
  // scrolling box would otherwise stop the header sticking to the window.
  useEffect(() => {
    const box = scroller.current;
    if (!box || typeof ResizeObserver === 'undefined') {
      setFits(true);
      return;
    }
    const measure = (): void => {
      const tableElement = box.querySelector('table');
      setFits(!tableElement || tableElement.scrollWidth <= box.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const tableElement = box.querySelector('table');
    if (tableElement) observer.observe(tableElement);
    measure();
    return () => observer.disconnect();
  }, []);

  // A header that has stuck to the top gets its hairline and shadow.
  useEffect(() => {
    const marker = sentinel.current;
    if (!marker || typeof IntersectionObserver === 'undefined') return;
    const header = frame.current?.querySelector('thead th');
    const offset = header ? Number.parseFloat(getComputedStyle(header).top) || 0 : 0;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setStuck(!entry.isIntersecting && entry.boundingClientRect.top < offset);
      },
      { rootMargin: `${-offset - 1}px 0px 0px 0px`, threshold: [0] },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);

  // A `cardBelow` the stylesheet has no container query for is measured.
  useIsomorphicLayoutEffect(() => {
    if (!measureCards) {
      setMeasuredCards(false);
      return;
    }
    const box = frame.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setMeasuredCards(box.clientWidth > 0 && box.clientWidth < cardBelow);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, [measureCards, cardBelow]);

  /* ------------------------------------------------------------ virtual */

  const virtualScroll = useRef<((index: number) => void) | null>(null);
  /** A row the keyboard moved to before the window had rendered it: focused once it has. */
  const awaitingRow = useRef<number | null>(null);
  const onWindowRendered = useCallback(() => {
    const index = awaitingRow.current;
    if (index === null || !rowElements.current[index]) return;
    awaitingRow.current = null;
    kbRef.current?.focusActive();
  }, []);
  const windowed = virtual && !groups && ordered.length > VIRTUAL_FROM;

  /* ------------------------------------------------------------ load all */

  const latest = useLatest({ pagination, rows });
  const [loadingAll, setLoadingAll] = useState(false);
  const rowsArrived = useRef<(() => void)[]>([]);
  useEffect(() => {
    const waiting = rowsArrived.current;
    rowsArrived.current = [];
    for (const resolve of waiting) resolve();
  }, [rows.length]);
  const loadAll = async (): Promise<void> => {
    setLoadingAll(true);
    try {
      for (let attempt = 0; attempt < LOAD_ALL_LIMIT; attempt++) {
        const current = latest.current;
        if (current.pagination.mode !== 'loadMore' || !current.pagination.hasMore || current.rows.length >= LOAD_ALL_LIMIT) break;
        const before = current.rows.length;
        const arrived = new Promise<void>((resolve) => {
          rowsArrived.current.push(resolve);
          setTimeout(resolve, 5_000);
        });
        await current.pagination.onLoadMore();
        await arrived;
        if (latest.current.rows.length === before) break;
      }
      announce(`${formatNumber(latest.current.rows.length, { locale })} ${nounFor(latest.current.rows.length, countNoun)} loaded`);
    } finally {
      setLoadingAll(false);
    }
  };

  /* ------------------------------------------------------------ view menu */

  const setSort = (sort: DataTableSort | null): void => {
    setView({ sort });
    onSortChange?.(sort);
    setPageIndex(0);
  };
  const setQuery = (q: string): void => {
    setView({ q });
    onSearchChange?.(q);
    setPageIndex(0);
  };
  const setFilters = (values: Record<string, FilterValue>): void => {
    setView({ filters: values });
    onFiltersChange?.(values);
    setPageIndex(0);
  };
  const clearFilters = (): void => {
    const cleared: Record<string, FilterValue> = {};
    for (const spec of filters) cleared[spec.id] = null;
    setView({ q: '', filters: cleared });
    onSearchChange?.('');
    onFiltersChange?.(cleared);
  };

  const sortable = columns.filter((column) => column.sortable === 'page' || column.sortable === 'server');
  const nextSort = (column: ColumnSpec): DataTableSort => {
    if (view.sort?.columnId === column.id) return { columnId: column.id, direction: view.sort.direction === 'ascending' ? 'descending' : 'ascending' };
    return { columnId: column.id, direction: sortsDescendingFirst(column.kind) ? 'descending' : 'ascending' };
  };

  const [densityChoice, setDensityChoice] = useState<Density | null>(null);
  const effectiveDensity = densityChoice ?? density;
  const hideableColumns: ViewMenuColumn[] = columns
    .filter((column) => column.id !== primary?.id && (!column.technical || prefs.showKeys))
    .map((column) => ({ id: column.id, label: column.header, visible: !isHidden(column), hideable: column.hideable !== false }));
  const technicalColumns = columns.some((column) => column.technical);
  const showSortMenu = (viewMenu?.sort ?? true) && sortable.length > 0;
  const showDensity = viewMenu?.density ?? true;
  const showColumns = (viewMenu?.columns ?? true) && hideableColumns.some((column) => column.hideable);
  const directions = directionLabels(sortColumn?.kind);
  const viewMenuProps = {
    ...(showSortMenu
      ? {
          sort: {
            options: [...(props.sort ? [] : [{ value: '', label: 'Default order' }]), ...sortable.map((column) => ({ value: column.id, label: column.header }))],
            value: view.sort?.columnId ?? '',
            onChange: (value: string) => {
              const column = sortable.find((candidate) => candidate.id === value);
              setSort(column ? { columnId: column.id, direction: view.sort?.direction ?? (sortsDescendingFirst(column.kind) ? 'descending' : 'ascending') } : null);
            },
          },
        }
      : {}),
    density: showDensity,
    densityValue: effectiveDensity ?? prefs.density,
    onDensityChange: (next: Density) => {
      setDensityChoice(next);
      setPrefs({ density: next });
    },
    ...(showColumns
      ? {
          columns: hideableColumns,
          onColumnsChange: (next: ViewMenuColumn[]) =>
            setHiddenColumns((current) => ({ ...current, ...Object.fromEntries(next.map((column) => [column.id, !column.visible])) })),
        }
      : {}),
    extra: [
      ...(showSortMenu && view.sort
        ? [
            {
              type: 'radio' as const,
              id: 'direction',
              label: 'Order',
              value: view.sort.direction,
              items: [
                { value: 'ascending', label: directions.ascending },
                { value: 'descending', label: directions.descending },
              ],
              onValueChange: (value: string) =>
                view.sort && setSort({ columnId: view.sort.columnId, direction: value === 'descending' ? 'descending' : 'ascending' }),
            },
          ]
        : []),
      ...(technicalColumns && (itsm?.app ?? 'admin') === 'admin'
        ? [{ type: 'checkbox' as const, id: 'show-keys', label: 'Show technical keys', checked: prefs.showKeys, onCheckedChange: (checked: boolean) => setPrefs({ showKeys: checked }) }]
        : []),
    ],
  };
  const viewMenuOffers = viewMenuItems(viewMenuProps).length > 0;

  /* ------------------------------------------------------------ rendering */

  const busy = refreshing || isPending || (loading && rows.length > 0) || loadingAll;
  const firstLoad = loading && rows.length === 0;
  // With nothing to find, filter or act on yet, a toolbar of a View menu and "0 items" is noise.
  const hasToolbar =
    search !== false || filters.length > 0 || scope !== undefined || toolbarEnd !== undefined || ((viewMenuOffers || selectable) && rows.length > 0);
  const colSpan = shownColumns.length + (selectable ? 1 : 0) + (hasMenu ? 1 : 0);
  const allSelected = matched.length > 0 && selectedRows.length === matched.length;
  const someSelected = anySelected && !allSelected;
  const nounPlural = countNoun.other;
  const showHint = !hintDone && ordered.length > 1 && keyboardColumns.length > 0;
  const hint = selectable
    ? `Use arrow keys to move; ${prefs.shortcuts === 'off' ? 'Space' : 'x'} selects`
    : 'Use arrow keys to move between rows';
  const cardsOn = measuredCards;

  const renderRow = (entry: RowEntry<Row>, measure?: (element: HTMLTableRowElement | null) => void): ReactNode => {
    const { row, key, index } = entry;
    const name = nameOf(row);
    const isSelected = selected.has(key);
    const current = isCurrent(row, key);
    const flash = flashing.get(key);
    const primaryControl = (content: ReactNode): ReactNode => {
      if (!activate) return content;
      const control = kb.getControlProps(index, 'primary');
      switch (activate.kind) {
        case 'link': {
          const href = primaryHref(row);
          if (!href) return content;
          return Link ? (
            <Link href={href} prefetch={false} className="itsm-DataTable__primary" {...control}>
              {content}
            </Link>
          ) : (
            <a href={href} className="itsm-DataTable__primary" {...control}>
              {content}
            </a>
          );
        }
        case 'drawer':
          return (
            <a
              href={drawerHref(row)}
              className="itsm-DataTable__primary"
              {...control}
              aria-haspopup="dialog"
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openDrawer(row);
              }}
            >
              {content}
            </a>
          );
        case 'callback':
          return (
            <button type="button" className="itsm-DataTable__primary" {...control} onClick={() => onActivate?.(row)}>
              {content}
            </button>
          );
      }
    };

    return (
      <tr
        key={key}
        ref={(element) => {
          rowElements.current[index] = element;
          measure?.(element);
        }}
        {...kb.getRowProps(index)}
        {...(windowed ? { 'data-index': index, 'aria-rowindex': index + 2 } : {})}
        className="itsm-DataTable__row"
        data-selected={isSelected ? '' : undefined}
        data-current={current ? '' : undefined}
        aria-current={current ? 'true' : undefined}
        data-flash={flash === undefined ? undefined : flash % 2 === 0 ? 'even' : 'odd'}
        data-activatable={activate ? '' : undefined}
        onClick={(event: MouseEvent<HTMLTableRowElement>) => {
          if (event.defaultPrevented) return;
          // A click inside a portalled menu bubbles through React, not the DOM.
          if (!event.currentTarget.contains(event.target as Node)) return;
          const target = event.target as HTMLElement;
          // The checkbox's hit ring and the ⋯ cell answer for themselves.
          if (target.closest(INTERACTIVE) || target.closest('.itsm-DataTable__selectCell, .itsm-DataTable__actionsCell')) return;
          // Selecting text to copy it is not a request to open the row (X-62).
          if ((window.getSelection?.()?.toString() ?? '').trim() !== '') return;
          if (selectMode && selectable) {
            toggle(index);
            return;
          }
          activateRow(index, event.metaKey || event.ctrlKey ? 'newTab' : 'inPlace');
        }}
      >
        {selectable ? (
          <td className="itsm-DataTable__selectCell" data-card-role="select">
            <Checkbox
              className="itsm-DataTable__checkbox"
              label={`Select ${name}`}
              labelHidden
              checked={isSelected}
              {...kb.getControlProps(index, 'select')}
              onChange={() => undefined}
              onClick={(event: MouseEvent<HTMLInputElement>) => {
                if (event.shiftKey && multiple && anchor.current !== null) {
                  event.preventDefault();
                  extend(anchor.current, index);
                  anchor.current = index;
                  return;
                }
                toggle(index);
              }}
            />
          </td>
        ) : null}
        {shownColumns.map((column) => {
          const isPrimary = column.id === primary?.id;
          const custom = cells?.[column.id];
          const content = custom ? custom(row) : renderCell(column, row, cellContext, { primary: isPrimary && hasPrimaryControl });
          const role = cardRoleOf(column, primary, badgeId);
          const shared = {
            className: cx('itsm-DataTable__cell', isPrimary && 'itsm-DataTable__primaryCell', column.truncate && 'itsm-DataTable__clamp'),
            'data-align': column.align ?? (alignsEnd(column.kind) ? 'end' : undefined),
            'data-hide-below': column.hideBelow,
            'data-card-role': role,
            'data-lines': column.truncate,
            'data-kind': column.kind ?? 'text',
          };
          if (isPrimary) {
            return (
              <th key={column.id} scope="row" {...shared}>
                {flash !== undefined ? <span className="itsm-DataTable__updated" aria-hidden="true" /> : null}
                {primaryControl(content)}
              </th>
            );
          }
          return (
            <td key={column.id} {...shared}>
              {role === 'meta' || role === 'subtitle' ? <span className="itsm-DataTable__cellLabel">{column.header}: </span> : null}
              {content}
            </td>
          );
        })}
        {hasMenu ? (
          <td className="itsm-DataTable__actionsCell" data-card-role="menu">
            <Menu
              label={`Actions for ${name}`}
              align="end"
              open={menuKey === key}
              onOpenChange={(open) => {
                if (open && menuKey !== key) menuReturn.current = rowElements.current[index]?.querySelector<HTMLElement>('[data-itsm-control="menu"]') ?? null;
                setMenuKey(open ? key : null);
              }}
              onCloseFocus={menuReturn}
              items={menuItemsFor(entry)}
              trigger={
                <IconButton
                  className="itsm-DataTable__menuButton"
                  label={`More actions for ${name}`}
                  icon="ellipsis"
                  size="sm"
                  variant="ghost"
                  tooltip={false}
                  {...kb.getControlProps(index, 'menu')}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                    // In a list, ↑↓ move between rows, as from any other control
                    // in the row; the menu opens with Enter, Space or ".". Taken
                    // here, before the menu button's own handler opens it on ↓.
                    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.metaKey && !event.ctrlKey) onBodyKeyDown(event);
                  }}
                />
              }
            />
          </td>
        ) : null}
      </tr>
    );
  };

  const stateRow = (content: ReactNode): ReactNode => (
    <tr className="itsm-DataTable__stateRow">
      <td colSpan={colSpan}>{content}</td>
    </tr>
  );

  let body: ReactNode;
  if (firstLoad) {
    body = Array.from({ length: skeletonRows }, (_, rowIndex) => (
      <tr key={`skeleton-${rowIndex}`} className="itsm-DataTable__skeletonRow" aria-hidden="true">
        {selectable ? <td className="itsm-DataTable__selectCell" data-card-role="select" /> : null}
        {shownColumns.map((column, columnIndex) => (
          <td
            key={column.id}
            data-align={column.align ?? (alignsEnd(column.kind) ? 'end' : undefined)}
            data-hide-below={column.hideBelow}
            data-card-role={cardRoleOf(column, primary, badgeId)}
          >
            <Skeleton width={`${[72, 48, 60, 36, 54][(rowIndex + columnIndex) % 5]}%`} height={12} />
          </td>
        ))}
        {hasMenu ? <td className="itsm-DataTable__actionsCell" data-card-role="menu" /> : null}
      </tr>
    ));
  } else if (rows.length === 0 && problem) {
    body = stateRow(<ProblemState size="sm" problem={problem} context={caption} {...(onRetry ? { onRetry } : {})} />);
  } else if (rows.length === 0) {
    body = stateRow(
      emptyContent ?? (
        <EmptyState
          size="sm"
          headingLevel={3}
          title={empty?.title ?? `No ${nounPlural} yet`}
          {...(empty?.description ? { description: empty.description } : {})}
          {...(empty?.icon ? { icon: empty.icon } : {})}
          {...(empty?.illustration ? { illustration: empty.illustration } : {})}
          {...(empty?.action ? { action: empty.action } : {})}
          {...(empty?.secondaryAction ? { secondaryAction: empty.secondaryAction } : {})}
          onAction={(id) => void Promise.resolve(onAction?.(id, [])).catch(() => undefined)}
        />
      ),
    );
  } else if (ordered.length === 0) {
    const query = view.q.trim();
    body = stateRow(
      <EmptyState
        size="sm"
        tone="search"
        headingLevel={3}
        title={noResults?.title ?? (query ? `No ${nounPlural} match “${query}”` : `No ${nounPlural} match these filters`)}
        {...(noResults?.description ? { description: noResults.description } : {})}
        {...(noResults?.icon ? { icon: noResults.icon } : {})}
        action={
          noResults?.action ?? (
            <Button size="sm" variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          )
        }
        onAction={(id) => void Promise.resolve(onAction?.(id, [])).catch(() => undefined)}
      />,
    );
  } else if (groups) {
    body = null;
  } else if (windowed) {
    body = (
      <Suspense fallback={ordered.slice(0, VIRTUAL_FROM).map((entry) => renderRow(entry))}>
        <VirtualRows
          count={ordered.length}
          estimateSize={effectiveDensity === 'compact' ? 36 : 44}
          colSpan={colSpan}
          renderRow={(index, measure) => renderRow(ordered[index]!, measure)}
          scrollTo={virtualScroll}
          onRendered={onWindowRendered}
        />
      </Suspense>
    );
  } else {
    body = ordered.map((entry) => renderRow(entry));
  }

  const contextEntry = contextKey ? ordered.find((entry) => entry.key === contextKey) : undefined;

  /**
   * A body of rows, and — with row actions — the right-click menu that
   * mirrors each row's ⋯ (never the only way to an action). It opens for the
   * row under the pointer; over a heading or an empty state inside the body
   * there is nothing to act on, so neither menu opens there. The header keeps
   * the browser's own.
   */
  const bodyOf = (key: string, className: string | undefined, children: ReactNode): ReactNode => {
    if (!hasMenu) {
      return (
        <tbody key={key} className={className}>
          {children}
        </tbody>
      );
    }
    return (
      <ContextMenu
        key={key}
        label={contextEntry ? `Actions for ${nameOf(contextEntry.row)}` : 'Actions'}
        items={contextEntry ? menuItemsFor(contextEntry) : []}
        disabledOnCoarse={activate?.kind === 'link' || activate?.kind === 'drawer'}
      >
        <tbody
          className={className}
          // Radix turns the iOS link callout off for the menu's long-press; a
          // body of links keeps it, since there the long-press is not bound (X-95).
          style={activate?.kind === 'link' || activate?.kind === 'drawer' ? { WebkitTouchCallout: 'default' } : undefined}
          onContextMenu={(event: MouseEvent<HTMLTableSectionElement>) => {
            const holder = (event.target as HTMLElement).closest<HTMLElement>('[data-itsm-row]');
            const entry = holder ? ordered[Number(holder.getAttribute('data-itsm-row'))] : undefined;
            if (!entry) {
              event.preventDefault();
              return;
            }
            setContextKey(entry.key);
          }}
        >
          {children}
        </tbody>
      </ContextMenu>
    );
  };

  const tableElement = (
    <table
      className="itsm-DataTable__table"
      aria-busy={busy || firstLoad || undefined}
      aria-describedby={showHint ? hintId : undefined}
      {...(windowed ? { 'aria-rowcount': ordered.length + 1 } : {})}
      onKeyDown={onBodyKeyDown}
      onFocus={kb.onFocus}
    >
      <caption className={cx('itsm-DataTable__caption', captionHidden && 'itsm-visually-hidden')}>
        {caption}
        {sortNote ? <span className="itsm-visually-hidden">, {inSentence(sortNote)}</span> : null}
        {firstLoad ? <span className="itsm-visually-hidden">, {messages.loading.replace(/…$/, '').toLowerCase()}</span> : null}
      </caption>
      <thead data-stuck={stuck ? '' : undefined}>
        <tr>
          {selectable ? (
            <td className="itsm-DataTable__selectCell" data-card-role="select">
              {multiple && ordered.length > 0 ? (
                <Checkbox
                  className="itsm-DataTable__checkbox"
                  label={`Select all ${formatNumber(matched.length, { locale })}${complete ? '' : ' loaded'} ${nounFor(matched.length, countNoun)}`}
                  labelHidden
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => (allSelected ? commitSelection(new Set()) : selectAll())}
                />
              ) : null}
            </td>
          ) : null}
          {shownColumns.map((column) => {
            const active = view.sort?.columnId === column.id && sortColumn !== undefined;
            const canSort = column.sortable === 'page' || column.sortable === 'server';
            const label = <span className={cx(column.headerHidden && 'itsm-visually-hidden')}>{column.header}</span>;
            return (
              <th
                key={column.id}
                scope="col"
                className={cx('itsm-DataTable__header', column.id === primary?.id && 'itsm-DataTable__primaryCell')}
                data-align={column.align ?? (alignsEnd(column.kind) ? 'end' : undefined)}
                data-hide-below={column.hideBelow}
                style={widthStyle(column, totalFr)}
                aria-sort={canSort && active && view.sort ? view.sort.direction : undefined}
              >
                {canSort ? (
                  <button type="button" className="itsm-DataTable__sort" data-active={active ? '' : undefined} onClick={() => setSort(nextSort(column))}>
                    {label}
                    <Icon
                      name={active ? (view.sort?.direction === 'ascending' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'}
                      size="xs"
                      className="itsm-DataTable__sortIcon"
                    />
                  </button>
                ) : (
                  label
                )}
              </th>
            );
          })}
          {hasMenu ? (
            <th scope="col" className="itsm-DataTable__actionsCell" data-card-role="menu">
              <span className="itsm-visually-hidden">Actions</span>
            </th>
          ) : null}
        </tr>
      </thead>
      {groups && ordered.length > 0 && !firstLoad
        ? groups.map((group) =>
            bodyOf(
              group.value,
              'itsm-DataTable__group',
              <>
                <tr className="itsm-DataTable__groupRow">
                  <th scope="colgroup" colSpan={colSpan}>
                    <span className="itsm-DataTable__groupLabel">{group.label}</span>
                    <span className="itsm-DataTable__groupCount">{formatNumber(group.entries.length, { locale })}</span>
                  </th>
                </tr>
                {group.entries.map((entry) => renderRow(entry))}
              </>,
            ),
          )
        : bodyOf('body', undefined, body)}
    </table>
  );

  const pagerCount = paged ? Math.max(1, Math.ceil(matched.length / pagination.pageSize)) : 1;

  return (
    <div
      className={cx('itsm-DataTable', className)}
      data-itsm-density={effectiveDensity}
      data-card-below={cardAttribute}
      data-layout={cardsOn ? 'cards' : undefined}
      data-selectable={selectable ? '' : undefined}
      data-any-selected={anySelected ? '' : undefined}
      data-select-mode={selectMode ? '' : undefined}
      data-has-menu={hasMenu ? '' : undefined}
      data-refreshing={busy ? '' : undefined}
    >
      {hasToolbar ? (
        <div className="itsm-DataTable__toolbar">
          <FilterBar
            className="itsm-DataTable__filterBar"
            label={`Filters for ${inSentence(caption)}`}
            filters={filters}
            values={view.filters}
            onChange={setFilters}
            {...(search !== false
              ? {
                  search: {
                    value: view.q,
                    placeholder: search.placeholder,
                    label: `Search ${inSentence(caption)}`,
                    onValueChange: setQuery,
                    ...(search.shortcut ? { shortcut: search.shortcut } : {}),
                    ...(isPending && search.mode === 'server' ? { loading: true } : {}),
                  },
                }
              : {})}
            {...(scope ? { scope } : {})}
            countText={firstLoad || (rows.length === 0 && !narrowing) ? undefined : countText}
            end={
              <>
                {toolbarEnd}
                {selectable ? (
                  <Button
                    className="itsm-DataTable__selectToggle"
                    size="sm"
                    variant="ghost"
                    aria-pressed={selectMode}
                    onClick={() => setSelectMode((on) => !on)}
                  >
                    {selectMode ? 'Done' : 'Select'}
                  </Button>
                ) : null}
              </>
            }
            viewMenu={viewMenuOffers ? <ViewMenu {...viewMenuProps} /> : undefined}
          />
        </div>
      ) : null}
      {sortNote ? (
        <p className="itsm-DataTable__note" id={noteId}>
          <span className="itsm-DataTable__sortNote">
            <Icon name="info" size="xs" />
            {sortNote}
          </span>
          {canLoadAll ? (
            <Button className="itsm-DataTable__loadAll" size="sm" variant="ghost" loading={loadingAll} onClick={() => void loadAll()}>
              Load all (up to {formatNumber(LOAD_ALL_LIMIT, { locale })})
            </Button>
          ) : null}
        </p>
      ) : null}
      {problem && rows.length > 0 ? (
        <InlineAlert tone="danger">
          <span className="itsm-DataTable__problemLine">
            Couldn't refresh {inSentence(caption)}. Showing what was loaded before.
            {onRetry ? (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                {messages.retry}
              </Button>
            ) : null}
          </span>
        </InlineAlert>
      ) : null}
      <div className="itsm-DataTable__frame" ref={frame}>
        {busy ? <ProgressBar className="itsm-DataTable__refresh" size="sm" label={`Refreshing ${inSentence(caption)}`} labelHidden /> : null}
        <div className="itsm-DataTable__sentinel" ref={sentinel} aria-hidden="true" />
        <div className="itsm-DataTable__scroll" ref={scroller} data-fits={fits ? '' : undefined}>
          {tableElement}
        </div>
      </div>
      {pagination.mode === 'loadMore' ? (
        <LoadMore
          hasMore={pagination.hasMore}
          onLoadMore={pagination.onLoadMore}
          loading={pagination.loading === true || loadingAll}
          shown={rows.length}
          noun={countNoun}
          {...(pagination.pageSize ? { pageSize: pagination.pageSize } : {})}
        />
      ) : pagination.mode === 'olderNewer' ? (
        <OlderNewer {...pagination} />
      ) : paged && pagerCount > 1 ? (
        <nav className="itsm-DataTable__pager" aria-label={`Pages of ${inSentence(caption)}`}>
          <Button size="sm" variant="secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => Math.max(0, index - 1))}>
            Previous
          </Button>
          <span className="itsm-DataTable__pageOf" aria-live="polite">
            Page {formatNumber(Math.min(pageIndex + 1, pagerCount), { locale })} of {formatNumber(pagerCount, { locale })}
          </span>
          <Button size="sm" variant="secondary" disabled={pageIndex >= pagerCount - 1} onClick={() => setPageIndex((index) => Math.min(pagerCount - 1, index + 1))}>
            Next
          </Button>
        </nav>
      ) : null}
      {anySelected && bulkActions.length > 0 ? (
        <BulkActionBar
          className="itsm-DataTable__bulk"
          count={selectedRows.length}
          noun={countNoun}
          actions={bulkActions}
          onAction={(id, details) => runBulk(id, details)}
          onClear={() => {
            commitSelection(new Set());
            kb.focusActive();
          }}
          {...(bulkBusy ? { busy: { label: bulkBusy } } : {})}
        />
      ) : null}
      {showHint ? (
        <p className="itsm-DataTable__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {lastConfirm?.action.confirm ? (
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(open) => {
            if (!open) {
              setConfirming(null);
              setTimeout(() => kb.focusActive(), 0);
            }
          }}
          spec={lastConfirm.action.confirm}
          onConfirm={(reason) => runAction(lastConfirm.action, lastConfirm.rows, reason === undefined ? undefined : { reason })}
        />
      ) : null}
    </div>
  );
}
