'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import { Children, isValidElement, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { useRegion } from '../a11y/regions.js';
import { Icon } from '../icons/Icon.js';
import type { MenuItemSpec } from '../overlays/Menu.js';
import type { IconName } from '../types.js';
import { cx } from '../web/cx.js';
import { AreaSwitcher, currentArea } from './AreaSwitcher.js';
import type { PageInfo } from './context.js';
import { LazyMenuButton } from './LazyMenuButton.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, currentRouteTitle, navModelItems, needsSearch, type SearchLike } from './match.js';
import type { NavItem, NavModel } from './nav.js';
import { SearchTrigger } from './SearchTrigger.js';
import { ShellLink } from './ShellLink.js';
import { UserMenu, type UserMenuProps } from './UserMenu.js';

export interface AppTopBarProps {
  readonly areas: AreaModel;
  readonly nav: NavModel;
  /** What the page published (`PageHeader`): wins over the nav model's title once hydrated. */
  readonly page?: PageInfo | null;
  /** Before everything: the ☰ that opens the navigation sheet (below 1024 px). */
  readonly start?: ReactNode;
  /** Frame-level chips — the live major incident — ahead of the page's. */
  readonly context?: ReactNode;
  readonly search?: { readonly placeholder: string; readonly shortcut?: 'mod+k' } | false;
  readonly onOpenSearch?: () => void;
  readonly bell?: ReactNode;
  /** The Help menu's items (768 px and up). */
  readonly help?: { readonly items: readonly MenuItemSpec[] } | false;
  /** `ConnectionStatus`, shown here below 1024 px (the sidebar's foot shows it above). */
  readonly status?: ReactNode;
  /** The Service Desk's compose icon, shown at 768–1023 px only. */
  readonly action?: ReactNode;
  readonly user?: UserMenuProps;
  /**
   * The frame's phone tab bar has its own Search tab (the Service Desk), so
   * the bar leaves search out below 768 px (A2 §5.2.2).
   */
  readonly tabSearch?: boolean;
  readonly className?: string;
}

/** At most two context chips; the frame's first (v3 §3.4). */
export const MAX_CONTEXT_CHIPS = 2;

/** The bar's words for the current page: its title and purpose, or "‹ {section}" on a record page. */
export interface BarTitle {
  readonly mode: 'page' | 'section';
  readonly title: string;
  readonly purpose?: string;
  /** In `section` mode: the list the record belongs to. */
  readonly back?: { readonly href: string; readonly label: string };
}

/**
 * The title contract (A2 §5.2.3), as one pure function so the server HTML and
 * the hydrated bar agree.
 *
 * - **Hub and list pages:** the current nav item's label (`currentItemId`,
 *   the sidebar's own matcher) and its `description`; for a route under no
 *   item, the model's `routes`; the area's name as a last resort. What the
 *   page publishes wins, field by field.
 * - **Record pages** (`barTitle: 'section'`, or a route title that names a
 *   list to go back to): "‹ {section}" — the nav item over the route, or the
 *   route title, or the page's own `back` — with the section's purpose.
 */
export function resolveBarTitle(input: {
  readonly nav: NavModel;
  readonly page: PageInfo | null | undefined;
  readonly pathname: string;
  readonly search?: SearchLike | null;
  readonly fallback: string;
}): BarTitle {
  const { nav, page, pathname, search, fallback } = input;
  const items = navModelItems(nav);
  const id = currentItemId(items, pathname, search);
  const item: NavItem | null = id === null ? null : (items.find((candidate) => candidate.id === id) ?? null);
  const route = item ? null : currentRouteTitle(nav.routes, pathname);
  const mode = page?.barTitle ?? (route?.href ? 'section' : 'page');

  if (mode === 'section') {
    const back = item ? { href: item.href, label: item.label } : route?.href ? { href: route.href, label: route.title } : page?.back;
    const purpose = item?.description ?? route?.purpose;
    if (back) return { mode, title: back.label, back, ...(purpose ? { purpose } : {}) };
  }
  const title = page?.title ?? item?.label ?? route?.title ?? fallback;
  const purpose = page?.purpose ?? item?.description ?? route?.purpose;
  return { mode: 'page', title, ...(purpose ? { purpose } : {}) };
}

/** The chips to draw: the frame's, then the page's, two at most. */
export function contextChips(frame: ReactNode, page: ReactNode): ReactNode[] {
  return [...Children.toArray(frame), ...Children.toArray(page)].slice(0, MAX_CONTEXT_CHIPS);
}

export interface ContextChipProps {
  /** The full text, at 1440 px and up: "MI-0004 · VPN sign-in failures · Sev 2". */
  readonly label: string;
  /** The shorter text where only one chip has words (1280–1439 px): "MI-0004 · Sev 2". */
  readonly compactLabel?: string;
  readonly icon?: IconName;
  /** `danger` for the live major incident. */
  readonly tone?: 'neutral' | 'danger';
  /** A chip that leads somewhere is a link; same-tab, and through `crossAreaHref` when it crosses areas. */
  readonly href?: string;
  readonly className?: string;
}

/**
 * A context chip in the sidebar frame's top bar: a 30 px pill, `border.subtle`
 * on `surface.raisedAlt`, or `danger.subtle` for the major incident. Words at
 * 1440 px and up; at 1280–1439 the first chip keeps its compact words and the
 * second shows its icon; below 1280 icons only, and the words stay its name
 * and its tooltip; below 1024 the chips leave the bar.
 */
export function ContextChip({ label, compactLabel, icon, tone = 'neutral', href, className }: ContextChipProps): ReactNode {
  const body = (
    <>
      {icon ? <Icon name={icon} size="sm" className="itsm-ContextChip__icon" /> : null}
      <span className="itsm-ContextChip__label">{label}</span>
      <span className="itsm-ContextChip__compact" aria-hidden="true">
        {compactLabel ?? label}
      </span>
    </>
  );
  const shared = { className: cx('itsm-ContextChip', className), 'data-tone': tone, 'data-icon': icon ? '' : undefined, title: label };
  return href ? (
    <a href={href} {...shared}>
      {body}
    </a>
  ) : (
    <span {...shared}>{body}</span>
  );
}

function TitleBlock({ title }: { readonly title: BarTitle }): ReactNode {
  return (
    <div className="itsm-AppTopBar__heading" data-mode={title.mode}>
      {title.back ? (
        <ShellLink href={title.back.href} className="itsm-AppTopBar__back">
          <Icon name="chevron-left" size="md" directional className="itsm-AppTopBar__backIcon" />
          <span className="itsm-AppTopBar__title" title={title.title}>
            <span className="itsm-visually-hidden">Back to </span>
            {title.title}
          </span>
        </ShellLink>
      ) : (
        <span className="itsm-AppTopBar__title" title={title.title}>
          {title.title}
        </span>
      )}
      {title.purpose ? (
        <span className="itsm-AppTopBar__purpose" title={title.purpose}>
          {title.purpose}
        </span>
      ) : null}
    </div>
  );
}

/** The parts of the bar that depend on the location: the phone switcher, the title and purpose. */
function Location({ nav, page, areas, search }: { readonly nav: NavModel; readonly page: PageInfo | null | undefined; readonly areas: AreaModel; readonly search: SearchLike | null }): ReactNode {
  const pathname = usePathnameSafe();
  const title = resolveBarTitle({ nav, page, pathname, search, fallback: currentArea(areas).name });
  return (
    <>
      {title.mode === 'page' && areas.visible ? <AreaSwitcher model={areas} display="compact" className="itsm-AppTopBar__area" /> : null}
      <TitleBlock title={title} />
    </>
  );
}

function HelpMenu({ items }: { readonly items: readonly MenuItemSpec[] }): ReactNode {
  return (
    <span className="itsm-AppTopBar__help">
      <LazyMenuButton
        items={items}
        align="end"
        label="Help"
        renderTrigger={(props) => (
          <button type="button" className="itsm-AppTopBar__tool" aria-label="Help" {...props}>
            <Icon name="help" size="md" />
          </button>
        )}
      />
    </span>
  );
}

/**
 * The sidebar frame's top bar (v3 §3.4, A2 §5.2): 56 px at every width,
 * opaque `surface.raised` with its hairline always drawn, sticky under any
 * system bar. The page's banner landmark and an F6 region.
 *
 * Start to end: ☰ below 1024 px; on phones, the compact area switcher on
 * top-level pages (RV5); the title — the current nav item's label, in the
 * server HTML — with its purpose under it, or "‹ {section}" on a record
 * page; up to two context chips, the frame's first; then search, the bell,
 * Help (768 px and up) and the account avatar. The Service Desk's compose
 * icon shows at 768–1023 px. Which parts show is the stylesheet's decision:
 * the structure follows the viewport and the density follows the column
 * (`@container itsm-column`), so the server and the client always draw the
 * same markup.
 *
 * The title is not a heading: the page's `<h1>` stays in `main` — visually
 * hidden where this bar shows the same words — as the focus target after a
 * navigation.
 */
export function AppTopBar({ areas, nav, page, start, context, search, onOpenSearch, bell, help, status, action, user, tabSearch = false, className }: AppTopBarProps): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  useRegion(ref);
  const items = useMemo(() => navModelItems(nav), [nav]);
  const chips = contextChips(context, page?.context);
  const plain = <Location nav={nav} page={page} areas={areas} search={null} />;

  return (
    <header ref={ref} className={cx('itsm-AppTopBar', 'itsm-Region', className)} tabIndex={-1} aria-label="Top bar" data-tab-search={tabSearch ? '' : undefined}>
      <div className="itsm-AppTopBar__start">
        {start}
        {needsSearch(items) ? <WithSearch fallback={plain}>{(query: SearchLike) => <Location nav={nav} page={page} areas={areas} search={query} />}</WithSearch> : plain}
      </div>
      {chips.length > 0 ? (
        <div className="itsm-AppTopBar__chips">
          {chips.map((chip, index) => (
            <span key={isValidElement(chip) && chip.key !== null ? chip.key : index} className="itsm-AppTopBar__chip" data-chip={index + 1}>
              {chip as ReactElement}
            </span>
          ))}
        </div>
      ) : null}
      <div className="itsm-AppTopBar__tools">
        {action ? <div className="itsm-AppTopBar__action">{action}</div> : null}
        {search && onOpenSearch ? (
          <SearchTrigger className="itsm-AppTopBar__search" placeholder={search.placeholder} shortcut={search.shortcut ?? 'mod+k'} bindShortcut={false} onOpen={onOpenSearch} />
        ) : null}
        {status ? <div className="itsm-AppTopBar__status">{status}</div> : null}
        {bell ? <div className="itsm-AppTopBar__bell">{bell}</div> : null}
        {help && help.items.length > 0 ? <HelpMenu items={help.items} /> : null}
        {user ? <UserMenu {...user} areas={user.areas ?? areas} className={cx('itsm-AppTopBar__account', user.className)} /> : null}
      </div>
    </header>
  );
}
