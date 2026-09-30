'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** A layout effect in the browser, a plain effect (which never runs) on the server. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The element focus should go back to: the one focused when the overlay
 * opened — or, when that was an item in a menu that is closing as the overlay
 * opens ("Delete…" opening its confirmation), the button that opened the
 * menu, since the item is about to leave the page.
 */
function returnTarget(active: Element | null): HTMLElement | null {
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  let target: HTMLElement = active;
  // Out through every menu level: a submenu is opened by an item of its parent menu.
  for (let menu = target.closest('[role="menu"]'); menu; menu = target.closest('[role="menu"]')) {
    // `Menu` names its trigger in `data-itsm-opener`; a bare Radix menu is labelled by it.
    const openerId = menu.getAttribute('data-itsm-opener') ?? menu.getAttribute('aria-labelledby');
    const trigger = openerId ? document.getElementById(openerId) : null;
    if (!trigger || trigger === target) break;
    target = trigger;
  }
  return target;
}

/**
 * Gives focus back to whatever opened a modal overlay, synchronously, as it
 * closes (SC 2.4.3).
 *
 * Radix restores focus a task later (a `setTimeout` inside its focus scope),
 * and only to its own `Trigger` — which the design system's controlled
 * dialogs never render. A person who presses Escape should land on the button
 * they came from in the same frame the dialog disappears, not on `<body>` for
 * a moment and then somewhere, so the overlays opt out of Radix's restore
 * (`onCloseAutoFocus` → `preventDefault`) and use this instead.
 *
 * The opener is read in a layout effect, before Radix's own mount effect has
 * moved focus inside. Focus goes back in the passive cleanup, which React
 * runs after the focus trap's own cleanup (children first), so the trap is
 * already gone and cannot pull focus back in. It goes back only when focus
 * is lost — still inside the closing overlay, or on `<body>` — so a caller
 * that moved focus somewhere on purpose as it closed ("focus the new row")
 * keeps it.
 */
export function useFocusReturn(active: boolean, contentRef: RefObject<HTMLElement | null>): void {
  const origin = useRef<HTMLElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (active) origin.current = returnTarget(document.activeElement);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return () => {
      const target = origin.current;
      origin.current = null;
      const content = contentRef.current;
      const restore = (): void => {
        const focused = document.activeElement;
        const lost = !focused || focused === document.body || (content !== null && content.contains(focused)) || !focused.isConnected;
        if (lost && target?.isConnected) target.focus();
      };
      // Closed by `open={false}`, `InertOutside` has already released the page
      // (its cleanup runs first; see inert.ts), so focus can go back now. But
      // an overlay *unmounted* while open runs its cleanups parent first: the
      // opener is still inert here and `focus()` would do nothing, leaving
      // focus on `<body>`. Then it goes back once this commit's cleanups have
      // all run — a microtask later, before the browser paints.
      if (target?.closest('[inert]')) queueMicrotask(restore);
      else restore();
    };
  }, [active, contentRef]);
}
