'use client';

import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import type { Crumb } from '../types.js';
import { cx } from '../web/cx.js';
import { LazyMenuButton } from './LazyMenuButton.js';
import { ShellLink } from './ShellLink.js';

export interface BreadcrumbsProps {
  readonly items: readonly Crumb[];
  /** The landmark's name, "Breadcrumb" by default. */
  readonly label?: string;
  readonly className?: string;
}

function Separator(): ReactNode {
  return <Icon name="chevron-right" size="xs" directional className="itsm-Breadcrumbs__separator" />;
}

/**
 * Where this page sits: a `nav` holding an ordered list, each ancestor a
 * link, the page itself plain text with `aria-current="page"`. The chevrons
 * between them are drawn, not spoken, and mirror right to left.
 *
 * It adapts to its own width rather than the window's: under 480 px of room
 * the middle of a long trail folds into a "…" menu (first, …, parent, page);
 * and on a phone the whole trail becomes a single "‹ Parent" link, the way
 * iOS names the way back.
 */
export function Breadcrumbs({ items, label = 'Breadcrumb', className }: BreadcrumbsProps): ReactNode {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;
  // The nearest ancestor that can be followed: the compact form's "‹ Parent".
  const parent = [...items.slice(0, lastIndex)].reverse().find((item) => item.href);
  const middle = items.slice(1, Math.max(1, lastIndex - 1)).filter((item) => item.href);
  const foldable = items.length > 3 && middle.length > 0;

  return (
    <nav aria-label={label} className={cx('itsm-Breadcrumbs', className)} data-foldable={foldable || undefined}>
      <ol className="itsm-Breadcrumbs__list">
        {items.map((item, index) => {
          const isLast = index === lastIndex;
          // Everything strictly between the first crumb and the parent folds.
          const folds = foldable && index > 0 && index < lastIndex - 1;
          return (
            <li key={`${index}-${item.label}`} className="itsm-Breadcrumbs__item" data-fold={folds || undefined}>
              {index > 0 ? <Separator /> : null}
              {isLast || !item.href ? (
                <span className="itsm-Breadcrumbs__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                <ShellLink href={item.href} className="itsm-Breadcrumbs__link">
                  {item.label}
                </ShellLink>
              )}
              {foldable && index === 0 ? (
                <span className="itsm-Breadcrumbs__more">
                  <Separator />
                  <LazyMenuButton
                    label="More pages in this trail"
                    items={middle.map((crumb, position) => ({ id: `crumb-${position}`, label: crumb.label, href: crumb.href! }))}
                    renderTrigger={(props) => (
                      <button type="button" className="itsm-Breadcrumbs__moreButton" aria-label="More pages in this trail" {...props}>
                        <Icon name="ellipsis" size="sm" />
                      </button>
                    )}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {parent?.href ? (
        <ShellLink href={parent.href} className="itsm-Breadcrumbs__parent">
          <Icon name="chevron-left" size="sm" directional />
          <span>{parent.label}</span>
        </ShellLink>
      ) : null}
    </nav>
  );
}
