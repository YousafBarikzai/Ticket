// @vitest-environment jsdom
import { act, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { activeElement, cleanupDocument, click, focus, pointerDown, press, render, settle } from '../../web/__tests__/support/render.js';
import { Menu, type MenuItemSpec } from '../Menu.js';
import { ContextMenu } from '../ContextMenu.js';

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => cleanupDocument());

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]');
const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
const item = (name: string): HTMLElement | undefined => items().find((entry) => entry.textContent?.includes(name));

function actions(onSelect: (id: string) => void): MenuItemSpec[] {
  return [
    { id: 'assign', label: 'Assign to me', icon: 'user', shortcut: 'a', onSelect: () => onSelect('assign') },
    { id: 'copy', label: 'Copy link', icon: 'link', onSelect: () => onSelect('copy') },
    { id: 'merge', label: 'Merge into…', disabled: true, disabledReason: 'Needs a second ticket', onSelect: () => onSelect('merge') },
    { type: 'separator' },
    { id: 'delete', label: 'Delete ticket', icon: 'trash', tone: 'danger', onSelect: () => onSelect('delete') },
  ];
}

function rightClick(target: Element, x: number, y: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  });
}

async function openWithKeyboard(trigger: HTMLElement): Promise<void> {
  focus(trigger);
  press(trigger, 'Enter');
  await settle();
}

describe('Menu', () => {
  it('opens from its trigger with the keyboard and focuses the first item', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await openWithKeyboard(trigger);
    expect(menu()).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(activeElement()).toBe(item('Assign to me'));
  });

  it('opens on a primary-button press', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    pointerDown(document.querySelector('button')!);
    await settle();
    expect(menu()).not.toBeNull();
  });

  it('is named by its trigger, or by its label when the trigger says too little', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    await openWithKeyboard(trigger);
    expect(document.getElementById(menu()!.getAttribute('aria-labelledby') ?? '')).toBe(trigger);
    cleanupDocument();

    render(<Menu label="Actions for INC-000123" trigger={<button type="button">⋯</button>} items={actions(() => undefined)} />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    expect(menu()!.getAttribute('aria-label')).toBe('Actions for INC-000123');
    expect(menu()!.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('moves with the arrow keys and runs the chosen item', async () => {
    const onSelect = vi.fn();
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(onSelect)} />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);

    // Radix moves focus a task after the key (roving focus), hence the settles.
    press(activeElement()!, 'ArrowDown');
    await settle();
    expect(activeElement()).toBe(item('Copy link'));
    press(activeElement()!, 'Enter');
    await settle();
    expect(onSelect).toHaveBeenCalledWith('copy');
    expect(menu()).toBeNull();
  });

  it('jumps to an item by typing the start of its name', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);

    press(activeElement()!, 'd');
    await settle();
    expect(activeElement()).toBe(item('Delete ticket'));
    press(activeElement()!, 'c');
    await settle(1100);
    // A new search after the pause: "c" finds "Copy link".
    press(activeElement()!, 'c');
    await settle();
    expect(activeElement()).toBe(item('Copy link'));
  });

  it('keeps an unavailable item focusable, says why, and never runs it', async () => {
    const onSelect = vi.fn();
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(onSelect)} />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);

    press(activeElement()!, 'ArrowDown');
    await settle();
    press(activeElement()!, 'ArrowDown');
    await settle();
    const merge = item('Merge into…')!;
    expect(activeElement()).toBe(merge);
    expect(merge.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(merge.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Needs a second ticket');

    press(merge, 'Enter');
    await settle();
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it('names items by their label alone, and announces shortcuts and danger through their own channels', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    const assign = item('Assign to me')!;
    expect(document.getElementById(assign.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Assign to me');
    expect(assign.getAttribute('aria-keyshortcuts')).toBe('A');
    expect(item('Delete ticket')!.className).toContain('itsm-Menu__item--danger');
  });

  it('navigates through the app’s Link for items with an href', async () => {
    render(
      <TestProvider>
        <Menu trigger={<button type="button">Go</button>} items={[{ id: 'open', label: 'Open full page', href: '/tickets/123' }]} />
      </TestProvider>,
    );
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    const link = item('Open full page')!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/tickets/123');
  });

  it('returns focus to the trigger on Escape', async () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={actions(() => undefined)} />);
    const trigger = document.querySelector<HTMLButtonElement>('button')!;
    await openWithKeyboard(trigger);
    press(activeElement()!, 'Escape');
    await settle();
    expect(menu()).toBeNull();
    expect(activeElement()).toBe(trigger);
  });

  it('returns focus to the row it was opened for when onCloseFocus says so (X-63)', async () => {
    function Row(): ReactNode {
      const row = useRef<HTMLDivElement | null>(null);
      return (
        <div>
          <div ref={row} id="row" tabIndex={-1}>
            INC-000123
          </div>
          <Menu onCloseFocus={row} trigger={<button type="button">⋯</button>} items={actions(() => undefined)} />
        </div>
      );
    }
    render(<Row />);
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    press(activeElement()!, 'Escape');
    await settle();
    expect(activeElement()?.id).toBe('row');
  });

  it('can be opened from elsewhere when controlled (a row’s "." shortcut)', async () => {
    function Controlled(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="elsewhere" onClick={() => setOpen(true)}>
            Open row menu
          </button>
          <Menu open={open} onOpenChange={setOpen} trigger={<button type="button">⋯</button>} items={actions(() => undefined)} />
        </>
      );
    }
    render(<Controlled />);
    click(document.querySelector('#elsewhere')!);
    await settle();
    expect(menu()).not.toBeNull();
  });

  it('draws checkbox and radio entries with their state, and groups radios under their label', async () => {
    const onChecked = vi.fn();
    const onValue = vi.fn();
    render(
      <Menu
        trigger={<button type="button">View</button>}
        items={[
          { type: 'checkbox', id: 'wrap', label: 'Wrap lines', checked: true, onCheckedChange: onChecked },
          { type: 'radio', id: 'density', label: 'Density', value: 'comfortable', items: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], onValueChange: onValue },
        ]}
      />,
    );
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    const wrap = document.querySelector('[role="menuitemcheckbox"]')!;
    expect(wrap.getAttribute('aria-checked')).toBe('true');
    const group = document.querySelector('[role="menu"] [role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Density');
    const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);

    click(radios[1]!);
    await settle();
    expect(onValue).toHaveBeenCalledWith('compact');
  });

  it('opens a submenu with ArrowRight and closes just the submenu with ArrowLeft', async () => {
    render(
      <Menu
        trigger={<button type="button">Actions</button>}
        items={[{ type: 'submenu', id: 'move', label: 'Move to', items: [{ id: 'desk', label: 'Service desk' }, { id: 'net', label: 'Network' }] }]}
      />,
    );
    await openWithKeyboard(document.querySelector<HTMLButtonElement>('button')!);
    press(activeElement()!, 'ArrowRight');
    await settle();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(activeElement()?.textContent).toContain('Service desk');

    // ArrowLeft steps back out; the parent stays, focus on its item. (Escape
    // closes the whole menu: a submenu is part of it, not a layer of its own.)
    press(activeElement()!, 'ArrowLeft');
    await settle();
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(activeElement()?.textContent).toContain('Move to');
  });
});

describe('ContextMenu', () => {
  it('opens at a right-click with the same items', async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu items={actions(onSelect)} label="Actions for INC-000123">
        <div id="row">INC-000123</div>
      </ContextMenu>,
    );
    const row = document.querySelector('#row')!;
    press(row, 'x'); // no-op, just to make sure nothing opens without the gesture
    expect(menu()).toBeNull();
    rightClick(row, 40, 60);
    await settle();
    expect(menu()?.getAttribute('aria-label')).toBe('Actions for INC-000123');
    expect(items().map((entry) => entry.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Copy link')]));
  });

  it('stays out of the way of a link’s long-press on touch screens (X-95)', async () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(pointer: coarse)', addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      render(
        <ContextMenu items={actions(() => undefined)}>
          <a href="/tickets/1" id="row">
            INC-000001
          </a>
        </ContextMenu>,
      );
      await settle();
      const row = document.querySelector('#row')!;
      rightClick(row, 4, 4);
      await settle();
      expect(menu()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
