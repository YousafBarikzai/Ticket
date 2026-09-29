'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';
import type { NavItem } from './nav.js';

export interface TabBarProps {
  /** At most five. */
  readonly items: readonly NavItem[];
  readonly className?: string;
}

/**
 * The portal's docked bottom tab bar below 768 px: full width, above the safe
 * area, hidden while the software keyboard is open.
 *
 * Stub (SPEC §4.9): renders the links; the shell package adds the current
 * page, badges, docking and keyboard hiding.
 */
export function TabBar({ items, className }: TabBarProps): ReactNode {
  return (
    <nav className={cx('itsm-TabBar', className)}>
      {items.map((item) => (
        <a key={item.id} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
