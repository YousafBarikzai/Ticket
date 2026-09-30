/**
 * The data table's arithmetic: reading a field by its dot path, filling a
 * link template, the value a column sorts and searches by, whether a row
 * passes a filter, and how the table's state is written into the URL.
 *
 * Server-safe and pure on purpose. A server page reads the same query string
 * the table writes — `readDataTableParams(searchParams, config)` — so the
 * filters and sort it asks the API for are exactly the ones the chips and
 * headers show, with one spelling of each parameter in one place.
 */
import type { Plural } from '../types.js';
import type { CellKind, ColumnSpec, FilterOption, FilterSpec, FilterValue } from './types.js';

/* -------------------------------------------------------------------------
 * Reading rows
 * ---------------------------------------------------------------------- */

/** The value at a dot path (`requester.displayName`), or `undefined` when any step is missing. */
export function valueAt(row: unknown, path: string): unknown {
  if (path === '') return row;
  let current: unknown = row;
  for (const step of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

/** Nothing to show: absent, null, an empty or whitespace string, or an empty list. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  return false;
}

/**
 * A link template filled from a row: `'/rules/{key}'` → `/rules/vip-requester`.
 * Each placeholder is a dot path, URI-encoded. `undefined` when a placeholder
 * has no value, so a row never links to `/rules/undefined`.
 */
export function fillTemplate(template: string, row: unknown): string | undefined {
  let missing = false;
  const filled = template.replace(/\{([^{}]+)\}/g, (_match, path: string) => {
    const value = valueAt(row, path.trim());
    if (isBlank(value) || typeof value === 'object') {
      missing = true;
      return '';
    }
    return encodeURIComponent(String(value));
  });
  return missing ? undefined : filled;
}

/** A row's identity, as a string: the value of its `rowKey` field. */
export function rowKeyOf(row: unknown, rowKey: string): string {
  const value = valueAt(row, rowKey);
  return value === null || value === undefined ? '' : String(value);
}

/** The one scalar a structured value stands for: a person's id, an option's value. */
function scalarOf(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return record.id ?? record.value ?? record.key ?? record.name ?? record.displayName ?? record.label;
  }
  return value;
}

/** A person as the API spells them: a name, or an object with a display name. */
export function personName(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, unknown>;
  const name = record.displayName ?? record.name ?? record.label ?? record.email ?? record.id;
  return name === undefined || name === null ? '' : String(name);
}

/** Lower case with the accents folded, so "élan" finds "Elan" and "ELAN". */
export function normaliseText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * A cell's value as words: what search matches, what a row is called
 * ("Select VIP requester"), and what a card's meta line would read. Mapped
 * values use their labels, people their names, lists their items.
 */
export function textOf(column: Pick<ColumnSpec, 'kind' | 'map'>, value: unknown): string {
  if (isBlank(value)) return '';
  if (Array.isArray(value)) return value.map((item) => textOf(column, item)).filter(Boolean).join(', ');
  const kind = column.kind ?? 'text';
  if (kind === 'person' || kind === 'people') return personName(value);
  if (kind === 'sparkline' || kind === 'sla') return '';
  const mapped = column.map?.[String(scalarOf(value))];
  if (mapped) return mapped.label;
  if (typeof value === 'object') return String(scalarOf(value) ?? '');
  return String(value);
}

/* -------------------------------------------------------------------------
 * Sorting
 * ---------------------------------------------------------------------- */

const NUMERIC_KINDS: ReadonlySet<CellKind> = new Set(['number', 'percent', 'currency', 'duration', 'progress']);
const TIME_KINDS: ReadonlySet<CellKind> = new Set(['date', 'datetime', 'relative']);

/** Kinds whose first sort is largest or newest first: the question a count or a date is usually asked. */
export function sortsDescendingFirst(kind: CellKind | undefined): boolean {
  return kind !== undefined && (NUMERIC_KINDS.has(kind) || TIME_KINDS.has(kind));
}

/** Kinds that line up at the end of the cell, as figures do. */
export function alignsEnd(kind: CellKind | undefined): boolean {
  return kind !== undefined && NUMERIC_KINDS.has(kind) && kind !== 'progress';
}

/**
 * What a column sorts by: a number or a string, and `undefined` for a blank
 * (blanks go last whichever way the column is sorted). Mapped states sort in
 * the order the map declares them — the author wrote "Draft, Live, Archived"
 * in the order a person thinks of them — and the SLA column by urgency.
 */
export function sortKeyOf(column: ColumnSpec, row: unknown): number | string | undefined {
  const value = valueAt(row, column.sortField ?? column.field);
  if (isBlank(value)) return undefined;
  const kind = column.kind ?? 'text';
  if (NUMERIC_KINDS.has(kind)) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (TIME_KINDS.has(kind)) {
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? time : undefined;
  }
  if (kind === 'boolean') return value === true || value === 'true' ? 1 : 0;
  if ((kind === 'status' || kind === 'badge' || kind === 'priority' || kind === 'channel') && column.map) {
    const keys = Object.keys(column.map);
    const index = keys.indexOf(String(scalarOf(value)));
    return index >= 0 ? index : keys.length;
  }
  if (kind === 'sla' && typeof value === 'object') {
    const clock = value as { state?: string; remainingMinutes?: number | null };
    if (clock.state === 'breached') return Number.NEGATIVE_INFINITY;
    if (clock.state === 'running' && typeof clock.remainingMinutes === 'number') return clock.remainingMinutes;
    return Number.POSITIVE_INFINITY;
  }
  if (kind === 'sparkline' && Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'number' ? last : undefined;
  }
  if (Array.isArray(value)) return value.length;
  return textOf(column, value);
}

const collator = typeof Intl === 'undefined' ? null : new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Two sort keys in ascending order: numbers before words, words in a natural order ("Rule 2" before "Rule 10"). */
export function compareSortKeys(a: number | string | undefined, b: number | string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
}

/* -------------------------------------------------------------------------
 * Filtering
 * ---------------------------------------------------------------------- */

/** Whether a filter value narrows anything: `null`, an empty string or an empty list do not. */
export function isFilterActive(value: FilterValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  const range = value as { from?: string; to?: string };
  return Boolean(range.from || range.to);
}

/** The calendar date of a moment in a time zone, as `YYYY-MM-DD`; a bare date passes through. */
export function dateKeyOf(value: unknown, timeZone: string | undefined): string | undefined {
  if (isBlank(value)) return undefined;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Whether a row's value passes a filter. Lists on the row match when any item
 * does; structured values (a person, an option) compare by their id; text
 * matches anywhere, ignoring case and accents; a date range includes both ends
 * and compares calendar dates where the reader is.
 */
export function matchesFilter(
  type: FilterSpec['type'],
  filter: FilterValue | undefined,
  rowValue: unknown,
  timeZone?: string,
): boolean {
  if (!isFilterActive(filter ?? null)) return true;
  switch (type) {
    case 'boolean': {
      const truthy = rowValue === true || rowValue === 'true' || (typeof rowValue === 'number' && rowValue !== 0);
      return truthy === (filter === true);
    }
    case 'multiselect': {
      const wanted = new Set((filter as readonly string[]).map(String));
      return asList(rowValue).some((item) => wanted.has(String(scalarOf(item))));
    }
    case 'text': {
      const needle = normaliseText(String(filter).trim());
      return asList(rowValue).some((item) => normaliseText(typeof item === 'object' ? personName(item) : String(item ?? '')).includes(needle));
    }
    case 'dateRange': {
      const { from, to } = filter as { from: string; to: string };
      const day = dateKeyOf(rowValue, timeZone);
      if (!day) return false;
      return (!from || day >= from) && (!to || day <= to);
    }
    case 'select':
    case 'person':
    default:
      return asList(rowValue).some((item) => String(scalarOf(item)) === String(filter));
  }
}

/** Every column's words for one row, folded for search. */
export function searchTextOf(columns: readonly ColumnSpec[], row: unknown): string {
  const words: string[] = [];
  for (const column of columns) {
    const text = textOf(column, valueAt(row, column.field));
    if (text) words.push(text);
    if (column.secondaryField) {
      const secondary = valueAt(row, column.secondaryField);
      if (!isBlank(secondary)) words.push(typeof secondary === 'object' ? personName(secondary) : String(secondary));
    }
  }
  return normaliseText(words.join('   '));
}

/** Whether every word of a query appears in a row's search text. */
export function matchesSearch(searchText: string, query: string): boolean {
  const words = normaliseText(query).split(/\s+/).filter(Boolean);
  return words.every((word) => searchText.includes(word));
}

/* -------------------------------------------------------------------------
 * Describing a filter
 * ---------------------------------------------------------------------- */

function optionLabel(options: readonly FilterOption[] | undefined, value: string, known?: ReadonlyMap<string, string>): string {
  return options?.find((option) => option.value === value)?.label ?? known?.get(value) ?? value;
}

/** A date range in words: "1 Sept – 30 Sept 2026". */
export function describeDateRange(range: { from: string; to: string }, locale = 'en-GB'): string {
  const parse = (text: string): Date | null => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null);
  const from = parse(range.from);
  const to = parse(range.to);
  try {
    const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    if (from && to) {
      const ranged = format as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
      return ranged.formatRange ? ranged.formatRange(from, to) : `${format.format(from)} – ${format.format(to)}`;
    }
    if (from) return `From ${format.format(from)}`;
    if (to) return `Until ${format.format(to)}`;
  } catch {
    // An unknown locale: the ISO dates still say it.
  }
  return [range.from, range.to].filter(Boolean).join(' – ');
}

/**
 * A filter's value in words, for its chip: "Open, Paused", "Open, Paused +1",
 * "Yes", "“vpn”", "1 Sept – 30 Sept 2026". `known` holds labels learnt from
 * options loaded while searching (a person picked from the directory).
 */
export function describeFilterValue(spec: FilterSpec, value: FilterValue, locale?: string, known?: ReadonlyMap<string, string>): string {
  if (!isFilterActive(value)) return '';
  switch (spec.type) {
    case 'multiselect': {
      // In the options' order, so a chip reads the same however its URL was written.
      const order = (spec.options ?? []).map((option) => option.value);
      const rank = (item: string): number => (order.includes(item) ? order.indexOf(item) : order.length);
      const values = [...(value as readonly string[])].sort((a, b) => rank(a) - rank(b));
      const labels = values.map((item) => optionLabel(spec.options, item, known));
      return labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
    }
    case 'boolean': {
      const key = value === true ? 'true' : 'false';
      const fromOptions = spec.options?.find((option) => option.value === key)?.label;
      return fromOptions ?? (value === true ? 'Yes' : 'No');
    }
    case 'text':
      return `“${String(value)}”`;
    case 'dateRange':
      return describeDateRange(value as { from: string; to: string }, locale);
    default:
      return optionLabel(spec.options, String(value), known);
  }
}

/* -------------------------------------------------------------------------
 * The URL
 * ---------------------------------------------------------------------- */

export type SortDirection = 'ascending' | 'descending';

export interface DataTableSort {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/** A table's view as the URL holds it: the search text, the sort and the filters. */
export interface DataTableViewState {
  readonly q: string;
  readonly sort: DataTableSort | null;
  readonly filters: Readonly<Record<string, FilterValue>>;
}

export interface DataTableParamsConfig {
  /**
   * The table's namespace. `''` writes plain names (`q`, `sort`, `status`) —
   * the page's one main list; any other key prefixes them (`runs.q`,
   * `runs.status`) so two tables on a page never share a parameter.
   */
  readonly urlKey: string;
  /** The search parameter's name before the namespace; `q` by default. */
  readonly searchParam?: string;
  readonly filters?: readonly FilterSpec[];
  /** The sortable columns, to map `sort=-createdAt` back to a column. */
  readonly columns?: readonly Pick<ColumnSpec, 'id' | 'sortField' | 'sortable'>[];
  /** The sort when the URL names none. */
  readonly defaultSort?: DataTableSort | null;
}

/** A parameter's name in a table's namespace. */
export function dataTableParam(urlKey: string, name: string): string {
  return urlKey ? `${urlKey}.${name}` : name;
}

/**
 * Written for a filter that has a default and was cleared: "no filter" has to
 * be said out loud, or the default would come back on the next load.
 */
export const CLEARED_FILTER = '*';

function sameFilterValue(a: FilterValue | undefined, b: FilterValue | undefined): boolean {
  return encodeFilterValue(a ?? null) === encodeFilterValue(b ?? null);
}

/** A filter value as one query-string value: lists comma-joined, ranges `from..to`. */
export function encodeFilterValue(value: FilterValue): string | undefined {
  if (!isFilterActive(value)) return undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(',');
  const range = value as { from: string; to: string };
  return `${range.from ?? ''}..${range.to ?? ''}`;
}

/** The reverse of `encodeFilterValue`, by the filter's type. Anything malformed is no filter. */
export function decodeFilterValue(spec: Pick<FilterSpec, 'type'>, raw: string | null): FilterValue {
  if (raw === null || raw === '' || raw === CLEARED_FILTER) return null;
  switch (spec.type) {
    case 'multiselect': {
      const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
      return list.length > 0 ? list : null;
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : null;
    case 'dateRange': {
      const match = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(raw);
      if (!match || (!match[1] && !match[2])) return null;
      return { from: match[1] ?? '', to: match[2] ?? '' };
    }
    default:
      return raw;
  }
}

/** The sort as the API spells it: `createdAt`, or `-createdAt` for descending. */
export function encodeSort(sort: DataTableSort | null, columns: DataTableParamsConfig['columns'] = []): string | undefined {
  if (!sort) return undefined;
  const column = columns.find((candidate) => candidate.id === sort.columnId);
  const field = column?.sortField ?? sort.columnId;
  return sort.direction === 'descending' ? `-${field}` : field;
}

export function decodeSort(raw: string | null, columns: DataTableParamsConfig['columns'] = []): DataTableSort | null {
  if (!raw) return null;
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;
  const column = columns.find((candidate) => (candidate.sortField ?? candidate.id) === field) ?? columns.find((candidate) => candidate.id === field);
  if (!column || !column.sortable) return null;
  return { columnId: column.id, direction: descending ? 'descending' : 'ascending' };
}

/**
 * A table's view read from a query string — what a server page calls to ask
 * the API for the same thing the table shows. Filters absent from the URL take
 * their `defaultValue`; `*` means "cleared on purpose".
 */
export function readDataTableParams(params: URLSearchParams, config: DataTableParamsConfig): DataTableViewState {
  const { urlKey, searchParam = 'q', filters = [], columns = [], defaultSort = null } = config;
  const filterValues: Record<string, FilterValue> = {};
  for (const spec of filters) {
    const raw = params.get(dataTableParam(urlKey, spec.id));
    filterValues[spec.id] = raw === null ? (spec.defaultValue ?? null) : decodeFilterValue(spec, raw);
  }
  const sortRaw = params.get(dataTableParam(urlKey, 'sort'));
  return {
    q: params.get(dataTableParam(urlKey, searchParam)) ?? '',
    sort: sortRaw === null ? defaultSort : decodeSort(sortRaw, columns),
    filters: filterValues,
  };
}

/** The query-string entries for a view; `undefined` removes a parameter (defaults never clutter a URL). */
export function writeDataTableParams(view: DataTableViewState, config: DataTableParamsConfig): Record<string, string | undefined> {
  const { urlKey, searchParam = 'q', filters = [], columns = [], defaultSort = null } = config;
  const out: Record<string, string | undefined> = {};
  out[dataTableParam(urlKey, searchParam)] = view.q.trim() === '' ? undefined : view.q;
  const sortText = encodeSort(view.sort, columns);
  out[dataTableParam(urlKey, 'sort')] = sortText === encodeSort(defaultSort, columns) ? undefined : (sortText ?? (defaultSort ? CLEARED_FILTER : undefined));
  for (const spec of filters) {
    const value = view.filters[spec.id] ?? null;
    const name = dataTableParam(urlKey, spec.id);
    if (sameFilterValue(value, spec.defaultValue ?? null)) out[name] = undefined;
    else out[name] = encodeFilterValue(value) ?? CLEARED_FILTER;
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------- */

/** The noun for a count: "1 rule", "2 rules". */
export function nounFor(count: number, noun: Plural): string {
  return count === 1 ? noun.one : noun.other;
}
