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
import { clearLocalData, needsAttention, outboxStore, pendingCount, useOutbox } from '@itsm/pwa';
import { useLiveState } from '@itsm/pwa/live';
import { ApiError } from '@itsm/sdk';
import {
  ConnectionStatus,
  GlobalBanner,
  IconButton,
  isDisclosureKey,
  isDismissalKey,
  isRecentsKey,
  useHotkey,
  useItsm,
} from '@itsm/ui';
import { AppShell, setShortcutsDialogOpen, type AppSwitcherItem } from '@itsm/ui/shell';
import { useTheme } from '@itsm/ui/theme';
import { api, fetchDeskCounts } from '../client/api.js';
import { useCountsFollowLive } from '../client/live.js';
import type { DeskPaletteDeps } from '../client/palette.js';
import { deskKeys, shouldRetry } from '../client/query-client.js';
import { VIEWS, deskNavModel, viewPath, type TeamSummary, type ViewDefinition } from '../inbox/views.js';
import { AvailabilityPill, useAvailability } from './AvailabilityPill.js';
import { DeskNotifications } from './DeskNotifications.js';

/**
 * The workbench frame (SPEC §5.3, D7, D9): the design system's sidebar
 * shell with the views and their counts, the compose button, search (⌘K),
 * the bell, the connection pill, availability and the account menu.
 *
 * Rendered by the `(desk)` layout with plain data — the person's name, their
 * teams, permission booleans — and nothing else; everything that is a
 * function lives here, on the client side of the boundary.
 *
 * What the frame owns, and pages do not:
 *   - the keyboard map's global keys (`c`, `/`, `g` + a view) — `mod+K`, `?`
 *     and `[` are the design system's own;
 *   - the palette (loaded on first use) and the new-ticket sheet (likewise);
 *   - "Your session ended": a persistent banner when the live stream or a
 *     background read hears a 401, never a dialog that steals focus (D15);
 *   - sign-out, which first clears this device's copies of the person's
 *     work (F19) and asks before discarding replies that have not been sent.
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
  readonly tenantName?: string;
  readonly switcher: readonly AppSwitcherItem[];
  readonly user: { readonly id: string | null; readonly name: string; readonly detail?: string };
  readonly teams: readonly TeamSummary[];
  readonly can: DeskPermissions;
  readonly children: ReactNode;
}

/** The frame's one sign-out form (`AppShell` renders it); every sign-out path submits it. */
const SIGN_OUT_FORM_ID = 'itsm-signout';
const SIGN_OUT_ACTION = '/api/session/logout';

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

function GoToHotkey({ view, enabled, navigate }: { readonly view: ViewDefinition; readonly enabled: boolean; readonly navigate: (href: string) => void }): null {
  useHotkey({
    keys: view.shortcut,
    handler: () => navigate(viewPath({ kind: 'view', id: view.id })),
    description: view.label,
    group: 'Go to',
    enabled,
  });
  return null;
}

export interface DeskHotkeysProps {
  readonly canReadTickets: boolean;
  readonly canCreate: boolean;
  navigate(href: string): void;
  openNewTicket(): void;
  openSearch(): void;
}

/**
 * The frame's keys (SPEC §5.6). `/` focuses the page's own search field
 * when it has one — a page whose `SearchField` binds `/` itself wins, being
 * the newer binding — and otherwise opens the palette, so the key is never
 * dead (F23).
 */
export function DeskHotkeys({ canReadTickets, canCreate, navigate, openNewTicket, openSearch }: DeskHotkeysProps): ReactNode {
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
      {VIEWS.map((view) => (
        <GoToHotkey key={view.id} view={view} enabled={canReadTickets} navigate={navigate} />
      ))}
    </>
  );
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

/** `/api/session/login?redirectTo=<this page>`, kept current as the person moves around. */
function useSignInHref(): string {
  const pathname = usePathname();
  const [href, setHref] = useState('/api/session/login');
  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    setHref(`/api/session/login?redirectTo=${encodeURIComponent(here)}`);
  }, [pathname]);
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

export function DeskShell({ tenantName, switcher, user, teams, can, children }: DeskShellProps): ReactNode {
  const { router } = useItsm();
  const { prefs, setPrefs } = useTheme();
  const pathname = usePathname();
  const signInHref = useSignInHref();

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
  const nav = useMemo(
    () => deskNavModel({ canReadTickets: can.readTickets, teams, counts: counts.data?.counts ?? {} }),
    [can.readTickets, teams, counts.data],
  );

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

  /* Availability, shared by the pill and the palette. */
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

  /* The palette's view of all of the above. */
  const paletteDeps = useMemo<DeskPaletteDeps>(
    () => ({
      canReadTickets: can.readTickets,
      canSearch: can.search,
      canCreate: can.createTickets,
      canSetAvailability: can.setAvailability,
      canReadPeople: can.readPeople,
      teams,
      prefs,
      setPrefs,
      openNewTicket,
      openShortcuts: () => setShortcutsDialogOpen(true),
      signOut,
      setAvailability: (status) => availability.set(status),
      searchTickets: async (query) => (await api.tickets({ q: query, limit: 5 })).data,
      searchPeople: async (query) => api.users({ q: query, limit: 5 }),
    }),
    [can, teams, prefs, setPrefs, openNewTicket, signOut, availability.set],
  );

  return (
    <SkipLinkRegistry value={registerSkipLinks}>
      <AppShell
        variant="sidebar"
        brand={{ name: 'Workbench', ...(tenantName ? { tenant: tenantName } : {}), href: '/inbox', app: 'workbench', switcher }}
        nav={nav}
        sidebarHeaderExtra={
          can.createTickets ? <IconButton label="New ticket" icon="compose" shortcut="c" onClick={openNewTicket} /> : undefined
        }
        search={{ placeholder: 'Search', shortcut: 'mod+k' }}
        onOpenSearch={openPalette}
        bell={<DeskNotifications />}
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
          appearance: true,
          density: true,
          shortcuts: true,
          signOut: { action: SIGN_OUT_ACTION, beforeSubmit: beforeSignOut },
        }}
        banner={
          sessionEnded ? (
            <GlobalBanner
              tone="warning"
              icon="log-in"
              title="Your session ended"
              body="Sign in again to carry on. Anything you were writing is kept on this device."
              action={{ id: 'sign-in', label: 'Sign in again' }}
              onAction={signIn}
              live="polite"
            />
          ) : undefined
        }
        skipLinks={skipLinks}
      >
        <DeskHotkeys
          canReadTickets={can.readTickets}
          canCreate={can.createTickets}
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
