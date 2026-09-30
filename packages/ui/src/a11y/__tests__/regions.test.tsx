// @vitest-environment jsdom
import { act, useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { activeElement, cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { Region, useRegion, useRegions, type Regions } from '../regions.js';

/*
 * F6 and Shift+F6 cycle the registered regions in document order (X-65):
 * sidebar, list, conversation, inspector. Arriving back in a region puts
 * focus where the person left it; hidden regions are skipped; a modal dialog
 * keeps F6 to itself.
 */

function f6(shiftKey = false): KeyboardEvent {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key: 'F6', shiftKey, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
}

let regions: Regions | null = null;

function Frame({ hideInspector = false }: { hideInspector?: boolean }): ReactElement {
  regions = useRegions();
  return (
    <>
      <Region id="sidebar" label="Sidebar" as="nav">
        <a href="/inbox">Inbox</a>
      </Region>
      <main>
        <Region id="list" label="Tickets">
          <a href="/tickets/1">INC-1</a>
          <a href="/tickets/2">INC-2</a>
        </Region>
        <Region id="conversation" label="Conversation" as="article">
          <button type="button">Reply</button>
        </Region>
      </main>
      <Region id="inspector" label="Details" as="aside" hidden={hideInspector}>
        <button type="button">Assign</button>
      </Region>
    </>
  );
}

afterEach(() => {
  cleanupDocument();
  regions = null;
});

describe('Region', () => {
  it('renders a named landmark that can take focus without joining the tab order', () => {
    const { container } = render(<Frame />);
    const list = container.querySelector('#list')!;
    expect(list.tagName).toBe('SECTION');
    expect(list.getAttribute('aria-label')).toBe('Tickets');
    expect(list.getAttribute('tabindex')).toBe('-1');
    expect(container.querySelector('#sidebar')!.tagName).toBe('NAV');
    expect(container.querySelector('#inspector')!.tagName).toBe('ASIDE');
  });
});

describe('F6', () => {
  it('cycles regions in document order and wraps, and Shift+F6 goes back', () => {
    render(<Frame />);
    const event = f6();
    expect(event.defaultPrevented).toBe(true);
    expect(activeElement()?.id).toBe('sidebar');
    f6();
    expect(activeElement()?.id).toBe('list');
    f6();
    expect(activeElement()?.id).toBe('conversation');
    f6();
    expect(activeElement()?.id).toBe('inspector');
    f6();
    expect(activeElement()?.id).toBe('sidebar');
    f6(true);
    expect(activeElement()?.id).toBe('inspector');
  });

  it('returns to where focus was left inside a region', () => {
    const { container } = render(<Frame />);
    const second = container.querySelectorAll<HTMLElement>('#list a')[1]!;
    act(() => second.focus());
    f6();
    expect(activeElement()?.id).toBe('conversation');
    f6(true);
    expect(activeElement()).toBe(second);
  });

  it('skips a hidden region', () => {
    render(<Frame hideInspector />);
    f6(true);
    expect(activeElement()?.id).toBe('conversation');
  });

  it('stays out of a modal dialog', () => {
    const { container } = render(<Frame />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Rule');
    dialog.innerHTML = '<button type="button">Save</button>';
    container.appendChild(dialog);
    const save = dialog.querySelector('button')!;
    act(() => save.focus());
    const event = f6();
    expect(event.defaultPrevented).toBe(false);
    expect(activeElement()).toBe(save);
  });

  it('moves focus from code too', () => {
    render(<Frame />);
    act(() => void regions!.focus('conversation'));
    expect(activeElement()?.id).toBe('conversation');
    act(() => regions!.focusNext());
    expect(activeElement()?.id).toBe('inspector');
    act(() => regions!.focusPrevious());
    expect(activeElement()?.id).toBe('conversation');
    expect(regions!.focus('missing')).toBe(false);
  });

  it('includes an element registered with useRegion, and forgets it on unmount', () => {
    function Pane(): ReactElement {
      const ref = useRef<HTMLDivElement>(null);
      useRegion(ref);
      return (
        <div ref={ref} id="pane" role="region" aria-label="Pane" tabIndex={-1}>
          Pane
        </div>
      );
    }
    const { unmount } = render(<Pane />);
    f6();
    expect(activeElement()?.id).toBe('pane');
    unmount();
    const button = document.createElement('button');
    document.body.appendChild(button);
    act(() => button.focus());
    expect(f6().defaultPrevented).toBe(false);
  });
});
