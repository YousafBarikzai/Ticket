'use client';

import { useState, type ReactNode } from 'react';
import { cx } from './cx.js';
import { useStableId } from '../a11y/ids.js';
import { IconButton } from './IconButton.js';

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

export interface AppShellProps {
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

/**
 * The landmark skeleton every application screen sits in.
 *
 * Its job is structural, not decorative: one `banner`, one `navigation`, one
 * `main`, an optional `complementary`, and a skip link as the first focusable
 * element on the page (SC 2.4.1) so a keyboard user is not made to walk the
 * whole navigation on every route change. On narrow viewports the navigation
 * collapses behind a disclosure button rather than disappearing.
 */
export function AppShell({
  children,
  brand,
  navItems,
  navLabel = 'Main',
  headerEnd,
  aside,
  asideLabel = 'Supporting information',
  skipLabel = 'Skip to main content',
  className,
}: AppShellProps): ReactNode {
  const ids = { main: useStableId('itsm-main'), nav: useStableId('itsm-nav') };
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={cx('itsm-AppShell', className)}>
      <a className="itsm-AppShell__skipLink" href={`#${ids.main}`}>
        {skipLabel}
      </a>
      <header className="itsm-AppShell__header" role="banner">
        {navItems && navItems.length > 0 ? (
          <IconButton
            className="itsm-AppShell__navToggle"
            size="sm"
            label={navOpen ? 'Hide navigation' : 'Show navigation'}
            icon="☰"
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
            // Collapsed with `display: none` (in the narrow-viewport media
            // query keyed off this attribute) rather than with opacity: a
            // hidden navigation must leave the tab order and the accessibility
            // tree, not linger invisibly in both. On wide viewports the
            // disclosure button is not rendered and the navigation is always
            // shown, which is why the attribute alone cannot hide it.
            data-open={navOpen}
          >
            <ul className="itsm-AppShell__navList">
              {navItems.map((item) => (
                <li key={item.id}>
                  {item.href ? (
                    <a
                      className="itsm-AppShell__navLink"
                      href={item.href}
                      aria-current={item.current ? 'page' : undefined}
                      onClick={item.onSelect}
                    >
                      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                      {item.label}
                      {item.badge ? <span className="itsm-AppShell__navBadge">{item.badge}</span> : null}
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="itsm-AppShell__navLink"
                      aria-current={item.current ? 'page' : undefined}
                      onClick={item.onSelect}
                      style={{ inlineSize: '100%', background: 'none', border: 0, textAlign: 'start', cursor: 'pointer' }}
                    >
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

        {/* tabIndex -1 so the skip link can move focus here, not just the viewport. */}
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
