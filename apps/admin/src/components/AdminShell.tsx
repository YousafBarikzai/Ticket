'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AreaId, AreaModel } from '@itsm/contracts/areas';
import { ConnectionStatus, GlobalBanner, useHotkey } from '@itsm/ui';
import type { MenuItemSpec } from '@itsm/ui/overlays';
import { AppShell, DEMO_RESET_REQUEST_EVENT, NotificationCenter, setShortcutsDialogOpen } from '@itsm/ui/shell';
import { useLiveState } from '@itsm/pwa/live';
import { navModel, visibleNav, type NavBadgeValues } from '../navigation.js';
import { holdsAny, type Grants } from '../permissions.js';
import { useAdminNotifications, useOnline } from '../client/live.js';
import { PaletteAreasProvider, setCommandPaletteOpen, useCommandPaletteOpen, type PaletteAreas } from '../client/palette.js';
import { forgetThisPerson } from '../client/sign-out.js';
import { useSessionEnded } from '../client/useMutation.js';

/**
 * The console's frame: the design system's `AppShell` in its sidebar variant
 * (SPEC §4.9, §5.2, D7, D18), for tenant and platform pages alike.
 *
 * Everything it is given is serialisable — who is signed in, their
 * permissions, their areas (`currentAreas()`), the links into the other areas
 * the server built from them, and the server-rendered demo bar and major
 * incident chip — because the layout that renders it is a server component.
 * It passes only the v3 frame props (SPEC v3 §3.10, RV1). It never reads an
 * origin and never builds a cross-area link itself: those come built from the
 * area model on the server, which keeps the model's code (and the demo's
 * tables behind it) out of every route's first load. What needs the browser
 * lives here:
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
 *   - the Help menu (Knowledge base · Help Portal, Keyboard shortcuts…; in
 *     the demo How the demo works and the site);
 *   - the account menu: the person's areas, *Your access*, appearance,
 *     contrast, density, keyboard shortcuts, help, in the demo the Demo group,
 *     and sign out (*End demo* in the demo) — a POST that first forgets this
 *     person's recent items, pins and dismissed notices on this device.
 */

export interface AdminShellProps {
  /** Line 2: the demo persona's job title, else the organisation or the workspace. */
  readonly person: { readonly name: string; readonly detail?: string };
  readonly permissions: Grants['permissions'];
  /** The person's areas, built on the server (`currentAreas()`): the Area card, the account menu, `useAreas()`. */
  readonly areas: AreaModel;
  /** The palette's words for each area (`AREAS[…].keywords`, read on the server). */
  readonly areaKeywords: Readonly<Partial<Record<AreaId, readonly string[]>>>;
  /** Links into the other areas, built from `areas` on the server (`crossAreaHref`); `null` where there is none. */
  readonly links: {
    /** "Knowledge base · Help Portal": the Help Portal's `/knowledge`. */
    readonly knowledge: string | null;
    /** The Service Desk's ticket page with a trailing slash; a notification's ticket is appended. */
    readonly serviceDeskTickets: string | null;
  };
  /** The demo bar (server-rendered, `LazySessionDemoBar`), in demo visits only. */
  readonly systemBar?: ReactNode;
  /** The frame's chips ahead of the page's own: the live major incident, streamed. */
  readonly context?: ReactNode;
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

function AdminBell({ serviceDeskTickets }: { readonly serviceDeskTickets: string | null }): ReactNode {
  const notifications = useAdminNotifications(serviceDeskTickets);
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

/**
 * "Sign in again" after the session ended under the page — back to this page
 * afterwards. A demo visit asks with `demo=1` (`signInAgainHref`'s shape,
 * D22): the BFF then reopens the demo through `/demo` rather than sending a
 * visitor to an identity provider they have no account with. Spelt out rather
 * than imported, because `@itsm/contracts/demo` would bring its tables into
 * every route's first load.
 */
export function signInAgainUrl(here: string, demo: boolean): string {
  const query = new URLSearchParams({ redirectTo: here });
  if (demo) query.set('demo', '1');
  return `/api/session/login?${query.toString()}`;
}

function signInAgain(demo: boolean): void {
  window.location.assign(signInAgainUrl(`${window.location.pathname}${window.location.search}`, demo));
}

/** Nothing while the stream is healthy (X-82); "Reconnecting…", "Offline" or "Session ended" otherwise. */
function AdminStatus({ demo }: { readonly demo: boolean }): ReactNode {
  const { state } = useLiveState();
  return <ConnectionStatus state={state} pending={0} attention={[]} onRetry={noItem} onDiscard={noItem} onSignIn={() => signInAgain(demo)} />;
}

function AdminBanners({ demo }: { readonly demo: boolean }): ReactNode {
  const online = useOnline();
  const { state } = useLiveState();
  if (!online) {
    return <GlobalBanner tone="warning" icon="wifi-off" title="You’re offline" body="Changes can’t be saved until the connection is back." live="polite" />;
  }
  if (state === 'ended') {
    // The demo's words (§4.4): a visit is continued, never signed in to.
    return demo ? (
      <GlobalBanner
        tone="warning"
        icon="play"
        title="Your demo session ended"
        body="Continue the demo to save changes. The demo data may have been reset since."
        action={{ id: 'continue-demo', label: 'Continue the demo' }}
        onAction={() => signInAgain(true)}
        live="polite"
      />
    ) : (
      <GlobalBanner
        tone="warning"
        icon="log-in"
        title="Your session ended"
        body="Sign in again to save changes. What you see stays here until you do."
        action={{ id: 'sign-in', label: 'Sign in again' }}
        onAction={() => signInAgain(false)}
        live="polite"
      />
    );
  }
  return null;
}

/**
 * The top bar's Help menu (A2 §5.2.6): the knowledge base, which lives in the
 * Help Portal, and the keyboard shortcuts; in the demo also how the demo works
 * and the site's home (D18 — a real session never links to the site). Pure,
 * and tested.
 */
export function helpItems(areas: AreaModel, knowledge: string | null): MenuItemSpec[] {
  const portal = areas.areas.find((area) => area.id === 'portal');
  const items: MenuItemSpec[] = [];
  if (knowledge) {
    items.push({
      id: 'knowledge',
      label: 'Knowledge base · Help Portal',
      icon: 'knowledge',
      href: knowledge,
      ...(areas.demo && portal?.persona ? { description: `You’ll continue as ${portal.persona.name}` } : {}),
    });
  }
  items.push({ id: 'shortcuts', label: 'Keyboard shortcuts…', icon: 'keyboard', shortcut: '?', onSelect: () => setShortcutsDialogOpen(true) });
  const home = areas.demo ? areas.home : undefined;
  if (home) {
    items.push({ id: 'how-it-works', label: 'How the demo works', icon: 'info', href: `${home.href.split('#')[0]!.replace(/\/+$/, '')}/#how-it-works` });
    items.push({ id: 'home', label: home.label, icon: 'home', href: home.href });
  }
  return items;
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

export function AdminShell({ person, permissions, areas, areaKeywords, links, systemBar, context, children }: AdminShellProps): ReactNode {
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

  const demo = areas.demo;
  // The v3 brand: the product lockup links home, under it the workspace (§3.4). The area's name is the Area card's.
  const brand = useMemo(() => ({ href: '/', ...(areas.workspace ? { workspace: areas.workspace } : {}) }), [areas.workspace]);
  const help = useMemo(() => ({ items: helpItems(areas, links.knowledge) }), [areas, links.knowledge]);
  const paletteAreas = useMemo<PaletteAreas>(() => ({ model: areas, keywords: areaKeywords }), [areas, areaKeywords]);

  const canReadNotifications = holdsAny(grants, ['notification.read']);
  const chords = useMemo(() => visibleNav(grants).filter((item) => item.shortcut), [grants]);

  return (
    <>
      <AppShell
        variant="sidebar"
        areas={areas}
        brand={brand}
        nav={nav}
        {...(systemBar ? { systemBar } : {})}
        {...(context ? { context } : {})}
        help={help}
        search={{ placeholder: 'Search or jump to…', shortcut: 'mod+k' }}
        onOpenSearch={openSearch}
        bell={canReadNotifications ? <AdminBell serviceDeskTickets={links.serviceDeskTickets} /> : undefined}
        status={<AdminStatus demo={demo} />}
        banner={<AdminBanners demo={demo} />}
        user={{
          name: person.name,
          ...(person.detail ? { detail: person.detail } : {}),
          areas,
          ...(demo ? { demo: { resetEvent: DEMO_RESET_REQUEST_EVENT } } : {}),
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
          ...(links.knowledge ? { help: { href: links.knowledge, label: 'Knowledge base · Help Portal' } } : {}),
          signOut: { action: '/api/session/logout', beforeSubmit: forgetThisPerson },
        }}
      >
        {children}
      </AppShell>
      {chords.map((item) => (
        <GoTo key={item.id} keys={item.shortcut!} href={item.href} label={item.label} />
      ))}
      {paletteWanted ? (
        // The palette is drawn beside the frame, outside its areas context, so it is handed the areas here.
        <PaletteAreasProvider value={paletteAreas}>
          <Suspense fallback={null}>
            <LazyPalette grants={grants} open={paletteOpen} onOpenChange={setCommandPaletteOpen} />
          </Suspense>
        </PaletteAreasProvider>
      ) : null}
      {accessWanted ? (
        <Suspense fallback={null}>
          <LazyAccessSheet grants={grants} open={accessOpen} onOpenChange={setAccessOpen} />
        </Suspense>
      ) : null}
      {sessionEnded ? (
        <Suspense fallback={null}>
          <LazySessionEnded open={sessionEnded} onDismiss={dismissSessionEnded} onSignIn={() => signInAgain(demo)} />
        </Suspense>
      ) : null}
    </>
  );
}
