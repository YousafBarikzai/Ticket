'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefCallback,
} from 'react';

/** A layout effect in the browser, a plain effect (which never runs) on the server. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A module the frame loads on intent: the menu library behind the account
 * menu, the notification panel, the navigation sheet. Once fetched it is kept
 * here, so every later instance renders it at once.
 */
export interface LazyModule<T> {
  readonly load: () => Promise<T>;
  value?: T;
  pending?: Promise<T>;
}

export function lazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  return { load };
}

/** Fetches a lazy module once; a failed fetch is forgotten so the next intent tries again. */
export function fetchModule<T>(module: LazyModule<T>): Promise<T> {
  if (module.value !== undefined) return Promise.resolve(module.value);
  module.pending ??= module.load().then(
    (value) => {
      module.value = value;
      module.pending = undefined;
      return value;
    },
    (error: unknown) => {
      module.pending = undefined;
      throw error;
    },
  );
  return module.pending;
}

/** Fetches a module when the browser is idle — the portal prefetches its panels this way (SPEC §3.7). */
export function useIdlePrefetch(module: LazyModule<unknown>, enabled = true): void {
  useEffect(() => {
    if (!enabled || module.value !== undefined) return;
    const run = (): void => {
      fetchModule(module).catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: 8000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(run, 4000);
    return () => window.clearTimeout(handle);
  }, [module, enabled]);
}

export interface IntentTriggerProps {
  readonly ref: RefCallback<HTMLButtonElement>;
  readonly onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onClick: () => void;
}

export interface IntentLoader<T> {
  /** The module, once it has arrived; `null` before (and always on the server). */
  readonly loaded: T | null;
  readonly open: boolean;
  setOpen(open: boolean): void;
  /** Spread on the plain trigger drawn before the module arrives. */
  readonly intentProps: IntentTriggerProps;
  /** The ref for the trigger once the module draws it. */
  readonly triggerRef: RefCallback<HTMLButtonElement>;
  readonly triggerElement: () => HTMLButtonElement | null;
}

/**
 * The plain button a heavy popup is drawn behind, and the moment it becomes
 * the real one.
 *
 * The frame's menus live in `@itsm/ui/overlays`, which the root entry — and
 * the portal's first load — must not carry (SPEC §3.1 rule 1, §3.7). So a
 * trigger renders as an ordinary button, and the module is fetched on the
 * first sign of intent: the pointer arriving, focus, a press. When it lands
 * the button is redrawn by the menu library, which makes it a new element,
 * and this hook covers the seams that would otherwise show:
 *
 * - **Focus** that was on the old button moves to the new one in the same
 *   frame, so a keyboard user tabbing past is not dropped on `<body>`.
 * - **A press made while the module was on its way** — a click, Enter,
 *   Space, ↓ — is remembered, and the popup opens as soon as it can.
 * - A fetch that fails leaves the plain button in place; the next intent tries
 *   again. Nothing throws.
 *
 * The first render is always the plain button, on the client as on the
 * server, so hydration never disagrees; a module another instance already
 * fetched is swapped in by an effect straight after.
 */
export function useIntentLoader<T>(module: LazyModule<T>): IntentLoader<T> {
  const [loaded, setLoaded] = useState<T | null>(null);
  const [open, setOpenState] = useState(false);
  const element = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const wantOpen = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (module.value !== undefined) setLoaded(() => module.value as T);
    return () => {
      alive.current = false;
    };
  }, [module]);

  const land = useCallback((value: T) => {
    if (!alive.current) return;
    // Read before the swap: the element under focus is still the plain button.
    refocus.current = element.current !== null && document.activeElement === element.current;
    setLoaded(() => value);
    if (wantOpen.current) setOpenState(true);
  }, []);

  const load = useCallback(() => {
    if (loaded !== null) return;
    if (module.value !== undefined) {
      land(module.value);
      return;
    }
    fetchModule(module).then(land, () => {
      wantOpen.current = false;
    });
  }, [land, loaded, module]);

  useIsomorphicLayoutEffect(() => {
    if (loaded === null) return;
    if (refocus.current && !wantOpen.current) element.current?.focus();
    refocus.current = false;
    wantOpen.current = false;
  }, [loaded]);

  const triggerRef = useCallback<RefCallback<HTMLButtonElement>>((node) => {
    element.current = node;
  }, []);

  const requestOpen = useCallback(() => {
    wantOpen.current = true;
    load();
  }, [load]);

  const intentProps: IntentTriggerProps = {
    ref: triggerRef,
    onPointerEnter: (event) => {
      if (event.pointerType !== 'touch') load();
    },
    onPointerDown: (event) => {
      if (event.button === 0 && !event.ctrlKey) requestOpen();
    },
    onFocus: () => load(),
    onBlur: () => {
      refocus.current = false;
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        requestOpen();
      }
    },
    onClick: requestOpen,
  };

  return {
    loaded,
    open,
    setOpen: setOpenState,
    intentProps,
    triggerRef,
    triggerElement: () => element.current,
  };
}
