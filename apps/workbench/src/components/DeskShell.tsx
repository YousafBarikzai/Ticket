'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AreaModel } from '@itsm/contracts/areas';
import { clearLocalData, needsAttention, outboxStore, pendingCount, useOutbox } from '@itsm/pwa';
import { useLiveState } from '@itsm/pwa/live';
import { ApiError } from '@itsm/sdk';
import {
  Button,
  ConnectionStatus,
  GlobalBanner,
  IconButton,
  Kbd,
  isDisclosureKey,
  isDismissalKey,
  isRecentsKey,
  useHotkey,
  useItsm,
} from '@itsm/ui';
import type { MenuItemSpec } from '@itsm/ui/overlays';
import {
  AppShell,
  DEMO_RESET_REQUEST_EVENT,
  NAV_SHEET_ID,
  setNavigationSheetOpen,
  setShortcutsDialogOpen,
  useNavigationSheetOpen,
  type DemoBarProps,
  type NavItem,
  type TabItem,
} from '@itsm/ui/shell';
import { useTheme } from '@itsm/ui/theme';
import { DemoBarSlot } from '../app/demo/DemoBarSlot.js';
import { api, fetchDeskCounts } from '../client/api.js';
import { useCountsFollowLive } from '../client/live.js';
import { AVAILABILITY_CHOICES, type AvailabilityChoice, type DeskPaletteDeps } from '../client/palette.js';
import { deskKeys, shouldRetry } from '../client/query-client.js';
import { HELP_PORTAL_NAME } from '../inbox/presentation.js';
import { VIEWS, hasDangerCount, navWithCounts, viewPath, type TeamSummary, type ViewDefinition } from '../inbox/views.js';
import type { DeskDestination, DeskFrame } from '../navigation.js';
import { AvailabilityPill, useAvailability } from './AvailabilityPill.js';
import { DeskNotifications } from './DeskNotifications.js';

/**
 * The Service Desk frame (v3 §3.4–§3.8; SPEC §5.3, D7, D9): the design
 * system's sidebar shell with the Area card, the views and their counts, the
 * New ticket action, search (⌘K), the bell, Help, the connection pill,
 * availability, the account menu, the phone's tab bar and, in a demo, the
 * demo bar.
 *
 * Rendered by the `(desk)` layout with plain data — the area model, the
 * frame the server built from `navigation.ts` (the navigation, the tabs, the
 * palette's places and the links out), the person's name, their teams,
 * permission booleans — and nothing else; everything that is a function
 * lives here, on the client side of the boundary. It passes only the v3
 * frame props (RV1): `areas`, `brand { href, workspace }`, `sidebarAction`.
 *
 * What the frame owns, and pages do not:
 *   - the keyboard map's global keys (`c`, `/`, `g` + a view, `g o`) —
 *     `mod+K`, `?` and `[` are the design system's own;
 *   - the palette (loaded on first use) and the new-ticket sheet (likewise);
 *   - "Your session ended": a persistent banner when the live stream or a
 *     background read hears a 401, never a dialog that steals focus (D15) —
 *     in a demo, "Your demo session ended" and Continue the demo;
 *   - sign-out, which first clears this device's copies of the person's
 *     work (F19) and asks before discarding replies that have not been sent;
 *   - in a demo, the demo bar, and with it clearing those copies again when
 *     the data is reset under the visitor (S11).
 */

export interface DeskPermissions {
  readonly readTickets: boolean;
  readonly createTickets: boolean;
  readonly search: boolean;
  readonly readPeople: boolean;
  readonly readAvailability: boolean;
  readonly setAvailability: boolean;
}

export interface DeskShellProps {
  /** The person's areas, built on the server (`currentAreas()`): the Area card, Switch area, the demo's persona lines. */
  readonly areas: AreaModel;
  /** What `navigation.ts` built for this person on the server. */
  readonly frame: DeskFrame;
  /** The workspace's name, under the product's in the brand block. */
  readonly workspace?: string;
  /**
   * The demo bar's props, in a demo session only (v3 §3.8): the clock the
   * server computed, the persona, the generation and the areas. The frame
   * draws it through the lazy slot, which also clears this device's copies
   * of the visit's work when the data is reset (S11).
   */
  readonly demoBar?: DemoBarProps;
  /** The frame's context chip: the live major incident (A2 §5.2.4). */
  readonly context?: ReactNode;
  readonly user: { readonly id: string | null; readonly name: string; readonly detail?: string };
  readonly teams: readonly TeamSummary[];
  readonly can: DeskPermissions;
  readonly children: ReactNode;
}

/** The frame's one sign-out form (`AppShell` renders it); every sign-out path submits it. */
const SIGN_OUT_FORM_ID = 'itsm-signout';
const SIGN_OUT_ACTION = '/api/session/logout';

/**
 * Words the frame shows in a demo, as the contracts word them
 * (`DEMO_COPY.sessionEnded`, `DEMO_COPY.continueDemo`, `SITE.homeLabel`).
 * Spelt out: this module is in every page's first load and the contracts'
 * tables would come with an import; `demo-pages.test.tsx` holds them equal.
 */
export const DESK_DEMO_COPY = {
  sessionEnded: 'Your demo session ended',
  sessionEndedBody: 'Pick up where you left off — the demo data may have been reset since.',
  continueDemo: 'Continue the demo',
} as const;

/** "Knowledge base · Help Portal": the Help menu's and the account menu's way to the articles (A2 §5.2.6). */
export const KNOWLEDGE_LABEL = `Knowledge base · ${HELP_PORTAL_NAME}`;

/* ------------------------------------------------------------- Skip links */

export interface DeskSkipLink {
  readonly label: string;
  readonly targetId: string;
}

const SkipLinkRegistry = createContext<(links: readonly DeskSkipLink[]) => () => void>(() => () => undefined);

/**
 * Adds skip links after "Skip to content" while the caller is mounted — the
 * inbox's "Skip to ticket list", the workspace's "Skip to conversation" and
 * "Skip to reply" (SPEC §6.2). Pages own the targets, so pages say when the
 * links exist; a skip link to nothing is worse than none.
 */
export function useDeskSkipLinks(links: readonly DeskSkipLink[]): void {
  const register = useContext(SkipLinkRegistry);
  const key = JSON.stringify(links);
  useEffect(() => register(JSON.parse(key) as DeskSkipLink[]), [register, key]);
}

/** The same, for a server component to render: `<DeskSkipLinks links={[…]} />`. */
export function DeskSkipLinks({ links }: { readonly links: readonly DeskSkipLink[] }): null {
  useDeskSkipLinks(links);
  return null;
}

/* ----------------------------------------------------------------- Hotkeys */

function GoToHotkey({
  keys,
  href,
  label,
  enabled,
  navigate,
}: {
  readonly keys: string;
  readonly href: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
}): null {
  useHotkey({ keys, handler: () => navigate(href), description: label, group: 'Go to', enabled });
  return null;
}

export interface DeskHotkeysProps {
  readonly canReadTickets: boolean;
  readonly canCreate: boolean;
  /** The places besides the views: the Overview (`g o`) and, once it ships, the Board (`g b`). */
  readonly destinations?: readonly DeskDestination[];
  navigate(href: string): void;
  openNewTicket(): void;
  openSearch(): void;
}

/**
 * The frame's keys (SPEC §5.6; D14 with v3's `g o` and `g b`). `/` focuses
 * the page's own search field when it has one — a page whose `SearchField`
 * binds `/` itself wins, being the newer binding — and otherwise opens the
 * palette, so the key is never dead (F23).
 */
export function DeskHotkeys({ canReadTickets, canCreate, destinations = [], navigate, openNewTicket, openSearch }: DeskHotkeysProps): ReactNode {
  useHotkey({ keys: 'c', handler: () => openNewTicket(), description: 'New ticket', group: 'General', enabled: canCreate });
  useHotkey({
    keys: '/',
    handler: () => {
      const field = document.querySelector<HTMLInputElement>('main input[type="search"]');
      if (field) field.focus();
      else openSearch();
    },
    description: 'Search this page',
    group: 'General',
  });
  return (
    <>
      {destinations.map((place) => (
        <GoToHotkey key={place.id} keys={place.shortcut} href={place.href} label={place.label} enabled navigate={navigate} />
      ))}
      {VIEWS.map((view: ViewDefinition) => (
        <GoToHotkey
          key={view.id}
          keys={view.shortcut}
          href={viewPath({ kind: 'view', id: view.id })}
          label={view.label}
          enabled={canReadTickets}
          navigate={navigate}
        />
      ))}
    </>
  );
}

/* ---------------------------------------------------------- Phone tab bar */

export interface DeskTabActions {
  openSearch(): void;
  /** The navigation sheet is open: More draws itself current. */
  readonly sheetOpen: boolean;
  /** A danger count in the navigation: More shows its dot. */
  readonly attention: boolean;
}

/**
 * The phone's tab bar (A2 §7.1, v3 §3.6): the links the server offered —
 * Overview, My work and, once `/board` ships, Board — then Search and More,
 * which are buttons that open the palette and the navigation sheet, so a
 * phone reaches everything with no ☰ hunt. Four tabs while the Board is
 * pending, five after.
 */
export function deskTabs(links: readonly NavItem[], actions: DeskTabActions): TabItem[] {
  return [
    ...links,
    { id: 'search', label: 'Search', icon: 'search', haspopup: 'dialog', onSelect: actions.openSearch },
    {
      id: 'more',
      label: 'More',
      icon: 'menu',
      haspopup: 'dialog',
      controls: NAV_SHEET_ID,
      expanded: actions.sheetOpen,
      onSelect: () => setNavigationSheetOpen(true),
      ...(actions.attention ? { dot: { label: 'something needs you' } } : {}),
    },
  ];
}

/* ------------------------------------------------------------ Lazy pieces */

const LazyPalette = dynamic(() => import('./DeskPalette.js'), { ssr: false });
const LazyNewTicketSheet = dynamic(() => import('../workspace/NewTicketSheet.js'), { ssr: false });
const LazyConfirmDialog = dynamic(() => import('@itsm/ui/overlays').then((module) => module.ConfirmDialog), { ssr: false });

/** A component that is mounted the first time it is wanted, and stays mounted (so it can animate closed). */
function useWanted(): [boolean, boolean, (open: boolean) => void] {
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const change = useCallback((next: boolean) => {
    if (next) setWanted(true);
    setOpen(next);
  }, []);
  return [wanted, open, change];
}

/**
 * "Sign in again" for a page: the login route, told to come back here. In a
 * demo it says so (`demo=1`, the shape of `signInAgainHref` in
 * `@itsm/contracts/demo`), and the BFF reopens the demo instead of sending
 * a visitor to an identity provider (A3-S2).
 */
export function signInHrefFor(path: string, demo: boolean): string {
  const query = new URLSearchParams({ redirectTo: path });
  if (demo) query.set('demo', '1');
  return `/api/session/login?${query.toString()}`;
}

/** The sign-in link for this page, kept current as the person moves around. */
function useSignInHref(demo: boolean): string {
  const pathname = usePathname();
  const [href, setHref] = useState(() => signInHrefFor('/', demo));
  useEffect(() => {
    setHref(signInHrefFor(`${window.location.pathname}${window.location.search}`, demo));
  }, [pathname, demo]);
  return href;
}

function submitSignOut(): void {
  let form = document.getElementById(SIGN_OUT_FORM_ID);
  if (!(form instanceof HTMLFormElement)) {
    form = Object.assign(document.createElement('form'), { method: 'post', action: SIGN_OUT_ACTION, hidden: true });
    document.body.append(form);
  }
  (form as HTMLFormElement).requestSubmit();
}

/** What sign-out forgets on this device besides caches, the outbox and drafts: recents, pins, dismissed notices, disclosure memory. */
export function isPersonalKey(key: string): boolean {
  return isRecentsKey(key) || isDismissalKey(key) || isDisclosureKey(key) || key.startsWith('itsm-wb-');
}

/* ------------------------------------------------------------------- Frame */

export function DeskShell({ areas, frame, workspace, demoBar, context, user, teams, can, children }: DeskShellProps): ReactNode {
  const { router } = useItsm();
  const { prefs, setPrefs } = useTheme();
  const pathname = usePathname();
  const demo = areas.demo;
  const signInHref = useSignInHref(demo);

  /* Counts: on mount, every minute, on focus, and after live ticket changes. */
  const teamIds = useMemo(() => teams.map((team) => team.id), [teams]);
  const counts = useQuery({
    queryKey: deskKeys.counts(),
    queryFn: ({ signal }) => fetchDeskCounts(teamIds, signal),
    enabled: can.readTickets,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: shouldRetry,
  });
  useCountsFollowLive();
  const nav = useMemo(() => navWithCounts(frame.nav, counts.data?.counts ?? {}), [frame.nav, counts.data]);

  /* The palette, the new-ticket sheet and the sign-out question, each loaded on first use. */
  const [paletteWanted, paletteOpen, setPaletteOpen] = useWanted();
  const [sheetWanted, sheetOpen, setSheetOpen] = useWanted();
  const openPalette = useCallback(() => setPaletteOpen(true), [setPaletteOpen]);
  const openNewTicket = useCallback(() => {
    if (can.createTickets) setSheetOpen(true);
  }, [can.createTickets, setSheetOpen]);
  const navigate = useCallback((href: string) => router.push(href), [router]);

  // The manifest's "New ticket" shortcut and the palette's links arrive as `?new=1`.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') !== '1') return;
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    openNewTicket();
  }, [pathname, openNewTicket]);

  /* Availability, shared by the pill, the account menu and the palette. */
  const availability = useAvailability({ userId: user.id, canRead: can.readAvailability, canSet: can.setAvailability });

  /* Connection: the live stream's state, the outbox's queue, and whether the session has ended. */
  const live = useLiveState();
  const outbox = useOutbox();
  const countsRefused = counts.error instanceof ApiError && counts.error.status === 401;
  const sessionEnded = live.state === 'ended' || countsRefused;
  const connection = sessionEnded ? 'ended' : !outbox.online ? 'offline' : live.state;
  const signIn = useCallback(() => window.location.assign(signInHref), [signInHref]);

  /* Skip links that pages add while they are mounted. */
  const [extraSkipLinks, setExtraSkipLinks] = useState<readonly (readonly DeskSkipLink[])[]>([]);
  const registerSkipLinks = useCallback((links: readonly DeskSkipLink[]) => {
    setExtraSkipLinks((current) => [...current, links]);
    return () => setExtraSkipLinks((current) => current.filter((entry) => entry !== links));
  }, []);
  const skipLinks = useMemo(() => {
    const seen = new Set<string>();
    return extraSkipLinks.flat().filter((link) => !seen.has(link.targetId) && seen.add(link.targetId));
  }, [extraSkipLinks]);

  /* Sign-out: ask about unsent work, forget this device's copies, then post the form. */
  const [discarding, setDiscarding] = useState<{ count: number; resolve(ok: boolean): void } | null>(null);
  const discardingRef = useRef(discarding);
  discardingRef.current = discarding;
  const beforeSignOut = useCallback(async (): Promise<boolean> => {
    try {
      const items = await (await outboxStore()).all();
      const unsent = pendingCount(items) + needsAttention(items).length;
      if (unsent > 0) {
        const ok = await new Promise<boolean>((resolve) => setDiscarding({ count: unsent, resolve }));
        if (!ok) return false;
      }
    } catch {
      // An unreadable outbox has nothing to lose; sign out regardless.
    }
    await clearLocalData({ alsoKeys: isPersonalKey }).catch(() => undefined);
    return true;
  }, []);
  const signOut = useCallback(() => {
    void beforeSignOut().then((ok) => {
      if (ok) submitSignOut();
    });
  }, [beforeSignOut]);
  const closeDiscard = useCallback((ok: boolean) => {
    discardingRef.current?.resolve(ok);
    setDiscarding(null);
  }, []);

  /* The phone's tab bar: the server's links, then Search and More. */
  const navigationSheetOpen = useNavigationSheetOpen();
  const attention = hasDangerCount(nav);
  const bottomTabs = useMemo(
    () => deskTabs(frame.tabs, { openSearch: openPalette, sheetOpen: navigationSheetOpen, attention }),
    [frame.tabs, openPalette, navigationSheetOpen, attention],
  );

  /* Help (A2 §5.2.6): the articles in the Help Portal, the keys, and in a demo the site. */
  const { links } = frame;
  const help = useMemo<MenuItemSpec[]>(
    () => [
      ...(links.knowledge
        ? [{ id: 'knowledge', label: KNOWLEDGE_LABEL, icon: 'knowledge' as const, href: links.knowledge, ...(links.knowledgePersona ? { description: links.knowledgePersona } : {}) }]
        : []),
      { id: 'shortcuts', label: 'Keyboard shortcuts…', icon: 'keyboard', shortcut: '?', onSelect: () => setShortcutsDialogOpen(true) },
      ...(links.howItWorks ? [{ id: 'how-it-works', label: 'How the demo works', icon: 'help' as const, href: links.howItWorks }] : []),
      ...(links.home ? [{ id: 'home', label: links.home.label, icon: 'home' as const, href: links.home.href }] : []),
    ],
    [links],
  );

  /* The account menu's own entry (A2 §8): availability, so a phone can set it too. */
  const { status: availabilityStatus, set: setAvailability } = availability;
  const accountItems = useMemo<MenuItemSpec[]>(
    () =>
      can.setAvailability
        ? [
            {
              type: 'radio',
              id: 'availability',
              label: 'Availability',
              value: availabilityStatus ?? '',
              items: AVAILABILITY_CHOICES,
              onValueChange: (value: string) => setAvailability(value as AvailabilityChoice),
            },
          ]
        : [],
    [can.setAvailability, availabilityStatus, setAvailability],
  );

  /* The palette's view of all of the above. */
  const paletteDeps = useMemo<DeskPaletteDeps>(
    () => ({
      canReadTickets: can.readTickets,
      canSearch: can.search,
      canCreate: can.createTickets,
      canSetAvailability: can.setAvailability,
      canReadPeople: can.readPeople,
      teams,
      destinations: frame.destinations,
      switchArea: frame.switchArea,
      prefs,
      setPrefs,
      openNewTicket,
      openShortcuts: () => setShortcutsDialogOpen(true),
      signOut,
      setAvailability: (status) => availability.set(status),
      searchTickets: async (query) => (await api.tickets({ q: query, limit: 5 })).data,
      searchPeople: async (query) => api.users({ q: query, limit: 5 }),
    }),
    [can, teams, frame.destinations, frame.switchArea, prefs, setPrefs, openNewTicket, signOut, availability.set],
  );

  return (
    <SkipLinkRegistry value={registerSkipLinks}>
      <AppShell
        variant="sidebar"
        areas={areas}
        brand={{ href: areas.areas.find((area) => area.current)?.href ?? '/overview', ...(workspace ? { workspace } : {}) }}
        nav={nav}
        {...(demoBar ? { systemBar: <DemoBarSlot {...demoBar} clearKeys={isPersonalKey} /> } : {})}
        {...(context ? { context } : {})}
        help={{ items: help }}
        sidebarAction={
          can.createTickets ? (
            <Button variant="primary" iconStart="compose" iconEnd={<Kbd keys="c" size="sm" aria-hidden />} aria-keyshortcuts="C" onClick={openNewTicket}>
              New ticket
            </Button>
          ) : undefined
        }
        topBarAction={can.createTickets ? <IconButton label="New ticket" icon="compose" shortcut="c" onClick={openNewTicket} /> : undefined}
        search={{ placeholder: 'Search', shortcut: 'mod+k' }}
        onOpenSearch={openPalette}
        bell={<DeskNotifications {...(links.notificationSettings ? { settingsHref: links.notificationSettings } : {})} />}
        status={
          <ConnectionStatus
            state={connection}
            pending={outbox.pending}
            attention={outbox.attention.map((item) => ({
              id: item.id,
              summary: item.summary,
              ...(item.problem ? { problem: item.problem } : {}),
              state: item.status === 'conflict' ? 'conflict' : 'failed',
            }))}
            onRetry={(id) => void outbox.retry(id)}
            onDiscard={(id) => void outbox.dismiss(id)}
            onSignIn={signIn}
          />
        }
        footerExtra={can.setAvailability ? <AvailabilityPill availability={availability} /> : undefined}
        user={{
          name: user.name,
          ...(user.detail ? { detail: user.detail } : {}),
          items: accountItems,
          appearance: true,
          density: true,
          shortcuts: true,
          ...(links.knowledge ? { help: { href: links.knowledge, label: KNOWLEDGE_LABEL } } : {}),
          signOut: { action: SIGN_OUT_ACTION, beforeSubmit: beforeSignOut },
          ...(demo ? { demo: { resetEvent: DEMO_RESET_REQUEST_EVENT } } : {}),
        }}
        banner={
          sessionEnded ? (
            <GlobalBanner
              tone="warning"
              icon="log-in"
              title={demo ? DESK_DEMO_COPY.sessionEnded : 'Your session ended'}
              body={demo ? DESK_DEMO_COPY.sessionEndedBody : 'Sign in again to carry on. Anything you were writing is kept on this device.'}
              action={{ id: 'sign-in', label: demo ? DESK_DEMO_COPY.continueDemo : 'Sign in again' }}
              onAction={signIn}
              live="polite"
            />
          ) : undefined
        }
        bottomTabs={bottomTabs}
        skipLinks={skipLinks}
      >
        <DeskHotkeys
          canReadTickets={can.readTickets}
          canCreate={can.createTickets}
          destinations={frame.destinations}
          navigate={navigate}
          openNewTicket={openNewTicket}
          openSearch={openPalette}
        />
        {children}
        {paletteWanted ? <LazyPalette open={paletteOpen} onOpenChange={setPaletteOpen} deps={paletteDeps} /> : null}
        {sheetWanted ? <LazyNewTicketSheet open={sheetOpen} onOpenChange={setSheetOpen} /> : null}
        {discarding ? (
          <LazyConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) closeDiscard(false);
            }}
            spec={{
              title: `Sign out and discard ${discarding.count === 1 ? 'an unsent item' : `${discarding.count} unsent items`}?`,
              body: 'They haven’t reached the service yet. Signing out removes them from this device.',
              confirmLabel: 'Sign out and discard',
              cancelLabel: 'Stay signed in',
              tone: 'danger',
            }}
            onConfirm={async () => closeDiscard(true)}
          />
        ) : null}
      </AppShell>
    </SkipLinkRegistry>
  );
}
