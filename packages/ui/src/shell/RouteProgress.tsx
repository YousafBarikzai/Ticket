'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface RouteProgressProps {
  /** Shown only for navigations slower than this; default 300 ms. */
  readonly delayMs?: number;
  readonly className?: string;
}

/*
 * Pending work the bar reports, from two sources:
 *
 * - The application's links. `AppLink` renders `<span data-itsm-pending
 *   hidden={!pending}>` from Next's `useLinkStatus`, so a navigation in
 *   flight shows as an unhidden span somewhere in the page.
 * - Transitions the design system starts itself (`useRoutePending`), such as
 *   a filter written to the URL through the router.
 */

let sources = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribeSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reports a pending navigation or transition to `RouteProgress` while `pending` is true. */
export function useRoutePending(pending: boolean): void {
  useEffect(() => {
    if (!pending) return;
    sources += 1;
    emit();
    return () => {
      sources -= 1;
      emit();
    };
  }, [pending]);
}

const PENDING_SELECTOR = '[data-itsm-pending]:not([hidden])';

/** Whether a link somewhere on the page says its navigation is pending, following changes. */
function useLinkPending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const check = (): void => setPending(document.querySelector(PENDING_SELECTOR) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-itsm-pending'] });
    return () => observer.disconnect();
  }, []);
  return pending;
}

type Phase = 'idle' | 'running' | 'finishing';

/** How long the bar takes to run out to full and fade once the navigation lands. */
const FINISH_MS = 250;

/**
 * The 2 px accent line along the top of the window while a navigation is
 * pending — and only when it is slow enough to notice (300 ms by default),
 * so the quick ones stay quiet. It creeps towards the end while waiting,
 * then runs out and fades when the page arrives; under reduced motion it
 * simply appears and disappears.
 *
 * Decorative (`aria-hidden`): what a screen reader needs to hear — the new
 * page — Next's route announcer says, from the page's `<title>`, and a
 * section that is loading says so itself with `aria-busy`.
 */
export function RouteProgress({ delayMs = 300, className }: RouteProgressProps): ReactNode {
  const linkPending = useLinkPending();
  const transitionPending = useSyncExternalStore(subscribeSources, () => sources > 0, () => false);
  const pending = linkPending || transitionPending;
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    if (pending) {
      if (phaseRef.current === 'running') return;
      const timer = window.setTimeout(() => setPhase('running'), delayMs);
      return () => window.clearTimeout(timer);
    }
    // Never shown: it was quick, and nothing needs saying.
    if (phaseRef.current === 'idle') return;
    if (phaseRef.current === 'running') setPhase('finishing');
    const timer = window.setTimeout(() => setPhase('idle'), FINISH_MS);
    return () => window.clearTimeout(timer);
  }, [pending, delayMs]);

  return <div aria-hidden="true" className={cx('itsm-RouteProgress', className)} data-phase={phase} />;
}
