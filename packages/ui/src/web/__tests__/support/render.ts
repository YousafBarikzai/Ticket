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

/**
 * The browser APIs the overlay primitives (Radix, the positioning library
 * under it) reach for and jsdom does not have. Each is installed only where
 * it is missing, and each is the smallest honest stand-in: an observer that
 * never reports (jsdom has no layout, so nothing ever resizes), pointer
 * capture that captures nothing, a `scrollIntoView` with nowhere to scroll.
 * None of them invents behaviour a test could come to depend on.
 *
 * Here rather than in a Vitest setup file because every DOM test already
 * imports this module first, and the node-environment tests that do not
 * must not see a `window` appear.
 */
function installBrowserStandIns(): void {
  if (typeof window === 'undefined') return;
  const scope = globalThis as Record<string, unknown>;

  if (typeof scope.ResizeObserver !== 'function') {
    scope.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  if (typeof scope.DOMRect !== 'function') {
    scope.DOMRect = class DOMRect {
      constructor(
        readonly x = 0,
        readonly y = 0,
        readonly width = 0,
        readonly height = 0,
      ) {}
      get top(): number {
        return this.y;
      }
      get left(): number {
        return this.x;
      }
      get right(): number {
        return this.x + this.width;
      }
      get bottom(): number {
        return this.y + this.height;
      }
      static fromRect(rect: { x?: number; y?: number; width?: number; height?: number } = {}): DOMRect {
        return new DOMRect(rect.x, rect.y, rect.width, rect.height);
      }
      toJSON(): Record<string, number> {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
      }
    };
  }

  if (typeof scope.PointerEvent !== 'function') {
    scope.PointerEvent = class PointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
      }
    };
  }

  const element = Element.prototype as unknown as Record<string, unknown>;
  element.hasPointerCapture ??= () => false;
  element.setPointerCapture ??= () => undefined;
  element.releasePointerCapture ??= () => undefined;
  element.scrollIntoView ??= () => undefined;
}

installBrowserStandIns();

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

/**
 * A primary-button press the way a browser reports one: `pointerdown`, then
 * `mousedown`. The overlays listen for the pointer event (a scrim closes on
 * it, a menu trigger opens on it); older code listens for the mouse one.
 */
export function pointerDown(target: EventTarget, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1, isPrimary: true, ...init }),
    );
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: init.button ?? 0 }));
  });
}

/** A pointer entering an element (and its ancestors), for hover-driven overlays such as tooltips. */
export function pointerEnter(target: EventTarget, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }));
    target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse', ...init }));
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'mouse', ...init }));
  });
}

/** Releases the pointer, which is what ends a drag. */
export function pointerUp(target: EventTarget, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', pointerId: 1, ...init }));
  });
}

/** Moves a pressed or hovering pointer. */
export function pointerMove(target: EventTarget, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, ...init }));
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

/** Picks an option in a native select the way a user does, inside `act`. */
export function selectOption(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Lets timers and promises settle inside `act`, so React state updates are flushed and warning-free. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The element that currently has DOM focus, typed for assertions. */
export function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
