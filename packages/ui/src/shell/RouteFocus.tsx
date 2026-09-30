'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathnameSafe } from './location.js';

/** The heading a page offers as its focus target (`PageHeader` renders it). */
export const ROUTE_FOCUS_SELECTOR = 'main h1[tabindex="-1"]';

/** How long to wait for the new page's heading to arrive (a streamed page may show its skeleton first). */
const WAIT_MS = 3000;

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Moves focus to the new page's `<h1>` when the **pathname** changes — never
 * when only the query does, which would yank focus out of the filter or the
 * search box someone is using (X-60).
 *
 * After a client-side navigation focus would otherwise stay on the link that
 * was followed, in the sidebar, far from the new content; a screen-reader
 * user would have to find their way back down. The heading is where the page
 * starts. Focus lands without a visible ring (the stylesheet draws none for
 * a programmatic focus on `h1[tabindex="-1"]`), and nothing extra is
 * announced: Next's route announcer reads the new `<title>`.
 *
 * It waits (up to 3 s) for a heading that is still streaming in, and gives up
 * if the person moves focus themselves in the meantime or a dialog is open
 * (an intercepted route drawn as a sheet has its own focus). Renders nothing.
 */
export function RouteFocus(): ReactNode {
  const pathname = usePathnameSafe();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const last = previous.current;
    previous.current = pathname;
    // The first render is the page load, which the browser already handled.
    if (last === null || last === pathname) return;

    const focusedAtNavigation = document.activeElement;
    let observer: MutationObserver | null = null;
    let timer: number | null = null;
    let frame: number | null = null;

    const stop = (): void => {
      observer?.disconnect();
      observer = null;
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      timer = null;
      frame = null;
    };

    const attempt = (): boolean => {
      // The person has already moved on; leave them where they are.
      const active = document.activeElement;
      if (active && active !== document.body && active !== focusedAtNavigation) return true;
      if (modalOpen()) return true;
      const heading = document.querySelector<HTMLElement>(ROUTE_FOCUS_SELECTOR);
      if (!heading) return false;
      heading.focus({ preventScroll: true });
      return true;
    };

    // After the new page has painted, so a heading from the old page is not
    // the one that gets focus.
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (attempt()) return;
      observer = new MutationObserver(() => {
        if (attempt()) stop();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = window.setTimeout(stop, WAIT_MS);
    });

    return stop;
  }, [pathname]);

  return null;
}
