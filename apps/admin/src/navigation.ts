import type { IconName } from '@itsm/ui';
import type { NavItem as ShellNavItem, NavModel, NavSection } from '@itsm/ui/shell';
import { holdsAny, permissionLabel, type Grants } from './permissions.js';

/**
 * The console's map: every route, what it is called, who may open it, and
 * where it sits (SPEC §5.1, §5.2; B §1.2–§1.4).
 *
 * One file, because the console used to have three copies of this list — the
 * layout's navigation, the Command centre's sections and each page's own
 * permission check — and they disagreed: Security was offered to people its
 * page refused, and Configuration was gated on permissions it never used. Now
 * the sidebar, the command palette's "Go to" group, breadcrumbs, route tabs,
 * the Command centre's "not available to you" note and **every page's read
 * gate** are read from here, and `navigation.test.ts` holds the invariants:
 * each `page.tsx` maps to an entry, each entry's gate is the page's gate, and a
 * platform entry never reaches a tenant administrator.
 *
 * Three rules this file keeps:
 *
 *   - **Nav label = H1 = `<title>`.** "Rules", not "What happens
 *     automatically"; the sentence moves into the page's subtitle.
 *   - **A gate is "any one of" a list, matched exactly** (`holdsAny`). An empty
 *     list is open to everyone signed in (the Command centre filters its own
 *     sections). A withheld item is *absent*, never disabled — and that is
 *     presentation, not a control: the API refuses regardless.
 *   - **Serialisable.** The layout builds the sidebar from this on the server
 *     and hands it to a client component; nothing here is a function a
 *     component needs to receive.
 *
 * Routes still to be built by the Stage 3 packages are listed in `PENDING`:
 * their entries exist (so the palette, tabs and gates are designed once) but
 * are hidden until the page does. The navigation test fails the moment a
 * pending page appears, so the package that builds it removes its line here —
 * the one edit to this file a page package should need.
 */

export type NavGroupId = 'overview' | 'desk' | 'catalogue' | 'automation' | 'cmdb' | 'organisation' | 'footer' | 'platform';

/** The counts `NavBadges` streams into the sidebar (SPEC §5.2, "Badge" column). */
export type NavBadgeKey = 'draftRequestTypes' | 'draftRules' | 'failedRuns' | 'failedDeliveries' | 'securityAlerts' | 'warranties';

/** A route tab inside one item: `TabNav` on the page, a "Go to" entry in the palette. */
export interface AdminTab {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Any one of these. The tab's pages are gated on exactly this list. */
  readonly read: readonly string[];
  /** Further route patterns under this tab: builders and detail pages (`/catalogue/forms/[key]`). */
  readonly routes?: readonly string[];
  readonly keywords?: readonly string[];
}

export interface AdminNavItem {
  readonly id: string;
  /** The page's H1 and `<title>`. */
  readonly label: string;
  /** The item's first page. With tabs, the first tab's `href`. */
  readonly href: string;
  readonly icon: IconName;
  readonly group: NavGroupId;
  /**
   * Any one of these. With tabs this is the union of the tabs' gates — the
   * item is shown when at least one tab is open to the person, and links to
   * the first that is.
   */
  readonly read: readonly string[];
  /** Route patterns of the item's own pages besides its tabs (`/rules/new`, `/rules/[key]`). */
  readonly routes?: readonly string[];
  readonly tabs?: readonly AdminTab[];
  /** What the item is for, in one sentence: palette descriptions and the Command centre's withheld list. */
  readonly description: string;
  /** Extra words the palette finds it by: "queues" finds Workforce, "configuration" finds Settings. */
  readonly keywords?: readonly string[];
  readonly badge?: NavBadgeKey;
  /** `g` then a letter (SPEC §5.6). */
  readonly shortcut?: string;
  /** Platform operators only; the `(platform)` layout's `notFound()` is its page gate. */
  readonly operator?: boolean;
}

/** Sentence-case group headings, in sidebar order. The footer and the operator group sit apart. */
export const NAV_GROUPS: readonly { readonly id: NavGroupId; readonly label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'desk', label: 'Service desk' },
  { id: 'catalogue', label: 'Service catalogue' },
  { id: 'automation', label: 'Automation' },
  { id: 'cmdb', label: 'CMDB' },
  { id: 'organisation', label: 'Organisation' },
  { id: 'footer', label: 'Settings' },
  { id: 'platform', label: 'Platform' },
];

const tab = (id: string, label: string, href: string, read: readonly string[], extra: Partial<AdminTab> = {}): AdminTab => ({
  id,
  label,
  href,
  read,
  ...extra,
});

const INSIGHTS_READ = ['analytics.read', 'analytics.manage'] as const;
const WORKLOAD_READ = ['workload.read', 'workload.manage'] as const;
const SLA_READ = ['sla.policy.read', 'sla.policy.manage'] as const;
const WORKFLOW_READ = ['workflow.read', 'workflow.manage'] as const;
const ACTION_READ = ['integration.action.read', 'integration.action.manage'] as const;
const PEOPLE_READ = ['identity.user.read', 'identity.user.manage'] as const;

/** The union of the tabs' gates, in order, without repeats. */
function unionOf(tabs: readonly AdminTab[]): string[] {
  return [...new Set(tabs.flatMap((entry) => entry.read))];
}

function withTabs(item: Omit<AdminNavItem, 'read' | 'href'> & { readonly tabs: readonly AdminTab[] }): AdminNavItem {
  return { ...item, href: item.tabs[0]!.href, read: unionOf(item.tabs) };
}

export const NAV: readonly AdminNavItem[] = [
  /* ------------------------------------------------------------ Overview */
  {
    id: 'command-centre',
    label: 'Command centre',
    href: '/',
    icon: 'home',
    group: 'overview',
    read: [],
    description: 'What needs you, and how the desk is doing.',
    keywords: ['home', 'overview', 'dashboard', 'briefing', 'setup'],
    shortcut: 'g c',
  },
  withTabs({
    id: 'insights',
    label: 'Insights',
    icon: 'insights',
    group: 'overview',
    description: 'Dashboards, metrics and scheduled reports.',
    keywords: ['analytics', 'reports', 'dashboards', 'metrics', 'charts'],
    tabs: [
      tab('dashboards', 'Dashboards', '/insights', INSIGHTS_READ),
      tab('metrics', 'Metrics', '/insights/metrics', INSIGHTS_READ),
      tab('reports', 'Reports', '/insights/reports', INSIGHTS_READ),
    ],
  }),

  /* -------------------------------------------------------- Service desk */
  {
    id: 'tickets',
    label: 'Tickets',
    href: '/tickets',
    icon: 'ticket',
    group: 'desk',
    read: ['ticket.read'],
    description: 'Everything raised on this desk, across every team.',
    keywords: ['incidents', 'requests', 'workload', 'backlog'],
    shortcut: 'g t',
  },
  withTabs({
    id: 'workforce',
    label: 'Workforce',
    icon: 'workforce',
    group: 'desk',
    description: 'Who is available, who is on call, shifts, skills and routing.',
    keywords: ['queues', 'availability', 'rota', 'on call', 'shifts', 'skills', 'routing', 'agents'],
    tabs: [
      tab('now', 'Now', '/workforce', WORKLOAD_READ),
      tab('on-call', 'On call', '/workforce/on-call', WORKLOAD_READ, { keywords: ['rota', 'pager'] }),
      tab('shifts', 'Shifts', '/workforce/shifts', WORKLOAD_READ),
      tab('skills', 'Skills', '/workforce/skills', WORKLOAD_READ),
      tab('routing', 'Routing', '/workforce/routing', WORKLOAD_READ, { keywords: ['assignment strategy'] }),
    ],
  }),
  withTabs({
    id: 'service-levels',
    label: 'Service levels',
    icon: 'sla',
    group: 'desk',
    description: 'Response and resolution targets, business hours and the priority matrix.',
    keywords: ['sla', 'slas', 'targets', 'business hours', 'calendars', 'priority matrix', 'impact', 'urgency'],
    tabs: [
      tab('policies', 'Policies', '/sla', SLA_READ),
      tab('calendars', 'Calendars', '/sla/calendars', SLA_READ, { keywords: ['business hours', 'holidays'] }),
      tab('matrix', 'Priority matrix', '/sla/matrix', SLA_READ, { keywords: ['impact', 'urgency'] }),
    ],
  }),

  /* --------------------------------------------------- Service catalogue */
  withTabs({
    id: 'services',
    label: 'Services & requests',
    icon: 'catalogue',
    group: 'catalogue',
    description: 'What people can ask for on the portal, and the forms they fill in.',
    keywords: ['catalogue', 'catalog', 'services', 'request types', 'portal', 'forms'],
    badge: 'draftRequestTypes',
    tabs: [
      tab('request-types', 'Request types', '/catalogue', ['catalogue.manage']),
      tab('forms', 'Forms', '/catalogue/forms', ['catalogue.form.read', 'catalogue.form.manage'], {
        routes: ['/catalogue/forms/new', '/catalogue/forms/[key]'],
        keywords: ['form builder', 'questions'],
      }),
    ],
  }),
  {
    id: 'fields',
    label: 'Ticket fields',
    href: '/fields',
    icon: 'fields',
    group: 'catalogue',
    // The API lets any ticket reader list fields, but this page is for the
    // people who shape a ticket, so the nav and page gates stay identical.
    read: ['ticket.config.manage'],
    description: 'The custom fields a ticket carries, who sees each one and when it is required.',
    keywords: ['custom fields', 'shape of a ticket', 'attributes'],
  },

  /* ------------------------------------------------------------ Automation */
  {
    id: 'rules',
    label: 'Rules',
    href: '/rules',
    icon: 'automation',
    group: 'automation',
    read: ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish'],
    routes: ['/rules/new', '/rules/[key]'],
    description: 'What happens automatically when something happens to a ticket.',
    keywords: ['business rules', 'triggers', 'automation', 'conditions'],
    badge: 'draftRules',
    shortcut: 'g r',
  },
  withTabs({
    id: 'workflows',
    label: 'Workflows',
    icon: 'workflow',
    group: 'automation',
    description: 'Work that runs across several steps and can wait, and each run of it.',
    keywords: ['automation', 'processes', 'runs', 'approvals'],
    badge: 'failedRuns',
    shortcut: 'g w',
    tabs: [
      tab('definitions', 'Workflows', '/workflows', WORKFLOW_READ, { routes: ['/workflows/[key]'] }),
      tab('runs', 'Runs', '/workflows/runs', WORKFLOW_READ, { keywords: ['failed runs', 'stuck'] }),
    ],
  }),
  withTabs({
    id: 'integrations',
    label: 'Integrations',
    icon: 'integrations',
    group: 'automation',
    description: 'Outbound actions, the credentials behind them, webhooks and failed deliveries.',
    keywords: ['connectors', 'outbound', 'api', 'deliveries', 'retries'],
    badge: 'failedDeliveries',
    tabs: [
      tab('deliveries', 'Failed deliveries', '/integrations', ACTION_READ, { keywords: ['errors', 'replay'] }),
      tab('actions', 'Actions', '/integrations/actions', ACTION_READ),
      tab('credentials', 'Credentials', '/integrations/credentials', ['integration.credential.read', 'integration.credential.manage'], {
        keywords: ['secrets', 'api keys', 'tokens'],
      }),
      tab('webhooks', 'Webhooks', '/integrations/webhooks', ['webhook.read']),
    ],
  }),
  withTabs({
    id: 'ai-triage',
    label: 'AI triage',
    icon: 'ai',
    group: 'automation',
    description: 'How well suggestions match the desk, and what AI may set by itself.',
    keywords: ['ai', 'machine learning', 'suggestions', 'auto-apply', 'confidence'],
    tabs: [
      tab('overview', 'Overview', '/ai-triage', ['ai.read']),
      tab('quality', 'Quality', '/ai-triage/quality', ['ai.read'], { keywords: ['accuracy'] }),
      tab('decisions', 'Decisions', '/ai-triage/decisions', ['ai.manage']),
    ],
  }),

  /* ------------------------------------------------------------------ CMDB */
  {
    id: 'configuration-items',
    label: 'Configuration items',
    href: '/cmdb',
    icon: 'cmdb',
    group: 'cmdb',
    read: ['cmdb.read', 'cmdb.manage'],
    description: 'The services and systems a ticket can point at, and how they depend on each other.',
    keywords: ['cmdb', 'ci', 'services', 'estate', 'dependencies'],
  },
  {
    id: 'assets',
    label: 'Assets',
    href: '/cmdb/assets',
    icon: 'assets',
    group: 'cmdb',
    read: ['asset.read', 'asset.manage'],
    description: 'Hardware and licences, who holds them and when warranties end.',
    keywords: ['hardware', 'laptops', 'warranty', 'inventory', 'licences'],
    badge: 'warranties',
  },

  /* ---------------------------------------------------------- Organisation */
  withTabs({
    id: 'people',
    label: 'People',
    icon: 'people',
    group: 'organisation',
    description: 'Everyone who can sign in to this desk, their teams and organisations.',
    keywords: ['users', 'agents', 'staff', 'teams', 'organisations', 'directory'],
    tabs: [
      tab('people', 'People', '/people', PEOPLE_READ),
      tab('teams', 'Teams', '/people/teams', PEOPLE_READ, { keywords: ['groups'] }),
      tab('organisations', 'Organisations', '/people/organisations', PEOPLE_READ, { keywords: ['departments', 'companies'] }),
    ],
  }),
  withTabs({
    id: 'security',
    label: 'Security',
    icon: 'security',
    group: 'organisation',
    description: 'Security alerts, roles and the permissions they grant.',
    keywords: ['alerts', 'roles', 'permissions', 'access'],
    badge: 'securityAlerts',
    tabs: [
      tab('alerts', 'Alerts', '/security', ['security.alert.read']),
      tab('access', 'Access', '/security/access', ['identity.role.read', 'identity.role.manage'], { keywords: ['roles', 'permissions'] }),
    ],
  }),
  {
    id: 'audit',
    label: 'Audit log',
    href: '/audit',
    icon: 'audit',
    group: 'organisation',
    read: ['audit.read'],
    description: 'Every change recorded on this desk, in the order it happened.',
    keywords: ['history', 'changes', 'log', 'compliance'],
  },

  /* ------------------------------------------------------------- Settings */
  withTabs({
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    group: 'footer',
    description: 'How this desk behaves: settings, features, AI, modules, usage and plan.',
    // "flags" too: until Features has its own tab, the flags live on General.
    keywords: ['configuration', 'preferences', 'options', 'flags', 'feature flags'],
    shortcut: 'g s',
    tabs: [
      tab('general', 'General', '/settings', ['admin.setting.read']),
      tab('features', 'Features', '/settings/features', ['admin.setting.read', 'admin.flag.manage'], {
        keywords: ['flags', 'feature flags', 'kill switch'],
      }),
      tab('ai', 'AI', '/settings/ai', ['admin.setting.read', 'admin.flag.manage'], { keywords: ['ai budget', 'capabilities'] }),
      tab('modules', 'Modules', '/settings/modules', ['admin.module.manage']),
      tab('usage', 'Usage & plan', '/settings/usage', ['tenant.usage.read'], { keywords: ['limits', 'billing', 'plan', 'meters'] }),
    ],
  }),

  /* ------------------------------------------------------------- Platform */
  {
    id: 'tenants',
    label: 'Tenants',
    href: '/tenants',
    icon: 'platform',
    group: 'platform',
    read: ['platform.tenant.manage'],
    description: 'Every desk on this deployment.',
    keywords: ['platform', 'customers', 'workspaces'],
    operator: true,
  },
  {
    id: 'plans',
    label: 'Plans',
    href: '/plans',
    icon: 'layers-2',
    group: 'platform',
    read: ['platform.tenant.manage'],
    description: 'The price list every desk is sold against.',
    keywords: ['platform', 'pricing', 'limits'],
    operator: true,
  },
];

/**
 * Pages with a route of their own that are not in the sidebar, and why.
 * Each still has a read gate, so `pageAccess()` works for them too.
 */
export const EXCLUDED: readonly { readonly route: string; readonly read: readonly string[]; readonly reason: string }[] = [
  {
    route: '/automation',
    read: ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish', 'workflow.read', 'workflow.manage'],
    reason: 'The old automation hub. It becomes a redirect to Rules or Workflows (WP18); nothing links to it.',
  },
];

/**
 * Routes this map describes whose pages do not exist yet. Hidden from the
 * sidebar, the tabs and the palette until they do; the navigation test fails
 * as soon as one of these gets a `page.tsx`, so its line is removed here in
 * the same change.
 */
export const PENDING: ReadonlySet<string> = new Set([
  '/catalogue/forms',
  '/catalogue/forms/new',
  '/catalogue/forms/[key]',
  '/rules/new',
  '/rules/[key]',
  '/workflows/runs',
  '/workflows/[key]',
  '/integrations/actions',
  '/integrations/credentials',
  '/integrations/webhooks',
  '/ai-triage/quality',
  '/ai-triage/decisions',
  '/cmdb/assets',
  '/people/teams',
  '/people/organisations',
  '/security/access',
  '/settings/features',
  '/settings/ai',
  '/settings/modules',
  '/settings/usage',
]);

export function isPending(route: string): boolean {
  return PENDING.has(route);
}

/* =========================================================================
 * Routes and gates
 * ====================================================================== */

/** One page route and everything the frame needs to know about it. */
export interface PageEntry {
  /** App-router pattern: `/rules/[key]`. */
  readonly route: string;
  /** Any one of these opens it; `[]` is everyone. */
  readonly read: readonly string[];
  /** The nav item it belongs to; absent for an excluded page. */
  readonly item?: AdminNavItem;
  readonly tab?: AdminTab;
}

function buildPages(): Map<string, PageEntry> {
  const pages = new Map<string, PageEntry>();
  const add = (entry: PageEntry): void => {
    if (pages.has(entry.route)) throw new Error(`navigation.ts: ${entry.route} is listed twice`);
    pages.set(entry.route, entry);
  };
  for (const item of NAV) {
    if (item.tabs) {
      for (const entry of item.tabs) {
        for (const route of [entry.href, ...(entry.routes ?? [])]) add({ route, read: entry.read, item, tab: entry });
      }
    } else {
      add({ route: item.href, read: item.read, item });
    }
    for (const route of item.routes ?? []) add({ route, read: item.read, item });
  }
  for (const excluded of EXCLUDED) add({ route: excluded.route, read: excluded.read });
  return pages;
}

const PAGES = buildPages();

/** Every route pattern this map knows, pending ones included. */
export function allRoutes(): string[] {
  return [...PAGES.keys()];
}

/** The page entry for a route pattern (`/rules/[key]`), or null when the map does not know it. */
export function pageEntry(route: string): PageEntry | null {
  return PAGES.get(route) ?? null;
}

/**
 * The route pattern a concrete path is served by: `/rules/vip-requester` →
 * `/rules/[key]`. A static segment beats a dynamic one (`/rules/new`), as it
 * does in the router.
 */
export function routeFor(pathname: string): string | null {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '') || '/';
  if (PAGES.has(path)) return path;
  const parts = path.split('/').filter(Boolean);
  let best: { route: string; dynamic: number } | null = null;
  for (const route of PAGES.keys()) {
    const pattern = route.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    let dynamic = 0;
    const fits = pattern.every((segment, index) => {
      if (/^\[[^\]]+\]$/.test(segment)) {
        dynamic += 1;
        return true;
      }
      return segment === parts[index];
    });
    if (fits && (best === null || dynamic < best.dynamic)) best = { route, dynamic };
  }
  return best?.route ?? null;
}

/** Whether this person may open a page: its gate, "any of", exactly. Unknown routes are closed. */
export function mayOpen(me: Grants, route: string): boolean {
  const entry = PAGES.get(route);
  return entry !== undefined && holdsAny(me, entry.read);
}

/* =========================================================================
 * What one person sees
 * ====================================================================== */

/** The tabs of an item this person may open and that exist, in order. */
export function visibleTabs(me: Grants, item: AdminNavItem): AdminTab[] {
  return (item.tabs ?? []).filter((entry) => !isPending(entry.href) && holdsAny(me, entry.read));
}

/**
 * The items this person sees, each pointing at the first page of it they may
 * open. An item with tabs appears when one of its built tabs is open to them;
 * a platform item only for an operator.
 */
export function visibleNav(me: Grants): AdminNavItem[] {
  const visible: AdminNavItem[] = [];
  for (const item of NAV) {
    if (item.tabs) {
      const first = visibleTabs(me, item)[0];
      if (first) visible.push({ ...item, href: first.href });
    } else if (!isPending(item.href) && holdsAny(me, item.read)) {
      visible.push(item);
    }
  }
  return visible;
}

/**
 * What this person cannot open, and the permission to ask for — the Command
 * centre's "Not available to you" disclosure (ADR-0049: screens say what they
 * withhold). Platform items are never mentioned to a non-operator: telling a
 * tenant administrator there is a platform section is itself a disclosure.
 */
export function withheldNav(me: Grants): { readonly item: AdminNavItem; readonly needs: string; readonly needsLabel: string }[] {
  const shown = new Set(visibleNav(me).map((item) => item.id));
  return NAV.filter((item) => !item.operator && !shown.has(item.id) && item.read.length > 0 && !isPending(item.href)).map(
    (item) => ({ item, needs: item.read[0]!, needsLabel: permissionLabel(item.read[0]!) }),
  );
}

export function isOperator(me: Grants): boolean {
  return holdsAny(me, ['platform.tenant.manage']);
}

/** The DS route tabs for a page's `PageHeader`, filtered for this person. */
export function tabsFor(me: Grants, itemId: string): { id: string; label: string; href: string; match?: 'exact' }[] {
  const item = NAV.find((entry) => entry.id === itemId);
  if (!item) return [];
  // The first tab shares its href with deeper tabs' prefix (`/sla` and
  // `/sla/calendars`), so it matches exactly.
  return visibleTabs(me, item).map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    href: entry.href,
    ...(index === 0 || entry.href === item.tabs?.[0]?.href ? { match: 'exact' as const } : {}),
  }));
}

/**
 * Breadcrumbs for a route: the item, then the tab when it is not the item's
 * first page. A page adds its own last crumb (the rule's name).
 */
export function breadcrumbsFor(route: string): { label: string; href?: string }[] {
  const entry = PAGES.get(route);
  if (!entry?.item) return [];
  const crumbs: { label: string; href?: string }[] = [{ label: entry.item.label, href: entry.item.href }];
  if (entry.tab && entry.tab.href !== entry.item.tabs?.[0]?.href) crumbs.push({ label: entry.tab.label, href: entry.tab.href });
  return crumbs;
}

/* =========================================================================
 * The sidebar
 * ====================================================================== */

/** Counts to show beside items, keyed by `NavBadgeKey`: streamed in after the frame. */
export type NavBadgeValues = Partial<Record<NavBadgeKey, { readonly value: number; readonly capped?: boolean }>>;

const BADGE_TONE: Readonly<Record<NavBadgeKey, 'neutral' | 'accent' | 'danger'>> = {
  draftRequestTypes: 'neutral',
  draftRules: 'neutral',
  failedRuns: 'danger',
  failedDeliveries: 'danger',
  securityAlerts: 'danger',
  warranties: 'neutral',
};

const BADGE_NOUN: Readonly<Record<NavBadgeKey, { one: string; other: string }>> = {
  draftRequestTypes: { one: 'draft', other: 'drafts' },
  draftRules: { one: 'draft', other: 'drafts' },
  failedRuns: { one: 'failed run', other: 'failed runs' },
  failedDeliveries: { one: 'failed delivery', other: 'failed deliveries' },
  securityAlerts: { one: 'high-severity alert', other: 'high-severity alerts' },
  warranties: { one: 'warranty ending soon', other: 'warranties ending soon' },
};

function shellItem(item: AdminNavItem, badges: NavBadgeValues): ShellNavItem {
  const count = item.badge ? badges[item.badge] : undefined;
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    icon: item.icon,
    // A path prefix, so `/sla` stays current on `/sla/calendars`; `/` would
    // otherwise be the prefix of everything.
    ...(item.href === '/' ? { match: 'exact' as const } : {}),
    description: item.description,
    ...(item.keywords ? { keywords: item.keywords } : {}),
    ...(item.shortcut ? { shortcut: item.shortcut } : {}),
    ...(item.badge && count && count.value > 0
      ? {
          badge: {
            value: count.value,
            ...(count.capped ? { capped: true } : {}),
            tone: BADGE_TONE[item.badge],
            label: `${count.capped ? `${count.value}+` : count.value} ${count.value === 1 && !count.capped ? BADGE_NOUN[item.badge].one : BADGE_NOUN[item.badge].other}`,
          },
        }
      : {}),
  };
}

/**
 * The frame's navigation model for one person: grouped sections in sidebar
 * order, Settings in the footer, and the operator's Platform group last.
 * Every item is current on its own subtree (`/sla` on `/sla/calendars`), the
 * Command centre only on itself.
 */
export function navModel(me: Grants, badges: NavBadgeValues = {}): NavModel {
  const visible = visibleNav(me);
  const sections: NavSection[] = [];
  for (const group of NAV_GROUPS) {
    if (group.id === 'footer') continue;
    const items = visible.filter((item) => item.group === group.id).map((item) => shellItem(item, badges));
    if (items.length > 0) sections.push({ id: group.id, label: group.label, items });
  }
  const footer = visible.filter((item) => item.group === 'footer').map((item) => shellItem(item, badges));
  return { label: 'Administration', sections, ...(footer.length > 0 ? { footer } : {}) };
}

/* =========================================================================
 * Create commands (palette "Create", SPEC §5.5)
 * ====================================================================== */

export interface CreateCommand {
  readonly id: string;
  readonly label: string;
  /** Opens the right page with `?new=1`; the page opens its sheet. */
  readonly href: string;
  /** The write permission; the command is offered only to people who hold it. */
  readonly permission: string;
  readonly icon: IconName;
  readonly keywords?: readonly string[];
}

export const CREATE_COMMANDS: readonly CreateCommand[] = [
  { id: 'new-rule', label: 'New rule', href: '/rules/new', permission: 'rules.rule.manage', icon: 'automation' },
  { id: 'new-request-type', label: 'New request type', href: '/catalogue?new=request-type', permission: 'catalogue.manage', icon: 'catalogue' },
  { id: 'new-service', label: 'New service', href: '/catalogue?new=service', permission: 'catalogue.manage', icon: 'catalogue' },
  { id: 'new-form', label: 'New form', href: '/catalogue/forms/new', permission: 'catalogue.form.manage', icon: 'forms' },
  { id: 'new-field', label: 'New field', href: '/fields?new=1', permission: 'ticket.config.manage', icon: 'fields', keywords: ['custom field'] },
  { id: 'new-sla-policy', label: 'New SLA policy', href: '/sla?new=1', permission: 'sla.policy.manage', icon: 'sla', keywords: ['service level'] },
  { id: 'new-calendar', label: 'New calendar', href: '/sla/calendars?new=1', permission: 'sla.policy.manage', icon: 'calendar', keywords: ['business hours'] },
  { id: 'add-person', label: 'Add person', href: '/people?new=1', permission: 'identity.user.manage', icon: 'user-plus', keywords: ['invite', 'user'] },
  { id: 'add-credential', label: 'Add credential', href: '/integrations/credentials?new=1', permission: 'integration.credential.manage', icon: 'key' },
  // No "New dashboard" yet: making and editing dashboards is SPEC [Plus] and
  // not built, and a command that lands on a page with nothing to do is worse
  // than no command. Add it back with the dashboard editor.
];

/** The create commands this person may run whose page exists. */
export function createCommandsFor(me: Grants): CreateCommand[] {
  return CREATE_COMMANDS.filter((command) => {
    const route = routeFor(command.href);
    return route !== null && !isPending(route) && holdsAny(me, [command.permission]) && mayOpen(me, route);
  });
}
