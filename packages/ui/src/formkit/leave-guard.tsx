'use client';

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { ConfirmSpec } from '../types.js';

/**
 * The confirmation, from the overlays subpath on demand: the root entry stays
 * free of Radix (SPEC §3.1 rule 1), and most forms are left without anyone
 * being asked anything.
 */
const LazyConfirmDialog = lazy(() => import('../overlays/ConfirmDialog.js').then((module) => ({ default: module.ConfirmDialog })));

/** A same-document link to somewhere else in this application, or `null` for one the guard leaves alone. */
function internalDestination(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  // A new tab, a download or another site leaves this page alone (or is
  // `beforeunload`'s to ask about).
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // A fragment on this page (an error summary link, a skip link) is not leaving.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Asks before unsaved changes are left behind (`Form dirtyGuard`).
 *
 * Two ways out of a page, two guards. Closing or reloading the tab, or going
 * to another site, is the browser's `beforeunload` prompt — the only thing a
 * page may do there. Following a link inside the application is caught
 * before the router sees it and answered with the product's own
 * confirmation, "Discard changes?", whose safe choice (*Keep editing*) has
 * focus first; *Discard changes* then navigates through the application's
 * router. The browser's Back button cannot be held by a page, which is one
 * reason forms that matter also keep a draft.
 *
 * Returns the dialog to render (nothing until it is needed).
 */
export function useLeaveGuard(active: boolean, keepsDraft: boolean): ReactNode {
  const itsm = useOptionalItsm();
  const [destination, setDestination] = useState<string | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!active) return;
    leaving.current = false;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (leaving.current) return;
      event.preventDefault();
      // Older engines still read this rather than `preventDefault`.
      event.returnValue = '';
    };
    // Capture, on the document: this runs before the application's link
    // handler (its router) and stops the navigation there.
    const onClick = (event: MouseEvent): void => {
      const href = internalDestination(event);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  if (destination === null) return null;

  const spec: ConfirmSpec = {
    title: 'Discard changes?',
    body: keepsDraft
      ? 'Your latest changes are kept as a draft on this device, but they have not been saved.'
      : 'You have changes on this page that have not been saved.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
    tone: 'danger',
  };

  return (
    <Suspense fallback={null}>
      <LazyConfirmDialog
        open
        spec={spec}
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
        onConfirm={async () => {
          const href = destination;
          leaving.current = true;
          setDestination(null);
          if (itsm) itsm.router.push(href);
          else window.location.assign(href);
        }}
      />
    </Suspense>
  );
}
