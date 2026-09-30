'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ConnectionStatus, GlobalBanner, useHotkey } from '@itsm/ui';
import { AppShell, NotificationCenter, type AppSwitcherItem } from '@itsm/ui/shell';
import { useLiveState } from '@itsm/pwa/live';
import { navModel, visibleNav, type NavBadgeValues } from '../navigation.js';
import { holdsAny, type Grants } from '../permissions.js';
import { useAdminNotifications, useOnline } from '../client/live.js';
import { setCommandPaletteOpen, useCommandPaletteOpen } from '../client/palette.js';
import { forgetThisPerson } from '../client/sign-out.js';
import { useSessionEnded } from '../client/useMutation.js';

/**
 * The console's frame: the design system's `AppShell` in its sidebar variant
 * (SPEC §4.9, §5.2, D7, D18), for tenant and platform pages alike.
 *
 * Everything it is given is serialisable — who is signed in, their
 * permissions, which other apps they can switch to — because the layout that
 * renders it is a server component. What needs the browser lives here:
 *
 *   - the sidebar, built from `navigation.ts` for this person, with badge
 *     counts that stream in after first paint (`NavBadges`);
 *   - search: ⌘K / Ctrl K anywhere, inside fields too, opens the command
 *     palette, which is fetched on first use (it is the heaviest thing here);
 *   - the bell, live through the page's one stream;
 *   - the connection pill (nothing while healthy), and the two frame-wide
 *     banners: "You're offline — changes can't be saved" (the console queues
 *     nothing, ADR-0049) and "Your session ended" when the stream finds out
 *     before the person does;
 *   - the account menu: appearance, contrast, density, keyboard shortcuts,
 *     *Your access*, help and sign out — a POST that first forgets this
 *     person's recent items, pins and dismissed notices on this device.
 */

export interface AdminShellProps {
  readonly person: { readonly name: string; readonly detail?: string };
  readonly tenant: { readonly name: string } | null;
  readonly permissions: Grants['permissions'];
  /** The other applications this person can use, same tab. */
  readonly switcher: readonly AppSwitcherItem[];
  /** Where a notification about a ticket opens. */
  readonly workbenchOrigin?: string;
  readonly helpHref?: string;
  readonly children: ReactNode;
}

/* -------------------------------------------------------------------------
 * Badge counts, streamed in by `NavBadges` after the frame has painted
 * ---------------------------------------------------------------------- */

let badgeValues: NavBadgeValues = {};
const badgeListeners = new Set<() => void>();

function subscribeBadges(listener: () => void): () => void {
  badgeListeners.add(listener);
  return () => badgeListeners.delete(listener);
}

const NO_BADGES: NavBadgeValues = {};

/**
 * Rendered by the server's `NavBadges` once its counts arrive: it hands them
 * to the sidebar and renders nothing itself. A sibling of the frame rather
 * than a prop, so the counts never hold up the first paint.
 */
export function PublishNavBadges({ values }: { readonly values: NavBadgeValues }): null {
  const key = JSON.stringify(values);
  useEffect(() => {
    badgeValues = JSON.parse(key) as NavBadgeValues;
    for (const listener of [...badgeListeners]) listener();
  }, [key]);
  return null;
}

function useNavBadges(): NavBadgeValues {
  return useSyncExternalStore(
    subscribeBadges,
    () => badgeValues,
    () => NO_BADGES,
  );
}

/* -------------------------------------------------------------------------
 * The heavier parts, fetched when first wanted
 * ---------------------------------------------------------------------- */

const LazyPalette = lazy(() => import('./AdminOverlays.js').then((module) => ({ default: module.AdminPalette })));
const LazyAccessSheet = lazy(() => import('./AdminOverlays.js').then((module) => ({ default: module.AccessSheet })));
const LazySessionEnded = lazy(() => import('./AdminOverlays.js').then((module) => ({ default: module.SessionEndedDialog })));

/** Fetches the palette's module when the browser is idle, so the first ⌘K opens it at once. */
function usePreloadPalette(): void {
  useEffect(() => {
    const load = (): void => void import('./AdminOverlays.js');
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(load, 2000);
    return () => window.clearTimeout(handle);
  }, []);
}

/* -------------------------------------------------------------------------
 * The bell, the pill and the banners
 * ---------------------------------------------------------------------- */

function AdminBell({ workbenchOrigin }: { readonly workbenchOrigin?: string }): ReactNode {
  const notifications = useAdminNotifications(workbenchOrigin);
  return (
    <NotificationCenter
      unread={notifications.unread}
      emergency={notifications.emergency}
      load={notifications.load}
      markRead={notifications.markRead}
      hrefFor={notifications.hrefFor}
    />
  );
}

const noItem = (): void => undefined;

function signInAgain(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/session/login?redirectTo=${encodeURIComponent(here)}`);
}

/** Nothing while the stream is healthy (X-82); "Reconnecting…", "Offline" or "Session ended" otherwise. */
function AdminStatus(): ReactNode {
  const { state } = useLiveState();
  return <ConnectionStatus state={state} pending={0} attention={[]} onRetry={noItem} onDiscard={noItem} onSignIn={signInAgain} />;
}

function AdminBanners(): ReactNode {
  const online = useOnline();
  const { state } = useLiveState();
  if (!online) {
    return <GlobalBanner tone="warning" icon="wifi-off" title="You’re offline" body="Changes can’t be saved until the connection is back." live="polite" />;
  }
  if (state === 'ended') {
    return (
      <GlobalBanner
        tone="warning"
        icon="log-in"
        title="Your session ended"
        body="Sign in again to save changes. What you see stays here until you do."
        action={{ id: 'sign-in', label: 'Sign in again' }}
        onAction={signInAgain}
        live="polite"
      />
    );
  }
  return null;
}

/* -------------------------------------------------------------------------
 * `g` then a letter: go to a page (SPEC §5.6)
 * ---------------------------------------------------------------------- */

/**
 * One chord per page that has one (`g c` Command centre, `g t` Tickets, `g r`
 * Rules, `g w` Workflows, `g s` Settings) — bound only for pages this person
 * can open, silent in text fields, listed in the shortcuts dialog, and off
 * with the single-key switch.
 */
function GoTo({ keys, href, label }: { readonly keys: string; readonly href: string; readonly label: string }): null {
  const router = useRouter();
  useHotkey({ keys, handler: () => router.push(href), description: `Go to ${label}`, group: 'Navigation' });
  return null;
}

/* -------------------------------------------------------------------------
 * The frame
 * ---------------------------------------------------------------------- */

export function AdminShell({ person, tenant, permissions, switcher, workbenchOrigin, helpHref, children }: AdminShellProps): ReactNode {
  const badges = useNavBadges();
  const grants = useMemo<Grants>(() => ({ permissions }), [permissions]);
  const nav = useMemo(() => navModel(grants, badges), [grants, badges]);

  const paletteOpen = useCommandPaletteOpen();
  const [paletteWanted, setPaletteWanted] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  // Kept mounted after the first open, so the sheet can animate closed.
  const [accessWanted, setAccessWanted] = useState(false);
  const [sessionEnded, dismissSessionEnded] = useSessionEnded();
  usePreloadPalette();

  const openSearch = useCallback(() => {
    setPaletteWanted(true);
    setCommandPaletteOpen(true);
  }, []);
  useEffect(() => {
    if (paletteOpen) setPaletteWanted(true);
  }, [paletteOpen]);

  // A palette left open across a navigation would hide the page it went to.
  const pathname = usePathname();
  useEffect(() => {
    setCommandPaletteOpen(false);
  }, [pathname]);

  const brand = useMemo(
    () => ({ name: 'Administration', ...(tenant ? { tenant: tenant.name } : {}), href: '/', app: 'admin' as const, switcher: [...switcher] }),
    [tenant, switcher],
  );

  const canReadNotifications = holdsAny(grants, ['notification.read']);
  const chords = useMemo(() => visibleNav(grants).filter((item) => item.shortcut), [grants]);

  return (
    <>
      <AppShell
        variant="sidebar"
        brand={brand}
        nav={nav}
        search={{ placeholder: 'Search or jump to…', shortcut: 'mod+k' }}
        onOpenSearch={openSearch}
        bell={canReadNotifications ? <AdminBell {...(workbenchOrigin ? { workbenchOrigin } : {})} /> : undefined}
        status={<AdminStatus />}
        banner={<AdminBanners />}
        user={{
          name: person.name,
          ...(person.detail ? { detail: person.detail } : {}),
          items: [
            {
              id: 'access',
              label: 'Your access',
              icon: 'key',
              onSelect: () => {
                setAccessWanted(true);
                setAccessOpen(true);
              },
            },
          ],
          appearance: true,
          density: true,
          shortcuts: true,
          ...(helpHref ? { help: { href: helpHref } } : {}),
          signOut: { action: '/api/session/logout', beforeSubmit: forgetThisPerson },
        }}
      >
        {children}
      </AppShell>
      {chords.map((item) => (
        <GoTo key={item.id} keys={item.shortcut!} href={item.href} label={item.label} />
      ))}
      {paletteWanted ? (
        <Suspense fallback={null}>
          <LazyPalette grants={grants} open={paletteOpen} onOpenChange={setCommandPaletteOpen} />
        </Suspense>
      ) : null}
      {accessWanted ? (
        <Suspense fallback={null}>
          <LazyAccessSheet grants={grants} open={accessOpen} onOpenChange={setAccessOpen} />
        </Suspense>
      ) : null}
      {sessionEnded ? (
        <Suspense fallback={null}>
          <LazySessionEnded open={sessionEnded} onDismiss={dismissSessionEnded} onSignIn={signInAgain} />
        </Suspense>
      ) : null}
    </>
  );
}
