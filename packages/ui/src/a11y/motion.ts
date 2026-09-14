/**
 * Reduced-motion support.
 *
 * Most of the work is done in the token layer: `renderTokenStylesheet` collapses
 * every duration variable to 1ms under `prefers-reduced-motion: reduce`, so CSS
 * transitions stop without any component opting in. This module covers the
 * cases CSS cannot: JavaScript-driven scrolling and animations whose *presence*,
 * not just speed, is the problem.
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Safe on the server and in environments without `matchMedia` (jsdom, older WebViews). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** `scrollIntoView` options that honour the preference — used by Timeline and CommandPalette. */
export function scrollBehaviour(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
