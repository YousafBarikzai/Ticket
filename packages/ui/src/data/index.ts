/**
 * `@itsm/ui/data` — tables and the controls that page, filter and act on them.
 *
 * Its own subpath because the data table brings the table-state and
 * virtualisation libraries, which the requester portal never needs.
 *
 * The URL helpers (`readDataTableParams` and friends) are server-safe: a
 * server page reads the query string a URL-backed table writes, with the same
 * spelling of every parameter, and asks the API for exactly what the table
 * shows.
 */
export {
  DataTable,
  type DataTableActivate,
  type DataTablePagination,
  type DataTableProps,
} from './DataTable.js';
export type { CellKind, ColumnSpec, DataTableScope, FilterOption, FilterSpec, FilterValue } from './types.js';
export {
  CLEARED_FILTER,
  dataTableParam,
  decodeFilterValue,
  decodeSort,
  describeFilterValue,
  encodeFilterValue,
  encodeSort,
  readDataTableParams,
  writeDataTableParams,
  type DataTableParamsConfig,
  type DataTableSort,
  type DataTableViewState,
  type SortDirection,
} from './model.js';
export { BulkActionBar, type ActionDetails, type BulkActionBarProps } from './BulkActionBar.js';
export { FilterBar, type FilterBarProps, type FilterBarSearch } from './FilterBar.js';
export { FilterChip, type FilterChipProps } from './FilterChip.js';
export { LoadMore, type LoadMoreProps } from './LoadMore.js';
export { OlderNewer, type OlderNewerProps } from './OlderNewer.js';
export { ViewMenu, type Density, type ViewMenuColumn, type ViewMenuProps } from './ViewMenu.js';
// Deprecated: a thin wrapper over `DataTable` until nothing imports it.
export { InteractiveTable, type InteractiveTableProps } from '../web/InteractiveTable.js';
