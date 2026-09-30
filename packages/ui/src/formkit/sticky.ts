'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Whether a bar that sticks to the bottom of the view is stuck there — that
 * is, whether its place in the page is below the fold and it is floating
 * over the content.
 *
 * A bar at rest at the end of a short form needs no background or edge; the
 * same bar floating over fields needs both, or the fields show through and
 * nothing separates the two. CSS cannot ask "am I stuck", so a one-pixel
 * sentinel sits where the bar's own place is, and the bar is stuck while the
 * sentinel is below the visible area. An `IntersectionObserver` reports that
 * without a scroll listener; where there is none (old engines, tests) the bar
 * simply never draws its stuck edge.
 */
export function useStuck(enabled: boolean): { readonly sentinelRef: RefObject<HTMLDivElement | null>; readonly stuck: boolean } {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || !sentinel || typeof IntersectionObserver !== 'function') {
      setStuck(false);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const below = entry.rootBounds ? entry.boundingClientRect.top >= entry.rootBounds.bottom - 1 : false;
      setStuck(!entry.isIntersecting && below);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled]);

  return { sentinelRef, stuck };
}
