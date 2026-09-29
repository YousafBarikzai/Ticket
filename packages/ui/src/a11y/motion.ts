'use client';

/**
 * Reduced-motion support.
 *
 * Most of the work is done in the token layer: `renderTokenStylesheet` collapses
 * every duration variable to 1ms under `prefers-reduced-motion: reduce`, and
 * under the product's own "Reduce motion" setting, so CSS transitions stop
 * without any component opting in. This module covers the cases CSS cannot:
 * JavaScript-driven scrolling and animations whose *presence*, not just speed,
 * is the problem.
 *
 * Both sources count, as they do in the stylesheet: the operating system's
 * preference, and the setting the pre-paint script and `ThemeProvider` write on
 * `<html>` as `data-itsm-motion="reduced"`. Honouring only the first would
 * leave a person who switched motion off in the product watching a smooth
 * scroll the CSS had already stopped.
 */
import { useEffect, useState } from 'react';
import { motionAttribute } from '../tokens/css.js';

const QUERY = '(prefers-reduced-motion: reduce)';

/** The product setting, as written on `<html>`; false where there is no document. */
function reducedBySetting(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(motionAttribute) === 'reduced';
}

/** Safe on the server and in environments without `matchMedia` (jsdom, older WebViews). */
export function prefersReducedMotion(): boolean {
  if (reducedBySetting()) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Whether motion should be reduced, kept current: it follows the operating
 * system's preference and the product setting on `<html>` as either changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const onChange = (): void => setReduced(prefersReducedMotion());
    onChange();

    const list = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
    list?.addEventListener('change', onChange);

    const observer =
      typeof MutationObserver === 'function' && typeof document !== 'undefined' ? new MutationObserver(onChange) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: [motionAttribute] });

    return () => {
      list?.removeEventListener('change', onChange);
      observer?.disconnect();
    };
  }, []);

  return reduced;
}

/** `scrollIntoView` options that honour the preference — used by Timeline and CommandPalette. */
export function scrollBehaviour(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/**
 * Scrolls an element into view where the platform supports it.
 *
 * `scrollIntoView` does not exist in jsdom and is missing from some embedded
 * WebViews; a keystroke that moves a highlight must not throw because the
 * environment cannot scroll. Uses `block: "nearest"` so a keyboard user who is
 * holding an arrow key does not get the list yanked about.
 */
export function scrollIntoViewIfPossible(
  element: Element | null | undefined,
  options: ScrollIntoViewOptions = { block: 'nearest' },
): void {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView(options);
}
