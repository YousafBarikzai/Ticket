'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLiveState } from '@itsm/pwa/live';
import { Button } from '@itsm/ui';
import { TopNavShell, type AppSwitcherItem } from '@itsm/ui/shell';
import { useTheme } from '@itsm/ui/theme';
import { api } from '../client/api.js';
import type { PortalPaletteDeps } from '../client/palette.js';
import { onSessionEnded, type SessionEndedHow } from '../client/useAction.js';
import { showsNewRequest, type PortalCan, type PortalFrameModel } from '../navigation.js';
import { PortalNotifications } from './PortalNotifications.js';

/**
 * The portal frame (SPEC §5.4, D7, D17): the design system's top-nav shell
 * (`TopNavShell` — `AppShell variant="topnav"` without the sidebar variant in
 * the first load) — a glass top bar with the brand, the four pills (Home, My requests,
 * Services, Knowledge), search (⌘K), *New request*, the connection pill, the
 * bell and the avatar menu — and below 768 px the docked tab bar with *Me*
 * as its fifth tab.
 *
 * Rendered by the `(portal)` layout with plain data (names, the navigation
 * model, permission booleans); everything that is a function lives here, on
 * the client side of the boundary.
 *
 * What the frame owns, and pages do not:
 *   - **"How can we help?"** — *New request* opens it, and so does anything
 *     on a page that calls `useHelpFlow().open(…)` ("Report 'vpn' as an
 *     issue", "Report it again"). The sheet is loaded on first use and
 *     prefetched when the browser is idle; offline, *New request* goes to
 *     the cached `/report` page instead, which queues.
 *   - the palette (loaded on first ⌘K, likewise);
 *   - "Your session ended": a persistent banner when the live stream or a
 *     background read hears a 401; an alert dialog when something the person
 *     just did did (D15) — either way, what they typed stays;
 *   - "You're offline. This is the copy from 10:42." — what a page shows
 *     when the network is gone is at least honest about its age;
 *   - sign-out, which first forgets this device's copies of the person's
 *     requests (F19) and asks before discarding anything not yet sent.
 */

/* --------------------------------------------------------- The help flow */

/** How a page opens "How can we help?": at the start, or at the details step with a title. */
export interface HelpFlowRequest {
  readonly step?: 'describe' | 'details';
  /** What the person typed, for step 1's field or step 2's title. */
  readonly text?: string;
}

export interface HelpFlow {
  /** Opens the flow — or, offline, the cached `/report` page. Does nothing without `ticket.create`. */
  open(request?: HelpFlowRequest): void;
  /** Whether the person may report anything at all (`ticket.create`). */
  readonly available: boolean;
}

const HelpFlowContext = createContext<HelpFlow>({
  open: () => window.location.assign('/report'),
  available: false,
});

/** "How can we help?", from anywhere inside the frame. */
export function useHelpFlow(): HelpFlow {
  return useContext(HelpFlowContext);
}

/* ------------------------------------------------------------ Lazy pieces */

const loadPalette = () => import('./PortalPalette.js');
const loadHelpSheet = () => import('../help/HelpSheet.js');
const loadStatus = () => import('./PortalStatus.js');
const LazyPalette = dynamic(loadPalette, { ssr: false });
const LazyHelpSheet = dynamic(loadHelpSheet, { ssr: false });
// Loaded right after hydration by the providers (the service worker lives there too): nothing on first paint.
const LazyConnectionPill = dynamic(() => loadStatus().then((module) => module.ConnectionPill), { ssr: false });
const LazyConnectionBanner = dynamic(() => loadStatus().then((module) => module.ConnectionBanner), { ssr: false });
const LazyConfirmDialog = dynamic(() => import('@itsm/ui/overlays').then((module) => module.ConfirmDialog), { ssr: false });
const LazyDialog = dynamic(() => import('@itsm/ui/overlays').then((module) => module.Dialog), { ssr: false });

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

/** When the browser has a quiet moment: fetch what the first press will want, so it opens at once (and offline). */
function useIdlePrefetch(loaders: readonly (() => Promise<unknown>)[]): void {
  useEffect(() => {
    const run = (): void => {
      for (const load of loaders) void load().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: 8000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(run, 4000);
    return () => window.clearTimeout(handle);
  }, [loaders]);
}

const PREFETCH = [loadHelpSheet, loadPalette] as const;

const noSubscription = (): (() => void) => () => undefined;

/**
 * False on the server and while hydrating, true straight after. The lazy
 * status pieces mount only then: rendered on the server they would leave a
 * placeholder in their slot, and the slot would take up room until
 * hydration — a small jump on every page.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * When the page on screen was drawn by the server, for "This is the copy
 * from 10:42": the layout's time on a full load (a page the service worker
 * served from its cache carries the time it was cached), then the time of
 * each navigation made while online.
 */
function useCopyTime(renderedAt: string): string {
  const pathname = usePathname();
  const [at, setAt] = useState(renderedAt);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (navigator.onLine) setAt(new Date().toISOString());
  }, [pathname]);
  return at;
}

/** `navigator.onLine`, followed; true on the server. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (change) => {
      window.addEventListener('online', change);
      window.addEventListener('offline', change);
      return () => {
        window.removeEventListener('online', change);
        window.removeEventListener('offline', change);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/* --------------------------------------------------------------- Sign-out */

const SIGN_OUT_ACTION = '/api/session/logout';
const SIGN_OUT_FORM_ID = 'itsm-signout';

function submitSignOut(): void {
  let form = document.getElementById(SIGN_OUT_FORM_ID);
  if (!(form instanceof HTMLFormElement)) {
    form = Object.assign(document.createElement('form'), { method: 'post', action: SIGN_OUT_ACTION, hidden: true });
    document.body.append(form);
  }
  (form as HTMLFormElement).requestSubmit();
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

/* ------------------------------------------------------------------ Frame */

export interface PortalShellProps {
  readonly user: { readonly id: string | null; readonly name: string; readonly detail?: string };
  readonly tenantName?: string;
  readonly frame: PortalFrameModel;
  readonly switcher: readonly AppSwitcherItem[];
  readonly can: PortalCan;
  readonly approvalsWaiting: number;
  /** When the server drew this page (ISO), for the offline banner. */
  readonly renderedAt: string;
  readonly children: ReactNode;
}

export function PortalShell({ user, tenantName, frame, switcher, can, approvalsWaiting, renderedAt, children }: PortalShellProps): ReactNode {
  const { prefs, setPrefs } = useTheme();
  const pathname = usePathname();
  const signInHref = useSignInHref();
  useIdlePrefetch(PREFETCH);

  /* "How can we help?" and the palette, each loaded on first use. */
  const [helpWanted, helpOpen, setHelpOpen] = useWanted();
  const [helpRequest, setHelpRequest] = useState<HelpFlowRequest | undefined>(undefined);
  const openHelp = useCallback(
    (request?: HelpFlowRequest) => {
      if (!can.createTickets) return;
      // Offline, the sheet's code may never have arrived; the report page is cached and queues.
      if (!navigator.onLine) {
        window.location.assign('/report');
        return;
      }
      setHelpRequest(request);
      setHelpOpen(true);
    },
    [can.createTickets, setHelpOpen],
  );
  const helpFlow = useMemo<HelpFlow>(() => ({ open: openHelp, available: can.createTickets }), [openHelp, can.createTickets]);

  const [paletteWanted, paletteOpen, setPaletteOpen] = useWanted();
  const openPalette = useCallback(() => setPaletteOpen(true), [setPaletteOpen]);

  /* Whether the session has ended: the live stream heard it, or a read or an action did. */
  const live = useLiveState();
  const [ended, setEnded] = useState<SessionEndedHow | null>(null);
  useEffect(() => onSessionEnded((how) => setEnded((previous) => (previous === 'action' ? previous : how))), []);
  const sessionEnded = live.state === 'ended' || ended !== null;
  const signIn = useCallback(() => window.location.assign(signInHref), [signInHref]);
  const signInRef = useRef<HTMLButtonElement | null>(null);
  const hydrated = useHydrated();
  const online = useOnline();
  const copyAt = useCopyTime(renderedAt);

  /* Sign-out: ask about unsent work, forget this device's copies, then post the form. */
  const [discarding, setDiscarding] = useState<{ count: number; resolve(ok: boolean): void } | null>(null);
  const discardingRef = useRef(discarding);
  discardingRef.current = discarding;
  const beforeSignOut = useCallback(async (): Promise<boolean> => {
    const confirmDiscard = (count: number): Promise<boolean> => new Promise<boolean>((resolve) => setDiscarding({ count, resolve }));
    try {
      const { forgetThisDevice } = await loadStatus();
      return await forgetThisDevice(confirmDiscard);
    } catch {
      // The module could not load: sign out anyway — the server session is what matters.
      return true;
    }
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
  const paletteDeps = useMemo<PortalPaletteDeps>(
    () => ({
      can,
      nav: frame.nav.sections.flatMap((section) => section.items),
      approvalsWaiting,
      prefs,
      setPrefs,
      openHelp,
      signOut,
      searchAnswers: async (query) => (await api.search(query, { types: 'knowledge', limit: 4 })).data,
      searchRequests: async (query) => (await api.myTickets({ q: query, limit: 3 })).data,
      services: async () => (await api.catalogue()).data,
    }),
    [can, frame.nav, approvalsWaiting, prefs, setPrefs, openHelp, signOut],
  );

  const banner =
    hydrated && (sessionEnded || !online) ? <LazyConnectionBanner sessionEnded={sessionEnded} onSignIn={signIn} copyAt={copyAt} /> : undefined;

  return (
    <HelpFlowContext value={helpFlow}>
      <TopNavShell
        brand={{ name: 'Help', ...(tenantName ? { tenant: tenantName } : {}), href: '/', app: 'portal', ...(switcher.length > 1 ? { switcher } : {}) }}
        nav={frame.nav}
        search={{ placeholder: 'Search', shortcut: 'mod+k' }}
        onOpenSearch={openPalette}
        bell={<PortalNotifications />}
        status={hydrated ? <LazyConnectionPill sessionEnded={sessionEnded} onSignIn={signIn} /> : undefined}
        user={{
          name: user.name,
          ...(user.detail ? { detail: user.detail } : {}),
          items: frame.menu,
          appearance: true,
          ...(can.readKnowledge ? { help: { href: '/knowledge' } } : {}),
          signOut: { action: SIGN_OUT_ACTION, beforeSubmit: beforeSignOut },
          ...(frame.avatarBadge ? { badge: frame.avatarBadge } : {}),
        }}
        banner={banner}
        bottomTabs={frame.tabs}
        topBarAction={
          showsNewRequest(pathname, can) ? (
            <Button variant="primary" size="sm" shape="capsule" iconStart="compose" onClick={() => openHelp()}>
              New request
            </Button>
          ) : undefined
        }
      >
        {children}
        {paletteWanted ? <LazyPalette open={paletteOpen} onOpenChange={setPaletteOpen} deps={paletteDeps} /> : null}
        {helpWanted ? <LazyHelpSheet open={helpOpen} onOpenChange={setHelpOpen} {...(helpRequest ? { request: helpRequest } : {})} /> : null}
        {discarding ? (
          <LazyConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) closeDiscard(false);
            }}
            spec={{
              title: `Sign out and discard ${discarding.count === 1 ? 'an unsent item' : `${discarding.count} unsent items`}?`,
              body: 'They haven’t reached the service desk yet. Signing out removes them from this device.',
              confirmLabel: 'Sign out and discard',
              cancelLabel: 'Stay signed in',
              tone: 'danger',
            }}
            onConfirm={async () => closeDiscard(true)}
          />
        ) : null}
        {ended === 'action' ? (
          <LazyDialog
            open
            onClose={() => setEnded('background')}
            role="alertdialog"
            initialFocusRef={signInRef}
            size="sm"
            title="Your session ended"
            description="Sign in again to carry on. What you were writing is kept on this device."
            footer={
              <>
                <Button variant="secondary" onClick={() => setEnded('background')}>
                  Not now
                </Button>
                <Button ref={signInRef} variant="primary" onClick={signIn}>
                  Sign in again
                </Button>
              </>
            }
          >
            {null}
          </LazyDialog>
        ) : null}
      </TopNavShell>
    </HelpFlowContext>
  );
}
