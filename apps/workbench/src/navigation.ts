import {
  AREAS,
  SERVICE_DESK_OVERVIEW_PURPOSE,
  crossAreaHref,
  isServiceDeskRoutePending,
  type AreaId,
  type AreaModel,
} from '@itsm/contracts/areas';
import type { CommandItem, IconName } from '@itsm/ui';
import { areaPersonaLine, type NavItem, type NavModel, type NavSection, type RouteTitle } from '@itsm/ui/shell';
import { TEAM_VIEW, VIEWS, viewById, viewKey, viewPath, viewRefFromLastView, type TeamSummary, type ViewRef } from './inbox/views.js';

/**
 * The Service Desk's map (SPEC v3 §3.5; A2 §5.4.1, §7.1, §10.3): every page
 * of the area, the gate that opens it, where it sits in the sidebar, the
 * phone's tabs, the palette's places and the frame's links out.
 *
 * One table, read by everything that offers a way somewhere, so a link is
 * shown to exactly the people its page lets in, and a page that is not built
 * yet is offered to nobody. `__tests__/navigation.test.ts` holds the table to
 * the pages on disk: every `page.tsx` is on it, and a route still pending
 * that grows a page fails until the integrator takes it out of the pending
 * set (§15.1).
 *
 * **Server-side.** The pending set, the area names and `crossAreaHref` come
 * from `@itsm/contracts/areas`, whose frozen tables cost a client bundle
 * about 4 kB that nothing could shake out. So the `(desk)` layout builds
 * the frame here, per request, and hands `DeskShell` plain data — the
 * navigation model, the tabs, the palette's places and the links — and the
 * client adds only what it alone knows: counts and button handlers. A client
 * module may `import type` from this file and nothing else.
 */

/* ------------------------------------------------------------------ Pending */

/**
 * Routes this build does not have yet (RV6): `/board` until wave 5, the
 * Phase 2 and 3 pages until waves 6 and 7. Owned by the contracts, so the
 * Service Desk and Administration frames, the Overview and the public site
 * read one set; the integrators of waves 5–7 empty it.
 */
export { SERVICE_DESK_PENDING as PENDING, isServiceDeskRoutePending as isPending } from '@itsm/contracts/areas';

/* -------------------------------------------------------------------- Names */

/** The area's home (`AREAS.workbench.home`): where `/` and a sign-in land. */
export const DESK_HOME = AREAS.workbench.home;

/** Any one of these permission keys opens the route. Empty: anyone with a session. */
export type Gate = readonly string[];

const READ_TICKETS: Gate = ['ticket.read'];

/** How a route is reached, which is what decides where it appears. */
export type RouteKind =
  /** A sidebar item (and, for some, a phone tab or a palette place). */
  | 'item'
  /** No item: a record under a section, titled "‹ {section}" in the top bar. */
  | 'record'
  /** Answers with a redirect; never offered as a page of its own. */
  | 'redirect'
  /** Outside the frame: the sign-in, demo and offline pages. */
  | 'outside';

export interface DeskRoute {
  /** As the app directory spells it, route groups removed: `/inbox/[view]`. */
  readonly route: string;
  readonly kind: RouteKind;
  readonly gate: Gate;
}

/**
 * Every page of the Service Desk. The Phase 2 and 3 entries are here from
 * the start, so that the page each later wave adds is already on the map and
 * already gated; while pending it is offered nowhere.
 */
export const ROUTES: readonly DeskRoute[] = [
  { route: '/', kind: 'redirect', gate: [] },
  { route: '/overview', kind: 'item', gate: READ_TICKETS },
  { route: '/inbox', kind: 'redirect', gate: READ_TICKETS },
  { route: '/inbox/[view]', kind: 'item', gate: READ_TICKETS },
  { route: '/inbox/team/[teamId]', kind: 'item', gate: READ_TICKETS },
  { route: '/queue', kind: 'redirect', gate: READ_TICKETS },
  { route: '/board', kind: 'redirect', gate: READ_TICKETS },
  { route: '/tickets/[id]', kind: 'record', gate: READ_TICKETS },
  { route: '/team', kind: 'item', gate: ['analytics.read'] },
  { route: '/major-incidents', kind: 'item', gate: ['incident.major.read'] },
  { route: '/major-incidents/[number]', kind: 'record', gate: ['incident.major.read'] },
  { route: '/changes', kind: 'item', gate: ['change.read'] },
  { route: '/problems', kind: 'item', gate: ['problem.read'] },
  { route: '/problems/[number]', kind: 'record', gate: ['problem.read'] },
  { route: '/knowledge', kind: 'item', gate: ['knowledge.read'] },
  { route: '/knowledge/new', kind: 'record', gate: ['knowledge.write'] },
  { route: '/knowledge/[key]', kind: 'record', gate: ['knowledge.read'] },
  { route: '/demo', kind: 'outside', gate: [] },
  { route: '/offline', kind: 'outside', gate: [] },
  { route: '/sign-in', kind: 'outside', gate: [] },
  { route: '/signed-out', kind: 'outside', gate: [] },
];

function segments(path: string): string[] {
  return path.split(/[?#]/, 1)[0]!.split('/').filter(Boolean);
}

/**
 * The pattern a path is served by: `/tickets/INC-000123` → `/tickets/[id]`.
 * Of the patterns that fit, the one with the most literal segments wins, so
 * `/knowledge/new` is the editor, not an article called "new".
 */
export function routeFor(path: string): string | null {
  const wanted = segments(path);
  let best: { route: string; literal: number } | null = null;
  for (const { route } of ROUTES) {
    const parts = segments(route);
    if (parts.length !== wanted.length) continue;
    let literal = 0;
    let fits = true;
    for (const [index, part] of parts.entries()) {
      if (part.startsWith('[')) continue;
      if (part !== wanted[index]) {
        fits = false;
        break;
      }
      literal += 1;
    }
    if (fits && (best === null || literal > best.literal)) best = { route, literal };
  }
  return best?.route ?? null;
}

/** The route's entry, or null for an address the map does not know. */
export function routeEntry(route: string): DeskRoute | null {
  return ROUTES.find((entry) => entry.route === route) ?? null;
}

/** Whether this person may open the page a path is served by. An unknown address opens for nobody. */
export function mayOpen(held: ReadonlySet<string>, path: string): boolean {
  const route = routeFor(path);
  const entry = route ? routeEntry(route) : null;
  return entry !== null && (entry.gate.length === 0 || entry.gate.some((key) => held.has(key)));
}

/** A page this person may open that this build has: what any link to it needs. */
function offered(held: ReadonlySet<string>, path: string): boolean {
  return mayOpen(held, path) && !isServiceDeskRoutePending(path);
}

/* ---------------------------------------------------------------- The tree */

/** One entry of the tree, before it is gated: a sidebar item and the facts behind it. */
interface TreeItem extends NavItem {
  readonly icon: IconName;
  readonly description: string;
}

const OVERVIEW: TreeItem = {
  id: 'overview',
  label: 'Overview',
  href: DESK_HOME,
  icon: 'home',
  match: 'exact',
  shortcut: 'g o',
  description: SERVICE_DESK_OVERVIEW_PURPOSE,
  keywords: ['home', 'dashboard', 'queue health', 'at a glance'],
};

const TEAM_PERFORMANCE: TreeItem = {
  id: 'team',
  label: 'Team performance',
  href: '/team',
  icon: 'chart-bar',
  description: 'How your team is doing: workload, speed and promises kept',
  keywords: ['team', 'performance', 'leads', 'workload'],
};

const OPERATIONS: readonly TreeItem[] = [
  {
    id: 'major-incidents',
    label: 'Major incidents',
    href: '/major-incidents',
    icon: 'siren',
    description: "Live major incidents, who's leading them and when the next update is due",
    keywords: ['mi', 'outage', 'war room', 'incident'],
  },
  {
    id: 'changes',
    label: 'Changes',
    href: '/changes',
    icon: 'calendar',
    description: "Scheduled changes, blackout windows and this week's work",
    keywords: ['change calendar', 'blackout', 'release'],
  },
  {
    id: 'problems',
    label: 'Problems',
    href: '/problems',
    icon: 'bug',
    description: 'Root causes under investigation and known errors',
    keywords: ['root cause', 'known error', 'workaround'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    href: '/knowledge',
    icon: 'knowledge',
    description: "Articles you're writing and the ones due for review",
    keywords: ['articles', 'kb', 'knowledge base'],
  },
];

/** The ticket views (`inbox/views.ts`), as sidebar items: ids are the view ids, which the counts are filed under. */
function viewItems(): TreeItem[] {
  return VIEWS.map((view) => ({
    id: view.id,
    label: view.label,
    href: viewPath({ kind: 'view', id: view.id }),
    icon: view.icon,
    match: 'prefix',
    shortcut: view.shortcut,
    description: view.description,
    keywords: view.keywords,
  }));
}

function teamItem(team: TeamSummary): TreeItem {
  const ref: ViewRef = { kind: 'team', teamId: team.id };
  return {
    id: viewKey(ref),
    label: team.name,
    href: viewPath(ref),
    icon: TEAM_VIEW.icon,
    match: 'prefix',
    description: `Open work for ${team.name}`,
    keywords: ['team'],
  };
}

/**
 * The record pages' top-bar titles (A2 §5.2.3): `/tickets/[id]` reads
 * "‹ {the view it was opened from}", from the last-view cookie the proxy
 * keeps, else My work; the Phase 2 and 3 records read "‹ {their section}".
 */
function recordTitles(lastView: string | null | undefined, teams: readonly TeamSummary[]): RouteTitle[] {
  const ref = viewRefFromLastView(lastView) ?? { kind: 'view', id: 'mine' };
  const view =
    ref.kind === 'view'
      ? { title: viewById(ref.id).label, href: viewPath(ref), purpose: viewById(ref.id).description }
      : (() => {
          const name = teams.find((team) => team.id === ref.teamId)?.name;
          return name
            ? { title: name, href: viewPath(ref), purpose: `Open work for ${name}` }
            : { title: viewById('mine').label, href: viewPath({ kind: 'view', id: 'mine' }), purpose: viewById('mine').description };
        })();
  const section = (item: TreeItem): Omit<RouteTitle, 'pattern'> => ({ title: item.label, href: item.href, purpose: item.description });
  const [incidents, , problems, knowledge] = OPERATIONS as [TreeItem, TreeItem, TreeItem, TreeItem];
  return [
    { pattern: '/tickets/[id]', ...view },
    { pattern: '/major-incidents/[number]', ...section(incidents) },
    { pattern: '/problems/[number]', ...section(problems) },
    { pattern: '/knowledge/new', ...section(knowledge) },
    { pattern: '/knowledge/[key]', ...section(knowledge) },
  ];
}

export interface DeskNavInput {
  /** The permission keys the person holds. */
  readonly held: ReadonlySet<string>;
  /** The person's teams, named (`me.teamIds` against the tenant's teams). */
  readonly teams: readonly TeamSummary[];
  /** The last-view cookie, for the ticket page's "‹ {view}". */
  readonly lastView?: string | null;
}

/**
 * The sidebar (v3 §3.5): Overview; Tickets (the six views); Teams (Team
 * performance for leads, then each of the person's teams); Operations (major
 * incidents, changes, problems, knowledge). Each item is gated as its page is,
 * pending pages are left out, and a section with nothing in it is left out
 * with them. Board is not an item: it is a layout of a view, and the phone's
 * tab (§3.6).
 *
 * Without counts: the client fetches them and `navWithCounts` puts them on.
 */
export function deskNavModel({ held, teams, lastView }: DeskNavInput): NavModel {
  const keep = (items: readonly TreeItem[]): NavItem[] => items.filter((item) => offered(held, item.href));
  const sections: NavSection[] = [
    { id: 'overview', items: keep([OVERVIEW]) },
    { id: 'views', label: 'Tickets', items: keep(viewItems()) },
    { id: 'teams', label: 'Teams', collapsible: true, items: keep([TEAM_PERFORMANCE, ...teams.map(teamItem)]) },
    { id: 'operations', label: 'Operations', items: keep(OPERATIONS) },
  ].filter((section) => section.items.length > 0);
  const tickets = mayOpen(held, '/tickets/[id]');
  return {
    label: AREAS.workbench.name,
    sections,
    pinned: { enabled: tickets, max: 8 },
    recent: { enabled: tickets, max: 8 },
    routes: recordTitles(lastView, teams),
  };
}

/* ------------------------------------------------------------ Phone, palette */

/**
 * The phone tab bar's links (A2 §7.1): Overview · My work · Board. Board is
 * left out while `/board` is pending (RV6), so waves 3 and 4 show four tabs;
 * `DeskShell` adds the two buttons, Search and More, which open the palette
 * and the navigation sheet.
 */
export function deskTabLinks(held: ReadonlySet<string>): NavItem[] {
  const tabs: NavItem[] = [
    { id: 'overview', label: 'Overview', href: DESK_HOME, icon: 'home', match: 'exact' },
    { id: 'mine', label: viewById('mine').label, href: viewPath({ kind: 'view', id: 'mine' }), icon: viewById('mine').icon, match: 'prefix' },
    { id: 'board', label: 'Board', href: '/board', icon: 'columns-3', match: 'exact' },
  ];
  return tabs.filter((tab) => offered(held, tab.href));
}

/** A place the frame goes to with a `g` chord and that the palette lists under "Go to". */
export interface DeskDestination {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** The `g` chord (D14, + `g o` and `g b` in v3). */
  readonly shortcut: string;
  readonly keywords: readonly string[];
}

/**
 * The places besides the views (whose chords `inbox/views.ts` keeps): the
 * Overview (`g o`) and, once `/board` ships, the Board (`g b`). "Go to
 * Board" is hidden while the route is pending (RV6).
 */
export function deskDestinations(held: ReadonlySet<string>): DeskDestination[] {
  const all: DeskDestination[] = [
    { id: 'overview', label: 'Overview', href: DESK_HOME, icon: 'home', shortcut: 'g o', keywords: ['go to', 'home', ...(OVERVIEW.keywords ?? [])] },
    { id: 'board', label: 'Board', href: '/board', icon: 'columns-3', shortcut: 'g b', keywords: ['go to', 'kanban', 'columns', 'layout'] },
  ];
  return all.filter((place) => offered(held, place.href));
}

/**
 * The palette's "Switch area" group (A2 §10.3): "Switch to {area}" for each
 * other area the person has, answering to the area's keywords (D1:
 * "ticketing" finds the Service Desk), and in a demo the persona they will
 * continue as and the way home to the site (D18). Same-tab links, through
 * the area model's own hrefs, so a demo hop goes through the sibling's
 * `/demo` page with this page as its Referer.
 */
export function switchAreaCommands(areas: AreaModel): CommandItem[] {
  if (!areas.visible) return [];
  const items: CommandItem[] = areas.areas
    .filter((area) => !area.current)
    .map((area) => {
      const line = areaPersonaLine(area);
      return {
        id: `area:${area.id}`,
        label: `Switch to ${area.name}`,
        description: line ?? area.description,
        icon: area.icon,
        keywords: ['switch area', 'go to', ...AREAS[area.id].keywords, ...(area.persona ? [area.persona.name] : [])],
        href: area.href,
      };
    });
  if (areas.demo && areas.home) {
    items.push({ id: 'area:home', label: areas.home.label, icon: 'home', keywords: ['site', 'landing', 'home'], href: areas.home.href });
  }
  return items;
}

/* ------------------------------------------------------------------- Links */

/** The frame's links that leave the Service Desk, each built from the area model (A2 §3.7, §5.2.6). */
export interface DeskLinks {
  /** "Knowledge base · Help Portal": the Help Portal's knowledge, through `crossAreaHref`. */
  readonly knowledge: string | null;
  /** In a demo, who the Help Portal opens as ("You'll continue as Emma Clarke, Finance Manager"). */
  readonly knowledgePersona: string | null;
  /**
   * The bell's "Notification settings": the person's own preferences, which
   * live on the Help Portal's profile. None in a demo, where the Help Portal
   * opens as somebody else, so the link would set another person's.
   */
  readonly notificationSettings: string | null;
  /** Demo only (D18): the site's home, "IT Service Management home", and its "How the demo works" section. */
  readonly home: { readonly href: string; readonly label: string } | null;
  readonly howItWorks: string | null;
}

/** `https://itsm.example` → `https://itsm.example/#how-it-works` (A5's anchor). */
function howItWorksFrom(home: string): string {
  const base = home.split('#')[0]!;
  return `${base.endsWith('/') ? base : `${base}/`}#how-it-works`;
}

export function deskLinks(areas: AreaModel): DeskLinks {
  const portal: AreaId = 'portal';
  const portalRow = areas.areas.find((area) => area.id === portal);
  const home = areas.demo && areas.home ? { href: areas.home.href, label: areas.home.label } : null;
  return {
    knowledge: crossAreaHref(areas, portal, '/knowledge'),
    knowledgePersona: portalRow ? areaPersonaLine(portalRow) : null,
    notificationSettings: areas.demo ? null : crossAreaHref(areas, portal, '/profile#notifications'),
    home,
    howItWorks: home ? howItWorksFrom(home.href) : null,
  };
}

/* -------------------------------------------------------- The frame's chip */

/** What the frame knows of a live major incident: the API's row, and the incident's ticket for the Phase 1 link. */
export interface FrameIncident {
  readonly number: string;
  readonly title: string;
  readonly severity: string;
  /** The incident's ticket, which the chip links while `/major-incidents` is pending. */
  readonly ticketId: string | null;
}

export interface IncidentChip {
  /** "MI-0004 · VPN sign-in failures · Sev 2", or "2 major incidents". */
  readonly label: string;
  /** "MI-0004 · Sev 2". */
  readonly compactLabel: string;
  readonly href?: string;
}

/** `SEV2` → "Sev 2"; anything else as it came. */
export function severityLabel(severity: string): string {
  const match = /^sev\s*(\d)$/i.exec(severity.trim());
  return match ? `Sev ${match[1]}` : severity;
}

/**
 * The top bar's frame chip (A2 §5.2.4, RV6): the live major incident, first
 * of the chips, in danger. While `/major-incidents` is pending it links the
 * incident's ticket (Phase 1); once the war room ships it links the incident
 * — or, with two or more running, the register ("2 major incidents"). Read at
 * render time, so the integrator's edit to the pending set is all it takes.
 */
export function incidentChip(incidents: readonly FrameIncident[]): IncidentChip | null {
  const top = incidents[0];
  if (!top) return null;
  const compactLabel = `${top.number} · ${severityLabel(top.severity)}`;
  const full = `${top.number} · ${top.title} · ${severityLabel(top.severity)}`;
  if (isServiceDeskRoutePending('/major-incidents')) {
    return { label: full, compactLabel, ...(top.ticketId ? { href: `/tickets/${encodeURIComponent(top.ticketId)}` } : {}) };
  }
  if (incidents.length > 1) {
    const many = `${incidents.length} major incidents`;
    return { label: many, compactLabel: many, href: '/major-incidents' };
  }
  return { label: full, compactLabel, href: `/major-incidents/${encodeURIComponent(top.number)}` };
}

/* ---------------------------------------------------------------- The frame */

/** Everything the `(desk)` layout hands `DeskShell` about where things are: plain data, built here on the server. */
export interface DeskFrame {
  readonly nav: NavModel;
  readonly tabs: readonly NavItem[];
  readonly destinations: readonly DeskDestination[];
  readonly switchArea: readonly CommandItem[];
  readonly links: DeskLinks;
}

export function deskFrame(input: DeskNavInput & { readonly areas: AreaModel }): DeskFrame {
  return {
    nav: deskNavModel(input),
    tabs: deskTabLinks(input.held),
    destinations: deskDestinations(input.held),
    switchArea: switchAreaCommands(input.areas),
    links: deskLinks(input.areas),
  };
}
