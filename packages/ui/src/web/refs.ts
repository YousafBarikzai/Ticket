import { useMemo, type Ref, type RefCallback } from 'react';

/**
 * One ref callback that feeds several refs: the caller's (React 19 passes
 * `ref` as an ordinary prop) and the component's own.
 *
 * A component that keeps a ref for itself — to measure, focus or grow the
 * element — and also accepts one from its caller has to hand the element to
 * both. Taking the caller's `ref` out of the props and then replacing it with
 * the component's own is how the old `Textarea` silently dropped every ref it
 * was given (07 §5.3); this is the fix, shared by every control that needs it.
 *
 * Callback refs may return a cleanup (React 19); the merged ref returns one
 * that runs them all, and clears object refs and cleanup-less callbacks the
 * way React would have on its own.
 */
export function mergeRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  return (node: T | null) => {
    const cleanups: (() => void)[] = [];
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        const cleanup = ref(node);
        cleanups.push(typeof cleanup === 'function' ? cleanup : () => void ref(null));
      } else {
        (ref as { current: T | null }).current = node;
        cleanups.push(() => {
          (ref as { current: T | null }).current = null;
        });
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}

/**
 * `mergeRefs`, kept stable across renders while the refs themselves are. A
 * new callback on every render would detach and reattach the element each
 * time — harmless, but it runs every caller's ref twice per render.
 */
export function useMergedRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  // The refs are the dependencies: the array is the same length every render.
  return useMemo(() => mergeRefs(...refs), refs);
}
