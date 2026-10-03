'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, needsSearch, type SearchLike } from './match.js';
import { useFullScreenFlowActive } from './flow.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavItem, TabAction, TabItem } from './nav.js';
import { ShellLink } from './ShellLink.js';

export interface TabBarProps {
  /**
   * At most five: more do not fit 320 px with their labels (X-91). Pages are
   * links; actions — the Service Desk's Search and More — are buttons that
   * open their dialogs.
   */
  readonly items: readonly TabItem[];
  /** The landmark's name. "Tab bar" by default, so it never shares a name with the top bar's navigation. */
  readonly label?: string;
  readonly className?: string;
}

/** How much the visual viewport must shrink before it is a software keyboard, not browser chrome settling. */
const KEYBOARD_THRESHOLD_PX = 150;

function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(element.type);
}

/**
 * Whether the phone's software keyboard is up: the visual viewport has lost
 * a keyboard's worth of height and focus is in something that types. Both,
 * because either alone lies — a pinch-zoom shrinks the viewport, and a
 * hardware keyboard types with nothing on screen.
 */
export function useSoftwareKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = (): void => {
      const lost = window.innerHeight - viewport.height;
      setOpen(lost > KEYBOARD_THRESHOLD_PX && isTextEntry(document.activeElement));
    };
    viewport.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}

/** Whether a tab acts (opens the palette, the navigation sheet) rather than navigates. */
export function isTabAction(item: TabItem): item is TabAction {
  return typeof (item as Partial<TabAction>).onSelect === 'function';
}

function Tabs({ items, currentId }: { readonly items: readonly TabItem[]; readonly currentId: string | null }): ReactNode {
  return (
    <ul className="itsm-TabBar__list">
      {items.map((item) => (
        <li key={item.id} className="itsm-TabBar__entry">
          {isTabAction(item) ? <TabButton item={item} /> : <TabLink item={item} current={item.id === currentId} />}
        </li>
      ))}
    </ul>
  );
}

function TabFace({ icon, badge, dot, label }: { readonly icon: TabItem['icon']; readonly badge: TabItem['badge']; readonly dot?: TabAction['dot']; readonly label: string }): ReactNode {
  return (
    <>
      <span className="itsm-TabBar__pill">
        <Icon name={icon ?? 'dot'} size="lg" className="itsm-TabBar__icon" />
        <NavBadgeView badge={badge} className="itsm-TabBar__badge" />
        {dot ? <span className="itsm-TabBar__dot" aria-hidden="true" /> : null}
      </span>
      <span className="itsm-TabBar__label">{label}</span>
      {dot ? <span className="itsm-visually-hidden">, {dot.label}</span> : null}
    </>
  );
}

function TabLink({ item, current }: { readonly item: NavItem; readonly current: boolean }): ReactNode {
  return (
    <ShellLink href={item.href} className="itsm-TabBar__item" aria-current={current ? 'page' : undefined}>
      <TabFace icon={item.icon} badge={item.badge} label={item.label} />
    </ShellLink>
  );
}

function TabButton({ item }: { readonly item: TabAction }): ReactNode {
  return (
    <button
      type="button"
      className="itsm-TabBar__item"
      aria-haspopup={item.haspopup}
      aria-controls={item.expanded && item.controls ? item.controls : undefined}
      aria-expanded={item.haspopup ? item.expanded === true : undefined}
      onClick={() => item.onSelect()}
    >
      <TabFace icon={item.icon} badge={item.badge} dot={item.dot} label={item.label} />
    </button>
  );
}

/**
 * The phone tab bar below 768 px (v3 §3.6, A2 §7.3): the Help Portal's Home ·
 * Requests · Services · Knowledge · Me, and the Service Desk's Overview · My
 * work · Board · Search · More. Docked to the bottom edge, full width, 60 px
 * plus the home-indicator safe area, on glass (`material.chrome`) with a
 * hairline above; tabs at least 52 px tall, a 20 px icon over a 600
 * 10.5/14 label. The current tab's label is `text.primary`, its icon the
 * accent, with a 24 × 3 accent bar on the bar's top edge and
 * `aria-current="page"`; the others are `text.faint`. An action tab (Search,
 * More) is a button that says what it opens (`aria-haspopup="dialog"`) and
 * draws itself current while that is open. Counts ride on the icon; More's
 * red dot says something inside needs attention, in words too.
 *
 * It steps aside while the software keyboard is up (a docked bar riding on
 * the keyboard hides the field being typed in) and during full-screen flows
 * (`useFullScreenFlow`), which bring their own Back or Close (X-92). At 768
 * and up the stylesheet hides it.
 *
 * Put it in a `BottomDock` so it shares the bottom edge in the one order the
 * product allows.
 */
export function TabBar({ items, label = 'Tab bar', className }: TabBarProps): ReactNode {
  const pathname = usePathnameSafe();
  const keyboardOpen = useSoftwareKeyboardOpen();
  const inFlow = useFullScreenFlowActive();
  const shown = useMemo(() => items.slice(0, 5), [items]);
  const links = useMemo(() => shown.filter((item): item is NavItem => !isTabAction(item)), [shown]);
  const plain = <Tabs items={shown} currentId={currentItemId(links, pathname)} />;

  return (
    <nav
      aria-label={label}
      className={cx('itsm-TabBar', className)}
      data-keyboard={keyboardOpen ? 'open' : undefined}
      data-flow={inFlow ? 'full' : undefined}
      hidden={keyboardOpen || inFlow || undefined}
    >
      {needsSearch(links) ? (
        <WithSearch fallback={plain}>{(search: SearchLike) => <Tabs items={shown} currentId={currentItemId(links, pathname, search)} />}</WithSearch>
      ) : (
        plain
      )}
    </nav>
  );
}
