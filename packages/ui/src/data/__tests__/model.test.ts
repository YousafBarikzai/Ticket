import { describe, expect, it } from 'vitest';
import {
  CLEARED_FILTER,
  compareSortKeys,
  dataTableParam,
  dateKeyOf,
  decodeFilterValue,
  decodeSort,
  describeFilterValue,
  encodeFilterValue,
  encodeSort,
  fillTemplate,
  isBlank,
  isFilterActive,
  matchesFilter,
  matchesSearch,
  readDataTableParams,
  searchTextOf,
  sortKeyOf,
  textOf,
  valueAt,
  writeDataTableParams,
} from '../model.js';
import type { ColumnSpec, FilterSpec } from '../types.js';

/**
 * The table's arithmetic, without a DOM: the same functions a server page
 * calls to read the URL the table writes, so the two can never disagree.
 */

describe('reading rows', () => {
  const row = { key: 'vip requester', requester: { displayName: 'Ada Lovelace' }, tags: [] as string[] };

  it('reads a dot path, and nothing past a missing step', () => {
    expect(valueAt(row, 'requester.displayName')).toBe('Ada Lovelace');
    expect(valueAt(row, 'requester.missing.deeper')).toBeUndefined();
    expect(valueAt(row, 'nothing')).toBeUndefined();
  });

  it('fills a link template, encoded, and refuses to link to a hole', () => {
    expect(fillTemplate('/rules/{key}', row)).toBe('/rules/vip%20requester');
    expect(fillTemplate('/people/{requester.displayName}', row)).toBe('/people/Ada%20Lovelace');
    expect(fillTemplate('/rules/{missing}', row)).toBeUndefined();
  });

  it('treats empty strings, empty lists and null as blank, but not zero or false', () => {
    expect([undefined, null, '', '  ', []].map(isBlank)).toEqual([true, true, true, true, true]);
    expect([0, false, 'x'].map(isBlank)).toEqual([false, false, false]);
  });

  it('names a value by its map label, a person by their name, a list by its items', () => {
    const status: ColumnSpec = { id: 's', header: 'Status', field: 's', kind: 'status', map: { live: { label: 'Live', tone: 'success' } } };
    expect(textOf(status, 'live')).toBe('Live');
    expect(textOf({ kind: 'person' }, { displayName: 'Grace Hopper' })).toBe('Grace Hopper');
    expect(textOf({ kind: 'text' }, ['a', 'b'])).toBe('a, b');
  });
});

describe('sorting', () => {
  const columns: Record<string, ColumnSpec> = {
    name: { id: 'name', header: 'Name', field: 'name', sortable: 'page' },
    count: { id: 'count', header: 'Count', field: 'count', kind: 'number', sortable: 'page' },
    updated: { id: 'updated', header: 'Updated', field: 'updated', kind: 'relative', sortable: 'page' },
    status: {
      id: 'status',
      header: 'Status',
      field: 'status',
      kind: 'status',
      sortable: 'page',
      map: { draft: { label: 'Draft' }, live: { label: 'Live' }, archived: { label: 'Archived' } },
    },
  };

  it('sorts words naturally, "Rule 2" before "Rule 10", ignoring case', () => {
    const keys = ['Rule 10', 'rule 2', 'Alpha'].map((name) => sortKeyOf(columns.name!, { name }));
    expect([...keys].sort(compareSortKeys)).toEqual(['Alpha', 'rule 2', 'Rule 10']);
  });

  it('sorts numbers and times as numbers, blanks last', () => {
    expect([10, 9, null, 100].map((count) => sortKeyOf(columns.count!, { count })).sort(compareSortKeys)).toEqual([9, 10, 100, undefined]);
    const a = sortKeyOf(columns.updated!, { updated: '2026-09-01T10:00:00Z' });
    const b = sortKeyOf(columns.updated!, { updated: '2026-09-02T10:00:00Z' });
    expect(compareSortKeys(a, b)).toBeLessThan(0);
  });

  it('sorts mapped states in the order the map declares them', () => {
    const keys = ['archived', 'draft', 'live'].map((status) => sortKeyOf(columns.status!, { status }));
    expect(keys).toEqual([2, 0, 1]);
  });

  it('sorts an SLA column by urgency: breached first, then least time left', () => {
    const sla: ColumnSpec = { id: 'sla', header: 'SLA', field: 'sla', kind: 'sla', sortable: 'page' };
    const keys = [
      { state: 'paused', remainingMinutes: null },
      { state: 'running', remainingMinutes: 30 },
      { state: 'breached', remainingMinutes: null },
    ].map((clock) => sortKeyOf(sla, { sla: clock }));
    expect([...keys].sort(compareSortKeys)).toEqual([Number.NEGATIVE_INFINITY, 30, Number.POSITIVE_INFINITY]);
  });
});

describe('filtering', () => {
  it('matches single, multiple and list values, by id for people', () => {
    expect(matchesFilter('select', 'open', 'open')).toBe(true);
    expect(matchesFilter('select', 'open', 'closed')).toBe(false);
    expect(matchesFilter('multiselect', ['open', 'paused'], 'paused')).toBe(true);
    expect(matchesFilter('multiselect', ['open'], ['closed', 'open'])).toBe(true);
    expect(matchesFilter('person', 'u-1', { id: 'u-1', displayName: 'Ada' })).toBe(true);
  });

  it('matches text anywhere, ignoring case and accents', () => {
    expect(matchesFilter('text', 'elan', 'Rapport Élan')).toBe(true);
    expect(matchesFilter('text', 'vpn', 'Printer')).toBe(false);
  });

  it('reads a yes/no filter both ways, and no filter at all as everything', () => {
    expect(matchesFilter('boolean', true, true)).toBe(true);
    expect(matchesFilter('boolean', true, false)).toBe(false);
    expect(matchesFilter('boolean', false, false)).toBe(true);
    expect(matchesFilter('select', null, 'anything')).toBe(true);
  });

  it('includes both ends of a date range, in the reader’s time zone', () => {
    const range = { from: '2026-09-01', to: '2026-09-30' };
    expect(matchesFilter('dateRange', range, '2026-09-30T23:30:00Z', 'Europe/London')).toBe(false);
    expect(matchesFilter('dateRange', range, '2026-09-30T23:30:00Z', 'UTC')).toBe(true);
    expect(dateKeyOf('2026-09-30T23:30:00Z', 'Asia/Tokyo')).toBe('2026-10-01');
  });

  it('searches every word of a query across the columns', () => {
    const columns: ColumnSpec[] = [
      { id: 'name', header: 'Name', field: 'name' },
      { id: 'owner', header: 'Owner', field: 'owner', kind: 'person' },
    ];
    const text = searchTextOf(columns, { name: 'VIP requester', owner: { displayName: 'Zoë Kay' } });
    expect(matchesSearch(text, 'vip zoe')).toBe(true);
    expect(matchesSearch(text, 'vip grace')).toBe(false);
  });

  it('knows when a value narrows anything', () => {
    expect([null, '', [], { from: '', to: '' }].map((value) => isFilterActive(value as never))).toEqual([false, false, false, false]);
    expect([false, 'x', ['x']].map((value) => isFilterActive(value as never))).toEqual([true, true, true]);
  });

  it('describes a value in words for its chip', () => {
    const status: FilterSpec = {
      id: 'status',
      label: 'Status',
      type: 'multiselect',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'paused', label: 'Paused' },
        { value: 'resolved', label: 'Resolved' },
      ],
    };
    expect(describeFilterValue(status, ['open', 'paused'])).toBe('Open, Paused');
    expect(describeFilterValue(status, ['open', 'paused', 'resolved'])).toBe('Open, Paused +1');
    expect(describeFilterValue({ id: 'q', label: 'Text', type: 'text' }, 'vpn')).toBe('“vpn”');
    expect(describeFilterValue({ id: 'b', label: 'Retired', type: 'boolean' }, true)).toBe('Yes');
    expect(describeFilterValue({ id: 'd', label: 'Created', type: 'dateRange' }, { from: '2026-09-01', to: '2026-09-30' }, 'en-GB')).toMatch(/1.*30 Sept 2026/);
  });
});

describe('the URL', () => {
  const filters: FilterSpec[] = [
    { id: 'status', label: 'Status', type: 'multiselect', defaultValue: ['open'] },
    { id: 'retired', label: 'Retired', type: 'boolean' },
    { id: 'created', label: 'Created', type: 'dateRange' },
  ];
  const columns = [
    { id: 'created', sortable: 'server' as const, sortField: 'createdAt' },
    { id: 'name', sortable: 'page' as const },
  ];

  it('namespaces a table’s parameters, and leaves the main list’s plain', () => {
    expect(dataTableParam('runs', 'status')).toBe('runs.status');
    expect(dataTableParam('', 'status')).toBe('status');
  });

  it('encodes values the way the API spells them, and decodes them back', () => {
    expect(encodeFilterValue(['open', 'paused'])).toBe('open,paused');
    expect(encodeFilterValue(true)).toBe('true');
    expect(encodeFilterValue({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09-01..2026-09-30');
    expect(decodeFilterValue({ type: 'multiselect' }, 'open,paused')).toEqual(['open', 'paused']);
    expect(decodeFilterValue({ type: 'boolean' }, 'yes')).toBeNull();
    expect(decodeFilterValue({ type: 'dateRange' }, '2026-09-01..')).toEqual({ from: '2026-09-01', to: '' });
    expect(decodeFilterValue({ type: 'dateRange' }, 'nonsense')).toBeNull();
  });

  it('writes the sort as the API takes it (`-createdAt`) and maps it back to its column', () => {
    expect(encodeSort({ columnId: 'created', direction: 'descending' }, columns)).toBe('-createdAt');
    expect(decodeSort('-createdAt', columns)).toEqual({ columnId: 'created', direction: 'descending' });
    expect(decodeSort('name', columns)).toEqual({ columnId: 'name', direction: 'ascending' });
    expect(decodeSort('unknown', columns)).toBeNull();
  });

  it('reads defaults for absent filters, and "*" as cleared on purpose', () => {
    expect(readDataTableParams(new URLSearchParams(''), { urlKey: '', filters, columns }).filters.status).toEqual(['open']);
    expect(readDataTableParams(new URLSearchParams(`status=${CLEARED_FILTER}`), { urlKey: '', filters, columns }).filters.status).toBeNull();
    const view = readDataTableParams(new URLSearchParams('runs.q=vpn&runs.sort=-createdAt&runs.retired=true'), { urlKey: 'runs', filters, columns });
    expect(view).toEqual({ q: 'vpn', sort: { columnId: 'created', direction: 'descending' }, filters: { status: ['open'], retired: true, created: null } });
  });

  it('writes nothing for a default, and round-trips everything else', () => {
    const config = { urlKey: 'runs', filters, columns };
    const view = { q: 'vpn', sort: { columnId: 'created', direction: 'ascending' as const }, filters: { status: null, retired: true, created: null } };
    const written = writeDataTableParams(view, config);
    expect(written).toEqual({ 'runs.q': 'vpn', 'runs.sort': 'createdAt', 'runs.status': CLEARED_FILTER, 'runs.retired': 'true', 'runs.created': undefined });
    const params = new URLSearchParams(Object.entries(written).filter((entry): entry is [string, string] => entry[1] !== undefined));
    expect(readDataTableParams(params, config)).toEqual(view);
    expect(writeDataTableParams({ q: '', sort: null, filters: { status: ['open'], retired: null, created: null } }, config)).toEqual({
      'runs.q': undefined,
      'runs.sort': undefined,
      'runs.status': undefined,
      'runs.retired': undefined,
      'runs.created': undefined,
    });
  });
});
