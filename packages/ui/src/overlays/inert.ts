'use client';

import { useEffect } from 'react';

/** How many open modal overlays have made each element inert, and which were inert already. */
const holds = new Map<Element, number>();
const alreadyInert = new WeakSet<Element>();

/**
 * Makes the page behind a modal overlay `inert` for as long as it is open —
 * exactly the parts Radix has hidden from assistive technology.
 *
 * Radix hides the rest of the page with `aria-hidden` (marking each hidden
 * subtree `data-aria-hidden`) and keeps focus in with a focus scope. That
 * leaves focusable elements inside `aria-hidden` subtrees, which is a WCAG
 * 4.1.2 failure in principle and an axe violation in practice
 * (`aria-hidden-focus`). `inert` is what a native modal `<dialog>` does: the
 * hidden page can no longer be focused, clicked or found with find-in-page.
 * Live regions, which Radix deliberately leaves visible, are never among the
 * marked elements, so announcements still reach a screen reader.
 *
 * Counted per element, so a dialog opened from a sheet releases only what
 * it added. It must run after Radix's own effect has marked the page, and
 * release before focus goes back to the opener (which cannot be focused
 * while inert) — `InertOutside` below arranges both.
 */
export function useInertOutside(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const held: Element[] = [];
    for (const element of document.querySelectorAll('[data-aria-hidden="true"]')) {
      const count = holds.get(element) ?? 0;
      if (count === 0 && element.hasAttribute('inert')) alreadyInert.add(element);
      holds.set(element, count + 1);
      if (count === 0) element.setAttribute('inert', '');
      held.push(element);
    }
    return () => {
      for (const element of held) {
        const count = (holds.get(element) ?? 1) - 1;
        if (count > 0) {
          holds.set(element, count);
          continue;
        }
        holds.delete(element);
        if (!alreadyInert.has(element)) element.removeAttribute('inert');
        alreadyInert.delete(element);
      }
    };
  }, [active]);
}

/**
 * `useInertOutside` as a component, for placing *after* a Radix dialog's
 * content inside the same portal: React runs the effects of earlier siblings
 * (and everything inside them) first, so by the time this one runs Radix has
 * marked the page. It changes to `active={false}` in the same render that
 * closes the dialog, so its cleanup — making the page usable again — runs
 * before the dialog's own cleanup gives focus back to the opener.
 */
export function InertOutside({ active }: { readonly active: boolean }): null {
  useInertOutside(active);
  return null;
}
