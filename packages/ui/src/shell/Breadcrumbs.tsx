'use client';

import type { ReactNode } from 'react';
import type { Crumb } from '../types.js';
import { cx } from '../web/cx.js';

export interface BreadcrumbsProps {
  readonly items: readonly Crumb[];
  /** The landmark's name, "Breadcrumb" by default. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Where this page sits: `nav > ol`, the last item `aria-current="page"`.
 *
 * Stub (SPEC §4.9): renders the trail; the shell package adds collapsing and
 * the compact "‹ Parent" form.
 */
export function Breadcrumbs({ items, label = 'Breadcrumb', className }: BreadcrumbsProps): ReactNode {
  return (
    <nav aria-label={label} className={cx('itsm-Breadcrumbs', className)}>
      <ol>
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`}>
            {item.href && index < items.length - 1 ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
