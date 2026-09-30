'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../web/cx.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { currentItemId, needsSearch, type SearchLike } from './match.js';
import { NavBadgeView } from './NavBadge.js';
import type { NavItem } from './nav.js';
import { ShellLink } from './ShellLink.js';

export interface TabNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly badge?: NavItem['badge'];
  readonly match?: NavItem['match'];
}

export interface TabNavProps {
  /** The landmark's name: what these are the sections of ("Settings"). */
  readonly label: string;
  readonly items: readonly TabNavItem[];
  readonly className?: string;
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function Links({ items, currentId }: { readonly items: readonly TabNavItem[]; readonly currentId: string | null }): ReactNode {
  const track = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState(false);
  const [animate, setAnimate] = useState(false);

  // One indicator that slides between tabs on the spring (SPEC §4.9), placed
  // after the first paint: until then — and without script — the current tab
  // draws its own underline, so nothing slides in on load. Measured in
  // physical pixels from the track's left edge, which is the same sum in
  // either writing direction.
  useIsomorphicLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const place = (): void => {
      const current = element.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current || current.offsetWidth === 0) {
        setPlaced(false);
        return;
      }
      element.style.setProperty('--_indicator-x', `${current.offsetLeft}px`);
      element.style.setProperty('--_indicator-w', String(current.offsetWidth));
      setPlaced(true);
    };
    place();
    // Keep the current tab in view when the row scrolls (narrow screens).
    element.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [currentId, items]);

  // Sliding starts only after the first placement has painted, so the
  // indicator appears under the current tab rather than gliding in.
  useEffect(() => {
    if (!placed || animate) return;
    const frame = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(frame);
  }, [placed, animate]);

  return (
    <div ref={track} className="itsm-TabNav__track" data-placed={placed || undefined} data-animate={(placed && animate) || undefined}>
      <ul className="itsm-TabNav__list">
        {items.map((item) => (
          <li key={item.id} className="itsm-TabNav__entry">
            <ShellLink href={item.href} className="itsm-TabNav__link" aria-current={item.id === currentId ? 'page' : undefined}>
              <span className="itsm-TabNav__label" data-text={item.label}>
                {item.label}
              </span>
              <NavBadgeView badge={item.badge} className="itsm-TabNav__badge" />
            </ShellLink>
          </li>
        ))}
      </ul>
      <span className="itsm-TabNav__indicator" aria-hidden="true" />
    </div>
  );
}

/**
 * Route sections as tabs — Settings › Features, Workflows › Runs: links with
 * `aria-current="page"`, not an ARIA tab list, because each one is a page
 * with its own URL, history entry and `<h1>`. In-place panels use `Tabs`.
 * Replaces the drafts' `SubNav`.
 *
 * The current tab is `text.primary` at 600 (the label reserves its bold
 * width, so neighbours do not shift) over a 2 px accent underline that
 * slides between tabs on the spring and simply appears under reduced motion.
 * The row scrolls sideways on narrow screens, keeping the current tab in
 * view.
 */
export function TabNav({ label, items, className }: TabNavProps): ReactNode {
  const pathname = usePathnameSafe();
  const plain = useMemo(() => <Links items={items} currentId={currentItemId(items, pathname)} />, [items, pathname]);
  return (
    <nav aria-label={label} className={cx('itsm-TabNav', className)}>
      {needsSearch(items) ? (
        <WithSearch fallback={plain}>{(search: SearchLike) => <Links items={items} currentId={currentItemId(items, pathname, search)} />}</WithSearch>
      ) : (
        plain
      )}
    </nav>
  );
}
