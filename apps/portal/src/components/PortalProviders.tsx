'use client';

import dynamic from 'next/dynamic';
import { useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LiveProvider } from '@itsm/pwa/live';
import { ItsmProvider, type ItsmRouter } from '@itsm/ui';
import { RouteFocus, RouteProgress } from '@itsm/ui/shell';
import { AppLink } from '../app/AppLink.js';
import { useHydrated } from './PortalShell.js';

/**
 * Everything the portal's screens stand on (SPEC §5.1, D11): the design
 * system's provider (link, router, locale and time zone, the person's
 * storage scope), the tab's one live stream, focus and progress on route
 * change, and the service worker.
 *
 * Mounted by the `(portal)` layout, never the root layout, so `/offline`,
 * `/sign-in` and `/signed-out` stay static and carry none of it. No query
 * cache: the portal's pages are server components that redraw with
 * `router.refresh()`, and its first load is budgeted (SPEC §3.7).
 *
 * The provider's portal defaults stand: no hover tooltips (every control
 * has a visible label) and no single-key shortcuts but the pages' own `/`.
 *
 * Every prop is serialisable — the layout passes the person's locale, time
 * zone and id, nothing that is a function.
 */

export interface PortalProvidersProps {
  readonly locale: string;
  readonly timeZone: string;
  /** The actor id: keeps one person's recents apart from the next person's on a shared machine. */
  readonly storageScope?: string;
  readonly children: ReactNode;
}

/**
 * The service worker — the offline copies, the queued reports and replies —
 * and "A new version is ready · Reload" (F19), loaded straight after
 * hydration with the rest of the frame's status pieces (`PortalStatus`):
 * registering a worker is nothing the first paint waits for.
 */
const LazyServiceWorker = dynamic(() => import('./PortalStatus.js').then((module) => module.ServiceWorkerUpdates), { ssr: false });

export function PortalProviders({ locale, timeZone, storageScope, children }: PortalProvidersProps): ReactNode {
  const router = useRouter();
  const hydrated = useHydrated();
  const itsmRouter = useMemo<ItsmRouter>(
    () => ({
      push: (href, options) => router.push(href, options),
      replace: (href, options) => router.replace(href, options),
      back: () => router.back(),
      prefetch: (href) => router.prefetch(href),
    }),
    [router],
  );

  return (
    <ItsmProvider
      app="portal"
      Link={AppLink}
      router={itsmRouter}
      usePathname={usePathname}
      useSearchParams={useSearchParams}
      locale={locale}
      timeZone={timeZone}
      {...(storageScope ? { storageScope } : {})}
    >
      <LiveProvider>
        <RouteFocus />
        <RouteProgress />
        {hydrated ? <LazyServiceWorker /> : null}
        {children}
      </LiveProvider>
    </ItsmProvider>
  );
}
