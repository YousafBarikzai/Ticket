'use client';

import { useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ItsmProvider, type ItsmRouter } from '@itsm/ui';
import { RouteFocus, RouteProgress } from '@itsm/ui/shell';
import { LiveProvider } from '@itsm/pwa/live';
import { AppLink } from '../app/AppLink.js';

/**
 * The console's client context, mounted once in `(console)/layout.tsx` — never
 * the root layout, so the sign-in pages and the 404 stay static (D11).
 *
 * `ItsmProvider` gets this app's link, router and *hook references* (the
 * provider never calls `useSearchParams` itself: only the leaf hooks that need
 * the query do, inside their own Suspense, so no page is forced to render
 * client-side for the frame's sake). It hosts the theme — so the account
 * menu's appearance, contrast and density apply at once and persist — the
 * live-region announcer, the toaster and the keyboard registries.
 *
 * `LiveProvider` opens the page's one server-sent-events stream (the bell, and
 * the connection pill). The console asks for no topics: the API always adds
 * the person's own. `storageScope` keeps one person's recent items apart from
 * the next person's on a shared machine.
 *
 * `RouteFocus` moves focus to the new page's heading after a navigation;
 * `RouteProgress` draws the thin line while a slow one streams.
 */
export interface ProvidersProps {
  readonly locale: string;
  readonly timeZone: string;
  /** An opaque per-person key: the actor id. */
  readonly storageScope?: string;
  readonly children: ReactNode;
}

export function Providers({ locale, timeZone, storageScope, children }: ProvidersProps): ReactNode {
  const router = useRouter();
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
      app="admin"
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
        {children}
      </LiveProvider>
    </ItsmProvider>
  );
}
