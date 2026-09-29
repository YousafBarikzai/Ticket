/**
 * The data table's serialisable vocabulary: column specs, cell kinds, filter
 * specs and values.
 *
 * Plain data on purpose. A server component can describe a whole table —
 * which columns, how each cell renders, which filters apply — and hand it to
 * the client `DataTable`; only a client parent can add render functions
 * (`cells`). Types only.
 */
import type { IconName, Tone } from '../types.js';

/** How a cell renders its value. Each kind is a formatter and a layout, chosen by name. */
export type CellKind =
  | 'text'
  | 'title'
  | 'mono'
  | 'number'
  | 'percent'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'relative'
  | 'duration'
  | 'status'
  | 'badge'
  | 'priority'
  | 'person'
  | 'people'
  | 'tags'
  | 'boolean'
  | 'link'
  | 'progress'
  | 'sparkline'
  | 'channel'
  | 'sla';

export interface ColumnSpec {
  readonly id: string;
  readonly header: string;
  /** Dot path into the row. */
  readonly field: string;
  readonly kind?: CellKind;
  readonly secondaryField?: string;
  /** A link template, `'/rules/{key}'`. */
  readonly href?: string;
  /** Raw value → label, tone and icon, for `status`, `badge` and `priority` cells. */
  readonly map?: Readonly<Record<string, { readonly label: string; readonly tone?: Tone; readonly icon?: IconName }>>;
  readonly srPrefix?: string;
  readonly format?: Intl.NumberFormatOptions | Intl.DateTimeFormatOptions | { readonly unit: 'minutes' };
  readonly align?: 'start' | 'end' | 'center';
  readonly width?: number | `${number}fr`;
  readonly minWidth?: number;
  /** `server` writes the URL (the API sorts `createdAt` and `dueAt` only); `page` sorts the loaded rows and says so. */
  readonly sortable?: false | 'server' | 'page';
  readonly sortField?: string;
  /** Dropped below this container width. */
  readonly hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  /** Where the column goes when rows become cards. */
  readonly cardRole?: 'title' | 'subtitle' | 'meta' | 'badge' | 'hidden';
  readonly pin?: 'start' | 'end';
  readonly defaultHidden?: boolean;
  readonly hideable?: boolean;
  readonly truncate?: 1 | 2;
  /** Shown for an empty value; "—" by default, read as "Not set". */
  readonly empty?: string;
  /** Hidden unless the person shows technical keys (X-81). */
  readonly technical?: boolean;
}

/** One choice of a select-like filter. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly tone?: Tone;
}

/**
 * A filter's current value, by type: `select`, `text` and `person` hold a
 * string, `multiselect` a list, `boolean` a boolean, `dateRange` a range;
 * `null` when cleared.
 */
export type FilterValue = string | readonly string[] | boolean | { readonly from: string; readonly to: string } | null;

export interface FilterSpec {
  readonly id: string;
  readonly label: string;
  readonly type: 'select' | 'multiselect' | 'boolean' | 'dateRange' | 'text' | 'person';
  readonly options?: readonly FilterOption[];
  /** Shown as a chip even when inactive; the rest sit behind "+ Filter". */
  readonly pinned?: boolean;
  readonly defaultValue?: FilterValue;
  /** Client only: options that depend on what is typed (people, services). */
  readonly loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly FilterOption[]>;
}

/** The scope switch above a list ("Open · Needs you · All"): links, each with an optional count. */
export interface DataTableScope {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly href: string; readonly count?: number }[];
  readonly value: string;
}
