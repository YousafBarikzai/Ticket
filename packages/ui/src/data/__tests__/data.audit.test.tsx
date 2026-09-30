// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { cleanupDocument, click, focus, pointerDown, press, render, settle } from '../../web/__tests__/support/render.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { BulkActionBar } from '../BulkActionBar.js';
import { DataTable, type DataTableProps } from '../DataTable.js';
import { FilterBar } from '../FilterBar.js';
import { FilterChip } from '../FilterChip.js';
import { LoadMore } from '../LoadMore.js';
import { OlderNewer } from '../OlderNewer.js';
import { ViewMenu } from '../ViewMenu.js';
import type { ColumnSpec } from '../types.js';
import { navigation, noun, resetLocation, ruleColumns, rules, statusFilter, UrlProvider, type Navigation, type Rule } from './support/table.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

/**
 * Every export of `@itsm/ui/data`, read by axe in the shapes that ship —
 * a table with everything switched on, its menus and chips open, each of its
 * states — audited from the document, because menus and popovers portal to
 * the body.
 */

let nav: Navigation;

beforeEach(() => {
  resetLocation();
  nav = navigation();
  window.localStorage.clear();
});

afterEach(() => cleanupDocument());

const everything: Partial<DataTableProps<Rule>> = {
  search: { placeholder: 'Search rules', mode: 'client', shortcut: '/' },
  filters: [statusFilter, { id: 'owner', label: 'Owner', type: 'select', options: [{ value: 'u-1', label: 'Ada Lovelace' }] }],
  scope: {
    label: 'Rules to show',
    value: 'all',
    options: [
      { value: 'all', label: 'All', href: '/rules' },
      { value: 'live', label: 'Live', href: '/rules?scope=live', count: 2 },
    ],
  },
  selection: 'multiple',
  bulkActions: [
    { id: 'publish', label: 'Publish' },
    { id: 'archive', label: 'Archive' },
  ],
  rowActions: [
    { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
    { id: 'delete', label: 'Delete rule', tone: 'danger', icon: 'trash' },
  ],
  reorderable: { onMove: async () => undefined },
  sort: { columnId: 'name', direction: 'ascending' },
  pagination: { mode: 'loadMore', hasMore: true, onLoadMore: () => undefined, pageSize: 50 },
};

function table(props: Partial<DataTableProps<Rule>> = {}) {
  return render(
    <UrlProvider nav={nav}>
      <DataTable<Rule> caption="Rules" columns={ruleColumns} rows={rules} rowKey="key" countNoun={noun} {...props} />
    </UrlProvider>,
  );
}

describe('DataTable', () => {
  it('with everything switched on, a row selected and the bulk bar showing', async () => {
    const { container } = table(everything);
    click(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('with a row’s menu open', async () => {
    const { container } = table(everything);
    focus(container.querySelector<HTMLElement>('tbody [data-itsm-control="primary"]')!);
    press(document.activeElement!, '.');
    await settle();
    await expectNoViolations(document.body);
  });

  it('with a filter chip’s choices open', async () => {
    const { container } = table(everything);
    click(container.querySelector('.itsm-FilterChip__trigger')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('with the View menu open', async () => {
    const { container } = table({ ...everything, columns: [...ruleColumns, { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true }] });
    pointerDown(container.querySelector('.itsm-ViewMenu__trigger')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('as drawers, with the current row marked, grouped under headings', async () => {
    table({
      activate: { kind: 'drawer', openKind: 'rule', keyField: 'key' },
      currentKeys: ['after-hours'],
      groupBy: { field: 'event', label: (row) => (row.event === 'created' ? 'When a ticket is created' : 'When a ticket changes') },
      selection: 'single',
    });
    await expectNoViolations(document.body);
  });

  it('with every cell kind', async () => {
    const columns: ColumnSpec[] = [
      { id: 'name', header: 'Name', field: 'name', kind: 'title', secondaryField: 'key' },
      { id: 'mono', header: 'Key', field: 'key', kind: 'mono' },
      { id: 'runs', header: 'Runs', field: 'runs', kind: 'number' },
      { id: 'share', header: 'Share', field: 'share', kind: 'percent' },
      { id: 'cost', header: 'Cost', field: 'cost', kind: 'currency', format: { currency: 'GBP' } },
      { id: 'date', header: 'Created', field: 'updatedAt', kind: 'date' },
      { id: 'datetime', header: 'Updated', field: 'updatedAt', kind: 'datetime' },
      { id: 'relative', header: 'Changed', field: 'updatedAt', kind: 'relative' },
      { id: 'duration', header: 'Target', field: 'minutes', kind: 'duration', format: { unit: 'minutes' } },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: { live: { label: 'Live', tone: 'success' } }, srPrefix: 'Status' },
      { id: 'badge', header: 'Type', field: 'type', kind: 'badge' },
      { id: 'priority', header: 'Priority', field: 'priority', kind: 'priority' },
      { id: 'person', header: 'Owner', field: 'owner', kind: 'person' },
      { id: 'people', header: 'Watchers', field: 'watchers', kind: 'people' },
      { id: 'tags', header: 'Tags', field: 'tags', kind: 'tags' },
      { id: 'boolean', header: 'Enabled', field: 'enabled', kind: 'boolean' },
      { id: 'link', header: 'Docs', field: 'docs', kind: 'link' },
      { id: 'progress', header: 'Done', field: 'done', kind: 'progress' },
      { id: 'sparkline', header: 'Trend', field: 'trend', kind: 'sparkline' },
      { id: 'channel', header: 'Channel', field: 'channel', kind: 'channel' },
      { id: 'sla', header: 'SLA', field: 'sla', kind: 'sla' },
    ];
    const row = {
      key: 'vip',
      name: 'VIP requester',
      runs: 1200,
      share: 0.42,
      cost: 12.5,
      updatedAt: '2026-09-28T09:00:00Z',
      minutes: 255,
      status: 'live',
      type: 'Incident',
      priority: 'P1',
      owner: { displayName: 'Ada Lovelace' },
      watchers: ['Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Tim Berners-Lee'],
      tags: ['vip', 'network', 'london', 'urgent'],
      enabled: true,
      docs: 'https://example.com/docs',
      done: 0.6,
      trend: [3, 5, 4, 8],
      channel: 'email',
      sla: { state: 'running', remainingMinutes: 42, targetType: 'resolution' },
    };
    render(
      <UrlProvider nav={nav}>
        <DataTable caption="Everything" columns={columns} rows={[row]} rowKey="key" />
      </UrlProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('loading, empty, filtered to nothing and failed', async () => {
    table({ rows: [], loading: true });
    table({ rows: [], empty: { title: 'No rules yet', description: 'Rules act on tickets as they change.', action: { id: 'new', label: 'New rule', href: '/rules/new' } } });
    table({ rows: [], problem: { status: 503 }, onRetry: () => undefined });
    const { container } = table({ search: { placeholder: 'Search rules', mode: 'client' }, filters: [{ ...statusFilter, defaultValue: ['nothing'] }] });
    void container;
    await expectNoViolations(document.body);
  });

  it('refreshing, with a sort within the loaded rows', async () => {
    table({ ...everything, refreshing: true, sort: { columnId: 'runs', direction: 'descending' } });
    await expectNoViolations(document.body);
  });
});

describe('the parts', () => {
  it('a FilterBar in the URL, and a FilterChip open on its own', async () => {
    render(
      <UrlProvider nav={nav}>
        <FilterBar urlKey="" filters={[statusFilter, { id: 'retired', label: 'Show retired', type: 'boolean', pinned: true }]} values={{}} search={{ value: '', placeholder: 'Search tickets' }} resultCount={{ shown: 50, hasMore: true, noun }} />
        <FilterChip label="Priority" valueLabel="P1" active onClear={() => undefined} open>
          <p>Choices</p>
        </FilterChip>
      </UrlProvider>,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('a BulkActionBar with its More menu open', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <BulkActionBar
          count={3}
          noun={noun}
          actions={[
            { id: 'a', label: 'Assign' },
            { id: 'r', label: 'Resolve' },
            { id: 'm', label: 'Merge', disabled: true, disabledReason: 'Pick two or more' },
            { id: 'd', label: 'Delete', tone: 'danger' },
          ]}
          onAction={() => undefined}
          onClear={() => undefined}
        />
      </UrlProvider>,
    );
    pointerDown([...container.querySelectorAll('button')].find((button) => button.textContent === 'More')!);
    await settle();
    await expectNoViolations(document.body);
  });

  it('a busy BulkActionBar, LoadMore and OlderNewer', async () => {
    render(
      <UrlProvider nav={nav}>
        <BulkActionBar count={200} noun={noun} actions={[]} onAction={() => undefined} onClear={() => undefined} busy={{ label: 'Resolving', done: 20, total: 200, onCancel: () => undefined }} />
        <LoadMore hasMore shown={100} noun={noun} pageSize={50} onLoadMore={() => undefined} />
        <LoadMore hasMore={false} shown={3} noun={noun} onLoadMore={() => undefined} />
        <OlderNewer olderHref="/audit?cursor=b" newerHref="/audit?cursor=a" firstHref="/audit" />
      </UrlProvider>,
    );
    await expectNoViolations(document.body);
  });

  it('a ViewMenu open', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <ViewMenu
          sort={{ options: [{ value: 'name', label: 'Name' }, { value: 'updated', label: 'Updated' }], value: 'name', onChange: () => undefined }}
          density
          columns={[
            { id: 'owner', label: 'Owner', visible: true, hideable: true },
            { id: 'runs', label: 'Runs', visible: false, hideable: true },
          ]}
          onColumnsChange={() => undefined}
        />
      </UrlProvider>,
    );
    pointerDown(container.querySelector('button')!);
    await settle();
    await expectNoViolations(document.body);
  });
});
