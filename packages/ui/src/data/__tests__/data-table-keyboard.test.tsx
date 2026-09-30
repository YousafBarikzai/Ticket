// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { resetNotifications, subscribeToNotifications, type NotifyEvent } from '../../provider/notify.js';
import { DataTable, type DataTableProps } from '../DataTable.js';
import { navigation, noun, resetLocation, ruleColumns, rules, UrlProvider, type Navigation, type Rule } from './support/table.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));
vi.mock('../../overlays/Toaster.js', () => ({ Toaster: () => null }));

/**
 * The table's keyboard model (X-64, SPEC §5.6): one tab stop in the body,
 * ↑↓ and `j`/`k` between rows keeping the column, ←→ between a row's
 * controls, `x`/Space to select, Shift to extend, mod+A for everything
 * loaded, Enter / `o` / mod+Enter to open, `.` for the row's menu, Escape to
 * clear — with the menu handing focus back to the row it came from.
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
  vi.restoreAllMocks();
});

function table(props: Partial<DataTableProps<Rule>> = {}) {
  const onAction = vi.fn();
  const rendered = render(
    <UrlProvider nav={nav}>
      <DataTable<Rule>
        caption="Rules"
        columns={ruleColumns}
        rows={rules}
        rowKey="key"
        selection="multiple"
        countNoun={noun}
        bulkActions={[{ id: 'archive', label: 'Archive' }]}
        rowActions={[
          { id: 'duplicate', label: 'Duplicate' },
          { id: 'delete', label: 'Delete rule', tone: 'danger' },
        ]}
        onAction={onAction}
        {...props}
      />
    </UrlProvider>,
  );
  const body = rendered.container.querySelector('tbody')!;
  const row = (index: number): HTMLTableRowElement => body.querySelectorAll<HTMLTableRowElement>('tr[data-itsm-row]')[index]!;
  const control = (index: number, column: 'select' | 'primary' | 'menu'): HTMLElement => row(index).querySelector<HTMLElement>(`[data-itsm-control="${column}"]`)!;
  return { ...rendered, body, row, control, onAction };
}

function key(name: string, init: KeyboardEventInit = {}): void {
  press(activeElement()!, name, init);
}

describe('one tab stop', () => {
  it('puts the body’s only tab stop on the first row’s link, and every other row control out of the order', () => {
    const { body, control } = table();
    const stops = [...body.querySelectorAll<HTMLElement>('a, button, input')].filter((element) => element.tabIndex === 0);
    expect(stops).toEqual([control(0, 'primary')]);
    expect(control(0, 'primary').tagName).toBe('A');
    expect(control(0, 'primary').getAttribute('href')).toBe('/rules/vip-requester');
  });

  it('moves between rows with ↑↓ and j/k, and to the ends with Home and End', () => {
    const { control } = table();
    focus(control(0, 'primary'));
    key('ArrowDown');
    expect(activeElement()).toBe(control(1, 'primary'));
    key('j');
    expect(activeElement()).toBe(control(2, 'primary'));
    key('k');
    expect(activeElement()).toBe(control(1, 'primary'));
    key('End');
    expect(activeElement()).toBe(control(3, 'primary'));
    key('Home');
    expect(activeElement()).toBe(control(0, 'primary'));
    // The tab stop moved with focus: one stop, now wherever the person left it.
    key('ArrowDown');
    expect(control(1, 'primary').tabIndex).toBe(0);
    expect(control(0, 'primary').tabIndex).toBe(-1);
  });

  it('moves between a row’s checkbox, link and ⋯ with ←→, and keeps the column when changing rows', () => {
    const { control } = table();
    focus(control(0, 'primary'));
    key('ArrowRight');
    expect(activeElement()).toBe(control(0, 'menu'));
    key('ArrowDown');
    expect(activeElement()).toBe(control(1, 'menu'));
    key('ArrowLeft');
    key('ArrowLeft');
    expect(activeElement()).toBe(control(1, 'select'));
    key('ArrowUp');
    expect(activeElement()).toBe(control(0, 'select'));
  });

  it('lets other links in a row join the tab order only while that row is current', () => {
    const { control, row } = table({ columns: [...ruleColumns, { id: 'docs', header: 'Docs', field: 'key', kind: 'link', href: '/docs/{key}' }] });
    const docs = (index: number): HTMLAnchorElement => row(index).querySelector<HTMLAnchorElement>('a.itsm-DataTable__link')!;
    expect([0, 1, 2].map((index) => docs(index).tabIndex)).toEqual([0, -1, -1]);
    focus(control(0, 'primary'));
    key('ArrowDown');
    expect([0, 1, 2].map((index) => docs(index).tabIndex)).toEqual([-1, 0, -1]);
    // Focusing it makes its row the current one.
    focus(docs(2));
    expect(control(2, 'primary').tabIndex).toBe(0);
  });
});

describe('selecting', () => {
  it('toggles the current row with x, and with Space when the link has focus', () => {
    const { control } = table();
    focus(control(0, 'primary'));
    key('x');
    expect((control(0, 'select') as HTMLInputElement).checked).toBe(true);
    key('ArrowDown');
    key(' ');
    expect((control(1, 'select') as HTMLInputElement).checked).toBe(true);
    key('x');
    expect((control(1, 'select') as HTMLInputElement).checked).toBe(false);
  });

  it('extends the selection with Shift and ↓, and selects everything loaded with mod+A', () => {
    const { control, container } = table();
    focus(control(0, 'primary'));
    key('ArrowDown', { shiftKey: true });
    key('ArrowDown', { shiftKey: true });
    expect([0, 1, 2, 3].map((index) => (control(index, 'select') as HTMLInputElement).checked)).toEqual([true, true, true, false]);
    key('a', { ctrlKey: true });
    expect([0, 1, 2, 3].every((index) => (control(index, 'select') as HTMLInputElement).checked)).toBe(true);
    expect(container.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Bulk actions for 4 selected rules');
  });

  it('clears with Escape, and past three rows offers Undo instead of clearing silently', () => {
    const events: NotifyEvent[] = [];
    subscribeToNotifications((event) => events.push(event));
    const { control, container } = table();
    focus(control(0, 'primary'));
    key('x');
    key('Escape');
    expect((control(0, 'select') as HTMLInputElement).checked).toBe(false);
    expect(events).toEqual([]);

    key('a', { ctrlKey: true });
    key('Escape');
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    const shown = events.find((event) => event.type === 'show');
    expect(shown && shown.type === 'show' ? shown.message : '').toBe('Selection cleared');
    expect(shown && shown.type === 'show' ? typeof shown.options.undo : '').toBe('function');
  });

  it('lets Escape through when nothing is selected, for whatever holds the table', () => {
    const outer = vi.fn();
    const { control, container } = table();
    container.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') outer(event.defaultPrevented);
    });
    focus(control(0, 'primary'));
    key('Escape');
    expect(outer).toHaveBeenCalledWith(false);
  });
});

describe('opening', () => {
  it('follows the row’s link with Enter and with o, through the application’s router', () => {
    const { control } = table();
    focus(control(1, 'primary'));
    key('Enter');
    expect(nav.followed).toEqual(['/rules/printer-jams']);
    key('o');
    expect(nav.followed).toEqual(['/rules/printer-jams', '/rules/printer-jams']);
  });

  it('opens the row in a new tab with mod+Enter', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { control } = table();
    focus(control(2, 'primary'));
    key('Enter', { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('/rules/after-hours', '_blank', 'noopener');
  });

  it('calls back for a callback table: its button takes Enter and Space natively, and o opens it too', () => {
    const onActivate = vi.fn();
    const { control } = table({ activate: { kind: 'callback' }, onActivate });
    expect(control(0, 'primary').tagName).toBe('BUTTON');
    focus(control(0, 'primary'));
    // Enter is left to the button (a browser turns it into the click below), not handled twice.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    control(0, 'primary').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();
    click(control(0, 'primary'));
    expect(onActivate).toHaveBeenCalledWith(rules[0]);
    key('o');
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});

describe('the row menu', () => {
  it('opens with ".", names the row, and hands focus back to the row when it closes', async () => {
    const { control } = table();
    focus(control(1, 'primary'));
    key('.');
    await settle();
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toBe('Actions for Printer jams');
    expect([...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['Duplicate', 'Delete rule']);
    press(document.activeElement!, 'Escape');
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(activeElement()).toBe(control(1, 'primary'));
  });

  it('runs a row action on the row it belongs to', async () => {
    const { control, onAction } = table();
    focus(control(2, 'primary'));
    key('.');
    await settle();
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === 'Duplicate')!;
    click(item);
    await settle();
    expect(onAction).toHaveBeenCalledWith('duplicate', [rules[2]], undefined);
  });
});

describe('the context menu', () => {
  it('offers the same actions on right-click, for the row that was clicked', async () => {
    const { row } = table();
    const cell = row(3).querySelector<HTMLElement>('[data-kind="number"]')!;
    act(() => {
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    });
    await settle();
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toBe('Actions for Major incident');
    expect([...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['Duplicate', 'Delete rule']);
  });

  it('leaves the header its browser menu: there is no row there to act on', () => {
    const { container } = table();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      container.querySelector('thead th')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('the one-time hint', () => {
  it('describes the table until the arrow keys have been used, then never again on this device', () => {
    const { container, control } = table();
    const tableElement = container.querySelector('table')!;
    const hint = document.getElementById(tableElement.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Use arrow keys to move; x selects');
    focus(control(0, 'primary'));
    key('ArrowDown');
    expect(tableElement.hasAttribute('aria-describedby')).toBe(false);
    expect(window.localStorage.getItem('itsm-datatable-hint')).toBe('1');
    cleanupDocument();
    const again = table();
    expect(again.container.querySelector('table')?.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('clicking a row', () => {
  it('forwards a click anywhere on the row to its link, but not while text is being selected', () => {
    const { row } = table();
    const cell = row(0).querySelector<HTMLElement>('[data-kind="number"]')!;
    click(cell);
    expect(nav.followed).toEqual(['/rules/vip-requester']);

    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'VIP' } as Selection);
    click(cell);
    expect(nav.followed).toHaveLength(1);
    selection.mockRestore();
  });

  it('leaves clicks on the checkbox and the ⋯ to them', () => {
    const { row, control } = table();
    click(control(0, 'select'));
    click(row(0).querySelector('.itsm-DataTable__selectCell')!);
    expect(nav.followed).toEqual([]);
    expect((control(0, 'select') as HTMLInputElement).checked).toBe(true);
  });
});
