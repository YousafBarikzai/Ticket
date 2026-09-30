'use client';

import { useMemo, type ReactNode } from 'react';
import { formatNumber } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from '../web/cx.js';
import { usePathnameSafe, WithSearch } from './location.js';
import { hrefPath, type SearchLike } from './match.js';
import { ShellLink } from './ShellLink.js';

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

/**
 * How closely an item's href describes the location: the path must be the
 * same, and every query value the href names must be there. The item naming
 * the most values wins, so "Servers › Linux" (`?class=server&os=linux`) is
 * current over "Servers" (`?class=server`), and an href with no query only
 * matches the page without the filter.
 */
function score(href: string, pathname: string, search: SearchLike | null): number {
  if (hrefPath(href) !== hrefPath(pathname || '/')) return 0;
  const query = href.includes('?') ? new URLSearchParams(href.slice(href.indexOf('?') + 1).split('#')[0]) : null;
  const wanted = query ? [...query.entries()] : [];
  if (wanted.length === 0) return 1;
  if (!search) return 0;
  for (const [name, value] of wanted) if (search.get(name) !== value) return 0;
  return 1 + wanted.length;
}

function currentId(items: readonly HierNavItem[], pathname: string, search: SearchLike | null): string | null {
  let best: string | null = null;
  let bestScore = 0;
  const walk = (list: readonly HierNavItem[]): void => {
    for (const item of list) {
      const value = score(item.href, pathname, search);
      if (value > bestScore) {
        best = item.id;
        bestScore = value;
      }
      if (item.children) walk(item.children);
    }
  };
  walk(items);
  // An href without a query is current only when the location has none of
  // the query values any item filters on ("All classes" on the bare page).
  if (bestScore === 1 && search && hasAnyFilter(items, search)) return null;
  return best;
}

function hasAnyFilter(items: readonly HierNavItem[], search: SearchLike): boolean {
  const names = new Set<string>();
  const walk = (list: readonly HierNavItem[]): void => {
    for (const item of list) {
      if (item.href.includes('?')) for (const name of new URLSearchParams(item.href.slice(item.href.indexOf('?') + 1)).keys()) names.add(name);
      if (item.children) walk(item.children);
    }
  };
  walk(items);
  return [...names].some((name) => search.get(name) !== null);
}

function Items({
  items,
  current,
  depth,
  locale,
}: {
  readonly items: readonly HierNavItem[];
  readonly current: string | null;
  readonly depth: number;
  readonly locale: string | undefined;
}): ReactNode {
  return (
    <ul className="itsm-HierNav__list" data-depth={depth}>
      {items.map((item) => (
        <li key={item.id} className="itsm-HierNav__entry">
          <ShellLink href={item.href} className="itsm-HierNav__link" aria-current={item.id === current ? 'page' : undefined}>
            <span className="itsm-HierNav__label">{item.label}</span>
            {item.count !== undefined ? (
              <span className="itsm-HierNav__count">
                <span className="itsm-visually-hidden">, </span>
                {formatNumber(item.count, { locale })}
              </span>
            ) : null}
          </ShellLink>
          {item.children && item.children.length > 0 ? <Items items={item.children} current={current} depth={depth + 1} locale={locale} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Nested links — the CMDB classes, organisations — as nested lists with
 * `aria-current`, not an ARIA tree: a tree's keyboard model (arrows, not
 * Tab) is one nobody expects of a set of links, and these are links (X-02).
 * Each level indents one step; counts sit at the end in tabular figures.
 *
 * The current item is matched on the path and the query its href names, so
 * a class filter (`/cmdb?class=server`) is current only while it is applied.
 */
export function HierNav({ label, items, className }: HierNavProps): ReactNode {
  const pathname = usePathnameSafe();
  const locale = useOptionalItsm()?.locale;
  const plain = useMemo(() => <Items items={items} current={currentId(items, pathname, null)} depth={0} locale={locale} />, [items, pathname, locale]);
  return (
    <nav aria-label={label} className={cx('itsm-HierNav', className)}>
      <WithSearch fallback={plain}>
        {(search: SearchLike) => <Items items={items} current={currentId(items, pathname, search)} depth={0} locale={locale} />}
      </WithSearch>
    </nav>
  );
}
