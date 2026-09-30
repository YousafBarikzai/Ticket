'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { useStableId } from '../a11y/ids.js';
import type { SheetProps } from '../overlays/Sheet.js';
import { useMediaQuery } from '../overlays/media.js';
import type { PageInfo } from '../shell/context.js';
import { FrameRoot, ShellMain as Main, type AppShellFrameProps } from '../shell/frame.js';
import { fetchModule, lazyModule } from '../shell/lazy.js';
import { usePathnameSafe } from '../shell/location.js';
import { SearchTrigger } from '../shell/SearchTrigger.js';
import { Sidebar } from '../shell/Sidebar.js';
import { TopBar } from '../shell/TopBar.js';
import { TopNavFrame } from '../shell/TopNavFrame.js';
import { UserMenu } from '../shell/UserMenu.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { IconButton } from './IconButton.js';
import { cx } from './cx.js';

// The frame's props live with the parts every variant shares (`shell/frame.tsx`).
export type { AppShellFrameProps } from '../shell/frame.js';

/* =========================================================================
 * AppShell v2 — the application frame (SPEC §4.9)
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
 * The sidebar frame (admin, workbench)
 * ---------------------------------------------------------------------- */

function SidebarFrame({ props, page, mainId }: { readonly props: AppShellFrameProps; readonly page: PageInfo | null; readonly mainId: string }): ReactNode {
  const { brand, nav, sidebarHeaderExtra, search, onOpenSearch, bell, status, footerExtra, user, banner, children } = props;
  const { prefs, setPrefs } = useTheme();
  const wide = useMediaQuery(XL_UP, true);
  const rail = prefs.nav === 'rail';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [Sheet, loadSheet] = useLazySheet();
  const pathname = usePathnameSafe();
  const sheetId = useStableId('itsm-nav-sheet');

  // A link followed inside the sheet closes it: the new page is the answer.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setSheetOpen(false);
  }, [pathname]);

  const openSheet = useCallback(() => {
    loadSheet();
    setSheetOpen(true);
  }, [loadSheet]);

  // `[` and the PanelLeft button: at 1280 px and up they collapse the sidebar
  // to the rail (remembered, D9); narrower, where the rail or the sheet is
  // the only choice, they show the whole sidebar as a sheet.
  const toggle = useCallback(() => {
    const isWide = typeof window.matchMedia === 'function' ? window.matchMedia(XL_UP).matches : true;
    if (isWide) setPrefs({ nav: rail ? 'auto' : 'rail' });
    else if (sheetOpen) setSheetOpen(false);
    else openSheet();
  }, [openSheet, rail, setPrefs, sheetOpen]);

  useHotkey({ keys: '[', handler: toggle, description: 'Collapse or expand the sidebar', group: 'Navigation' });

  const toggleLabel = wide ? (rail ? 'Expand sidebar' : 'Collapse sidebar') : 'Show full navigation';

  return (
    <>
      <TopBar
        className="itsm-AppShell__compactBar"
        start={
          <IconButton
            icon="menu"
            label="Open navigation"
            variant="ghost"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-controls={sheetOpen ? sheetId : undefined}
            onPointerEnter={loadSheet}
            onFocus={loadSheet}
            onClick={openSheet}
          />
        }
        title={page?.title ?? brand.name}
        end={
          <>
            {search ? <SearchTrigger display="icon" placeholder={search.placeholder} shortcut={search.shortcut ?? 'mod+k'} bindShortcut={false} onOpen={onOpenSearch} /> : null}
            {status ? <div className="itsm-AppShell__status">{status}</div> : null}
            {bell}
            <UserMenu {...user} />
          </>
        }
      />
      <div className="itsm-AppShell__sidebar">
        <Sidebar
          mode="docked"
          brand={brand}
          nav={nav}
          headerExtra={sidebarHeaderExtra}
          search={search}
          onOpenSearch={onOpenSearch}
          bell={bell}
          status={status}
          footerExtra={footerExtra}
          user={user}
          toggle={{ label: toggleLabel, onToggle: toggle }}
        />
      </div>
      <div className="itsm-AppShell__panel">
        {banner ? <div className="itsm-AppShell__banner">{banner}</div> : null}
        <Main id={mainId}>{children}</Main>
      </div>
      {Sheet ? (
        <Sheet
          open={sheetOpen}
          onOpenChange={(next) => setSheetOpen(next)}
          side="start"
          size="sm"
          title={brand.name}
          {...(brand.tenant ? { description: brand.tenant } : {})}
          className="itsm-AppShell__navSheet"
        >
          <div id={sheetId}>
            <Sidebar mode="sheet" brand={brand} nav={nav} headerExtra={sidebarHeaderExtra} status={status} footerExtra={footerExtra} user={user} />
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------
 * The frame
 * ---------------------------------------------------------------------- */

/**
 * The application frame every signed-in page sits in: landmarks, skip links,
 * navigation, search, the bell, connection status and the account menu —
 * the same parts in the same places in all three apps.
 *
 * **`sidebar`** (admin, workbench). At 1280 px and up a 248 px opaque
 * sidebar on the canvas beside an inset content panel; the window scrolls
 * and the sidebar stays put (`sticky`, full height). `[` or the PanelLeft
 * button collapses it to the 64 px rail, remembered on this device
 * (`prefs.nav`); 1024–1279 px is always the rail. Below 1024 px a 52 px
 * compact bar on glass (☰, the page's title, search, status, bell, account)
 * replaces it, and ☰ opens the sidebar as a modal sheet from the start edge,
 * which closes on navigation. The brand, search and bell live in the
 * sidebar's header — there is no global top bar on wide screens (D7).
 *
 * **`topnav`** (portal). A 52 px glass top bar: brand, centred pills (the
 * current one on an opaque pill), search, *New request*, status, bell,
 * account. Below 768 px the pills give way to a docked tab bar, and inner
 * pages put "‹ Back" and their title where the brand was.
 *
 * Both: skip links first; `header` (banner), `nav`, `main`; nothing with
 * `role="status"` before `main`; ⌘K bound to `onOpenSearch` (inside fields
 * too); `?` opens the keyboard shortcuts; one hidden sign-out form for the
 * page's account menus. Pages report their title and way back through
 * `PageHeader`, which the compact bars show.
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
      frame={(page, mainId) =>
        props.variant === 'sidebar' ? <SidebarFrame props={props} page={page} mainId={mainId} /> : <TopNavFrame props={props} page={page} mainId={mainId} />
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
