'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface HierNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly count?: number;
  readonly children?: readonly HierNavItem[];
}

export interface HierNavProps {
  readonly label: string;
  readonly items: readonly HierNavItem[];
  readonly className?: string;
}

function Items({ items }: { readonly items: readonly HierNavItem[] }): ReactNode {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <a href={item.href}>{item.label}</a>
          {item.children && item.children.length > 0 ? <Items items={item.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Nested links — the CMDB classes, organisations — as nested lists with
 * `aria-current`, not an ARIA tree: a tree's keyboard model is one nobody
 * expects of a set of links (X-02).
 *
 * Stub (SPEC §4.9): renders the nested lists; the shell package adds the
 * current page, counts and styling.
 */
export function HierNav({ label, items, className }: HierNavProps): ReactNode {
  return (
    <nav aria-label={label} className={cx('itsm-HierNav', className)}>
      <Items items={items} />
    </nav>
  );
}
