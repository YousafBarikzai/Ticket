'use client';

import { useMemo, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { BottomDockHost } from './BottomDock.js';
import type { PageInfo } from './context.js';
import { ShellMain as Main, type AppShellFrameProps } from './frame.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, needsSearch, type SearchLike } from './match.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavItem, NavModel } from './nav.js';
import { SearchTrigger } from './SearchTrigger.js';
import { ShellLink } from './ShellLink.js';
import { TabBar } from './TabBar.js';
import { TopBar } from './TopBar.js';
import { UserMenu } from './UserMenu.js';

/**
 * The top-nav frame (portal): a 52 px glass top bar — brand, centred pills
 * (the current one on an opaque pill), search, *New request*, status, bell,
 * account — and below 768 px a docked tab bar, with "‹ Back" and the page's
 * title where the brand was on inner pages. Drawn by `AppShell
 * variant="topnav"` and by `TopNavShell`.
 */

function Pills({ items, currentId }: { readonly items: readonly NavItem[]; readonly currentId: string | null }): ReactNode {
  return (
    <ul className="itsm-AppShell__pillList">
      {items.map((item) => (
        <li key={item.id}>
          <ShellLink href={item.href} className="itsm-AppShell__pill" aria-current={item.id === currentId ? 'page' : undefined}>
            <span className="itsm-AppShell__pillLabel" data-text={item.label}>
              {item.label}
            </span>
            <NavBadgeView badge={item.badge} />
          </ShellLink>
        </li>
      ))}
    </ul>
  );
}

function PillNav({ nav }: { readonly nav: NavModel }): ReactNode {
  const pathname = usePathnameSafe();
  const items = useMemo(() => nav.sections.flatMap((section) => section.items), [nav]);
  const plain = <Pills items={items} currentId={currentItemId(items, pathname)} />;
  return (
    <nav aria-label={nav.label} className="itsm-AppShell__pills">
      {needsSearch(items) ? <WithSearch fallback={plain}>{(search: SearchLike) => <Pills items={items} currentId={currentItemId(items, pathname, search)} />}</WithSearch> : plain}
    </nav>
  );
}

export function TopNavFrame({ props, page, mainId }: { readonly props: AppShellFrameProps; readonly page: PageInfo | null; readonly mainId: string }): ReactNode {
  const { brand, nav, search, onOpenSearch, bell, status, user, banner, bottomTabs, topBarAction, children } = props;
  return (
    <BottomDockHost tabBar={bottomTabs && bottomTabs.length > 0 ? <TabBar items={bottomTabs} /> : undefined}>
      <TopBar
        className="itsm-AppShell__topBar"
        start={
          page?.back ? (
            <ShellLink href={page.back.href} className="itsm-AppShell__back">
              <Icon name="chevron-left" size="md" directional />
              <span className="itsm-AppShell__backLabel">{page.back.label}</span>
            </ShellLink>
          ) : null
        }
        brand={brand}
        {...(page?.back ? { title: page.title } : {})}
        center={nav.sections.some((section) => section.items.length > 0) ? <PillNav nav={nav} /> : undefined}
        end={
          <>
            {search ? <SearchTrigger placeholder={search.placeholder} shortcut={search.shortcut ?? 'mod+k'} bindShortcut={false} onOpen={onOpenSearch} /> : null}
            {topBarAction ? <div className="itsm-AppShell__action">{topBarAction}</div> : null}
            {status ? <div className="itsm-AppShell__status">{status}</div> : null}
            {bell}
            <UserMenu {...user} {...(brand.switcher ? { switcher: brand.switcher } : {})} />
          </>
        }
      />
      {banner ? <div className="itsm-AppShell__banner">{banner}</div> : null}
      <Main id={mainId}>{children}</Main>
    </BottomDockHost>
  );
}
