/**
 * A minimal React test harness.
 *
 * Deliberately not `@testing-library/react`: the behaviour under test here is
 * focus order, key handling and ARIA wiring, all of which are read straight off
 * the DOM. A query library would add a dependency without adding a fact, and
 * these tests should fail for the same reasons a browser would.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React refuses to batch updates from `act` without this flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  readonly container: HTMLElement;
  readonly root: Root;
  rerender: (element: ReactElement) => void;
  unmount: () => void;
}

/**
 * Every root is tracked so that `cleanupDocument` can unmount it. Wiping
 * `document.body` instead would leave the previous test's effects — document
 * key listeners, focus traps — attached to a document they no longer render
 * into, and the next Escape keypress would reach all of them at once.
 */
const mounted: Rendered[] = [];

export function render(element: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const rendered: Rendered = {
    container,
    root,
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
      const index = mounted.indexOf(rendered);
      if (index >= 0) mounted.splice(index, 1);
    },
  };
  mounted.push(rendered);
  return rendered;
}

export function cleanupDocument(): void {
  for (const rendered of [...mounted]) rendered.unmount();
  document.body.innerHTML = '';
}

export function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

export function click(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export function mouseDown(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

export function focus(element: HTMLElement): void {
  act(() => {
    element.focus();
  });
}

/**
 * Types into a controlled input the way a browser does: React listens for the
 * native `input` event and reads the value off the node, so the value has to be
 * set through the prototype's own setter or React's change tracker swallows it.
 */
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The element that currently has DOM focus, typed for assertions. */
export function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
