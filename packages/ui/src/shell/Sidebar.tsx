'use client';

import type { AreaModel } from '@itsm/contracts/areas';
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
import { kindIcon } from './app-icons.js';
import { AreaList } from './AreaList.js';
import { AreaSwitcher, currentArea } from './AreaSwitcher.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, navModelItems, needsSearch, type SearchLike } from './match.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavBadge, NavItem, NavModel, NavSection, ShellBrand } from './nav.js';
import { ShellLink } from './ShellLink.js';
import { UserMenu, type UserMenuProps } from './UserMenu.js';

export interface SidebarProps {
  /** The person's areas: the Area card in the column, the area list in the sheet. */
  readonly areas: AreaModel;
  /** The brand block's link (the area's home) and workspace. */
  readonly brand: ShellBrand;
  readonly nav: NavModel;
  /** Under the Area card: the Service Desk's "New ticket". */
  readonly action?: ReactNode;
  /** The connection status slot — renders nothing when healthy. */
  readonly status?: ReactNode;
  /** The foot's status row: the Service Desk's availability pill. */
  readonly footerExtra?: ReactNode;
  readonly user?: UserMenuProps;
  /** `docked`: the column beside the content (full or rail, by width). `sheet`: inside the navigation sheet below 1024 px. */
  readonly mode: 'docked' | 'sheet';
  /** The foot's Collapse button: collapse to the rail, expand it, or show the full sidebar as a sheet. */
  readonly collapse?: { readonly label: string; readonly onToggle: () => void };
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

/**
 * The brand block, 56 px like the top bar so the two hairlines meet: the
 * product mark, "IT Service Management" and the workspace under it, as one
 * link to the area's home — always home, never a menu (A2 §5.3.1).
 */
function BrandBlock({ areas, brand }: { readonly areas: AreaModel; readonly brand: ShellBrand }): ReactNode {
  const area = currentArea(areas);
  return (
    <div className="itsm-Sidebar__brand">
      <ShellLink href={brand.href} className="itsm-Sidebar__home" aria-label={`${areas.product} — ${area.name} home`} data-rail-label={`${area.name} home`}>
        <BrandMark size={32} className="itsm-Sidebar__mark" />
        <span className="itsm-Sidebar__brandText">
          <span className="itsm-Sidebar__brandName">{areas.product}</span>
          {areas.workspace ? <span className="itsm-Sidebar__workspace">{areas.workspace}</span> : null}
        </span>
      </ShellLink>
    </div>
  );
}

/** The Area card: the way to the other areas, or the area's lockup when there is none. */
function AreaCard({ areas }: { readonly areas: AreaModel }): ReactNode {
  const area = currentArea(areas);
  return (
    <div className="itsm-Sidebar__area" data-rail-label={areas.visible ? `${area.name} · Switch area` : area.name}>
      <AreaSwitcher model={areas} display="card" />
    </div>
  );
}

/** In the rail only danger counts are drawn, as a small badge that stops at "9+"; the rest stay in the link's name. */
function railCount(badge: NavBadge | undefined): string | null {
  if (!badge || badge.tone !== 'danger' || !(badge.value > 0)) return null;
  return badge.value > 9 ? '9+' : String(Math.trunc(badge.value));
}

function NavEntry({ item, currentId }: { readonly item: NavItem; readonly currentId: string | null }): ReactNode {
  const current = item.id === currentId;
  const childCurrent = useMemo(() => (item.children ?? []).some(function has(child: NavItem): boolean {
    return child.id === currentId || (child.children ?? []).some(has);
  }), [item.children, currentId]);
  const rail = railCount(item.badge);

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
        {rail ? (
          <span className="itsm-Sidebar__railCount" aria-hidden="true">
            {rail}
          </span>
        ) : null}
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

/**
 * The sections, then this device's Pinned and Recent, then the footer nav:
 * the primary items keep their places whatever the device remembers
 * (A2 §5.3.4).
 */
function NavLists({ nav, currentId }: { readonly nav: NavModel; readonly currentId: string | null }): ReactNode {
  const app = useOptionalItsm()?.app ?? 'default';
  const [collapsed, setCollapsed] = useCollapsedSections(app);
  return (
    <>
      <div className="itsm-Sidebar__scroll">
        {nav.sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            currentId={currentId}
            collapsed={collapsed[section.id]}
            onCollapse={(value) => setCollapsed(section.id, value)}
          />
        ))}
        <PinnedAndRecent nav={nav} />
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
 * The foot (A2 §5.3.5): the status row — the Service Desk's availability,
 * the connection only when it is unwell — the user card, which opens the
 * same account menu as the top bar's avatar, and Collapse (`[`).
 */
function Foot({
  areas,
  status,
  footerExtra,
  user,
  collapse,
}: Pick<SidebarProps, 'areas' | 'status' | 'footerExtra' | 'user' | 'collapse'>): ReactNode {
  if (!status && !footerExtra && !user && !collapse) return null;
  return (
    <div className="itsm-Sidebar__foot">
      {status || footerExtra ? (
        <div className="itsm-Sidebar__statusRow">
          {footerExtra ? <div className="itsm-Sidebar__footerExtra">{footerExtra}</div> : null}
          {status ? <div className="itsm-Sidebar__status">{status}</div> : null}
        </div>
      ) : null}
      {user ? (
        <div className="itsm-Sidebar__user" data-rail-label={user.name}>
          <UserMenu {...user} areas={user.areas ?? areas} display="row" />
        </div>
      ) : null}
      {collapse ? (
        <button
          type="button"
          className="itsm-Sidebar__collapse"
          aria-keyshortcuts="["
          data-rail-label={collapse.label}
          data-rail-shortcut="["
          onClick={collapse.onToggle}
        >
          <Icon name="panel-left" size="sm" directional className="itsm-Sidebar__collapseIcon" />
          <span className="itsm-Sidebar__collapseLabel">{collapse.label}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The sidebar of Administration and the Service Desk (v3 §3.4, A2 §5.3):
 * light — white `surface.raised` with a `border.subtle` edge, no shadow —
 * with, top to bottom, the brand block (56 px, aligned with the top bar's
 * hairline), the Area card, the Service Desk's "New ticket", the grouped
 * navigation with its counts, and the foot: status row, user card,
 * Collapse.
 *
 * The current page is `surface.selected` with a 3 px accent bar at the
 * inline start, its label `text.primary` at 600 and its icon in the accent,
 * with `aria-current="page"` (X-B4) — never a link-coloured label. Group
 * labels are sentence case, 600 12/16 in `text.muted`; items 500 13/18 in
 * `text.secondary` with `text.faint` icons. Hover is `surface.hover` over
 * `fast`, and nothing moves.
 *
 * Collapsible sections remember their state on this device; the section
 * holding the current page opens by itself. *Pinned* and *Recent* are this
 * device's lists (`usePins`, `useRecents`), empty on the server and hidden
 * while empty, after the sections.
 *
 * As a rail (1024–1279 px, or collapsed at 1280 and up) it keeps the icons,
 * the Area card becomes a 44 px tile with a ⇕ badge, section headings become
 * hairlines, only danger counts stay as small badges, and each part names
 * itself in a bubble on hover or keyboard focus. It never widens on hover.
 *
 * In the navigation sheet (below 1024 px) the sheet's own title carries the
 * brand; the sheet lists the areas (`AreaList`), "New ticket", the
 * navigation and the user card.
 */
export function Sidebar({ areas, brand, nav, action, status, footerExtra, user, mode, collapse, className }: SidebarProps): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  // The docked sidebar is an F6 region; inside the sheet, the sheet is.
  useRegion(navRef, mode === 'docked');
  const rail = useRailTips(() => (mode === 'docked' ? rootRef.current : null));

  return (
    <div
      ref={rootRef}
      className={cx('itsm-Sidebar', className)}
      data-mode={mode}
      onPointerOver={rail.handlers.onPointerOver}
      onPointerOut={rail.handlers.onPointerOut}
      onFocus={rail.handlers.onFocus}
      onBlur={rail.handlers.onBlur}
      onKeyDown={rail.handlers.onKeyDown}
    >
      {mode === 'docked' ? (
        <>
          <BrandBlock areas={areas} brand={brand} />
          <AreaCard areas={areas} />
        </>
      ) : areas.visible ? (
        <div className="itsm-Sidebar__areas">
          <AreaList model={areas} />
        </div>
      ) : null}
      {action ? <div className="itsm-Sidebar__action">{action}</div> : null}

      <nav ref={navRef} aria-label={nav.label} className="itsm-Sidebar__nav itsm-Region" tabIndex={-1} onScrollCapture={rail.handlers.onScrollCapture}>
        <CurrentNav nav={nav} />
      </nav>

      <Foot areas={areas} status={status} footerExtra={footerExtra} user={user} collapse={mode === 'docked' ? collapse : undefined} />
      <RailTooltip tip={rail.tip} />
    </div>
  );
}
