// @vitest-environment jsdom
import { act, useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { CHORD_TIMEOUT_MS, restoreHotkeyFocus, useHotkey, useHotkeyRegistry, type HotkeyOptions } from '../hotkeys.js';

/*
 * `useHotkey` (SPEC §4.1, §5.6, X-63): matched on `event.key`; single-key
 * shortcuts silent in fields and in widgets that use the keys themselves;
 * chords with a timeout; a switch that turns single keys off; and focus that
 * goes back to where the shortcut was pressed.
 */

type BindProps = Omit<HotkeyOptions, 'handler' | 'description' | 'group'> &
  Partial<Pick<HotkeyOptions, 'description' | 'group'>> & { readonly onFire: HotkeyOptions['handler'] };

function Bind({ onFire, description = 'Do it', group = 'General', ...options }: BindProps): null {
  useHotkey({ ...options, description, group, handler: onFire });
  return null;
}

function mount(element: ReactElement, provider: Partial<Parameters<typeof TestProvider>[0]> = {}) {
  return render(<TestProvider {...provider}>{element}</TestProvider>);
}

/** Dispatches on the focused element, as a browser does. */
function type(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function focusNew(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const target = holder.querySelector<HTMLElement>('[data-focus]') ?? (holder.firstElementChild as HTMLElement);
  target.focus();
  return target;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanupDocument();
  localStorage.clear();
  vi.useRealTimers();
});

describe('matching', () => {
  it('fires on the key and prevents the browser’s own use of it', () => {
    const fire = vi.fn();
    mount(<Bind keys="c" onFire={fire} />);
    const event = type('c');
    expect(fire).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    type('d');
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('matches / and ? on the character typed, not the key that typed it', () => {
    const slash = vi.fn();
    const question = vi.fn();
    mount(
      <>
        <Bind keys="/" onFire={slash} />
        <Bind keys="?" onFire={question} />
      </>,
    );
    type('?', { shiftKey: true, code: 'Slash' });
    type('/', { shiftKey: true, code: 'Digit7' });
    expect(question).toHaveBeenCalledTimes(1);
    expect(slash).toHaveBeenCalledTimes(1);
  });

  it('reads mod as Control away from Apple devices', () => {
    const palette = vi.fn();
    mount(<Bind keys="mod+k" onFire={palette} />);
    type('k', { metaKey: true });
    expect(palette).not.toHaveBeenCalled();
    type('k', { ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
  });

  it('ignores a key press something else already handled, a held key and IME composition', () => {
    const fire = vi.fn();
    mount(<Bind keys="c" onFire={fire} />);
    const handled = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => void document.body.dispatchEvent(handled));
    type('c', { repeat: true });
    type('c', { isComposing: true });
    expect(fire).not.toHaveBeenCalled();
  });

  it('calls the latest handler without registering twice', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = mount(<Bind keys="c" onFire={first} />);
    rerender(
      <TestProvider>
        <Bind keys="c" onFire={second} />
      </TestProvider>,
    );
    type('c');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('prefers the shortcut scoped to where focus is, then the newest', () => {
    const shell = vi.fn();
    const page = vi.fn();
    const inPanel = vi.fn();
    function Scoped(): ReactElement {
      const panel = useRef<HTMLDivElement>(null);
      useHotkey({ keys: 'escape', handler: inPanel, scope: panel, description: 'Close panel', group: 'Panel' });
      return (
        <div ref={panel}>
          <button type="button" data-focus="">
            In panel
          </button>
        </div>
      );
    }
    const { container } = mount(
      <>
        <Bind keys="escape" onFire={shell} />
        <Bind keys="escape" onFire={page} />
        <Scoped />
      </>,
    );
    type('Escape');
    expect(page).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
    container.querySelector<HTMLElement>('[data-focus]')!.focus();
    type('Escape');
    expect(inPanel).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  });
});

describe('where single keys stay quiet', () => {
  it.each([
    ['a text field', '<input type="text" />'],
    ['a search field', '<input type="search" />'],
    ['a textarea', '<textarea></textarea>'],
    ['a select', '<select><option>One</option></select>'],
    ['contenteditable', '<div contenteditable="true" tabindex="0" data-focus="">Draft</div>'],
    ['a checkbox', '<input type="checkbox" aria-label="Pick" />'],
    ['a menu', '<div role="menu"><div role="menuitem" tabindex="-1" data-focus="">Open</div></div>'],
    ['a menu item checkbox', '<div role="menu"><div role="menuitemcheckbox" aria-checked="false" tabindex="-1" data-focus="">Wrap</div></div>'],
    ['a listbox', '<div role="listbox" tabindex="0" data-focus=""><div role="option" aria-selected="false">One</div></div>'],
    ['an option', '<div role="listbox"><div role="option" aria-selected="false" tabindex="0" data-focus="">One</div></div>'],
    ['a grid', '<div role="grid"><div role="row"><div role="gridcell" tabindex="0" data-focus="">Cell</div></div></div>'],
    ['a radio group', '<div role="radiogroup"><div role="radio" aria-checked="true" tabindex="0" data-focus="">A</div></div>'],
    ['a slider', '<div role="slider" aria-valuenow="1" aria-label="Size" tabindex="0"></div>'],
    ['a combobox', '<div role="combobox" aria-expanded="false" aria-label="Pick" tabindex="0"></div>'],
    ['a modal dialog', '<div role="dialog" aria-label="Rule"><button data-focus="">Save</button></div>'],
  ])('ignores c in %s', (_where, html) => {
    const fire = vi.fn();
    mount(<Bind keys="c" onFire={fire} />);
    focusNew(html);
    type('c');
    expect(fire).not.toHaveBeenCalled();
  });

  it('lets mod+k through in a field, and nothing else without allowInFields', () => {
    const palette = vi.fn();
    const escape = vi.fn();
    const save = vi.fn();
    mount(
      <>
        <Bind keys="mod+k" onFire={palette} allowInFields />
        <Bind keys="escape" onFire={escape} />
        <Bind keys="mod+s" onFire={save} />
      </>,
    );
    focusNew('<input type="text" />');
    type('k', { ctrlKey: true });
    type('Escape');
    type('s', { ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
    expect(escape).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('fires modifier shortcuts from non-text controls', () => {
    const save = vi.fn();
    mount(<Bind keys="mod+s" onFire={save} />);
    focusNew('<input type="checkbox" aria-label="Pick" />');
    type('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps working in a non-modal surface that says so', () => {
    const fire = vi.fn();
    mount(<Bind keys="r" onFire={fire} />);
    focusNew('<div role="dialog" aria-modal="false" aria-label="Details"><button data-focus="">Edit</button></div>');
    type('r');
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('is silent under an opt-out subtree', () => {
    const fire = vi.fn();
    mount(<Bind keys="mod+k" onFire={fire} allowInFields />);
    focusNew('<div data-itsm-hotkeys="off"><button data-focus="">Editor</button></div>');
    type('k', { ctrlKey: true });
    expect(fire).not.toHaveBeenCalled();
  });
});

describe('switching single keys off', () => {
  it('silences single keys when the person has turned them off, and keeps mod shortcuts', () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ shortcuts: 'off' }));
    const create = vi.fn();
    const palette = vi.fn();
    mount(
      <>
        <Bind keys="c" onFire={create} />
        <Bind keys="mod+k" onFire={palette} />
      </>,
    );
    type('c');
    type('k', { ctrlKey: true });
    expect(create).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledTimes(1);
  });

  it('keeps single keys off in an app that has none (the portal), except an essential one', () => {
    const create = vi.fn();
    const search = vi.fn();
    mount(
      <>
        <Bind keys="c" onFire={create} />
        <Bind keys="/" onFire={search} essential />
      </>,
      { app: 'portal' },
    );
    type('c');
    type('/');
    expect(create).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('lets the person’s switch win over essential', () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ shortcuts: 'off' }));
    const search = vi.fn();
    mount(<Bind keys="/" onFire={search} essential />, { app: 'portal' });
    type('/');
    expect(search).not.toHaveBeenCalled();
  });

  it('follows a switch changed while mounted', () => {
    const create = vi.fn();
    function Toggle(): ReactElement {
      const [enabled, setEnabled] = useState(true);
      return (
        <>
          <Bind keys="c" onFire={create} enabled={enabled} />
          <button type="button" onClick={() => setEnabled(false)}>
            Off
          </button>
        </>
      );
    }
    const { container } = mount(<Toggle />);
    type('c');
    act(() => container.querySelector('button')!.click());
    type('c');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('chords', () => {
  it('fires g m as G then M, and resets on any other key', () => {
    const goMine = vi.fn();
    mount(<Bind keys="g m" onFire={goMine} />);
    type('g');
    type('m');
    expect(goMine).toHaveBeenCalledTimes(1);
    type('g');
    type('x');
    type('m');
    expect(goMine).toHaveBeenCalledTimes(1);
  });

  it('gives up after 1.2 seconds and clears its timer', () => {
    vi.useFakeTimers();
    const goMine = vi.fn();
    mount(<Bind keys="g m" onFire={goMine} />);
    type('g');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1));
    type('m');
    expect(goMine).not.toHaveBeenCalled();
    type('g');
    type('m');
    expect(goMine).toHaveBeenCalledTimes(1);
    // Completed: nothing is left waiting.
    const chordTimers = vi.getTimerCount();
    act(() => void vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1));
    expect(vi.getTimerCount()).toBeLessThanOrEqual(chordTimers);
  });

  it('treats a key that does not continue the chord as a fresh press', () => {
    const create = vi.fn();
    mount(
      <>
        <Bind keys="g m" onFire={vi.fn()} />
        <Bind keys="c" onFire={create} />
      </>,
    );
    type('g');
    type('c');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('focus return', () => {
  it('hands the handler the element focus was on, and puts focus back there', () => {
    function Row(): ReactElement {
      const [open, setOpen] = useState(false);
      useHotkey({
        keys: 'a',
        description: 'Assign',
        group: 'Ticket',
        handler: (_event, context) => {
          expect(context.invoker?.textContent).toBe('INC-000123');
          setOpen(true);
        },
      });
      return (
        <>
          <a href="/tickets/123" data-row="">
            INC-000123
          </a>
          {open ? (
            <div role="menu" aria-label="Assign to">
              <button
                type="button"
                role="menuitem"
                ref={(node) => node?.focus()}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  setOpen(false);
                  restoreHotkeyFocus();
                }}
              >
                Ada
              </button>
            </div>
          ) : null}
        </>
      );
    }
    const { container } = mount(<Row />);
    const row = container.querySelector<HTMLElement>('[data-row]')!;
    row.focus();
    type('a');
    expect(document.activeElement?.textContent).toBe('Ada');
    press(document.activeElement!, 'Escape');
    expect(document.activeElement).toBe(row);
  });
});

describe('the registry the shortcuts dialog lists', () => {
  function Listing(): ReactElement {
    const listing = useHotkeyRegistry();
    return <output>{listing.map((entry) => `${entry.group}:${entry.keys}:${entry.description}`).join('|')}</output>;
  }

  it('lists what is bound, once, leaving out hidden and disabled shortcuts', () => {
    const { container, rerender } = mount(
      <>
        <Bind keys="c" onFire={vi.fn()} description="New ticket" group="Create" />
        <Bind keys="c" onFire={vi.fn()} description="New ticket" group="Create" />
        <Bind keys="?" onFire={vi.fn()} description="Keyboard shortcuts" group="Help" />
        <Bind keys="mod+k" onFire={vi.fn()} description="Search" group="General" hidden />
        <Bind keys="x" onFire={vi.fn()} description="Select" group="Lists" enabled={false} />
        <Listing />
      </>,
    );
    expect(container.querySelector('output')!.textContent).toBe('Create:c:New ticket|Help:?:Keyboard shortcuts');
    rerender(
      <TestProvider>
        <Bind keys="?" onFire={vi.fn()} description="Keyboard shortcuts" group="Help" />
        <Listing />
      </TestProvider>,
    );
    expect(container.querySelector('output')!.textContent).toBe('Help:?:Keyboard shortcuts');
  });

  it('stops listening once nothing is bound', () => {
    const fire = vi.fn();
    const { unmount } = mount(<Bind keys="c" onFire={fire} />);
    unmount();
    type('c');
    expect(fire).not.toHaveBeenCalled();
  });
});
