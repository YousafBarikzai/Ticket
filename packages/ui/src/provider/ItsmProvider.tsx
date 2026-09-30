'use client';

import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { installAnnouncer } from '../a11y/announcer.js';
import { ThemeProvider } from '../theme/ThemeProvider.js';
import type { AppName } from '../theme/prefs.js';
import type { LinkComponent } from '../types.js';
import { mergeMessages, type UiMessages } from './messages.js';
import { watchNotificationDemand } from './notify.js';

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
  /** The signed-in person's locale and time zone (`me.locale`, `me.timeZone`), for every date and number. */
  readonly locale: string;
  readonly timeZone: string;
  readonly messages?: Partial<UiMessages>;
  readonly features?: ItsmFeatures;
  /**
   * An opaque key for the signed-in person — the actor id, say — that keeps
   * one person's recent items and pins apart from the next person's on a
   * shared machine. Without it they are per app on this device.
   */
  readonly storageScope?: string;
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
  readonly storageScope?: string;
}

const ItsmContext = createContext<ItsmContextValue | null>(null);

/**
 * The `Toaster`, from the overlays subpath, loaded only when it is wanted:
 * sonner is ten kilobytes the portal's first load does not pay for. A
 * dynamic `import()` rather than a static one keeps the root entry free of it
 * (SPEC §3.1 rule 1), and a bundler splits it into its own chunk.
 */
const LazyToaster = lazy(() => import('../overlays/Toaster.js').then((module) => ({ default: module.Toaster })));

/** When the browser has a quiet moment; a timer where it cannot say (Safari, jsdom). Returns the cancel. */
function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 3000);
  return () => window.clearTimeout(handle);
}

/**
 * Mounts the `Toaster` on the first `notify()`, or once the page is idle so
 * that the first toast does not wait for a download. Never on the server:
 * the state starts false and only an effect sets it.
 */
function useLazyToaster(): boolean {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (wanted) return;
    const want = (): void => setWanted(true);
    const stopWatching = watchNotificationDemand(want);
    const cancelIdle = whenIdle(want);
    return () => {
      stopWatching();
      cancelIdle();
    };
  }, [wanted]);
  return wanted;
}

/**
 * The design system's context for one application: its link component and
 * router, locale and time zone, copy and feature switches — and the things
 * one application has exactly one of: the theme, the live-region announcer
 * and the toaster.
 *
 * Mounted in each app's group layout (`(console)`, `(desk)`, `(portal)`), not
 * the root layout, so `/offline`, `/sign-in` and `/signed-out` stay static and
 * light (D11).
 *
 * The keyboard-shortcut, palette-command and F6-region registries, and the
 * clock relative times tick on, are module-level: there is one keyboard and
 * one wall clock per page, and a component rendered outside the provider — in
 * a test or on a status page — still gets working shortcuts and timestamps.
 * What the provider contributes to them is the switches that decide whether
 * a shortcut fires (`features`, and the person's preferences through
 * `ThemeProvider`).
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
  storageScope,
  children,
}: ItsmProviderProps): ReactNode {
  // A server layout passes these as fresh objects on every render; their
  // contents are what matter, so the context does not change (and re-render
  // every consumer) unless a value really did.
  const messagesKey = JSON.stringify(messages ?? {});
  const tooltips = features?.tooltips ?? app !== 'portal';
  const singleKeyShortcuts = features?.singleKeyShortcuts ?? app !== 'portal';
  const value = useMemo<ItsmContextValue>(
    () => ({
      app,
      Link,
      router,
      usePathname,
      useSearchParams,
      locale,
      timeZone,
      messages: mergeMessages(JSON.parse(messagesKey) as Partial<UiMessages>),
      features: { tooltips, singleKeyShortcuts },
      ...(storageScope ? { storageScope } : {}),
    }),
    [app, Link, router, usePathname, useSearchParams, locale, timeZone, messagesKey, tooltips, singleKeyShortcuts, storageScope],
  );

  useEffect(() => {
    // The live regions must exist before the first announcement, or the
    // first thing a screen reader should hear is lost.
    installAnnouncer(document);
  }, []);

  const toaster = useLazyToaster();

  return (
    <ItsmContext value={value}>
      <ThemeProvider app={app}>
        {children}
        {toaster ? (
          <Suspense fallback={null}>
            <LazyToaster label={value.messages.notifications} />
          </Suspense>
        ) : null}
      </ThemeProvider>
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

/**
 * The provider's context, or `null` outside it — for the hooks that have an
 * honest answer without one (a shortcut still fires, a timestamp still
 * formats) and so must not throw in a test or on a static status page.
 */
export function useOptionalItsm(): ItsmContextValue | null {
  return useContext(ItsmContext);
}
