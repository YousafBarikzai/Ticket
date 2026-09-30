'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** A layout effect in the browser, a plain effect on the server (where neither runs, and a layout effect warns). */
export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The latest value of something, for handlers that must keep one identity
 * (keyboard and pointer handlers attached once) but read this render's props.
 * Updated before any effect of this render runs.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
