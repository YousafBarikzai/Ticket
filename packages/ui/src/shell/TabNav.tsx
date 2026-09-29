'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { NavItem } from './nav.js';

export interface TabNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly badge?: NavItem['badge'];
  readonly match?: NavItem['match'];
}

export interface TabNavProps {
  readonly label: string;
  readonly items: readonly TabNavItem[];
  readonly className?: string;
}

/**
 * Route sections as tabs: links with `aria-current`, not an ARIA tab list,
 * because each one is a page. In-place panels use `Tabs`. Replaces the
 * drafts' `SubNav`.
 *
 * Stub (SPEC §4.9): renders the links; the shell package adds the current
 * page, badges and indicator.
 */
export function TabNav({ label, items, className }: TabNavProps): ReactNode {
  return (
    <nav aria-label={label} className={cx('itsm-TabNav', className)}>
      {items.map((item) => (
        <a key={item.id} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
