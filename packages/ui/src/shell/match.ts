/**
 * Which navigation item is the current page.
 *
 * One rule for every frame — sidebar, rail, pills, tab bar, route tabs,
 * breadcrumbs — so the same item is current wherever it is drawn. Pure
 * functions, server-safe: a layout may run them to pick a title.
 *
 * - `exact`: the pathname equals the item's.
 * - `prefix` (the default for everything but `/`): the pathname is the item's
 *   or below it, so `/rules/vip` keeps *Rules* current. `/` is never a
 *   prefix of everything; it is exact unless an item says otherwise.
 * - `{ pathname, search }`: that pathname exactly, with those query values —
 *   the workbench's `/inbox/all?assignee=…` style of view.
 *
 * Several items can match (`/cmdb` and `/cmdb/assets` at `/cmdb/assets`);
 * the most specific one wins — a query match over an exact one over a
 * prefix, then the longer path — so exactly one item carries
 * `aria-current="page"`.
 */
import type { NavItem, NavMatch, NavModel, RouteTitle } from './nav.js';

/** The path part of an href: no query, no fragment, no trailing slash (except the root). */
export function hrefPath(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path === '' ? '/' : path;
}

function normalise(pathname: string): string {
  return hrefPath(pathname || '/');
}

/** A read-only view of the query, as `URLSearchParams` or anything with `get`. */
export interface SearchLike {
  get(name: string): string | null;
}

/**
 * How well an item matches the location: `0` for no match, higher for a more
 * specific one. The score orders candidates; its value means nothing else.
 */
export function matchScore(
  item: { readonly href: string; readonly match?: NavMatch },
  pathname: string,
  search?: SearchLike | null,
): number {
  const current = normalise(pathname);
  const match: NavMatch = item.match ?? (hrefPath(item.href) === '/' ? 'exact' : 'prefix');

  if (typeof match === 'object') {
    if (normalise(match.pathname) !== current) return 0;
    const wanted = Object.entries(match.search ?? {});
    // Without the query (a server render, or before the leaf has read it) a
    // query-specific item cannot claim to be current.
    if (wanted.length > 0 && !search) return 0;
    for (const [name, value] of wanted) if (search?.get(name) !== value) return 0;
    return 3_000_000 + wanted.length * 10_000 + current.length;
  }

  const base = hrefPath(item.href);
  if (match === 'exact') return base === current ? 2_000_000 + base.length : 0;
  if (base === current) return 1_000_000 + base.length + 0.5;
  if (base === '/' ) return 0;
  return current.startsWith(`${base}/`) ? 1_000_000 + base.length : 0;
}

/** Every item in a list, children included, depth first. */
export function flattenItems(items: readonly NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (list: readonly NavItem[]): void => {
    for (const item of list) {
      out.push(item);
      if (item.children) walk(item.children);
    }
  };
  walk(items);
  return out;
}

/** Every item a nav model draws: its sections, then its footer. */
export function navModelItems(model: Pick<NavModel, 'sections' | 'footer'>): NavItem[] {
  return flattenItems([...model.sections.flatMap((section) => section.items), ...(model.footer ?? [])]);
}

/**
 * The id of the current item among `items`, or `null`. Ties keep the first
 * item in reading order, so a model that lists the same page twice marks the
 * first.
 */
export function currentItemId<T extends { readonly id: string; readonly href: string; readonly match?: NavMatch }>(
  items: readonly T[],
  pathname: string,
  search?: SearchLike | null,
): string | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const score = matchScore(item, pathname, search);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}

/** Whether any item asks about the query, so only then does a frame read it (it costs a Suspense boundary in Next). */
export function needsSearch(items: readonly { readonly match?: NavMatch }[]): boolean {
  return items.some((item) => typeof item.match === 'object' && Object.keys(item.match.search ?? {}).length > 0);
}

/**
 * Whether `pathname` fits a route pattern: literal segments, `[name]` for
 * exactly one segment, `[...name]` for one or more to the end.
 */
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const want = hrefPath(pattern).split('/').filter(Boolean);
  const have = normalise(pathname).split('/').filter(Boolean);
  for (let index = 0; index < want.length; index++) {
    const part = want[index]!;
    if (/^\[\.\.\.[^\]]+\]$/.test(part)) return have.length > index;
    if (index >= have.length) return false;
    if (/^\[[^\]]+\]$/.test(part)) continue;
    if (part !== have[index]) return false;
  }
  return want.length === have.length;
}

/** The first route title whose pattern fits the location, for a page under no nav item (A2 §5.2.3). */
export function currentRouteTitle(routes: readonly RouteTitle[] | undefined, pathname: string): RouteTitle | null {
  return routes?.find((route) => matchesRoutePattern(route.pattern, pathname)) ?? null;
}
