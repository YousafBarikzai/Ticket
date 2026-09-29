/**
 * `@itsm/ui/data` — tables and the controls that page, filter and act on them.
 *
 * Its own subpath because the data table brings the table-state and
 * virtualisation libraries, which the requester portal never needs.
 */
export {
  DataTable,
  type DataTableActivate,
  type DataTablePagination,
  type DataTableProps,
} from './DataTable.js';
export type { CellKind, ColumnSpec, DataTableScope, FilterOption, FilterSpec, FilterValue } from './types.js';
export { BulkActionBar, type BulkActionBarProps } from './BulkActionBar.js';
export { FilterBar, type FilterBarProps } from './FilterBar.js';
export { FilterChip, type FilterChipProps } from './FilterChip.js';
export { LoadMore, type LoadMoreProps } from './LoadMore.js';
export { OlderNewer, type OlderNewerProps } from './OlderNewer.js';
export { ViewMenu, type ViewMenuColumn, type ViewMenuProps } from './ViewMenu.js';
// Deprecated: a thin wrapper over `DataTable` until nothing imports it.
export { InteractiveTable, type InteractiveTableProps } from '../web/InteractiveTable.js';
