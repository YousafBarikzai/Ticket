'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerServiceWorker, useServiceWorkerUpdate } from '@itsm/pwa';
import { LiveProvider } from '@itsm/pwa/live';
import { ItsmProvider, notify, type ItsmRouter } from '@itsm/ui';
import { RouteFocus, RouteProgress } from '@itsm/ui/shell';
import { AppLink } from '../app/AppLink.js';
import { createDeskQueryClient } from '../client/query-client.js';

/**
 * Everything the desk's screens stand on (SPEC §5.1, D11, D16): the design
 * system's provider (link, router, locale, the person's storage scope), the
 * query cache, the one live stream per tab, focus and progress on route
 * change, and the service worker.
 *
 * Mounted by the `(desk)` layout, never the root layout, so `/offline`,
 * `/sign-in` and `/signed-out` stay static and carry none of it.
 *
 * Every prop is serialisable — the server layout passes the person's locale,
 * time zone, id and live topics, nothing that is a function.
 */

export interface DeskProvidersProps {
  readonly locale: string;
  readonly timeZone: string;
  /** The actor id: keeps one person's recents and pins apart from the next person's on a shared machine. */
  readonly storageScope?: string;
  /** `group:<id>` per team (the API adds the person's own topic). */
  readonly topics: readonly string[];
  readonly children: ReactNode;
}

/**
 * The service worker, and "A new version is ready · Reload" when a deploy
 * lands while the desk is open (F19). The worker waits for the person rather
 * than taking over a page mid-reply.
 */
function ServiceWorker(): null {
  const update = useServiceWorkerUpdate();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!update.ready) return;
    notify('A new version is ready', {
      id: 'desk-update',
      tone: 'info',
      description: 'Reload when it suits you; anything you were writing is kept.',
      duration: 'persistent',
      action: { label: 'Reload', onClick: update.apply },
    });
  }, [update.ready, update.apply]);

  return null;
}

export function DeskProviders({ locale, timeZone, storageScope, topics, children }: DeskProvidersProps): ReactNode {
  const router = useRouter();
  // One cache for the life of the tab: created once, not on every render.
  const [queryClient] = useState(createDeskQueryClient);
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
      app="workbench"
      Link={AppLink}
      router={itsmRouter}
      usePathname={usePathname}
      useSearchParams={useSearchParams}
      locale={locale}
      timeZone={timeZone}
      {...(storageScope ? { storageScope } : {})}
    >
      <QueryClientProvider client={queryClient}>
        <LiveProvider topics={topics}>
          <RouteFocus />
          <RouteProgress />
          <ServiceWorker />
          {children}
        </LiveProvider>
      </QueryClientProvider>
    </ItsmProvider>
  );
}
