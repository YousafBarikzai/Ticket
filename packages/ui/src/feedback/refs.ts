'use client';

import { useCallback, type Ref, type RefObject } from 'react';

/**
 * One callback ref that fills a component's own ref and the caller's (React 19
 * passes `ref` as an ordinary prop, SPEC §4.0). Memoised on both, so React
 * does not detach and reattach it on every render.
 */
export function useComposedRef<T>(own: RefObject<T | null>, theirs: Ref<T> | undefined): (node: T | null) => void {
  return useCallback(
    (node: T | null) => {
      own.current = node;
      if (typeof theirs === 'function') theirs(node);
      else if (theirs) theirs.current = node;
    },
    [own, theirs],
  );
}
