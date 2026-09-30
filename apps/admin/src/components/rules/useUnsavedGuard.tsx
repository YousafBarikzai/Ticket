'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@itsm/ui/overlays';

/**
 * Asks before a rule's unsaved changes are left behind (SPEC §6.1: an
 * unsaved-changes guard, no autosave for rules — a saved edit to a live rule
 * takes it offline, R1, so saving by itself would be the worst default).
 *
 * The same two guards the design system's `Form dirtyGuard` keeps, for a
 * canvas that is not one form: closing or reloading the tab is the browser's
 * own prompt; following a link inside the console — the sidebar, a
 * breadcrumb, the palette's links — is caught and answered with "Discard
 * changes?", whose safe choice (*Keep editing*) has focus first. The
 * browser's Back button cannot be held by a page.
 *
 * Returns the dialog to render, and `release()` for the moment the builder
 * leaves on purpose (after a save that navigates).
 */
export function useUnsavedGuard(dirty: boolean): { readonly dialog: ReactNode; release(): void } {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  const released = useRef(false);

  useEffect(() => {
    released.current = false;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (released.current) return;
      event.preventDefault();
      // Older engines read this rather than `preventDefault`.
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent): void => {
      if (released.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // A fragment or a change of tab on this page is not leaving it.
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture, so the router's own link handler never sees a click it should not follow.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const dialog =
    destination === null ? null : (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) setDestination(null);
        }}
        spec={{
          title: 'Discard changes?',
          body: 'Your changes to this rule haven’t been saved. Leaving now loses them.',
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        }}
        onConfirm={async () => {
          released.current = true;
          const to = destination;
          setDestination(null);
          router.push(to);
        }}
      />
    );

  return {
    dialog,
    release: () => {
      released.current = true;
    },
  };
}
