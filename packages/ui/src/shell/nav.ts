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

export interface NavModel {
  /** The navigation landmark's name. */
  readonly label: string;
  readonly sections: readonly NavSection[];
  readonly footer?: readonly NavItem[];
  readonly pinned?: { readonly enabled: boolean; readonly max?: number };
  readonly recent?: { readonly enabled: boolean; readonly max?: number };
}

/** An application the person can switch to. Only apps they can use are listed. */
export interface AppSwitcherItem {
  readonly app: AppName;
  readonly label: string;
  readonly href: string;
}

/** The brand block at the top of a frame, with the app switcher when there is more than one app. */
export interface ShellBrand {
  readonly name: string;
  readonly tenant?: string;
  readonly href: string;
  readonly app: AppName;
  readonly switcher?: readonly AppSwitcherItem[];
}
