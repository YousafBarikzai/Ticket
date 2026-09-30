'use client';

import { useEffect, useState } from 'react';

/**
 * Whether a media query matches, following changes. `fallback` on the server
 * and until the first effect, so server and client markup agree and only an
 * effect can change it.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(fallback);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/** The `md` breakpoint (768 px) as a query, in rem like the stylesheet's. */
export const MD_UP = '(min-width: 48rem)';
