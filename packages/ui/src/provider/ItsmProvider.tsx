'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import type { AppName } from '../theme/prefs.js';
import type { LinkComponent } from '../types.js';
import { defaultMessages, type UiMessages } from './messages.js';

/** Navigation, as the app's router offers it. Injected so the design system never imports Next. */
export interface ItsmRouter {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  back(): void;
  prefetch?(href: string): void;
}

export interface ItsmFeatures {
  /** Hover tooltips on icon buttons. Off in the portal, whose controls carry visible labels. */
  readonly tooltips?: boolean;
  /** Single-key shortcuts (`c`, `j`, `/`). Off in the portal, apart from `/` on Home and Knowledge. */
  readonly singleKeyShortcuts?: boolean;
}

export interface ItsmProviderProps {
  readonly app: AppName;
  readonly Link: LinkComponent;
  readonly router: ItsmRouter;
  /**
   * Hook references, not values: the app's `usePathname`/`useSearchParams`.
   * The provider calls neither — `useSearchParams` makes a statically rendered
   * page bail out to client rendering — only the leaf hooks that need them do.
   */
  readonly usePathname: () => string;
  readonly useSearchParams: () => URLSearchParams;
  readonly locale: string;
  readonly timeZone: string;
  readonly messages?: Partial<UiMessages>;
  readonly features?: ItsmFeatures;
  readonly children: ReactNode;
}

/** What `useItsm()` returns: the provider's props with the defaults applied. */
export interface ItsmContextValue {
  readonly app: AppName;
  readonly Link: LinkComponent;
  readonly router: ItsmRouter;
  readonly usePathname: () => string;
  readonly useSearchParams: () => URLSearchParams;
  readonly locale: string;
  readonly timeZone: string;
  readonly messages: UiMessages;
  readonly features: Required<ItsmFeatures>;
}

const ItsmContext = createContext<ItsmContextValue | null>(null);

/**
 * The design system's context for one application: its link component and
 * router, locale and time zone, copy and feature switches.
 *
 * Mounted in each app's group layout (`(console)`, `(desk)`, `(portal)`), not
 * the root layout, so `/offline`, `/sign-in` and `/signed-out` stay static and
 * light (D11).
 *
 * Stub (SPEC §4.1): provides the context and hosts `ThemeProvider`. The
 * foundations package adds the hotkey, command and region registries, the
 * announcer, the shared clock and the lazily mounted `Toaster`.
 */
export function ItsmProvider({
  app,
  Link,
  router,
  usePathname,
  useSearchParams,
  locale,
  timeZone,
  messages,
  features,
  children,
}: ItsmProviderProps): ReactNode {
  const value = useMemo<ItsmContextValue>(
    () => ({
      app,
      Link,
      router,
      usePathname,
      useSearchParams,
      locale,
      timeZone,
      messages: { ...defaultMessages, ...messages },
      features: {
        tooltips: features?.tooltips ?? app !== 'portal',
        singleKeyShortcuts: features?.singleKeyShortcuts ?? app !== 'portal',
      },
    }),
    [app, Link, router, usePathname, useSearchParams, locale, timeZone, messages, features],
  );
  return (
    <ItsmContext value={value}>
      <ThemeProvider app={app}>{children}</ThemeProvider>
    </ItsmContext>
  );
}

/**
 * The provider's context. Throws outside `ItsmProvider`, with a message that
 * names the fix: a component that needs the app's router has no sensible
 * fallback, and rendering a dead link quietly would be worse than failing.
 */
export function useItsm(): ItsmContextValue {
  const value = useContext(ItsmContext);
  if (!value) throw new Error('@itsm/ui: this component needs <ItsmProvider> above it (mounted in the app’s group layout).');
  return value;
}
