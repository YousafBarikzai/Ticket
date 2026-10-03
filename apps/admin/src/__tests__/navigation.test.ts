import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  CREATE_COMMANDS,
  EXCLUDED,
  NAV,
  NAV_GROUPS,
  NOT_FOUND_TITLE,
  PAGE_PURPOSES,
  PENDING,
  UNFINISHED,
  allRoutes,
  breadcrumbsFor,
  createCommandsFor,
  isPending,
  mayOpen,
  navModel,
  pageEntry,
  purposeFor,
  rootTab,
  routeFor,
  routeTitles,
  tabsFor,
  visibleNav,
  withheldNav,
} from '../navigation.js';
import { holdsAny, permissionLabel, viewOnlyFor, type Grants } from '../permissions.js';

/**
 * The console's map, held to its invariants (SPEC §5.1, F4; B §6).
 *
 *   - Every `page.tsx` under `(console)` is in the map — as an item, a tab, a
 *     sub-route or an explicit exclusion — and every built route in the map
 *     has a page. A page added without an entry, or an entry for a page that
 *     does not exist yet without being marked pending, fails here.
 *   - **Nav gate = page gate.** Every tenant page opens through
 *     `pageAccess('<its own route>')`, which reads its gate from this map, so
 *     a sidebar item is shown to exactly the people its page lets in. Checked
 *     from the source of each page, and checked behaviourally: for every
 *     permission on its own, an item is visible if and only if one of its
 *     built pages opens.
 *   - Platform items reach operators only, and their gate is the `(platform)`
 *     layout's `notFound()`.
 *   - Nav label = H1 = `<title>` for the pages that carry a static title.
 */

const appDir = fileURLToPath(new URL('../app/', import.meta.url));
const consoleDir = join(appDir, '(console)');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pagesUnder(path));
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}

/** `(console)/(admin)/rules/[key]/page.tsx` → `/rules/[key]`. Route groups do not appear in URLs. */
function routeOfFile(file: string): string {
  const parts = relative(consoleDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((part) => !/^\(.*\)$/.test(part));
  return `/${parts.join('/')}`;
}

/** The catch-all that sends any unknown address to the in-frame 404; not a page on the map. */
const MISSING = join(consoleDir, '[...missing]', 'page.tsx');

const pages = pagesUnder(consoleDir)
  .filter((file) => file !== MISSING)
  .map((file) => ({ file, route: routeOfFile(file), platform: file.includes(`${sep}(platform)${sep}`) }));
const builtRoutes = new Set(pages.map((page) => page.route));

function person(...keys: string[]): Grants {
  return { permissions: keys.map((key) => ({ key, scope: 'any' })) };
}

const everyGateKey = [...new Set([...NAV.flatMap((item) => [...item.read, ...(item.tabs ?? []).flatMap((tab) => tab.read)]), ...EXCLUDED.flatMap((entry) => entry.read)])];

describe('every page is on the map', () => {
  it('finds the console’s pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(19);
    expect(builtRoutes.has('/')).toBe(true);
    expect(builtRoutes.has('/tenants')).toBe(true);
  });

  it('maps every page.tsx to an item, a tab, a sub-route or an exclusion', () => {
    const known = new Set(allRoutes());
    expect(pages.filter((page) => !known.has(page.route)).map((page) => page.route)).toEqual([]);
  });

  it('has a page for every route that is not pending, and none for a pending one', () => {
    for (const route of allRoutes()) {
      if (PENDING.has(route)) {
        expect(builtRoutes.has(route), `${route} has a page now: remove it from PENDING in navigation.ts`).toBe(false);
      } else {
        expect(builtRoutes.has(route), `${route} is on the map but has no page.tsx`).toBe(true);
      }
    }
  });

  it('lists nothing as pending that the map does not know', () => {
    const known = new Set(allRoutes());
    expect([...PENDING].filter((route) => !known.has(route))).toEqual([]);
  });

  it('answers every unknown address with the in-frame 404, outside any loading boundary', () => {
    const source = readFileSync(MISSING, 'utf8');
    expect(source).toContain('notFound();');
    expect(source).not.toContain('pageAccess(');
    expect(existsSync(join(consoleDir, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(consoleDir, '[...missing]', 'loading.tsx'))).toBe(false);
  });

  it('keeps /queues as a redirect, not a page (it is Workforce now)', () => {
    expect(builtRoutes.has('/queues')).toBe(false);
    const config = readFileSync(fileURLToPath(new URL('../../next.config.ts', import.meta.url)), 'utf8');
    expect(config).toMatch(/source: '\/queues', destination: '\/workforce', permanent: true/);
  });
});

describe('nav gate = page gate', () => {
  it('gates every tenant page through pageAccess with its own route, and renders Forbidden for that route', () => {
    for (const page of pages.filter((entry) => !entry.platform)) {
      const source = readFileSync(page.file, 'utf8');
      expect(source, page.file).toContain(`pageAccess('${page.route}')`);
      expect(source, page.file).toContain(`<Forbidden route="${page.route}" />`);
      // No page reads the actor behind the gate's back.
      expect(source, page.file).not.toMatch(/\bcurrentActor\(\)/);
    }
  });

  it('gates the platform pages in their layout with a 404, and nowhere with pageAccess', () => {
    const layout = readFileSync(join(consoleDir, '(platform)', 'layout.tsx'), 'utf8');
    expect(layout).toContain('await requirePlatformOperator()');
    for (const page of pages.filter((entry) => entry.platform)) {
      const entry = pageEntry(page.route);
      expect(entry?.item?.operator, page.route).toBe(true);
      expect(entry?.read).toEqual(['platform.tenant.manage']);
      expect(readFileSync(page.file, 'utf8')).not.toContain('pageAccess(');
    }
  });

  it('has no loading.tsx above the platform gate', () => {
    expect(existsSync(join(consoleDir, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(appDir, 'loading.tsx'))).toBe(false);
    expect(existsSync(join(consoleDir, '(admin)', 'loading.tsx'))).toBe(true);
  });

  it('gives every item a gate, except the Command centre', () => {
    for (const item of NAV) {
      if (item.id === 'command-centre') expect(item.read).toEqual([]);
      else expect(item.read.length, item.id).toBeGreaterThan(0);
    }
  });

  it('gates an item with tabs on exactly the union of its tabs, and lands on the tab the others sit under', () => {
    for (const item of NAV.filter((entry) => entry.tabs)) {
      const union = [...new Set(item.tabs!.flatMap((tab) => tab.read))];
      expect([...item.read].sort(), item.id).toEqual(union.sort());
      expect(item.href, item.id).toBe(rootTab(item.tabs!).href);
      for (const tab of item.tabs!) expect(tab.href === item.href || tab.href.startsWith(`${item.href}/`), `${item.id} › ${tab.id}`).toBe(true);
    }
  });

  it('shows an item to a permission exactly when one of its built pages opens for it', () => {
    for (const key of everyGateKey) {
      const me = person(key);
      const visible = new Set(visibleNav(me).map((item) => item.id));
      for (const item of NAV) {
        const routes = [...(item.tabs ? item.tabs.flatMap((tab) => [tab.href, ...(tab.routes ?? [])]) : [item.href]), ...(item.routes ?? [])];
        const opens = routes.some((route) => builtRoutes.has(route) && !isPending(route) && mayOpen(me, route));
        expect(visible.has(item.id), `${item.id} for someone holding only ${key}`).toBe(opens);
      }
    }
  });

  it('links every visible item to a page that opens for the person', () => {
    const people = [person(), ...everyGateKey.map((key) => person(key)), person(...everyGateKey)];
    for (const me of people) {
      for (const item of visibleNav(me)) {
        const route = routeFor(item.href);
        expect(route, item.href).not.toBeNull();
        expect(isPending(route!)).toBe(false);
        expect(mayOpen(me, route!), `${item.id} → ${item.href}`).toBe(true);
      }
    }
  });

  it('closes a route the map does not know', () => {
    expect(mayOpen(person(...everyGateKey), '/no-such-page')).toBe(false);
    expect(pageEntry('/no-such-page')).toBeNull();
  });

  it('fixes the gate mismatches the three old lists had (F4)', () => {
    // Security no longer opens for people who can only read the directory.
    expect(mayOpen(person('identity.user.read'), '/security')).toBe(false);
    expect(mayOpen(person('identity.user.read'), '/people')).toBe(true);
    // Settings is not gated on the catalogue or field permissions.
    expect(mayOpen(person('catalogue.manage'), '/settings')).toBe(false);
    expect(mayOpen(person('ticket.config.manage'), '/settings')).toBe(false);
    expect(mayOpen(person('admin.setting.read'), '/settings')).toBe(true);
    // Each builder has its own item and gate.
    expect(visibleNav(person('catalogue.manage')).map((item) => item.id)).toContain('services');
    expect(visibleNav(person('ticket.config.manage')).map((item) => item.id)).toContain('fields');
    expect(visibleNav(person('rules.rule.read')).map((item) => item.id)).toContain('rules');
  });
});

describe('the platform section', () => {
  it('never appears for a tenant administrator', () => {
    const administrator = person(...everyGateKey.filter((key) => key !== 'platform.tenant.manage'));
    const ids = visibleNav(administrator).map((item) => item.id);
    expect(ids).not.toContain('tenants');
    expect(ids).not.toContain('plans');
    expect(navModel(administrator).sections.map((section) => section.id)).not.toContain('platform');
    // Nor is it mentioned as something to ask for.
    expect(withheldNav(administrator).map((entry) => entry.item.id)).not.toContain('tenants');
    expect(withheldNav(person()).some((entry) => entry.item.operator)).toBe(false);
  });

  it('appears, last, for an operator', () => {
    const operator = person('platform.tenant.manage');
    const model = navModel(operator);
    expect(model.sections.at(-1)?.id).toBe('platform');
    expect(model.sections.at(-1)?.items.map((item) => item.id)).toEqual(['tenants', 'plans']);
  });
});

describe('labels are titles', () => {
  it('matches each item’s page title and H1 to its label', () => {
    for (const item of NAV) {
      const route = routeFor(item.href);
      const page = pages.find((entry) => entry.route === route);
      if (!page) continue;
      const source = readFileSync(page.file, 'utf8');
      const title = /export const metadata: Metadata = \{ title: '([^']+)' \}/.exec(source)?.[1];
      if (title !== undefined) expect(title, page.file).toBe(item.label);
      const h1 = /<h1[^>]*>([^<{]+)<\/h1>/.exec(source)?.[1];
      if (h1 !== undefined) expect(h1.replace('&amp;', '&'), page.file).toBe(item.label);
    }
  });

  it('uses sentence case for group headings', () => {
    const acronyms = new Set(['CMDB']);
    for (const group of NAV_GROUPS) {
      const [first, ...rest] = group.label.split(' ');
      expect(first!.charAt(0), group.id).toBe(first!.charAt(0).toUpperCase());
      for (const word of rest) expect(acronyms.has(word) || word === word.toLowerCase(), `${group.label}: ${word}`).toBe(true);
    }
  });
});

describe('routes, tabs and crumbs', () => {
  it('finds the pattern a path is served by, a static segment first', () => {
    expect(routeFor('/')).toBe('/');
    expect(routeFor('/rules')).toBe('/rules');
    expect(routeFor('/rules/')).toBe('/rules');
    expect(routeFor('/rules/new')).toBe('/rules/new');
    expect(routeFor('/rules/vip-requester')).toBe('/rules/[key]');
    expect(routeFor('/catalogue/forms/laptop?step=2')).toBe('/catalogue/forms/[key]');
    expect(routeFor('/nowhere')).toBeNull();
  });

  it('offers only the tabs a person may open and that exist', () => {
    const lead = person('workload.read');
    expect(tabsFor(lead, 'workforce').map((tab) => tab.id)).toEqual(['now', 'on-call', 'shifts', 'skills', 'routing']);
    // Decisions needs `ai.manage`: a list of every decision is a list of every triaged ticket.
    expect(tabsFor(person('ai.read'), 'ai-triage').map((tab) => tab.id)).toEqual(['overview', 'quality']);
    expect(tabsFor(person('ai.read', 'ai.manage'), 'ai-triage').map((tab) => tab.id)).toEqual(['overview', 'quality', 'decisions']);
    expect(tabsFor(person(), 'workforce')).toEqual([]);
  });

  it('builds breadcrumbs from the item and the tab', () => {
    expect(breadcrumbsFor('/rules/[key]')).toEqual([{ label: 'Rules', href: '/rules' }]);
    expect(breadcrumbsFor('/sla/calendars')).toEqual([
      { label: 'Service levels', href: '/sla' },
      { label: 'Calendars', href: '/sla/calendars' },
    ]);
    expect(breadcrumbsFor('/sla')).toEqual([{ label: 'Service levels', href: '/sla' }]);
  });
});

describe('the sidebar model', () => {
  const everyone = person(...everyGateKey);

  it('groups items in order, with Settings in the footer', () => {
    const model = navModel(everyone);
    expect(model.label).toBe('Administration');
    expect(model.sections.map((section) => section.id)).toEqual(['overview', 'desk', 'catalogue', 'automation', 'cmdb', 'organisation', 'platform']);
    expect(model.footer?.map((item) => item.id)).toEqual(['settings']);
    expect(model.sections[0]?.items[0]).toMatchObject({ id: 'command-centre', href: '/', match: 'exact' });
  });

  it('shows 18 items to someone who holds everything, plus the two operator items', () => {
    const ids = visibleNav(everyone).map((item) => item.id);
    // 18 on the map; the Status page is held back for the release (UNFINISHED).
    expect(ids.filter((id) => id !== 'tenants' && id !== 'plans')).toHaveLength(18 - NAV.filter((item) => UNFINISHED.has(item.href)).length);
    expect(ids).toHaveLength(NAV.filter((item) => !isPending(item.href)).length);
    expect(ids).toContain('tenants');
  });

  it('names badges for screen readers and caps them', () => {
    const model = navModel(everyone, { failedRuns: { value: 50, capped: true }, draftRules: { value: 1 }, securityAlerts: { value: 0 } });
    const items = model.sections.flatMap((section) => section.items);
    expect(items.find((item) => item.id === 'workflows')?.badge).toEqual({ value: 50, capped: true, tone: 'danger', label: '50+ failed runs' });
    expect(items.find((item) => item.id === 'rules')?.badge).toEqual({ value: 1, tone: 'neutral', label: '1 draft' });
    expect(items.find((item) => item.id === 'security')?.badge).toBeUndefined();
  });

  it('points an item at the first tab a person may open', () => {
    const credentialsOnly = person('integration.credential.read');
    expect(visibleNav(credentialsOnly).find((item) => item.id === 'integrations')?.href).toBe('/integrations/credentials');
    expect(visibleNav(person('webhook.read')).find((item) => item.id === 'integrations')?.href).toBe('/integrations/webhooks');
    expect(visibleNav(person('integration.action.read')).find((item) => item.id === 'integrations')?.href).toBe('/integrations');
  });
});

describe('what a person is told they cannot open', () => {
  it('names the permission in words', () => {
    const withheld = withheldNav(person('ticket.read'));
    const rules = withheld.find((entry) => entry.item.id === 'rules');
    expect(rules).toMatchObject({ needs: 'rules.rule.read', needsLabel: 'Read rules' });
    expect(withheld.map((entry) => entry.item.id)).not.toContain('tickets');
    expect(withheld.map((entry) => entry.item.id)).not.toContain('command-centre');
  });

  it('words an unlisted permission sensibly', () => {
    expect(permissionLabel('rules.rule.read')).toBe('Read rules');
    expect(permissionLabel('feedback.survey.manage')).toBe('Manage feedback survey');
    expect(permissionLabel('platform')).toBe('Use platform');
  });

  it('says View only exactly when the write permission is missing', () => {
    expect(viewOnlyFor(person('rules.rule.read'), 'Rules', 'rules.rule.manage')).toEqual({
      label: 'Rules',
      permission: 'Manage rules',
      key: 'rules.rule.manage',
    });
    expect(viewOnlyFor(person('rules.rule.manage'), 'Rules', ['rules.rule.manage', 'rules.rule.publish'])).toBeUndefined();
  });
});

describe('create commands', () => {
  it('are offered only with the write permission, and only where the page exists', () => {
    expect(createCommandsFor(person('rules.rule.read')).map((command) => command.id)).toEqual([]);
    const sla = createCommandsFor(person('sla.policy.manage')).map((command) => command.id);
    expect(sla).toContain('new-sla-policy');
    expect(sla).toContain('new-calendar');
    for (const command of CREATE_COMMANDS) expect(routeFor(command.href), command.href).not.toBeNull();
    // Someone who may do everything is still offered no command whose page is pending.
    const everything = person(...CREATE_COMMANDS.map((command) => command.permission), ...NAV.flatMap((item) => item.read));
    for (const command of createCommandsFor(everything)) expect(isPending(routeFor(command.href)!), command.id).toBe(false);
  });

  it('need the page’s read gate too', () => {
    for (const command of createCommandsFor(person(...everyGateKey, 'rules.rule.manage', 'identity.user.manage'))) {
      expect(holdsAny(person(command.permission), [command.permission])).toBe(true);
    }
  });
});

describe('purposes (A7 §3.1; SPEC §3.5)', () => {
  it('gives every route on the map a purpose of at most 80 characters, with no full stop', () => {
    expect(Object.keys(PAGE_PURPOSES).sort()).toEqual(allRoutes().sort());
    for (const [route, purpose] of Object.entries(PAGE_PURPOSES)) {
      expect(purpose.length, route).toBeLessThanOrEqual(80);
      expect(purpose.length, route).toBeGreaterThan(0);
      expect(purpose, route).not.toMatch(/[.!]$/);
      expect(purpose.charAt(0), route).toBe(purpose.charAt(0).toUpperCase());
    }
  });

  it('gives every item a description in the same style, and says Help Portal, never "portal"', () => {
    for (const item of NAV) {
      expect(item.description.length, item.id).toBeLessThanOrEqual(80);
      expect(item.description, item.id).not.toMatch(/\.$/);
      expect(item.description, item.id).not.toMatch(/\b(?:on|the) portal\b|workbench/i);
    }
    for (const purpose of Object.values(PAGE_PURPOSES)) expect(purpose).not.toMatch(/\b(?:on|the) portal\b|workbench/i);
  });

  it('is the item’s own purpose on a page without tabs, and the page’s on a tab', () => {
    expect(purposeFor('/tickets')).toBe(NAV.find((item) => item.id === 'tickets')!.description);
    expect(purposeFor('/sla/calendars')).toBe('Business hours and holidays the clocks run on');
    expect(purposeFor('/rules/vip-requester')).toBe(PAGE_PURPOSES['/rules']);
    expect(purposeFor('/nowhere')).toBeUndefined();
  });

  it('hands the frame a title and purpose for every route, record pages with the way back, and the 404 last', () => {
    const titles = routeTitles();
    expect(navModel(person()).routes).toEqual(titles);
    expect(titles.at(-1)).toEqual({ pattern: '/[...missing]', title: NOT_FOUND_TITLE });
    expect(titles.find((entry) => entry.pattern === '/rules/[key]')).toEqual({ pattern: '/rules/[key]', title: 'Rules', purpose: PAGE_PURPOSES['/rules/[key]'], href: '/rules' });
    expect(titles.find((entry) => entry.pattern === '/catalogue/forms/[key]')).toMatchObject({ title: 'Services & requests', href: '/catalogue/forms' });
    expect(titles.find((entry) => entry.pattern === '/sla/performance')).toEqual({ pattern: '/sla/performance', title: 'Service levels', purpose: PAGE_PURPOSES['/sla/performance'] });
    expect(new Set(titles.map((entry) => entry.pattern)).size).toBe(titles.length);
  });
});

describe('the v3 map (A7 §3.2; SPEC §3.5)', () => {
  // The map as it reads once the stand-ins are replaced: the release hold
  // (UNFINISHED) is lifted for this block and asserted on its own below.
  const held = [...UNFINISHED];
  beforeEach(() => held.forEach((route) => (UNFINISHED as Set<string>).delete(route)));
  afterEach(() => held.forEach((route) => (UNFINISHED as Set<string>).add(route)));

  it('puts SLA performance first among the Service levels tabs, gated on analytics', () => {
    const lead = person('analytics.read');
    expect(NAV.find((item) => item.id === 'service-levels')!.tabs!.map((tab) => tab.id)).toEqual(['performance', 'policies', 'calendars', 'matrix']);
    expect(tabsFor(lead, 'service-levels').map((tab) => tab.id)).toEqual(['performance']);
    expect(visibleNav(lead).find((item) => item.id === 'service-levels')?.href).toBe('/sla/performance');
  });

  it('lands on Policies when it is open, so the item stays current on all four tabs', () => {
    const manager = person('analytics.read', 'sla.policy.read');
    expect(visibleNav(manager).find((item) => item.id === 'service-levels')?.href).toBe('/sla');
    expect(breadcrumbsFor('/sla/performance')).toEqual([
      { label: 'Service levels', href: '/sla' },
      { label: 'Performance', href: '/sla/performance' },
    ]);
  });

  it('matches a tab exactly only when another tab sits below it (Policies is not current on Performance)', () => {
    const manager = person('analytics.read', 'sla.policy.read');
    expect(tabsFor(manager, 'service-levels')).toEqual([
      { id: 'performance', label: 'Performance', href: '/sla/performance' },
      { id: 'policies', label: 'Policies', href: '/sla', match: 'exact' },
      { id: 'calendars', label: 'Calendars', href: '/sla/calendars' },
      { id: 'matrix', label: 'Priority matrix', href: '/sla/matrix' },
    ]);
    // Forms keeps its builder (`/catalogue/forms/[key]`) lit; Request types does not light up on Forms.
    expect(tabsFor(person('catalogue.manage', 'catalogue.form.read'), 'services')).toEqual([
      { id: 'request-types', label: 'Request types', href: '/catalogue', match: 'exact' },
      { id: 'forms', label: 'Forms', href: '/catalogue/forms' },
    ]);
  });

  it('adds Channels after Webhooks, gated on channel accounts', () => {
    expect(NAV.find((item) => item.id === 'integrations')!.tabs!.map((tab) => tab.id)).toEqual(['deliveries', 'actions', 'credentials', 'webhooks', 'channels']);
    expect(mayOpen(person('channel.account.read'), '/integrations/channels')).toBe(true);
    expect(visibleNav(person('channel.account.read')).find((item) => item.id === 'integrations')?.href).toBe('/integrations/channels');
  });

  it('puts the Status page after Service levels, for status-page readers, with its badge', () => {
    const desk = NAV.filter((item) => item.group === 'desk').map((item) => item.id);
    expect(desk).toEqual(['tickets', 'workforce', 'service-levels', 'status-page']);
    expect(pageEntry('/status-page')?.read).toEqual(['statuspage.read', 'statuspage.manage']);
    expect(PENDING.size).toBe(0);
    const items = navModel(person('statuspage.read'), { statusIncidents: { value: 1 } }).sections.flatMap((section) => section.items);
    expect(items.find((item) => item.id === 'status-page')?.badge).toEqual({ value: 1, tone: 'danger', label: '1 open status incident' });
  });

  it('opens Settings › Modules to settings readers, and General to settings managers', () => {
    expect(mayOpen(person('admin.setting.read'), '/settings/modules')).toBe(true);
    expect(mayOpen(person('admin.module.manage'), '/settings/modules')).toBe(true);
    expect(mayOpen(person('admin.setting.manage'), '/settings')).toBe(true);
  });

  it('opens AI triage › Decisions with ai.decision.read as well as ai.manage', () => {
    expect(tabsFor(person('ai.read', 'ai.decision.read'), 'ai-triage').map((tab) => tab.id)).toEqual(['overview', 'quality', 'decisions']);
  });
});

describe('the three new routes’ stand-ins (A7 §12)', () => {
  const shells = [
    { route: '/sla/performance', module: '../components/sla-performance/SlaPerformancePage.js', name: 'SlaPerformancePage', title: 'SLA performance' },
    { route: '/integrations/channels', module: '../components/integrations/ChannelsView.js', name: 'ChannelsView', title: 'Channels' },
    { route: '/status-page', module: '../components/status-page/StatusPageConsole.js', name: 'StatusPageConsole', title: 'Status page' },
  ];

  it('each has a page and a loading skeleton, gated through the map', () => {
    for (const shell of shells) {
      expect(builtRoutes.has(shell.route), shell.route).toBe(true);
      const dir = join(consoleDir, '(admin)', ...shell.route.split('/').filter(Boolean));
      expect(existsSync(join(dir, 'loading.tsx')), shell.route).toBe(true);
      expect(readFileSync(join(dir, 'page.tsx'), 'utf8')).toContain(`purposeFor('${shell.route}')`);
    }
  });

  it('are held back for the release: off the sidebar, the tabs and the palette, and a 404 from the page', () => {
    expect([...UNFINISHED].sort()).toEqual(shells.map((shell) => shell.route).sort());
    const everyoneHere = person(...everyGateKey);
    const hrefs = [
      ...visibleNav(everyoneHere).map((item) => item.href),
      ...NAV.flatMap((item) => tabsFor(everyoneHere, item.id).map((tab) => tab.href)),
      ...createCommandsFor(everyoneHere).map((command) => command.href),
    ];
    for (const shell of shells) {
      expect(isPending(shell.route), shell.route).toBe(true);
      expect(hrefs, shell.route).not.toContain(shell.route);
      const dir = join(consoleDir, '(admin)', ...shell.route.split('/').filter(Boolean));
      expect(readFileSync(join(dir, 'page.tsx'), 'utf8')).toContain(`if (isPending('${shell.route}')) notFound();`);
    }
  });

  it('export A7_PLACEHOLDER and render an empty state until their owners replace them', async () => {
    for (const shell of shells) {
      const module = (await import(shell.module)) as Record<string, unknown>;
      expect(module.A7_PLACEHOLDER, shell.module).toBe(true);
      const html = renderToStaticMarkup(createElement(module[shell.name] as () => null));
      expect(html, shell.name).toContain(shell.title);
      expect(html, shell.name).toContain('itsm-EmptyState');
      expect(html, shell.name).not.toMatch(/coming soon/i);
    }
  });
});
