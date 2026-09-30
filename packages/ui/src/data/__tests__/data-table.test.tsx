// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { componentStylesheet } from '../../styles/index.js';
import { resetNotifications } from '../../provider/notify.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { DataTable, type DataTableProps } from '../DataTable.js';
import { dataTableStyles } from '../DataTable.styles.js';
import type { ColumnSpec } from '../types.js';
import { navigation, noun, resetLocation, ruleColumns, rules, statusFilter, UrlProvider, type Navigation, type Rule } from './support/table.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

/**
 * The data table's behaviour: semantics a screen reader can navigate, rows
 * that never nest one control in another, sorting and filtering that say
 * how far they reach, pagination without totals, the states, the card
 * layout, reordering without drag, and a refetch that never dims the rows.
 */

let nav: Navigation;

beforeEach(() => {
  resetLocation();
  nav = navigation();
  window.localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  resetNotifications();
  destroyAnnouncer();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount(props: Partial<DataTableProps<Rule>> = {}) {
  const rendered = render(
    <UrlProvider nav={nav}>
      <DataTable<Rule> caption="Rules" columns={ruleColumns} rows={rules} rowKey="key" countNoun={noun} {...props} />
    </UrlProvider>,
  );
  const names = (): string[] =>
    [...rendered.container.querySelectorAll('tbody tr[data-itsm-row] .itsm-DataTable__primaryCell')].map((cell) => cell.textContent ?? '');
  const header = (name: string): HTMLTableCellElement =>
    [...rendered.container.querySelectorAll<HTMLTableCellElement>('thead th')].find((cell) => cell.textContent?.startsWith(name))!;
  return { ...rendered, names, header };
}

/** Every focusable or clickable thing, and whether any sits inside another. */
function nestedControls(root: Element): string[] {
  const interactive = 'a[href], button, input, select, textarea, [role="button"], [role="checkbox"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const found: string[] = [];
  for (const element of root.querySelectorAll(interactive)) {
    const outer = element.parentElement?.closest('a[href], button, [role="button"], [role="link"]');
    if (outer && root.contains(outer)) found.push(`${outer.tagName} > ${element.tagName}`);
  }
  return found;
}

describe('semantics', () => {
  it('is a table with a caption, column headers and a row header — not a grid', () => {
    const { container } = mount();
    const table = container.querySelector('table')!;
    expect(table.getAttribute('role')).toBeNull();
    expect(table.querySelector('caption')?.textContent).toBe('Rules');
    expect([...table.querySelectorAll('thead th[scope="col"]')].map((cell) => cell.textContent)).toEqual(['Name', 'Status', 'Runs', 'Owner']);
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(rules.length);
  });

  it('has a nesting check that finds nesting (the check the next test relies on)', () => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<a href="/x"><button type="button">x</button></a><button type="button">y</button>';
    expect(nestedControls(fixture)).toEqual(['A > BUTTON']);
  });

  it('never puts one control inside another, with every feature that adds one switched on', async () => {
    const { container } = mount({
      selection: 'multiple',
      rowActions: [{ id: 'edit', label: 'Edit', href: '/rules/{key}/edit' }],
      reorderable: { onMove: async () => undefined },
      columns: [...ruleColumns, { id: 'docs', header: 'Docs', field: 'key', kind: 'link', href: '/docs/{key}' }],
    });
    expect(nestedControls(container)).toEqual([]);
    // The row's own controls are siblings in separate cells.
    const row = container.querySelector('tbody tr')!;
    expect([...row.querySelectorAll('[data-itsm-control]')].map((element) => element.closest('td, th')?.className)).toEqual([
      'itsm-DataTable__selectCell',
      'itsm-DataTable__cell itsm-DataTable__primaryCell',
      'itsm-DataTable__actionsCell',
    ]);
  });

  it('names an empty cell "Not set" for a screen reader, or uses the column’s own word', () => {
    const { container } = mount({ columns: [...ruleColumns, { id: 'desc', header: 'Description', field: 'description' }] });
    const printer = container.querySelectorAll('tbody tr')[1]!;
    expect(printer.querySelector('[data-kind="person"] .itsm-DataTable__empty')?.textContent).toBe('Unassigned');
    expect(printer.querySelector('[data-kind="text"] .itsm-DataTable__empty')?.textContent).toBe('—Not set');
  });

  it('draws custom cells from a client parent', () => {
    const { container } = mount({ cells: { runs: (row) => <strong>{row.runs} runs</strong> } });
    expect(container.querySelector('tbody tr strong')?.textContent).toBe('120 runs');
  });
});

describe('sorting', () => {
  it('sorts the loaded rows from a header, says so with aria-sort, and turns round on a second press', () => {
    const { names, header } = mount();
    click(header('Name').querySelector('button')!);
    expect(names()).toEqual(['After hours', 'Major incident', 'Printer jams', 'VIP requester']);
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    click(header('Name').querySelector('button')!);
    expect(names()[0]).toBe('VIP requester');
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
  });

  it('starts a number column largest first, and sorts a mapped state in the map’s order', () => {
    const { names, header } = mount();
    click(header('Runs').querySelector('button')!);
    expect(names()).toEqual(['VIP requester', 'After hours', 'Printer jams', 'Major incident']);
    click(header('Status').querySelector('button')!);
    expect(names()).toEqual(['Printer jams', 'VIP requester', 'After hours', 'Major incident']);
  });

  it('is honest about a sort within a partial list: "Sorted within the 4 loaded", with Load all', () => {
    const { container, header } = mount({ pagination: { mode: 'loadMore', hasMore: true, onLoadMore: () => undefined } });
    click(header('Name').querySelector('button')!);
    const note = container.querySelector('.itsm-DataTable__note');
    expect(note?.textContent).toContain('Sorted within the 4 loaded');
    expect(note?.querySelector('button')?.textContent).toBe('Load all (up to 200)');
    expect(container.querySelector('caption')?.textContent).toBe('Rules, sorted within the 4 loaded');
  });

  it('says nothing of the kind once every row is loaded', () => {
    const { container, header } = mount({ pagination: { mode: 'loadMore', hasMore: false, onLoadMore: () => undefined } });
    click(header('Name').querySelector('button')!);
    expect(container.querySelector('.itsm-DataTable__note')).toBeNull();
    expect(container.querySelector('caption')?.textContent).toBe('Rules');
  });

  it('asks the server for a server sort, through the router, and does not re-sort what comes back', () => {
    const columns: ColumnSpec[] = [...ruleColumns, { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', sortable: 'server', sortField: 'updatedAt' }];
    const { names, header, container } = mount({ urlKey: '', columns, pagination: { mode: 'loadMore', hasMore: true, onLoadMore: () => undefined } });
    click(header('Updated').querySelector('button')!);
    expect(nav.router.replace).toHaveBeenCalledWith('/rules?sort=-updatedAt', { scroll: false });
    // The server sorts; the rows stay in the order they were given.
    expect(names()).toEqual(rules.map((rule) => rule.name));
    expect(container.querySelector('.itsm-DataTable__note')).toBeNull();
  });

  it('loads everything (up to 200) for "Load all", then says how many', async () => {
    function Paged() {
      const [rows, setRows] = useState<readonly Rule[]>(rules.slice(0, 2));
      const more = rows.length < rules.length;
      return (
        <DataTable<Rule>
          caption="Rules"
          columns={ruleColumns}
          rows={rows}
          rowKey="key"
          countNoun={noun}
          sort={{ columnId: 'name', direction: 'ascending' }}
          pagination={{ mode: 'loadMore', hasMore: more, onLoadMore: async () => setRows(rules.slice(0, rows.length + 1)) }}
        />
      );
    }
    const { container } = render(
      <UrlProvider nav={nav}>
        <Paged />
      </UrlProvider>,
    );
    click(container.querySelector('.itsm-DataTable__loadAll')!);
    await settle(50);
    await settle(50);
    expect(container.querySelectorAll('tbody tr[data-itsm-row]')).toHaveLength(4);
    expect(container.querySelector('.itsm-DataTable__note')).toBeNull();
    await settle(50);
    expect(announcerText()).toBe('4 rules loaded');
  });
});

describe('searching and filtering', () => {
  it('searches the loaded rows as the person types, and says how far the search reached', async () => {
    const { names, container } = mount({ search: { placeholder: 'Search rules', mode: 'client' }, pagination: { mode: 'loadMore', hasMore: true, onLoadMore: () => undefined } });
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'printer');
    await settle(250);
    expect(names()).toEqual(['Printer jams']);
    expect(container.querySelector('.itsm-FilterBar__count')?.textContent).toBe('1 match in the 4 loaded');
  });

  it('finds nothing honestly, and "Clear filters" brings the rows back', async () => {
    const { container, names } = mount({ search: { placeholder: 'Search rules', mode: 'client' } });
    typeInto(container.querySelector<HTMLInputElement>('input[type="search"]')!, 'zzz');
    await settle(250);
    expect(container.querySelector('tbody h3')?.textContent).toBe('No rules match “zzz”');
    click([...container.querySelectorAll('tbody button')].find((button) => button.textContent === 'Clear filters')!);
    await settle(250);
    expect(names()).toHaveLength(4);
  });

  it('filters the loaded rows from a pinned chip, shows the value on the chip, and clears it', async () => {
    const { container, names } = mount({ filters: [statusFilter] });
    const chip = container.querySelector<HTMLButtonElement>('.itsm-FilterChip__trigger')!;
    expect(chip.textContent).toBe('Status');
    click(chip);
    await settle();
    const live = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'Live')!;
    click(live);
    await settle();
    expect(names()).toEqual(['VIP requester', 'After hours']);
    expect(container.querySelector('.itsm-FilterChip__trigger')?.textContent).toBe('Status: Live');
    expect(container.querySelector('.itsm-FilterBar__count')?.textContent).toBe('2 rules');
    click(container.querySelector('.itsm-FilterChip__clear')!);
    await settle();
    expect(names()).toHaveLength(4);
  });

  it('keeps a client filter in the URL without a server round trip when the table has a urlKey', async () => {
    const { container } = mount({ urlKey: 'rules', filters: [statusFilter] });
    click(container.querySelector('.itsm-FilterChip__trigger')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'Draft')!);
    await settle();
    expect(window.location.search).toBe('?rules.status=draft');
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it('sends a server filter through the router and leaves the rows to the server', async () => {
    const { container, names } = mount({ urlKey: '', filters: [{ ...statusFilter, mode: 'server' }] });
    click(container.querySelector('.itsm-FilterChip__trigger')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'Draft')!);
    await settle();
    expect(nav.router.replace).toHaveBeenCalledWith('/rules?status=draft', { scroll: false });
    expect(names()).toHaveLength(4);
  });
});

describe('pagination', () => {
  it('says "Showing 4 · more available", loads more, and announces what arrived', async () => {
    function Paged() {
      const [rows, setRows] = useState<readonly Rule[]>(rules.slice(0, 2));
      return (
        <DataTable<Rule>
          caption="Rules"
          columns={ruleColumns}
          rows={rows}
          rowKey="key"
          countNoun={noun}
          pagination={{ mode: 'loadMore', hasMore: rows.length < 4, pageSize: 2, onLoadMore: async () => setRows(rules) }}
        />
      );
    }
    const { container } = render(
      <UrlProvider nav={nav}>
        <Paged />
      </UrlProvider>,
    );
    expect(container.querySelector('.itsm-LoadMore__status')?.textContent).toBe('Showing 2 · more available');
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Load 2 more')!;
    focus(button);
    click(button);
    await settle(50);
    expect(container.querySelectorAll('tbody tr[data-itsm-row]')).toHaveLength(4);
    expect(container.querySelector('.itsm-LoadMore__status')?.textContent).toBe('4 rules');
    expect(announcerText()).toBe('2 more loaded');
    // The button went with the last page; focus did not fall to the page.
    expect(activeElement()).toBe(container.querySelector('.itsm-LoadMore__status'));
  });

  it('pages a complete set in the browser', () => {
    const { container, names } = mount({ pagination: { mode: 'pages', pageSize: 3 } });
    expect(names()).toHaveLength(3);
    expect(container.querySelector('.itsm-DataTable__pageOf')?.textContent).toBe('Page 1 of 2');
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Next')!);
    expect(names()).toEqual(['Major incident']);
  });

  it('draws Older and Newer as links for the audit log', () => {
    const { container } = mount({ pagination: { mode: 'olderNewer', olderHref: '/audit?cursor=b', newerHref: '/audit?cursor=a', firstHref: '/audit' } });
    const nav = container.querySelector('nav[aria-label="Pages"]')!;
    expect([...nav.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Newest', '/audit'],
      ['Newer', '/audit?cursor=a'],
      ['Older', '/audit?cursor=b'],
    ]);
  });
});

describe('states', () => {
  it('shows skeleton rows on the first load only, hidden from assistive technology', () => {
    const { container, rerender } = mount({ rows: [], loading: true, skeletonRows: 3 });
    const table = container.querySelector('table')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('tbody tr.itsm-DataTable__skeletonRow[aria-hidden="true"]')).toHaveLength(3);
    rerender(
      <UrlProvider nav={nav}>
        <DataTable<Rule> caption="Rules" columns={ruleColumns} rows={rules} rowKey="key" loading />
      </UrlProvider>,
    );
    // A refetch of rows already shown is the refresh line, not skeletons.
    expect(container.querySelectorAll('.itsm-DataTable__skeletonRow')).toHaveLength(0);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Refreshing rules');
  });

  it('refreshes without dimming: busy, a 2 px line, the rows exactly as they were', () => {
    const { container } = mount({ refreshing: true });
    const table = container.querySelector('table')!;
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.itsm-DataTable__refresh[role="progressbar"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr[data-itsm-row]')).toHaveLength(4);
    for (const element of container.querySelectorAll<HTMLElement>('*')) expect(element.style.opacity).toBe('');
    // And nothing in the stylesheet fades a busy or refreshing table.
    expect(dataTableStyles).not.toMatch(/\[data-refreshing\][^{]*\{[^}]*opacity/);
    expect(dataTableStyles).not.toMatch(/\[aria-busy[^\]]*\][^{]*\{[^}]*opacity/);
  });

  it('shows the empty state inside the table when there has never been anything', () => {
    const { container } = mount({ rows: [], empty: { title: 'No rules yet', description: 'Rules act on tickets as they change.' } });
    const cell = container.querySelector('tbody td[colspan]')!;
    expect(cell.querySelector('h3')?.textContent).toBe('No rules yet');
    expect(Number(cell.getAttribute('colspan'))).toBe(4);
  });

  it('shows a problem in the table when nothing loaded, and keeps the rows when a refresh failed', () => {
    const onRetry = vi.fn();
    const { container, rerender } = mount({ rows: [], problem: { status: 503 }, onRetry });
    expect(container.querySelector('tbody .itsm-ProblemState')).not.toBeNull();
    rerender(
      <UrlProvider nav={nav}>
        <DataTable<Rule> caption="Rules" columns={ruleColumns} rows={rules} rowKey="key" problem={{ status: 503 }} onRetry={onRetry} />
      </UrlProvider>,
    );
    expect(container.querySelectorAll('tbody tr[data-itsm-row]')).toHaveLength(4);
    expect(container.textContent).toContain("Couldn't refresh rules");
    click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!);
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('selection', () => {
  it('marks the table while anything is selected, which is what shows every row’s checkbox', () => {
    const { container } = mount({ selection: 'multiple' });
    const root = container.querySelector('.itsm-DataTable')!;
    expect(root.hasAttribute('data-any-selected')).toBe(false);
    click(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!);
    expect(root.hasAttribute('data-any-selected')).toBe(true);
    expect(container.querySelector('tbody tr')?.hasAttribute('data-selected')).toBe(true);
  });

  it('hides checkboxes until hover or focus on a pointer that hovers, and behind "Select" on touch', () => {
    // The rules the checkboxes live by, as written.
    expect(dataTableStyles).toContain('@media (hover: hover) and (pointer: fine)');
    expect(dataTableStyles).toMatch(/:not\(\[data-any-selected\]\) \.itsm-DataTable__row:not\(:hover\):not\(:focus-within\) \.itsm-DataTable__checkbox/);
    expect(dataTableStyles).toMatch(/@media \(pointer: coarse\) \{\s*\.itsm-DataTable:not\(\[data-select-mode\]\):not\(\[data-any-selected\]\) \.itsm-DataTable__selectCell \{\s*display: none;/);
  });

  it('turns a tap on a row into selecting it once "Select" is on', () => {
    const { container } = mount({ selection: 'multiple' });
    const toggle = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Select')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    click(toggle);
    expect(container.querySelector('.itsm-DataTable')?.hasAttribute('data-select-mode')).toBe(true);
    expect(toggle.textContent).toBe('Done');
    click(container.querySelector('tbody tr [data-kind="number"]')!);
    expect(container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')?.checked).toBe(true);
    expect(nav.followed).toEqual([]);
  });

  it('labels the header checkbox for what it selects, and runs a bulk action on the selected rows', async () => {
    const onAction = vi.fn(async () => undefined);
    const { container } = mount({
      selection: 'multiple',
      bulkActions: [{ id: 'archive', label: 'Archive' }],
      onAction,
      pagination: { mode: 'loadMore', hasMore: true, onLoadMore: () => undefined },
    });
    const all = container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
    expect(container.querySelector(`label[for="${all.id}"]`)?.textContent).toBe('Select all 4 loaded rules');
    click(all);
    click([...container.querySelectorAll('[role="toolbar"] button')].find((button) => button.textContent === 'Archive')!);
    await settle();
    expect(onAction).toHaveBeenCalledWith('archive', [...rules], undefined);
    // Done: the selection goes, and the bar with it.
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('says how many are selected, once the selecting pauses', async () => {
    const { container } = mount({ selection: 'multiple' });
    const boxes = container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    click(boxes[0]!);
    click(boxes[1]!);
    await settle(350);
    expect(announcerText()).toBe('2 selected');
  });
});

describe('opening a drawer', () => {
  it('links each row to its drawer, opens it in place with pushState, and marks the row as current', () => {
    const onActivate = vi.fn();
    const { container } = mount({ activate: { kind: 'drawer', openKind: 'rule', keyField: 'key' }, onActivate });
    const links = container.querySelectorAll<HTMLAnchorElement>('tbody a[data-itsm-control="primary"]');
    expect(links[0]?.getAttribute('href')).toBe('?open=rule%3Avip-requester');
    const before = window.history.length;
    click(links[0]!);
    expect(window.location.search).toBe('?open=rule%3Avip-requester');
    expect(window.history.length).toBe(before + 1);
    expect(onActivate).toHaveBeenCalledWith(rules[0]);
    expect(container.querySelector('tbody tr')?.getAttribute('aria-current')).toBe('true');
    // Another row, with the drawer open, replaces rather than stacking history.
    click(links[1]!);
    expect(window.history.length).toBe(before + 1);
    expect(container.querySelectorAll('tbody tr')[1]?.getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('tbody tr')?.hasAttribute('aria-current')).toBe(false);
  });
});

describe('reordering without drag', () => {
  function Ordered({ sorted = false }: { readonly sorted?: boolean }) {
    const [rows, setRows] = useState<readonly Rule[]>(rules);
    return (
      <DataTable<Rule>
        caption="Rules"
        columns={ruleColumns}
        rows={rows}
        rowKey="key"
        {...(sorted ? { sort: { columnId: 'name', direction: 'ascending' as const } } : {})}
        reorderable={{
          onMove: async (key, direction) => {
            const index = rows.findIndex((row) => row.key === key);
            const next = [...rows];
            const [moved] = next.splice(index, 1);
            next.splice(direction === 'up' ? index - 1 : index + 1, 0, moved!);
            setRows(next);
          },
        }}
      />
    );
  }

  it('moves a row with Alt+↓, keeps focus on it, and says where it went', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <Ordered />
      </UrlProvider>,
    );
    focus(container.querySelector<HTMLElement>('tbody a[data-itsm-control="primary"]')!);
    press(activeElement()!, 'ArrowDown', { altKey: true });
    await settle();
    const names = [...container.querySelectorAll('tbody .itsm-DataTable__primaryCell')].map((cell) => cell.textContent);
    expect(names.slice(0, 2)).toEqual(['Printer jams', 'VIP requester']);
    expect(activeElement()?.textContent).toBe('VIP requester');
    await settle(50);
    expect(announcerText()).toBe('VIP requester moved to position 2 of 4');
  });

  it('offers Move up and Move down in the row menu, unavailable at the ends', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <Ordered />
      </UrlProvider>,
    );
    focus(container.querySelector<HTMLElement>('tbody a[data-itsm-control="primary"]')!);
    press(activeElement()!, '.');
    await settle();
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => [item.textContent?.replace(/⌥.*$|Alt.*$/, ''), item.getAttribute('aria-disabled')])).toEqual([
      ['Move up', 'true'],
      ['Move down', null],
    ]);
    click(items[1]!);
    await settle();
    expect(container.querySelector('tbody .itsm-DataTable__primaryCell')?.textContent).toBe('Printer jams');
  });

  it('explains why a sorted list cannot be reordered', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <Ordered sorted />
      </UrlProvider>,
    );
    focus(container.querySelector<HTMLElement>('tbody a[data-itsm-control="primary"]')!);
    press(activeElement()!, '.');
    await settle();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Clear the sort to reorder');
  });
});

describe('cards in a narrow container', () => {
  it('turns rows into cards below 640 px of container by default, with a container query', () => {
    const { container } = mount();
    expect(container.querySelector('.itsm-DataTable')?.getAttribute('data-card-below')).toBe('640');
    expect(dataTableStyles).toContain('@container itsm-datatable (width < 40rem)');
    expect(dataTableStyles).toMatch(/@container itsm-datatable \(width < 40rem\) \{\s*\n\.itsm-DataTable\[data-card-below="640"\] \.itsm-DataTable__table,/);
    expect(componentStylesheet).toContain('container: itsm-datatable / inline-size');
  });

  it('measures a breakpoint of its own, and never makes cards with cardBelow 0', () => {
    let width = 480;
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: () => void) {
          observers.push(() => this.callback());
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const { container } = mount({ cardBelow: 500 });
    const root = container.querySelector('.itsm-DataTable')!;
    expect(root.getAttribute('data-layout')).toBe('cards');
    width = 900;
    act(() => {
      for (const notify of observers) notify();
    });
    return settle().then(() => {
      expect(root.hasAttribute('data-layout')).toBe(false);
      cleanupDocument();
      const never = mount({ cardBelow: 0 });
      expect(never.container.querySelector('.itsm-DataTable')?.hasAttribute('data-card-below')).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  it('gives each meta cell its column’s name for the card layout, and hides it in the table', () => {
    const { container } = mount();
    const runs = container.querySelector('tbody [data-kind="number"]')!;
    expect(runs.getAttribute('data-card-role')).toBe('meta');
    expect(runs.querySelector('.itsm-DataTable__cellLabel')?.textContent).toBe('Runs: ');
    expect(container.querySelector('tbody [data-kind="status"]')?.getAttribute('data-card-role')).toBe('badge');
  });
});

describe('the View menu', () => {
  it('hides a column, and brings it back', async () => {
    const { container } = mount();
    pointerDown(container.querySelector('.itsm-ViewMenu__trigger')!);
    await settle();
    const owner = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent === 'Owner')!;
    expect(owner.getAttribute('aria-checked')).toBe('true');
    click(owner);
    await settle();
    expect([...container.querySelectorAll('thead th[scope="col"]')].map((cell) => cell.textContent)).toEqual(['Name', 'Status', 'Runs']);
  });

  it('sorts from the menu, with the direction in words that fit the column', async () => {
    const { container, names } = mount();
    pointerDown(container.querySelector('.itsm-ViewMenu__trigger')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === 'Runs')!);
    await settle();
    expect(names()[0]).toBe('VIP requester');
    pointerDown(container.querySelector('.itsm-ViewMenu__trigger')!);
    await settle();
    const orders = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((item) => item.textContent);
    expect(orders).toContain('Smallest first');
    expect(orders).toContain('Largest first');
  });

  it('shows technical columns only to people who asked for technical keys', async () => {
    const columns: ColumnSpec[] = [...ruleColumns, { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true }];
    const { container } = mount({ columns });
    expect(container.querySelector('tbody [data-kind="mono"]')).toBeNull();
    pointerDown(container.querySelector('.itsm-ViewMenu__trigger')!);
    await settle();
    click([...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((item) => item.textContent === 'Show technical keys')!);
    await settle();
    expect(container.querySelector('tbody [data-kind="mono"] code')?.textContent).toBe('vip-requester');
  });
});

describe('groups and live rows', () => {
  it('groups rows under sticky headings, in the order each group first appears', () => {
    const { container } = mount({ groupBy: { field: 'event', label: (row) => (row.event === 'created' ? 'When a ticket is created' : 'When a ticket changes') } });
    const bodies = container.querySelectorAll('tbody');
    expect(bodies).toHaveLength(2);
    expect([...bodies].map((body) => body.querySelector('th[scope="colgroup"]')?.textContent)).toEqual(['When a ticket is created2', 'When a ticket changes2']);
  });

  it('flashes rows a live update touched, and stops', async () => {
    const { container, rerender } = mount();
    rerender(
      <UrlProvider nav={nav}>
        <DataTable<Rule> caption="Rules" columns={ruleColumns} rows={rules} rowKey="key" highlightKeys={['after-hours']} />
      </UrlProvider>,
    );
    const row = container.querySelectorAll('tbody tr')[2]!;
    expect(row.getAttribute('data-flash')).toBe('odd');
    await settle(1300);
    expect(row.hasAttribute('data-flash')).toBe(false);
  });
});

describe('long lists', () => {
  it('windows a long list once TanStack Virtual has loaded, and tells a screen reader how many rows there are', async () => {
    // jsdom has no layout: give rows the height a browser would.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'TR' ? 44 : 0;
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const many: Rule[] = Array.from({ length: 400 }, (_, index) => ({ ...rules[0]!, key: `rule-${index}`, name: `Rule ${index + 1}` }));
    const { container } = mount({ rows: many, virtual: true });
    // Until the chunk arrives, the first rows render plainly.
    expect(container.querySelectorAll('tbody tr[data-itsm-row]').length).toBeLessThanOrEqual(100);
    await settle(50);
    await settle(50);
    const rendered = container.querySelectorAll('tbody tr[data-itsm-row]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
    expect(container.querySelector('table')?.getAttribute('aria-rowcount')).toBe('401');
    expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    expect(container.querySelectorAll('tbody tr.itsm-DataTable__spacer[aria-hidden="true"]')).toHaveLength(2);
  });

  it('scrolls the window to a row the keyboard moves to, and focuses it once it is drawn', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'TR' ? 44 : 0;
    });
    // jsdom does not scroll or lay out: give the page its height, and move the window as a browser would.
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(400 * 44 + 768);
    vi.spyOn(window, 'scrollTo').mockImplementation(((options: ScrollToOptions) => {
      Object.defineProperty(window, 'scrollY', { value: options.top ?? 0, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    }) as typeof window.scrollTo);
    const many: Rule[] = Array.from({ length: 400 }, (_, index) => ({ ...rules[0]!, key: `rule-${index}`, name: `Rule ${index + 1}` }));
    const { container } = mount({ rows: many, virtual: true });
    await settle(50);
    await settle(50);
    focus(container.querySelector<HTMLElement>('tbody [data-itsm-control="primary"]')!);
    press(activeElement()!, 'End');
    await settle(50);
    await settle(50);
    expect(activeElement()?.textContent).toBe('Rule 400');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
