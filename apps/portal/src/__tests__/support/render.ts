import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * A minimal React harness, local to this app.
 *
 * `packages/ui` has one of its own and this is deliberately not an import of
 * it: reaching across a package boundary by relative path is the thing
 * `check-boundaries` exists to stop, and a test helper is not worth a shared
 * package. Twenty lines duplicated is cheaper than a dependency in the wrong
 * direction.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  readonly container: HTMLElement;
  readonly root: Root;
  unmount: () => void;
}

const mounted: Rendered[] = [];

export function render(element: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const rendered: Rendered = {
    container,
    root,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  mounted.push(rendered);
  return rendered;
}

export function cleanupDocument(): void {
  for (const rendered of [...mounted]) rendered.unmount();
  mounted.length = 0;
  document.body.innerHTML = '';
}

export function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * Clicks and waits for whatever the handler set in motion to settle.
 *
 * The asynchronous form of `act` is what flushes the state updates that happen
 * *after* an awaited call resolves. The synchronous one leaves them to land
 * outside the act scope, which React reports as a warning and which makes an
 * assertion read a component one render behind.
 */
export async function clickAsync(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export function type(element: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  act(() => {
    // React tracks the last value it wrote on the node; setting `.value`
    // directly makes it think nothing changed, so the tracker is cleared first.
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Submits and waits for whatever the handler set in motion to settle.
 *
 * The asynchronous form of `act` is what flushes the state updates that happen
 * *after* an awaited call resolves. The synchronous one leaves them to land
 * outside the act scope, which React reports as a warning and which makes an
 * assertion read a component one render behind.
 */
export async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
