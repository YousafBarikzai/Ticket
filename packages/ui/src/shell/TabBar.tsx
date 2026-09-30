'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, needsSearch, type SearchLike } from './match.js';
import { useFullScreenFlowActive } from './flow.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavItem } from './nav.js';
import { ShellLink } from './ShellLink.js';

export interface TabBarProps {
  /** At most five: more do not fit 320 px with their labels (X-91). */
  readonly items: readonly NavItem[];
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

function Tabs({ items, currentId }: { readonly items: readonly NavItem[]; readonly currentId: string | null }): ReactNode {
  return (
    <ul className="itsm-TabBar__list">
      {items.map((item) => {
        const current = item.id === currentId;
        return (
          <li key={item.id} className="itsm-TabBar__entry">
            <TabLink item={item} current={current} />
          </li>
        );
      })}
    </ul>
  );
}

function TabLink({ item, current }: { readonly item: NavItem; readonly current: boolean }): ReactNode {
  return (
    <ShellLink href={item.href} className="itsm-TabBar__item" aria-current={current ? 'page' : undefined}>
      <span className="itsm-TabBar__pill">
        <Icon name={item.icon ?? 'dot'} size="lg" className="itsm-TabBar__icon" />
        <NavBadgeView badge={item.badge} className="itsm-TabBar__badge" />
      </span>
      <span className="itsm-TabBar__label">{item.label}</span>
    </ShellLink>
  );
}

/**
 * The portal's tab bar below 768 px: docked to the bottom edge, full width,
 * 56 px plus the home-indicator safe area, on glass (`material.chrome`),
 * with icon-over-label tabs in `footnote` (X-91). The current tab sits on an
 * opaque `surface.selected` pill — never text on bare glass for the one
 * thing that must read — and carries `aria-current="page"`. Counts ride on
 * the icon.
 *
 * It steps aside while the software keyboard is up (a docked bar riding on
 * the keyboard hides the field being typed in) and during full-screen flows
 * (`useFullScreenFlow`), which bring their own Back or Close (X-92). At 768
 * and up the stylesheet hides it; the top bar's pills take over.
 *
 * Put it in a `BottomDock` so it shares the bottom edge in the one order the
 * product allows.
 */
export function TabBar({ items, label = 'Tab bar', className }: TabBarProps): ReactNode {
  const pathname = usePathnameSafe();
  const keyboardOpen = useSoftwareKeyboardOpen();
  const inFlow = useFullScreenFlowActive();
  const shown = useMemo(() => items.slice(0, 5), [items]);
  const plain = <Tabs items={shown} currentId={currentItemId(shown, pathname)} />;

  return (
    <nav
      aria-label={label}
      className={cx('itsm-TabBar', className)}
      data-keyboard={keyboardOpen ? 'open' : undefined}
      data-flow={inFlow ? 'full' : undefined}
      hidden={keyboardOpen || inFlow || undefined}
    >
      {needsSearch(shown) ? (
        <WithSearch fallback={plain}>{(search: SearchLike) => <Tabs items={shown} currentId={currentItemId(shown, pathname, search)} />}</WithSearch>
      ) : (
        plain
      )}
    </nav>
  );
}
