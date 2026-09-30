// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcerText, destroyAnnouncer } from '../../a11y/announcer.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, press, render, settle, typeInto } from '../../web/__tests__/support/render.js';
import { InteractiveTable } from '../../web/InteractiveTable.js';
import { BulkActionBar } from '../BulkActionBar.js';
import { LoadMore } from '../LoadMore.js';
import { OlderNewer } from '../OlderNewer.js';
import { ViewMenu } from '../ViewMenu.js';
import { navigation, resetLocation, UrlProvider, type Navigation } from './support/table.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

/**
 * The pieces around a table: the bulk bar, "Load more", Older/Newer, the View
 * menu — and the deprecated `InteractiveTable`, which is now a `DataTable`
 * underneath and must still honour its old contract.
 */

const noun = { one: 'ticket', other: 'tickets' };
let nav: Navigation;

beforeEach(() => {
  resetLocation('/tickets');
  nav = navigation();
});

afterEach(() => {
  cleanupDocument();
  destroyAnnouncer();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BulkActionBar', () => {
  const actions = [
    { id: 'assign', label: 'Assign' },
    { id: 'resolve', label: 'Resolve' },
    { id: 'merge', label: 'Merge', disabled: true, disabledReason: 'Pick two tickets or more' },
    { id: 'delete', label: 'Delete', tone: 'danger' as const, confirm: { title: 'Delete 3 tickets?', confirmLabel: 'Delete tickets', tone: 'danger' as const, requireReason: true } },
  ];

  function bar(props: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
    const onAction = vi.fn(async () => undefined);
    const onClear = vi.fn();
    const rendered = render(
      <UrlProvider nav={nav}>
        <BulkActionBar count={3} noun={noun} actions={actions} onAction={onAction} onClear={onClear} {...props} />
      </UrlProvider>,
    );
    const toolbar = rendered.container.querySelector<HTMLElement>('[role="toolbar"]')!;
    return { ...rendered, toolbar, onAction, onClear };
  }

  it('is a toolbar named for what it acts on, with two actions and the rest behind More', () => {
    const { toolbar } = bar();
    expect(toolbar.getAttribute('aria-label')).toBe('Bulk actions for 3 selected tickets');
    expect([...toolbar.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual([
      'Assign',
      'Resolve',
      'More',
      'Clear selection',
    ]);
  });

  it('is one tab stop, with ← → Home and End between its controls', async () => {
    const { toolbar } = bar({ actions: actions.slice(0, 2) });
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    focus(buttons[0]!);
    press(buttons[0]!, 'ArrowRight');
    expect(activeElement()).toBe(buttons[1]);
    press(buttons[1]!, 'End');
    expect(activeElement()).toBe(buttons[2]);
    press(buttons[2]!, 'ArrowRight');
    expect(activeElement()).toBe(buttons[0]);
    press(buttons[0]!, 'ArrowLeft');
    expect(activeElement()).toBe(buttons[2]);
    expect(buttons[2]!.tabIndex).toBe(0);
    // Focusing the icon button fetched its tooltip; let that land inside act().
    await settle();
  });

  it('runs an action by id and clears', () => {
    const { toolbar, onAction, onClear } = bar();
    click([...toolbar.querySelectorAll('button')].find((button) => button.textContent === 'Resolve')!);
    expect(onAction).toHaveBeenCalledWith('resolve');
    click(toolbar.querySelector('button[aria-label="Clear selection"]')!);
    expect(onClear).toHaveBeenCalled();
  });

  it('confirms a dangerous action from the More menu, with the reason it asked for', async () => {
    const { toolbar, onAction } = bar();
    pointerDown([...toolbar.querySelectorAll('button')].find((button) => button.textContent === 'More')!);
    await settle();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['MergePick two tickets or more', 'Delete']);
    click(items[1]!);
    await settle(50);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Delete 3 tickets?');
    typeInto(dialog.querySelector('textarea')!, 'Duplicates of INC-000123');
    click([...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Delete tickets')!);
    await settle(50);
    expect(onAction).toHaveBeenCalledWith('delete', { reason: 'Duplicates of INC-000123' });
  });

  it('opens a menu of choices from an action that carries one, and as a submenu behind More', async () => {
    const chosen = vi.fn();
    const status = { id: 'status', label: 'Status', menu: [{ id: 'resolved', label: 'Resolved', onSelect: () => chosen('resolved') }] };
    const { toolbar, onAction } = bar({ actions: [actions[0]!, status] });
    const trigger = [...toolbar.querySelectorAll('button')].find((button) => button.textContent === 'Status')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    pointerDown(trigger);
    await settle();
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Status for 3 selected tickets');
    click([...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Resolved')!);
    await settle();
    expect(chosen).toHaveBeenCalledWith('resolved');
    expect(onAction).not.toHaveBeenCalled();

    cleanupDocument();
    const overflowing = bar({ actions: [...actions.slice(0, 2), status] as never });
    expect([...overflowing.toolbar.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual([
      'Assign',
      'Resolve',
      'Status',
      'Clear selection',
    ]);
    const four = bar({ actions: [...actions.slice(0, 3), status] as never });
    pointerDown([...four.toolbar.querySelectorAll('button')].find((button) => button.textContent === 'More')!);
    await settle();
    const sub = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith('Status'));
    expect(sub?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('gives way to a long job’s progress, with Cancel', () => {
    const onCancel = vi.fn();
    const { toolbar } = bar({ busy: { label: 'Resolving', done: 40, total: 200, onCancel } });
    expect(toolbar.getAttribute('aria-busy')).toBe('true');
    expect(toolbar.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('20');
    expect([...toolbar.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Cancel', 'Clear selection']);
    click(toolbar.querySelector('button')!);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('LoadMore', () => {
  function Paged({ fail = false }: { readonly fail?: boolean }) {
    const [shown, setShown] = useState(50);
    return (
      <LoadMore
        hasMore={shown < 100}
        shown={shown}
        noun={noun}
        pageSize={50}
        onLoadMore={async () => {
          if (fail) throw new Error('offline');
          setShown((count) => count + 50);
        }}
      />
    );
  }

  it('says there is more without inventing a total, and announces what a load added', async () => {
    const { container } = render(<Paged />);
    expect(container.querySelector('.itsm-LoadMore__status')?.textContent).toBe('Showing 50 · more available');
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Load 50 more');
    focus(button);
    click(button);
    await settle(50);
    expect(announcerText()).toBe('50 more loaded');
    expect(container.querySelector('.itsm-LoadMore__status')?.textContent).toBe('100 tickets');
    expect(container.querySelector('button')).toBeNull();
    expect(activeElement()).toBe(container.querySelector('.itsm-LoadMore__status'));
  });

  it('keeps the button after a failed load, now "Try again", and says why', async () => {
    const { container } = render(<Paged fail />);
    click(container.querySelector('button')!);
    await settle(50);
    expect(container.querySelector('button')?.textContent).toBe('Try again');
    expect(container.querySelector('.itsm-LoadMore__status')?.textContent).toContain("Couldn't load more tickets");
    expect(announcerText('assertive')).toBe("Couldn't load more");
  });

  it('loads when its sentinel scrolls into view, when asked to', async () => {
    let seen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          seen = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const onLoadMore = vi.fn();
    render(<LoadMore hasMore shown={50} noun={noun} auto onLoadMore={onLoadMore} />);
    act(() => seen?.([{ isIntersecting: true }]));
    await settle();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe('OlderNewer', () => {
  it('disables the end it cannot go to, in place, and offers Newest only past the first page', () => {
    const first = render(
      <UrlProvider nav={nav}>
        <OlderNewer olderHref="/audit?cursor=b" firstHref="/audit" />
      </UrlProvider>,
    );
    const navigation = first.container.querySelector('nav')!;
    expect(navigation.getAttribute('aria-label')).toBe('Pages');
    expect([...navigation.querySelectorAll('a, button')].map((element) => [element.tagName, element.textContent, element.hasAttribute('disabled')])).toEqual([
      ['BUTTON', 'Newer', true],
      ['A', 'Older', false],
    ]);
  });
});

describe('ViewMenu', () => {
  it('renders nothing when it has nothing to offer', () => {
    const { container } = render(<ViewMenu density={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('sets the person’s density preference, the one the account menu sets', async () => {
    const { container } = render(
      <UrlProvider nav={nav}>
        <ViewMenu density />
      </UrlProvider>,
    );
    pointerDown(container.querySelector('button')!);
    await settle();
    const compact = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent === 'Compact')!;
    expect(compact.getAttribute('aria-checked')).toBe('false');
    click(compact);
    await settle();
    expect(document.documentElement.getAttribute('data-itsm-density')).toBe('compact');
  });
});

describe('InteractiveTable (deprecated)', () => {
  const rows = [
    { id: 't-1', number: 'INC-1', title: 'VPN will not connect' },
    { id: 't-2', number: 'INC-2', title: 'Printer is jammed' },
  ];
  const columns = [
    { key: 'number', header: 'Ticket', cell: (row: (typeof rows)[number]) => row.number, sortable: true },
    { key: 'title', header: 'Summary', cell: (row: (typeof rows)[number]) => row.title },
  ];

  it('keeps its contract: rows open through onRowActivate, and sorting is the parent’s', () => {
    const onRowActivate = vi.fn();
    const onSortChange = vi.fn();
    const { container } = render(
      <InteractiveTable
        caption="Queue"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ columnKey: 'number', direction: 'ascending' }}
        onSortChange={onSortChange}
        onRowActivate={onRowActivate}
      />,
    );
    expect(container.querySelector('.itsm-DataTable')).not.toBeNull();
    const header = container.querySelector('thead th')!;
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    click(header.querySelector('button')!);
    expect(onSortChange).toHaveBeenCalledWith({ columnKey: 'number', direction: 'descending' });
    // The parent sorts: the rows stay as given until it does.
    expect([...container.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual(['INC-1', 'INC-2']);
    click(container.querySelectorAll<HTMLElement>('tbody [data-itsm-control="primary"]')[1]!);
    expect(onRowActivate).toHaveBeenCalledWith(rows[1]);
    click(container.querySelector('tbody td')!);
    expect(onRowActivate).toHaveBeenLastCalledWith(rows[0]);
  });

  it('has no toolbar, no card layout and no role=grid: the old table, with the new keyboard', () => {
    const { container } = render(<InteractiveTable caption="Queue" columns={columns} rows={rows} rowKey={(row) => row.id} onRowActivate={() => undefined} />);
    expect(container.querySelector('.itsm-FilterBar')).toBeNull();
    expect(container.querySelector('.itsm-DataTable')?.hasAttribute('data-card-below')).toBe(false);
    expect(container.querySelector('table')?.getAttribute('role')).toBeNull();
    const primaries = container.querySelectorAll<HTMLElement>('tbody [data-itsm-control="primary"]');
    focus(primaries[0]!);
    press(primaries[0]!, 'ArrowDown');
    expect(activeElement()).toBe(primaries[1]);
  });

  it('shows its empty message', () => {
    const { container } = render(<InteractiveTable caption="Queue" columns={columns} rows={[]} rowKey={(row) => row.id} empty="Nothing in this queue" />);
    expect(container.querySelector('tbody h3')?.textContent).toBe('Nothing in this queue');
  });
});
