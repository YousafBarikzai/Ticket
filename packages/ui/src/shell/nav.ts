/**
 * The navigation model every frame renders from: one description of an app's
 * sections, items, badges and matching rules, drawn as a sidebar, a rail, a
 * top bar, a tab bar or palette commands. Serialisable, so an app's
 * `navigation.ts` can be built on the server. Types only.
 */
import type { AppName } from '../theme/prefs.js';
import type { IconName } from '../types.js';

export interface NavBadge {
  readonly value: number;
  /** The source stopped counting: shown as "99+". */
  readonly capped?: boolean;
  readonly tone?: 'neutral' | 'accent' | 'danger';
  /** Spoken text, e.g. "3 approvals waiting". */
  readonly label?: string;
}

/** When an item is the current page: exactly, as a path prefix, or on a pathname plus query. */
export type NavMatch =
  | 'exact'
  | 'prefix'
  | { readonly pathname: string; readonly search?: Readonly<Record<string, string>> };

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: IconName;
  readonly badge?: NavBadge;
  readonly match?: NavMatch;
  readonly children?: readonly NavItem[];
  readonly shortcut?: string;
  /**
   * The purpose line the sidebar frame's top bar shows under the title while
   * this item is current (v3 §3.4): one line, sentence case, no full stop.
   */
  readonly description?: string;
  /** Extra words the palette matches. */
  readonly keywords?: readonly string[];
}

export interface NavSection {
  readonly id: string;
  readonly label?: string;
  readonly collapsible?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly items: readonly NavItem[];
}

/**
 * The top bar's title for a route no nav item covers — the Service Desk's
 * `/tickets/[id]` — so the bar is right in the server HTML before the page
 * publishes anything (A2 §5.2.3 rule 2).
 */
export interface RouteTitle {
  /** A path pattern: literal segments, `[name]` for one segment, `[...name]` for the rest. */
  readonly pattern: string;
  /** The section the record belongs to, shown as "‹ {title}" when `href` is set. */
  readonly title: string;
  /** Where "‹" goes back to: the list the record was opened from. */
  readonly href?: string;
  /** The section's purpose line. */
  readonly purpose?: string;
}

export interface NavModel {
  /** The navigation landmark's name. */
  readonly label: string;
  readonly sections: readonly NavSection[];
  readonly footer?: readonly NavItem[];
  readonly pinned?: { readonly enabled: boolean; readonly max?: number };
  readonly recent?: { readonly enabled: boolean; readonly max?: number };
  /** Titles for routes under no nav item, first match wins. */
  readonly routes?: readonly RouteTitle[];
}

/**
 * A tab in the phone tab bar that acts instead of navigating: the Service
 * Desk's Search (opens the palette) and More (opens the navigation sheet),
 * which are buttons that open dialogs (A2 §7.1).
 */
export interface TabAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Client only: what pressing the tab does. */
  onSelect(): void;
  /** What it opens, for `aria-haspopup`. */
  readonly haspopup?: 'dialog';
  /** The `id` of what it opens, for `aria-controls`. */
  readonly controls?: string;
  /** Drawn as current while what it opened is showing (More while the sheet is open). */
  readonly expanded?: boolean;
  readonly badge?: NavBadge;
  /**
   * A dot without a number, for "something in here needs you" — More's red
   * dot when any navigation count is a danger one. Its words join the tab's
   * name.
   */
  readonly dot?: { readonly label: string };
}

/** One tab of the phone tab bar: a page, or an action (v3 §3.10). */
export type TabItem = NavItem | TabAction;

/**
 * An application the person can switch to. Only apps they can use are listed.
 *
 * @deprecated v2: replaced by `AreaModel` (`@itsm/contracts/areas`). Removed
 * with the other RV1 aliases by the wave-3 integrator.
 */
export interface AppSwitcherItem {
  readonly app: AppName;
  readonly label: string;
  readonly href: string;
}

/**
 * The brand block at the top of a frame: a link to the current area's home,
 * with the workspace (tenant) name under the product's (v3 §3.4). The area
 * itself, and the way to the others, come from the frame's `areas`.
 */
export interface ShellBrand {
  /** The current area's home: what the product mark links to. */
  readonly href: string;
  /** The workspace's name, under the product name. */
  readonly workspace?: string;
  /** @deprecated v2 (RV1): the app's name. Without `areas` it names the single-area lockup (`areasFromV2Brand`). */
  readonly name?: string;
  /** @deprecated v2 (RV1): use `workspace`. */
  readonly tenant?: string;
  /** @deprecated v2 (RV1): the current area comes from `areas.current`. */
  readonly app?: AppName;
  /** @deprecated v2 (RV1): the other areas come from `areas`; ignored. */
  readonly switcher?: readonly AppSwitcherItem[];
}
