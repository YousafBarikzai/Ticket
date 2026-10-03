import type { IconName } from '@itsm/ui';
import type { MenuItemSpec } from '@itsm/ui/overlays';
import type { NavBadge, NavItem, NavModel } from '@itsm/ui/shell';

/**
 * The portal's map (SPEC §5.1, §5.4): one description of its pages that the
 * top bar's pills, the phone's tab bar, the avatar menu, the palette's
 * *Go to* group and the pages' own gates are all drawn from, so the four can
 * never disagree about what a person may open.
 *
 * Pure and serialisable. The `(portal)` layout builds the frame's model on
 * the server from the person's permissions; the lazy palette reads the same
 * items on the client. Who may use the other areas is not decided here: the
 * gates and the switcher's rows are `@itsm/contracts/areas`' (v3 §3.2), built
 * per request by `currentAreas()`.
 *
 * Three rules this file exists to hold:
 *
 *   - **Nav label = H1 = `<title>` noun.** "My requests" is the pill, the
 *     page's heading and its tab title; the tab bar may shorten a label to fit
 *     320 px ("Requests"), never rename it.
 *   - **Approvals are never in the primary navigation** (X-44). Most people
 *     who use the portal never approve anything, and a permanent tab for them
 *     is a tab that is empty. They are a row in the avatar menu and on the Me
 *     page, with a count on the avatar and on *Me* when something is waiting.
 *   - **A page and its navigation item have one gate.** A pill is shown to
 *     exactly the people its page lets in (any-of, exact key match).
 */

/* ------------------------------------------------------------ Permissions */

/** What the frame needs to know about the person, as booleans (nothing else crosses to the client). */
export interface PortalCan {
  /** `catalogue.read`: Services. */
  readonly readCatalogue: boolean;
  /** `knowledge.read`: Knowledge. */
  readonly readKnowledge: boolean;
  /** `approval.read`: the Approvals row and its count. Without it the layout never asks. */
  readonly readApprovals: boolean;
  /** `ticket.create`: *New request* and *Report an issue*. */
  readonly createTickets: boolean;
  /** `search.query`: answers and requests in the palette. */
  readonly search: boolean;
}

export function portalCan(held: ReadonlySet<string>): PortalCan {
  return {
    readCatalogue: held.has('catalogue.read'),
    readKnowledge: held.has('knowledge.read'),
    readApprovals: held.has('approval.read'),
    createTickets: held.has('ticket.create'),
    search: held.has('search.query'),
  };
}

/** Any of `keys` held (exact match); an empty gate is open to everyone signed in. */
export function holdsAny(held: ReadonlySet<string>, keys: readonly string[]): boolean {
  return keys.length === 0 || keys.some((key) => held.has(key));
}

/* ----------------------------------------------------------------- Routes */

/** Where a page sits in the frame: which navigation item is current while it is open. */
export type PortalSection = 'home' | 'tickets' | 'catalogue' | 'knowledge' | 'me' | 'approvals' | null;

export interface PortalRoute {
  /** As the file system spells it: `/tickets/[id]`. */
  readonly route: string;
  /** The page's noun: its H1 and `<title>` (the H1 of an item page is the item's own name). */
  readonly label: string;
  /** Any of these opens it; empty = everyone signed in. */
  readonly read: readonly string[];
  readonly section: PortalSection;
  /** Planned by a later package and not built yet: the map knows it, the file system does not. */
  readonly pending?: boolean;
}

/**
 * Every page under `(portal)`. The nav test fails when a `page.tsx` is added
 * without an entry here, or an entry names a page that does not exist
 * without being marked pending.
 */
export const ROUTES: readonly PortalRoute[] = [
  { route: '/', label: 'Home', read: [], section: 'home' },
  { route: '/tickets', label: 'My requests', read: [], section: 'tickets' },
  { route: '/tickets/[id]', label: 'My requests', read: [], section: 'tickets' },
  { route: '/catalogue', label: 'Services', read: ['catalogue.read'], section: 'catalogue' },
  { route: '/catalogue/[key]', label: 'Services', read: ['catalogue.read'], section: 'catalogue' },
  { route: '/knowledge', label: 'Knowledge', read: ['knowledge.read'], section: 'knowledge' },
  { route: '/knowledge/[key]', label: 'Knowledge', read: ['knowledge.read'], section: 'knowledge' },
  { route: '/profile', label: 'Profile', read: [], section: 'me' },
  { route: '/approvals', label: 'Approvals', read: ['approval.read'], section: 'approvals' },
  { route: '/report', label: 'Report an issue', read: ['ticket.create'], section: null },
  { route: '/search', label: 'Results', read: ['search.query'], section: null },
];

function segmentsMatch(pattern: string, pathname: string): boolean {
  const want = pattern.split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  if (want.length !== have.length) return false;
  return want.every((segment, index) => (segment.startsWith('[') && segment.endsWith(']') ? have[index] !== '' : segment === have[index]));
}

/** The map's entry for a URL path (`/tickets/INC-000123` → `/tickets/[id]`), or null for a path that is no page. */
export function routeFor(pathname: string): PortalRoute | null {
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  return ROUTES.find((entry) => entry.route === path) ?? ROUTES.find((entry) => segmentsMatch(entry.route, path)) ?? null;
}

/** The gate a page applies to itself: its entry's any-of list. */
export function pageGate(route: string): readonly string[] {
  const entry = ROUTES.find((candidate) => candidate.route === route);
  if (!entry) throw new Error(`navigation.ts has no entry for ${route}`);
  return entry.read;
}

/** Whether the person may open a page, by its route as the file system spells it. */
export function mayOpen(route: string, held: ReadonlySet<string>): boolean {
  return holdsAny(held, pageGate(route));
}

/* ------------------------------------------------------------- Navigation */

interface PortalNavEntry {
  readonly id: Exclude<PortalSection, null | 'approvals' | 'me'>;
  readonly label: string;
  /** The tab bar's word, where the pill's does not fit 320 px. */
  readonly tabLabel: string;
  readonly href: string;
  readonly icon: IconName;
  readonly read: readonly string[];
  readonly keywords: readonly string[];
}

/** The top bar's pills, in order (SPEC §5.4). Approvals is not one of them, and never will be. */
export const PRIMARY_NAV: readonly PortalNavEntry[] = [
  { id: 'home', label: 'Home', tabLabel: 'Home', href: '/', icon: 'home', read: [], keywords: ['start', 'front page'] },
  {
    id: 'tickets',
    label: 'My requests',
    tabLabel: 'Requests',
    href: '/tickets',
    icon: 'ticket',
    read: [],
    keywords: ['tickets', 'issues', 'my tickets', 'status'],
  },
  {
    id: 'catalogue',
    label: 'Services',
    tabLabel: 'Services',
    href: '/catalogue',
    icon: 'catalogue',
    read: ['catalogue.read'],
    keywords: ['catalogue', 'request something', 'order', 'software', 'access', 'equipment'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    tabLabel: 'Knowledge',
    href: '/knowledge',
    icon: 'knowledge',
    read: ['knowledge.read'],
    keywords: ['help articles', 'how to', 'answers', 'guides'],
  },
];

/** The last tab on a phone, where the avatar menu is on a wide screen. */
export const ME_TAB = { id: 'me', label: 'Me', href: '/profile', icon: 'profile' } as const satisfies Pick<NavItem, 'id' | 'label' | 'href' | 'icon'>;

/** Every tab label fits a fifth of 320 px in the footnote style (X-91): the test holds it to this many characters. */
export const TAB_LABEL_MAX = 9;

/** "2 approvals waiting": the words a screen reader says for the count on the avatar and on *Me*. */
export function approvalsWaitingLabel(waiting: number): string {
  return waiting === 1 ? '1 approval waiting' : `${waiting > 99 ? '99+' : waiting} approvals waiting`;
}

function approvalsBadge(waiting: number): NavBadge | undefined {
  return waiting > 0 ? { value: waiting, tone: 'accent', label: approvalsWaitingLabel(waiting) } : undefined;
}

function visible(can: PortalCan): readonly PortalNavEntry[] {
  return PRIMARY_NAV.filter(
    (entry) => (entry.id !== 'catalogue' || can.readCatalogue) && (entry.id !== 'knowledge' || can.readKnowledge),
  );
}

export interface PortalFrameModel {
  /** The pills (≥ 768 px). */
  readonly nav: NavModel;
  /** The docked tab bar (< 768 px): the pills with short labels, then *Me*. At most five. */
  readonly tabs: readonly NavItem[];
  /** The avatar menu's own entries, before Appearance: Profile, Approvals (count), Help. */
  readonly menu: readonly MenuItemSpec[];
  /** The count on the avatar, when approvals are waiting. */
  readonly avatarBadge?: { readonly value: number; readonly label: string };
}

/**
 * The frame's navigation for one person. `waiting` is the number of
 * approvals waiting on them — undecided ones only; zero without
 * `approval.read`.
 */
export function portalFrame(can: PortalCan, waiting: number): PortalFrameModel {
  const entries = visible(can);
  const badge = can.readApprovals ? approvalsBadge(waiting) : undefined;
  const items: NavItem[] = entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    href: entry.href,
    icon: entry.icon,
    ...(entry.id === 'home' ? { match: 'exact' as const } : {}),
    keywords: entry.keywords,
  }));
  const tabs: NavItem[] = [
    ...entries.map((entry) => ({
      id: entry.id,
      label: entry.tabLabel,
      href: entry.href,
      icon: entry.icon,
      ...(entry.id === 'home' ? { match: 'exact' as const } : {}),
    })),
    { ...ME_TAB, ...(badge ? { badge } : {}) },
  ];

  const menu: MenuItemSpec[] = [{ id: 'profile', label: 'Profile', icon: 'profile', href: '/profile' }];
  if (can.readApprovals) {
    menu.push({
      id: 'approvals',
      label: 'Approvals',
      icon: 'approvals',
      href: '/approvals',
      description: waiting > 0 ? approvalsWaitingLabel(waiting) : 'Nothing waiting on you',
    });
  }

  return {
    nav: { label: 'Main', sections: [{ id: 'main', items }] },
    tabs,
    menu,
    ...(badge ? { avatarBadge: { value: badge.value, label: badge.label! } } : {}),
  };
}

/**
 * Whether the top bar offers *New request* here (X-84: one primary per view).
 * Not where the page already has it as its own primary action — Home's hero
 * and My requests' header — and not on the report page, which is the flow
 * itself. Not on a request (`/tickets/<n>`), whose hero card carries the one
 * thing to do there (Reply, Is it fixed?, Report it again), nor on a service
 * being requested (`/catalogue/<key>`), whose form ends in its own primary
 * and is a full-screen flow on phones. Not at all without `ticket.create`.
 */
export function showsNewRequest(pathname: string, can: Pick<PortalCan, 'createTickets'>): boolean {
  if (!can.createTickets) return false;
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/tickets' || path === '/report') return false;
  const segments = path.split('/').filter(Boolean);
  return !(segments.length === 2 && (segments[0] === 'tickets' || segments[0] === 'catalogue'));
}
