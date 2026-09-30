// @vitest-environment jsdom
import { act, useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import {
  useCollectionKeyboard,
  type ActivateHow,
  type CollectionKeyboard,
  type CollectionKeyboardOptions,
} from '../collection-keyboard.js';

/*
 * The one keyboard model for rows of things (SPEC §4.1, §5.6, X-64): a single
 * tab stop; rows by ↑↓ and j/k; a row's controls by ←→; select, extend,
 * select all; open in place, as a page, in a new tab; the row menu; Escape to
 * clear. The fixture is shaped like the admin table and the ticket list: a
 * checkbox, a link and a ⋯ button per row.
 */

type Callbacks = Omit<CollectionKeyboardOptions, 'count' | 'getRow'>;
type Clear = 'cleared' | 'confirm' | 'none';

let api: CollectionKeyboard | null = null;

function List({ rows, callbacks, hidden = [] }: { rows: readonly string[]; callbacks: Callbacks; hidden?: readonly number[] }): ReactElement {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const keyboard = useCollectionKeyboard({ count: rows.length, getRow: (index) => refs.current[index] ?? null, ...callbacks });
  api = keyboard;
  return (
    <ul aria-label="Tickets" onKeyDown={keyboard.onKeyDown} onFocus={keyboard.onFocus}>
      {rows.map((label, index) =>
        hidden.includes(index) ? null : (
          <li
            key={label}
            ref={(node) => {
              refs.current[index] = node;
            }}
            {...keyboard.getRowProps(index)}
          >
            <input type="checkbox" aria-label={`Select ${label}`} {...keyboard.getControlProps(index, 'select')} />
            <a href={`/tickets/${index}`} {...keyboard.getControlProps(index, 'primary')}>
              {label}
            </a>
            <button type="button" aria-haspopup="menu" aria-label={`More for ${label}`} {...keyboard.getControlProps(index, 'menu')}>
              ⋯
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

const ROWS = ['INC-1', 'INC-2', 'INC-3', 'INC-4'];

function callbacks(overrides: { onClearSelection?: () => Clear } = {}) {
  return {
    onActivate: vi.fn<(index: number, how: ActivateHow) => void>(),
    onToggleSelect: vi.fn<(index: number) => void>(),
    onExtendSelect: vi.fn<(from: number, to: number) => void>(),
    onSelectAll: vi.fn<() => void>(),
    onClearSelection: vi.fn<() => Clear>(overrides.onClearSelection ?? (() => 'cleared')),
    onRowMenu: vi.fn<(index: number) => void>(),
    onActiveChange: vi.fn<(index: number) => void>(),
  };
}

function mount(element: ReactElement) {
  return render(<TestProvider>{element}</TestProvider>);
}

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

function focusFirst(container: HTMLElement): HTMLElement {
  const stop = container.querySelector<HTMLElement>('[tabindex="0"]')!;
  act(() => stop.focus());
  return stop;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanupDocument();
  localStorage.clear();
  api = null;
});

describe('one tab stop', () => {
  it('is the first row’s link, and nothing else in the list is tabbable', () => {
    const { container } = mount(<List rows={ROWS} callbacks={callbacks()} />);
    const tabbable = [...container.querySelectorAll<HTMLElement>('[tabindex="0"]')];
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]!.textContent).toBe('INC-1');
    expect(container.querySelectorAll('[tabindex="-1"]')).toHaveLength(ROWS.length * 3 - 1);
  });

  it('follows focus that arrives some other way (a click, Shift+Tab)', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    const third = container.querySelectorAll<HTMLElement>('a')[2]!;
    act(() => third.focus());
    expect(api!.activeIndex).toBe(2);
    expect(third.tabIndex).toBe(0);
    expect(on.onActiveChange).toHaveBeenCalledWith(2);
  });
});

describe('moving between rows', () => {
  it('goes down and up with the arrows and with j and k, stopping at the ends', () => {
    const { container } = mount(<List rows={ROWS} callbacks={callbacks()} />);
    focusFirst(container);
    key('ArrowDown');
    expect(activeElement()?.textContent).toBe('INC-2');
    key('j');
    expect(activeElement()?.textContent).toBe('INC-3');
    key('k');
    key('ArrowUp');
    key('ArrowUp');
    expect(activeElement()?.textContent).toBe('INC-1');
    key('End');
    expect(activeElement()?.textContent).toBe('INC-4');
    key('j');
    expect(activeElement()?.textContent).toBe('INC-4');
    key('Home');
    expect(activeElement()?.textContent).toBe('INC-1');
    // The tab stop moved with focus.
    expect(container.querySelector('[tabindex="0"]')).toBe(activeElement());
  });

  it('moves between a row’s controls with ← and →, and keeps the column on the next row', () => {
    const { container } = mount(<List rows={ROWS} callbacks={callbacks()} />);
    focusFirst(container);
    key('ArrowRight');
    expect(activeElement()?.getAttribute('aria-label')).toBe('More for INC-1');
    key('ArrowRight');
    expect(activeElement()?.getAttribute('aria-label')).toBe('More for INC-1');
    key('ArrowDown');
    expect(activeElement()?.getAttribute('aria-label')).toBe('More for INC-2');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(activeElement()?.getAttribute('aria-label')).toBe('Select INC-2');
    expect(api!.activeColumn).toBe('select');
  });

  it('waits for a virtual row to render before focusing it', () => {
    const on = callbacks();
    function Virtual(): ReactElement {
      const [hidden, setHidden] = useState<number[]>([2, 3]);
      return <List rows={ROWS} hidden={hidden} callbacks={{ ...on, onActiveChange: (index) => setHidden((h) => h.filter((i) => i !== index)) }} />;
    }
    const { container } = mount(<Virtual />);
    focusFirst(container);
    key('ArrowDown');
    key('ArrowDown');
    expect(activeElement()?.textContent).toBe('INC-3');
  });

  it('leaves letters to a field inside a row', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    const input = document.createElement('input');
    container.querySelector('li')!.appendChild(input);
    act(() => input.focus());
    key('j');
    key('x');
    expect(activeElement()).toBe(input);
    expect(on.onToggleSelect).not.toHaveBeenCalled();
  });
});

describe('selecting', () => {
  it('toggles with x and with Space on the link', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('x');
    const space = key(' ');
    expect(on.onToggleSelect).toHaveBeenNthCalledWith(1, 0);
    expect(on.onToggleSelect).toHaveBeenNthCalledWith(2, 0);
    expect(space.defaultPrevented).toBe(true);
  });

  it('leaves Space to the checkbox and the ⋯ button, which handle it themselves', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('ArrowLeft');
    expect(key(' ').defaultPrevented).toBe(false);
    key('ArrowRight');
    key('ArrowRight');
    expect(key(' ').defaultPrevented).toBe(false);
    expect(on.onToggleSelect).not.toHaveBeenCalled();
  });

  it('extends from the anchor with Shift', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('ArrowDown', { shiftKey: true });
    key('J', { shiftKey: true });
    expect(on.onExtendSelect).toHaveBeenNthCalledWith(1, 0, 1);
    expect(on.onExtendSelect).toHaveBeenNthCalledWith(2, 0, 2);
    // A plain move drops the anchor; the next extension starts where focus is.
    key('ArrowUp');
    key('ArrowUp', { shiftKey: true });
    expect(on.onExtendSelect).toHaveBeenLastCalledWith(1, 0);
  });

  it('selects everything loaded with mod+A', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(on.onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('clears with Escape and keeps the key from reaching what contains the list', () => {
    const on = callbacks({ onClearSelection: () => 'confirm' });
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(on.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone when there was nothing to clear', () => {
    const on = callbacks({ onClearSelection: () => 'none' });
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    expect(key('Escape').defaultPrevented).toBe(false);
    expect(on.onClearSelection).toHaveBeenCalledTimes(1);
  });
});

describe('opening', () => {
  it('opens in place with Enter, as a page with o, in a new tab with mod+Enter', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('ArrowDown');
    const enter = key('Enter');
    key('o');
    key('Enter', { ctrlKey: true });
    expect(enter.defaultPrevented).toBe(true);
    expect(on.onActivate.mock.calls).toEqual([
      [1, 'inPlace'],
      [1, 'page'],
      [1, 'newTab'],
    ]);
  });

  it('leaves Enter on the ⋯ button to the button', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('ArrowRight');
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(on.onActivate).not.toHaveBeenCalled();
  });

  it('opens the row menu with ., Shift+F10 and the Menu key', () => {
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('.');
    key('F10', { shiftKey: true });
    key('ContextMenu');
    expect(on.onRowMenu.mock.calls).toEqual([[0], [0], [0]]);
  });

  it('puts focus back on the current row after a menu', () => {
    const { container } = mount(<List rows={ROWS} callbacks={callbacks()} />);
    focusFirst(container);
    key('ArrowDown');
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    act(() => elsewhere.focus());
    act(() => api!.focusActive());
    expect(activeElement()?.textContent).toBe('INC-2');
  });
});

describe('the single-key switch', () => {
  it('turns off the letters and keeps arrows, Space and Enter', () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ shortcuts: 'off' }));
    const on = callbacks();
    const { container } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('j');
    key('x');
    key('o');
    expect(activeElement()?.textContent).toBe('INC-1');
    expect(on.onToggleSelect).not.toHaveBeenCalled();
    key('ArrowDown');
    key(' ');
    key('Enter');
    expect(activeElement()?.textContent).toBe('INC-2');
    expect(on.onToggleSelect).toHaveBeenCalledWith(1);
    expect(on.onActivate).toHaveBeenCalledWith(1, 'inPlace');
  });
});

describe('a row that is its own control', () => {
  it('moves the one tab stop between whole-row links, as the workbench list has them', () => {
    const onActivate = vi.fn();
    function Links(): ReactElement {
      const refs = useRef<(HTMLAnchorElement | null)[]>([]);
      const keyboard = useCollectionKeyboard({ count: 3, getRow: (index) => refs.current[index] ?? null, onActivate });
      return (
        <div role="list" aria-label="Inbox" onKeyDown={keyboard.onKeyDown} onFocus={keyboard.onFocus}>
          {['A', 'B', 'C'].map((label, index) => (
            <a
              key={label}
              role="listitem"
              href={`/inbox/mine?t=${index}`}
              ref={(node) => {
                refs.current[index] = node;
              }}
              {...keyboard.getControlProps(index, 'primary')}
            >
              {label}
            </a>
          ))}
        </div>
      );
    }
    const { container } = mount(<Links />);
    focusFirst(container);
    key('j');
    expect(activeElement()?.textContent).toBe('B');
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    key('Enter');
    expect(onActivate).toHaveBeenCalledWith(1, 'inPlace');
  });
});

describe('a shrinking list', () => {
  it('keeps the tab stop on a row that still exists', () => {
    const on = callbacks();
    const { container, rerender } = mount(<List rows={ROWS} callbacks={on} />);
    focusFirst(container);
    key('End');
    rerender(
      <TestProvider>
        <List rows={ROWS.slice(0, 2)} callbacks={on} />
      </TestProvider>,
    );
    expect(api!.activeIndex).toBe(1);
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});
