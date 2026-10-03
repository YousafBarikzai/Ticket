'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { useStableId } from '../a11y/ids.js';
import type { SheetProps } from '../overlays/Sheet.js';
import { useMediaQuery } from '../overlays/media.js';
import { AppTopBar } from '../shell/AppTopBar.js';
import { BottomDockHost } from '../shell/BottomDock.js';
import { frameSidebarAction } from '../shell/compat.js';
import type { PageInfo } from '../shell/context.js';
import { FrameRoot, ShellMain as Main, type AppShellFrameProps } from '../shell/frame.js';
import { fetchModule, lazyModule } from '../shell/lazy.js';
import { usePathnameSafe } from '../shell/location.js';
import { Sidebar } from '../shell/Sidebar.js';
import { TabBar } from '../shell/TabBar.js';
import { TopNavFrame } from '../shell/TopNavFrame.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { IconButton } from './IconButton.js';
import { cx } from './cx.js';

// The frame's props live with the parts every variant shares (`shell/frame.tsx`).
export type { AppShellFrameProps } from '../shell/frame.js';

/* =========================================================================
 * AppShell v3 — the application frame (v3 §3.4–§3.10)
 * ====================================================================== */

/** The legacy frame's navigation entries. */
export interface AppShellNavItem {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
  readonly icon?: ReactNode;
  /** A count, e.g. unread approvals. Announced as part of the link's name. */
  readonly badge?: ReactNode;
  readonly current?: boolean;
}

/** @deprecated The pre-redesign frame's props, kept until the Stage 2 frames move to `variant`. */
export interface LegacyAppShellProps {
  readonly variant?: undefined;
  readonly children: ReactNode;
  readonly brand: ReactNode;
  readonly navItems?: readonly AppShellNavItem[];
  readonly navLabel?: string;
  /** Search, notifications, the theme switch, the account menu. */
  readonly headerEnd?: ReactNode;
  readonly aside?: ReactNode;
  readonly asideLabel?: string;
  readonly skipLabel?: string;
  readonly className?: string;
}

export type AppShellProps = AppShellFrameProps | LegacyAppShellProps;

/** The sidebar's full width begins here (SPEC D9); below it the sidebar is a rail or a sheet. */
const XL_UP = '(min-width: 80rem)';

/** The navigation sheet's `id`: one frame per page, so a tab's `aria-controls` can name it. */
export const NAV_SHEET_ID = 'itsm-nav-sheet';

/* -------------------------------------------------------------------------
 * The navigation sheet, openable from outside the frame
 * ---------------------------------------------------------------------- */

/*
 * The Service Desk's More tab (built in its shell, A2 §7.1) opens the same
 * sheet as ☰, and draws itself current while the sheet is open. One frame per
 * page, so a module-level switch, like the shortcuts dialog's.
 */
let sheetWanted = false;
const sheetListeners = new Set<() => void>();

function subscribeSheet(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
}

/** Opens or closes the sidebar frame's navigation sheet (the More tab, A2 §7.1). */
export function setNavigationSheetOpen(next: boolean): void {
  if (sheetWanted === next) return;
  sheetWanted = next;
  for (const listener of [...sheetListeners]) listener();
}

/** Whether the navigation sheet is open: More draws itself current meanwhile. False on the server. */
export function useNavigationSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheet, () => sheetWanted, () => false);
}

/** The navigation sheet, loaded the first time it is wanted (it is a Radix dialog). */
const sheetModule = lazyModule(() => import('../overlays/Sheet.js'));

function useLazySheet(): [ComponentType<SheetProps> | null, () => void] {
  // Null on the first render everywhere, so hydration agrees; fetched on intent.
  const [Sheet, setSheet] = useState<ComponentType<SheetProps> | null>(null);
  const load = useCallback(() => {
    if (Sheet) return;
    fetchModule(sheetModule).then(
      (module) => setSheet(() => module.Sheet),
      () => undefined,
    );
  }, [Sheet]);
  return [Sheet, load];
}

/* -------------------------------------------------------------------------
 * The sidebar frame (Administration, the Service Desk)
 * ---------------------------------------------------------------------- */

function SidebarFrame({
  props,
  page,
  mainId,
  areas,
}: {
  readonly props: AppShellFrameProps;
  readonly page: PageInfo | null;
  readonly mainId: string;
  readonly areas: AreaModel;
}): ReactNode {
  const { brand, nav, search, onOpenSearch, bell, status, footerExtra, user, banner, bottomTabs, topBarAction, context, help, children } = props;
  const action = frameSidebarAction(props);
  const { prefs, setPrefs } = useTheme();
  const wide = useMediaQuery(XL_UP, true);
  const rail = prefs.nav === 'rail';
  const sheetOpen = useNavigationSheetOpen();
  const [Sheet, loadSheet] = useLazySheet();
  const pathname = usePathnameSafe();

  // Whoever asked for the sheet — ☰, More, Collapse below 1280 — it loads first.
  useEffect(() => {
    if (sheetOpen) loadSheet();
  }, [sheetOpen, loadSheet]);
  // A sheet left open by a page that has gone does not reopen on the next.
  useEffect(() => () => setNavigationSheetOpen(false), []);

  // A link followed inside the sheet closes it: the new page is the answer.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setNavigationSheetOpen(false);
  }, [pathname]);

  const openSheet = useCallback(() => {
    loadSheet();
    setNavigationSheetOpen(true);
  }, [loadSheet]);

  // `[` and Collapse: at 1280 px and up they collapse the sidebar to the rail
  // (remembered, D9); narrower, where the rail or the sheet is the only
  // choice, they show the whole sidebar as a sheet.
  const toggle = useCallback(() => {
    const isWide = typeof window.matchMedia === 'function' ? window.matchMedia(XL_UP).matches : true;
    if (isWide) setPrefs({ nav: rail ? 'auto' : 'rail' });
    else if (sheetOpen) setNavigationSheetOpen(false);
    else openSheet();
  }, [openSheet, rail, sheetOpen, setPrefs]);

  useHotkey({ keys: '[', handler: toggle, description: 'Collapse or expand the sidebar', group: 'Navigation' });

  const collapseLabel = wide ? (rail ? 'Expand sidebar' : 'Collapse') : 'Show full navigation';
  const tabs = bottomTabs && bottomTabs.length > 0 ? bottomTabs : null;

  return (
    <BottomDockHost tabBar={tabs ? <TabBar items={tabs} /> : undefined}>
      <div className="itsm-AppShell__frame">
        <div className="itsm-AppShell__sidebar">
          <Sidebar
            mode="docked"
            areas={areas}
            brand={brand}
            nav={nav}
            action={action}
            status={status}
            footerExtra={footerExtra}
            user={user}
            collapse={{ label: collapseLabel, onToggle: toggle }}
          />
        </div>
        <div className="itsm-AppShell__column">
          <AppTopBar
            areas={areas}
            nav={nav}
            page={page}
            start={
              <IconButton
                className="itsm-AppTopBar__menu"
                icon="menu"
                label="Open navigation"
                variant="ghost"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                aria-controls={sheetOpen ? NAV_SHEET_ID : undefined}
                onPointerEnter={loadSheet}
                onFocus={loadSheet}
                onClick={openSheet}
              />
            }
            context={context}
            search={search}
            onOpenSearch={onOpenSearch}
            bell={bell}
            help={help}
            status={status}
            action={topBarAction}
            user={user}
            tabSearch={tabs !== null}
          />
          {banner ? <div className="itsm-AppShell__banner">{banner}</div> : null}
          <Main id={mainId}>{children}</Main>
        </div>
      </div>
      {Sheet ? (
        <Sheet
          open={sheetOpen}
          onOpenChange={(next) => setNavigationSheetOpen(next)}
          side="start"
          size="sm"
          title={areas.product}
          {...(areas.workspace ? { description: areas.workspace } : {})}
          className="itsm-AppShell__navSheet"
        >
          <div id={NAV_SHEET_ID}>
            <Sidebar mode="sheet" areas={areas} brand={brand} nav={nav} action={action} status={status} footerExtra={footerExtra} user={user} />
          </div>
        </Sheet>
      ) : null}
    </BottomDockHost>
  );
}

/* -------------------------------------------------------------------------
 * The frame
 * ---------------------------------------------------------------------- */

/**
 * The application frame every signed-in page sits in: landmarks, skip links,
 * the system bar, navigation, the top bar, search, the bell, connection
 * status and the account menu — the same parts in the same places in all
 * three areas.
 *
 * **`sidebar`** (Administration, the Service Desk; v3 §3.4). A light 256 px
 * sidebar — brand, Area card, "New ticket", grouped navigation, user card,
 * Collapse — beside a column holding the 56 px top bar (title and purpose,
 * chips, search, bell, Help, account), the banners and `main` on the canvas,
 * centred at 1600 px. The window scrolls; the sidebar and the top bar are
 * sticky under any system bar. `[` or Collapse folds the sidebar to the
 * 72 px rail, remembered on this device (`prefs.nav`); 1024–1279 px is
 * always the rail; below 1024 px ☰ opens the sidebar as a sheet from the
 * start edge, which closes on navigation. Below 768 px a tab bar can dock
 * at the bottom (the Service Desk's).
 *
 * **`topnav`** (the Help Portal; v3 §3.6). A 56 px opaque top bar: the
 * product mark, the area switcher, centred pills, search, *New request*,
 * status, bell, account. Below 768 px the pills give way to a docked tab
 * bar, and inner pages put "‹ Back" and their title where the mark was.
 *
 * Both: skip links first; the system bar (`systemBar`) next, across the
 * window; `header` (banner), `nav`, `main`; nothing with `role="status"`
 * before `main`; ⌘K bound to `onOpenSearch` (inside fields too); `?` opens
 * the keyboard shortcuts; one hidden sign-out form for the page's account
 * menus. Pages report their title, purpose, chips and way back through
 * `PageHeader`.
 *
 * Called without `variant`, it draws the pre-redesign frame for the apps that
 * have not moved yet (deprecated; removed in Stage 5).
 */
export function AppShell(props: AppShellProps): ReactNode {
  if (props.variant === undefined) return <LegacyAppShell {...props} />;
  return <FrameShell {...props} />;
}

function FrameShell(props: AppShellFrameProps): ReactNode {
  return (
    <FrameRoot
      props={props}
      frame={(page, mainId, areas) =>
        props.variant === 'sidebar' ? (
          <SidebarFrame props={props} page={page} mainId={mainId} areas={areas} />
        ) : (
          <TopNavFrame props={props} page={page} mainId={mainId} areas={areas} />
        )
      }
    />
  );
}

/* =========================================================================
 * The pre-redesign frame (deprecated)
 * ====================================================================== */

/**
 * The landmark skeleton the applications use until their Stage 2 frames:
 * one `banner`, one `navigation`, one `main`, an optional `complementary`,
 * and a skip link as the first focusable element (SC 2.4.1). On narrow
 * viewports the navigation collapses behind a disclosure button rather than
 * disappearing.
 *
 * @deprecated Pass `variant` for the redesigned frame.
 */
function LegacyAppShell({
  children,
  brand,
  navItems,
  navLabel = 'Main',
  headerEnd,
  aside,
  asideLabel = 'Supporting information',
  skipLabel = 'Skip to main content',
  className,
}: LegacyAppShellProps): ReactNode {
  const ids = { main: useStableId('itsm-main'), nav: useStableId('itsm-nav') };
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={cx('itsm-AppShell', 'itsm-AppShell--legacy', className)}>
      <a className="itsm-AppShell__skipLink" href={`#${ids.main}`}>
        {skipLabel}
      </a>
      <header className="itsm-AppShell__header" role="banner">
        {navItems && navItems.length > 0 ? (
          <IconButton
            className="itsm-AppShell__navToggle"
            size="sm"
            label={navOpen ? 'Hide navigation' : 'Show navigation'}
            icon="menu"
            aria-expanded={navOpen}
            aria-controls={ids.nav}
            onClick={() => setNavOpen((open) => !open)}
          />
        ) : null}
        <div className="itsm-AppShell__brand">{brand}</div>
        {headerEnd ? <div className="itsm-AppShell__headerEnd">{headerEnd}</div> : null}
      </header>

      <div className="itsm-AppShell__main">
        {navItems && navItems.length > 0 ? (
          <nav
            id={ids.nav}
            className="itsm-AppShell__nav"
            aria-label={navLabel}
            // Collapsed with `display: none` in the narrow-viewport query keyed
            // off this attribute, rather than with opacity: a hidden navigation
            // must leave the tab order and the accessibility tree.
            data-open={navOpen}
          >
            <ul className="itsm-AppShell__navList">
              {navItems.map((item) => (
                <li key={item.id}>
                  {item.href ? (
                    <a className="itsm-AppShell__navLink" href={item.href} aria-current={item.current ? 'page' : undefined} onClick={item.onSelect}>
                      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                      {item.label}
                      {item.badge ? <span className="itsm-AppShell__navBadge">{item.badge}</span> : null}
                    </a>
                  ) : (
                    <button type="button" className="itsm-AppShell__navLink itsm-AppShell__navButton" aria-current={item.current ? 'page' : undefined} onClick={item.onSelect}>
                      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                      {item.label}
                      {item.badge ? <span className="itsm-AppShell__navBadge">{item.badge}</span> : null}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <main id={ids.main} className="itsm-AppShell__content" tabIndex={-1}>
          {children}
        </main>

        {aside ? (
          <aside className="itsm-AppShell__aside" aria-label={asideLabel}>
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
