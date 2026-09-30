'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../web/cx.js';

export interface BottomDockProps {
  /** The tab bar, at the very bottom. */
  readonly tabBar?: ReactNode;
  /** Exactly one contextual bar: form actions, the bulk bar, or the composer. */
  readonly bar?: ReactNode;
  readonly className?: string;
}

/** The variable the dock publishes on `<html>`, read by the base layer's `scroll-padding` and by the toaster. */
export const BOTTOM_DOCK_VARIABLE = '--itsm-bottom-dock-height';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/*
 * One dock per page. The frame mounts the host (with the tab bar); a page
 * that has a contextual bar mounts `<BottomDock bar={…}>` wherever it likes,
 * and the bar is drawn in the host's slot, above the tab bar. When two pages'
 * bars are mounted at once (a sheet's actions over a list's bulk bar), the
 * most recent one shows: the bottom edge holds one contextual bar (X-92).
 */

interface DockHost {
  readonly slot: HTMLElement | null;
  claim(token: object): () => void;
  readonly owner: () => object | null;
  subscribe(listener: () => void): () => void;
}

const DockContext = createContext<DockHost | null>(null);

function useDockHost(slot: HTMLElement | null): DockHost {
  const claims = useRef<object[]>([]);
  const listeners = useRef(new Set<() => void>());
  return useMemo<DockHost>(() => {
    const emit = (): void => {
      for (const listener of [...listeners.current]) listener();
    };
    return {
      slot,
      claim(token) {
        claims.current = [...claims.current.filter((entry) => entry !== token), token];
        emit();
        return () => {
          claims.current = claims.current.filter((entry) => entry !== token);
          emit();
        };
      },
      owner: () => claims.current[claims.current.length - 1] ?? null,
      subscribe(listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    };
  }, [slot]);
}

/** A page's contextual bar, drawn in the frame's dock. */
function DockedBar({ host, bar }: { readonly host: DockHost; readonly bar: ReactNode }): ReactNode {
  const [token] = useState(() => ({}));
  useEffect(() => host.claim(token), [host, token]);
  const owner = useSyncExternalStore(host.subscribe, host.owner, () => null);
  if (owner !== token || !host.slot) return null;
  return createPortal(bar, host.slot);
}

/**
 * Publishes the dock's height as `--itsm-bottom-dock-height` on `<html>`,
 * following every change (a composer growing, the tab bar hiding for the
 * keyboard), so the page scrolls clear of it — `scroll-padding` in the base
 * layer keeps a focused control out from under it (WCAG 2.4.11) — and toasts
 * rise above it.
 */
function usePublishHeight(element: HTMLElement | null): void {
  useIsomorphicLayoutEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    const publish = (): void => {
      const height = Math.round(element.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty(BOTTOM_DOCK_VARIABLE, `${height}px`);
      else root.style.removeProperty(BOTTOM_DOCK_VARIABLE);
    };
    publish();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BOTTOM_DOCK_VARIABLE);
    };
  }, [element]);
}

/**
 * Owns the phone's bottom edge so its occupants never overlap: the tab bar at
 * the bottom, then at most one contextual bar above it (form actions, the
 * bulk bar or the composer), then toasts above both (X-92). Fixed to the
 * viewport, clear of the home indicator, and — in the sidebar apps — clear of
 * the sidebar.
 *
 * Mounted once by the frame. Mounted again inside it, with a `bar`, it sends
 * that bar to the frame's dock rather than stacking a second one.
 */
export function BottomDock({ tabBar, bar, className }: BottomDockProps): ReactNode {
  const outer = useContext(DockContext);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const host = useDockHost(slot);
  const ownBar = useSyncExternalStore(host.subscribe, host.owner, () => null) === null ? bar : null;
  usePublishHeight(outer ? null : root);

  if (outer) {
    // Inside the frame: the bar joins the frame's dock. A second tab bar has no place.
    return bar ? <DockedBar host={outer} bar={bar} /> : null;
  }

  return (
    <DockContext value={host}>
      <div ref={setRoot} className={cx('itsm-BottomDock', className)}>
        <div ref={setSlot} className="itsm-BottomDock__bar">
          {ownBar}
        </div>
        {tabBar ? <div className="itsm-BottomDock__tabs">{tabBar}</div> : null}
      </div>
    </DockContext>
  );
}

/** Provides the dock to pages rendered before it in the tree (the frame renders the dock after `main`). */
export function BottomDockHost({ children, tabBar, className }: { readonly children: ReactNode; readonly tabBar?: ReactNode; readonly className?: string }): ReactNode {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const host = useDockHost(slot);
  usePublishHeight(root);
  return (
    <DockContext value={host}>
      {children}
      <div ref={setRoot} className={cx('itsm-BottomDock', className)}>
        <div ref={setSlot} className="itsm-BottomDock__bar" />
        {tabBar ? <div className="itsm-BottomDock__tabs">{tabBar}</div> : null}
      </div>
    </DockContext>
  );
}
