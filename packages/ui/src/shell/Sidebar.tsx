'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useStableId } from '../a11y/ids.js';
import { useRegion } from '../a11y/regions.js';
import { BrandMark } from '../icons/BrandMark.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { usePins, useRecents, type RecentItem } from '../provider/recents.js';
import { cx } from '../web/cx.js';
import { IconButton } from '../web/IconButton.js';
import { Kbd } from '../web/Kbd.js';
import { appIcon, kindIcon } from './app-icons.js';
import { LazyMenuButton } from './LazyMenuButton.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, navModelItems, needsSearch, type SearchLike } from './match.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavItem, NavModel, NavSection, ShellBrand } from './nav.js';
import { SearchTrigger } from './SearchTrigger.js';
import { ShellLink } from './ShellLink.js';
import { UserMenu, type UserMenuProps } from './UserMenu.js';

export interface SidebarProps {
  readonly brand: ShellBrand;
  readonly nav: NavModel;
  /** Beside the brand: the workbench's compose button. */
  readonly headerExtra?: ReactNode;
  readonly search?: { readonly placeholder: string; readonly shortcut?: 'mod+k' } | false;
  readonly onOpenSearch?: () => void;
  readonly bell?: ReactNode;
  /** The connection status slot — renders nothing when healthy. */
  readonly status?: ReactNode;
  /** The workbench's availability pill. */
  readonly footerExtra?: ReactNode;
  readonly user?: UserMenuProps;
  /** `docked`: the column beside the content (full or rail, by width). `sheet`: inside the navigation sheet on small screens. */
  readonly mode: 'docked' | 'sheet';
  /** The *PanelLeft* button: collapse to the rail, or show the full sidebar. */
  readonly toggle?: { readonly label: string; readonly onToggle: () => void };
  readonly className?: string;
}

/* -------------------------------------------------------------------------
 * Collapsed sections, remembered on this device
 * ---------------------------------------------------------------------- */

type Collapsed = Readonly<Record<string, boolean>>;
const NO_COLLAPSED: Collapsed = Object.freeze({});
const collapsedListeners = new Set<() => void>();
const collapsedCache = new Map<string, Collapsed>();

function readCollapsed(key: string): Collapsed {
  const cached = collapsedCache.get(key);
  if (cached) return cached;
  let value: Collapsed = NO_COLLAPSED;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      value = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Collapsed;
    }
  } catch {
    // Private browsing or a blocked origin: sections start as the model says.
  }
  collapsedCache.set(key, value);
  return value;
}

function writeCollapsed(key: string, value: Collapsed): void {
  collapsedCache.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this page only.
  }
  for (const listener of [...collapsedListeners]) listener();
}

function subscribeCollapsed(listener: () => void): () => void {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

/** Forgets remembered section states held in memory. Tests use it between cases. */
export function resetSidebarMemoryForTesting(): void {
  collapsedCache.clear();
}

function useCollapsedSections(app: string): [Collapsed, (id: string, collapsed: boolean) => void] {
  const key = `itsm-nav-collapsed:${app}`;
  // Empty on the server and during hydration: the server cannot see this
  // device's storage, so the first client render must not either.
  const collapsed = useSyncExternalStore(subscribeCollapsed, () => readCollapsed(key), () => NO_COLLAPSED);
  const set = useCallback((id: string, value: boolean) => writeCollapsed(key, { ...readCollapsed(key), [id]: value }), [key]);
  return [collapsed, set];
}

/* -------------------------------------------------------------------------
 * The rail's tooltips
 * ---------------------------------------------------------------------- */

interface RailTip {
  readonly label: string;
  readonly shortcut?: string;
  readonly top: number;
  readonly start: number;
}

/** Hover delay before a rail label shows — the product's tooltip timing (SPEC §4.3). */
const TIP_DELAY_MS = 500;

/**
 * In the rail the labels are hidden, so each item names itself in a small
 * bubble beside it: after a moment's hover, or at once when the keyboard
 * arrives. Supplementary only — the link keeps its full name — so the bubble
 * is hidden from assistive technology. Never on touch.
 *
 * Whether the sidebar is a rail is the stylesheet's decision (width and the
 * person's preference), published as `--_rail: 1`; this asks it at the moment
 * of hovering rather than duplicating the breakpoints in script.
 */
function useRailTips(sidebar: () => HTMLElement | null): {
  readonly tip: RailTip | null;
  readonly handlers: {
    onPointerOver(event: PointerEvent<HTMLElement>): void;
    onPointerOut(event: PointerEvent<HTMLElement>): void;
    onFocus(event: FocusEvent<HTMLElement>): void;
    onBlur(): void;
    onKeyDown(event: KeyboardEvent<HTMLElement>): void;
    onScrollCapture(): void;
  };
} {
  const [tip, setTip] = useState<RailTip | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setTip(null);
  }, []);

  useEffect(() => clear, [clear]);

  const tipFor = useCallback(
    (target: EventTarget | null): RailTip | null => {
      const root = sidebar();
      if (!root || !(target instanceof Element)) return null;
      const item = target.closest<HTMLElement>('[data-rail-label]');
      if (!item || !root.contains(item)) return null;
      if (getComputedStyle(root).getPropertyValue('--_rail').trim() !== '1') return null;
      const rect = item.getBoundingClientRect();
      const rtl = getComputedStyle(root).direction === 'rtl';
      const shortcut = item.getAttribute('data-rail-shortcut') ?? undefined;
      return {
        label: item.getAttribute('data-rail-label') ?? '',
        ...(shortcut ? { shortcut } : {}),
        top: rect.top + rect.height / 2,
        start: rtl ? window.innerWidth - rect.left + 8 : rect.right + 8,
      };
    },
    [sidebar],
  );

  return {
    tip,
    handlers: {
      onPointerOver(event) {
        if (event.pointerType === 'touch') return;
        const next = tipFor(event.target);
        if (timer.current !== null) window.clearTimeout(timer.current);
        if (!next) {
          timer.current = null;
          setTip(null);
          return;
        }
        // Moving between items while one is showing swaps at once, as tooltips do.
        if (tip) {
          setTip(next);
          return;
        }
        timer.current = window.setTimeout(() => setTip(next), TIP_DELAY_MS);
      },
      onPointerOut(event) {
        const related = event.relatedTarget;
        if (related instanceof Element && related.closest('[data-rail-label]') === (event.target as Element).closest?.('[data-rail-label]')) return;
        clear();
      },
      onFocus(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        let keyboard = false;
        try {
          keyboard = target.matches(':focus-visible');
        } catch {
          // An engine without the selector: no tooltip rather than one on every click.
        }
        if (keyboard) setTip(tipFor(target));
      },
      onBlur: clear,
      onKeyDown(event) {
        if (event.key === 'Escape' && tip) clear();
      },
      // A bubble placed in the window would drift off its item as the list scrolls.
      onScrollCapture: clear,
    },
  };
}

function RailTooltip({ tip }: { readonly tip: RailTip | null }): ReactNode {
  if (!tip) return null;
  return (
    <span className="itsm-Sidebar__tip" aria-hidden="true" style={{ insetBlockStart: tip.top, insetInlineStart: tip.start }}>
      <span>{tip.label}</span>
      {tip.shortcut ? <Kbd keys={tip.shortcut} size="sm" aria-hidden /> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Parts
 * ---------------------------------------------------------------------- */

function BrandBlock({ brand }: { readonly brand: ShellBrand }): ReactNode {
  const others = (brand.switcher ?? []).filter((entry) => entry.app !== brand.app);
  const body = (
    <>
      <BrandMark app={brand.app} size={28} className="itsm-Sidebar__mark" />
      <span className="itsm-Sidebar__brandText">
        <span className="itsm-Sidebar__brandName">{brand.name}</span>
        {brand.tenant ? (
          <span className="itsm-Sidebar__tenant">
            <span className="itsm-visually-hidden">, </span>
            {brand.tenant}
          </span>
        ) : null}
      </span>
    </>
  );

  // The switcher is a menu only when there is somewhere else to go.
  if ((brand.switcher?.length ?? 0) > 1 && others.length > 0) {
    return (
      <LazyMenuButton
        label="Switch app"
        align="start"
        items={[
          { type: 'label', label: 'Switch to' },
          ...others.map((entry) => ({ id: `app-${entry.app}`, label: entry.label, icon: appIcon(entry.app), href: entry.href })),
        ]}
        renderTrigger={(props) => (
          <button type="button" className="itsm-Sidebar__brand" {...props}>
            {body}
            <Icon name="chevrons-up-down" size="sm" className="itsm-Sidebar__brandChevron" />
          </button>
        )}
      />
    );
  }
  return (
    <ShellLink href={brand.href} className="itsm-Sidebar__brand">
      {body}
    </ShellLink>
  );
}

function NavEntry({ item, currentId }: { readonly item: NavItem; readonly currentId: string | null }): ReactNode {
  const current = item.id === currentId;
  const childCurrent = useMemo(() => (item.children ?? []).some(function has(child: NavItem): boolean {
    return child.id === currentId || (child.children ?? []).some(has);
  }), [item.children, currentId]);

  return (
    <li className="itsm-Sidebar__entry">
      <ShellLink
        href={item.href}
        className="itsm-Sidebar__item"
        aria-current={current ? 'page' : undefined}
        data-rail-label={item.label}
        {...(item.shortcut ? { 'data-rail-shortcut': item.shortcut } : {})}
      >
        {item.icon ? <Icon name={item.icon} size="md" className="itsm-Sidebar__icon" /> : <span className="itsm-Sidebar__icon" aria-hidden="true" />}
        <span className="itsm-Sidebar__label">{item.label}</span>
        <NavBadgeView badge={item.badge} className="itsm-Sidebar__badge" />
      </ShellLink>
      {item.children && item.children.length > 0 && (current || childCurrent) ? (
        <ul className="itsm-Sidebar__children">
          {item.children.map((child) => (
            <NavEntry key={child.id} item={child} currentId={currentId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SectionView({
  section,
  currentId,
  collapsed,
  onCollapse,
}: {
  readonly section: NavSection;
  readonly currentId: string | null;
  readonly collapsed: boolean | undefined;
  readonly onCollapse: (collapsed: boolean) => void;
}): ReactNode {
  const labelId = useStableId('itsm-nav-section');
  const listId = `${labelId}-items`;
  const holdsCurrent = useMemo(() => navModelItems({ sections: [section] }).some((item) => item.id === currentId), [section, currentId]);
  // Remembered state first; otherwise the model's default — except that the
  // section holding the current page opens, so the page is never hidden.
  const isCollapsed = section.collapsible === true && (collapsed ?? (section.defaultCollapsed === true && !holdsCurrent));

  return (
    <div className="itsm-Sidebar__section">
      {section.label ? (
        section.collapsible ? (
          <button
            type="button"
            id={labelId}
            className="itsm-Sidebar__sectionLabel itsm-Sidebar__sectionToggle"
            aria-expanded={!isCollapsed}
            aria-controls={listId}
            onClick={() => onCollapse(!isCollapsed)}
          >
            <span className="itsm-Sidebar__sectionText">{section.label}</span>
            <Icon name="chevron-down" size="xs" className="itsm-Sidebar__sectionChevron" />
          </button>
        ) : (
          <div id={labelId} className="itsm-Sidebar__sectionLabel">
            <span className="itsm-Sidebar__sectionText">{section.label}</span>
          </div>
        )
      ) : null}
      <ul id={listId} className="itsm-Sidebar__list" aria-labelledby={section.label ? labelId : undefined} data-collapsed={isCollapsed || undefined}>
        {section.items.map((item) => (
          <NavEntry key={item.id} item={item} currentId={currentId} />
        ))}
      </ul>
    </div>
  );
}

function DeviceSection({
  label,
  items,
  onRemove,
}: {
  readonly label: string;
  readonly items: readonly RecentItem[];
  readonly onRemove?: (item: RecentItem) => void;
}): ReactNode {
  const labelId = useStableId('itsm-nav-device');
  if (items.length === 0) return null;
  return (
    <div className="itsm-Sidebar__section">
      <div id={labelId} className="itsm-Sidebar__sectionLabel">
        <span className="itsm-Sidebar__sectionText">{label}</span>
      </div>
      <ul className="itsm-Sidebar__list" aria-labelledby={labelId}>
        {items.map((item) => (
          <li key={item.id} className="itsm-Sidebar__entry" data-removable={onRemove ? '' : undefined}>
            <ShellLink href={item.href} className="itsm-Sidebar__item" data-rail-label={item.label}>
              <Icon name={kindIcon(item.kind)} size="md" className="itsm-Sidebar__icon" />
              <span className="itsm-Sidebar__label">{item.label}</span>
            </ShellLink>
            {onRemove ? (
              <IconButton
                className="itsm-Sidebar__remove"
                icon="x"
                size="sm"
                variant="ghost"
                label={`Unpin ${item.label}`}
                tooltip={false}
                onClick={() => onRemove(item)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PinnedAndRecent({ nav }: { readonly nav: NavModel }): ReactNode {
  const { pins, unpin } = usePins();
  const recents = useRecents();
  const pinnedOn = nav.pinned?.enabled === true;
  const recentOn = nav.recent?.enabled === true;
  const pinned = pinnedOn ? pins.slice(0, nav.pinned?.max ?? 8) : [];
  const pinnedIds = new Set(pinned.map((item) => item.id));
  // A pinned item is not listed again under Recent.
  const recent = recentOn ? recents.filter((item) => !pinnedIds.has(item.id)).slice(0, nav.recent?.max ?? 5) : [];
  return (
    <>
      {pinnedOn ? <DeviceSection label="Pinned" items={pinned} onRemove={(item) => unpin(item.id)} /> : null}
      {recentOn ? <DeviceSection label="Recent" items={recent} /> : null}
    </>
  );
}

function NavLists({ nav, currentId }: { readonly nav: NavModel; readonly currentId: string | null }): ReactNode {
  const app = useOptionalItsm()?.app ?? 'default';
  const [collapsed, setCollapsed] = useCollapsedSections(app);
  return (
    <>
      <div className="itsm-Sidebar__scroll">
        <PinnedAndRecent nav={nav} />
        {nav.sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            currentId={currentId}
            collapsed={collapsed[section.id]}
            onCollapse={(value) => setCollapsed(section.id, value)}
          />
        ))}
      </div>
      {nav.footer && nav.footer.length > 0 ? (
        <ul className="itsm-Sidebar__list itsm-Sidebar__list--footer">
          {nav.footer.map((item) => (
            <NavEntry key={item.id} item={item} currentId={currentId} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The model's items with their current one worked out; the query is read only when an item matches on it. */
function CurrentNav({ nav }: { readonly nav: NavModel }): ReactNode {
  const pathname = usePathnameSafe();
  const items = useMemo(() => navModelItems(nav), [nav]);
  const withoutQuery = <NavLists nav={nav} currentId={currentItemId(items, pathname)} />;
  if (!needsSearch(items)) return withoutQuery;
  return <WithSearch fallback={withoutQuery}>{(search: SearchLike) => <NavLists nav={nav} currentId={currentItemId(items, pathname, search)} />}</WithSearch>;
}

/**
 * The sheet's own header (its title — the app's name — is the sheet's): the
 * compose button, and the other apps as plain links, which suit a touch
 * screen better than a menu inside a sheet.
 */
function SheetHeader({ brand, headerExtra }: { readonly brand: ShellBrand; readonly headerExtra?: ReactNode }): ReactNode {
  const labelId = useStableId('itsm-nav-apps');
  const others = (brand.switcher ?? []).filter((entry) => entry.app !== brand.app);
  if (!headerExtra && others.length === 0) return null;
  return (
    <div className="itsm-Sidebar__header">
      {headerExtra ? <div className="itsm-Sidebar__headerExtra">{headerExtra}</div> : null}
      {others.length > 0 ? (
        <div className="itsm-Sidebar__section">
          <div id={labelId} className="itsm-Sidebar__sectionLabel">
            <span className="itsm-Sidebar__sectionText">Switch to</span>
          </div>
          <ul className="itsm-Sidebar__list" aria-labelledby={labelId}>
            {others.map((entry) => (
              <li key={entry.app} className="itsm-Sidebar__entry">
                <ShellLink href={entry.href} className="itsm-Sidebar__item">
                  <Icon name={appIcon(entry.app)} size="md" className="itsm-Sidebar__icon" />
                  <span className="itsm-Sidebar__label">{entry.label}</span>
                </ShellLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sidebar of the admin console and the workbench: the brand with its app
 * switcher, search and the bell at the top; the navigation, grouped into
 * sections, in the middle; connection status, availability and the account
 * menu at the foot.
 *
 * Opaque, on the canvas (D6): nothing scrolls beneath it, so it has no reason
 * to be glass. The current page is `surface.selected` with a 3 px accent bar,
 * `text.primary` at 600 and `aria-current="page"` (X-72) — never a
 * link-coloured label. Hover is `surface.hover` over `fast`, and nothing
 * moves.
 *
 * Collapsible sections remember their state on this device; the section
 * holding the current page opens by itself. *Pinned* and *Recent* are this
 * device's lists (`usePins`, `useRecents`), empty on the server and hidden
 * while empty.
 *
 * As a rail (1024–1279 px, or collapsed by the person at 1280 and up) it
 * keeps the icons, turns section headings into hairlines and names each item
 * in a bubble on hover or keyboard focus. It never widens on hover — a panel
 * that grows under a passing pointer covers what the person was reading.
 */
export function Sidebar({
  brand,
  nav,
  headerExtra,
  search,
  onOpenSearch,
  bell,
  status,
  footerExtra,
  user,
  mode,
  toggle,
  className,
}: SidebarProps): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  // The docked sidebar is an F6 region; inside the sheet, the sheet is.
  useRegion(navRef, mode === 'docked');
  const rail = useRailTips(() => (mode === 'docked' ? rootRef.current : null));

  return (
    <div ref={rootRef} className={cx('itsm-Sidebar', className)} data-mode={mode}>
      {mode === 'docked' ? (
        <div className="itsm-Sidebar__header">
          <div className="itsm-Sidebar__brandRow">
            <BrandBlock brand={brand} />
            {headerExtra ? <div className="itsm-Sidebar__headerExtra">{headerExtra}</div> : null}
            {toggle ? (
              <IconButton
                className="itsm-Sidebar__toggle"
                icon="panel-left"
                size="sm"
                variant="ghost"
                label={toggle.label}
                shortcut="["
                onClick={toggle.onToggle}
              />
            ) : null}
          </div>
          {(search && onOpenSearch) || bell ? (
            <div className="itsm-Sidebar__tools">
              {search && onOpenSearch ? (
                <SearchTrigger
                  className="itsm-Sidebar__search"
                  placeholder={search.placeholder}
                  shortcut={search.shortcut ?? 'mod+k'}
                  bindShortcut={false}
                  onOpen={onOpenSearch}
                />
              ) : null}
              {bell ? <div className="itsm-Sidebar__bell">{bell}</div> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <SheetHeader brand={brand} headerExtra={headerExtra} />
      )}

      <nav
        ref={navRef}
        aria-label={nav.label}
        className="itsm-Sidebar__nav itsm-Region"
        tabIndex={-1}
        onPointerOver={rail.handlers.onPointerOver}
        onPointerOut={rail.handlers.onPointerOut}
        onFocus={rail.handlers.onFocus}
        onBlur={rail.handlers.onBlur}
        onKeyDown={rail.handlers.onKeyDown}
        onScrollCapture={rail.handlers.onScrollCapture}
      >
        <CurrentNav nav={nav} />
      </nav>

      {status || footerExtra || user ? (
        <div className="itsm-Sidebar__footer">
          {status ? <div className="itsm-Sidebar__status">{status}</div> : null}
          {footerExtra ? <div className="itsm-Sidebar__footerExtra">{footerExtra}</div> : null}
          {user ? <UserMenu {...user} display="row" /> : null}
        </div>
      ) : null}
      <RailTooltip tip={rail.tip} />
    </div>
  );
}
