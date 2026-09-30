import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CREATE_COMMANDS,
  EXCLUDED,
  NAV,
  NAV_GROUPS,
  PENDING,
  allRoutes,
  breadcrumbsFor,
  createCommandsFor,
  isPending,
  mayOpen,
  navModel,
  pageEntry,
  routeFor,
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

const pages = pagesUnder(consoleDir).map((file) => ({ file, route: routeOfFile(file), platform: file.includes(`${sep}(platform)${sep}`) }));
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
      if (isPending(route)) {
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

  it('gates an item with tabs on exactly the union of its tabs', () => {
    for (const item of NAV.filter((entry) => entry.tabs)) {
      const union = [...new Set(item.tabs!.flatMap((tab) => tab.read))];
      expect([...item.read].sort(), item.id).toEqual(union.sort());
      expect(item.href, item.id).toBe(item.tabs![0]!.href);
    }
  });

  it('shows an item to a permission exactly when one of its built pages opens for it', () => {
    for (const key of everyGateKey) {
      const me = person(key);
      const visible = new Set(visibleNav(me).map((item) => item.id));
      for (const item of NAV) {
        const routes = [...(item.tabs ? item.tabs.flatMap((tab) => [tab.href, ...(tab.routes ?? [])]) : [item.href]), ...(item.routes ?? [])];
        const opens = routes.some((route) => builtRoutes.has(route) && mayOpen(me, route));
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

  it('shows 17 items to someone who holds everything, plus the two operator items', () => {
    // Assets is still being built; it joins the sidebar with its page.
    const ids = visibleNav(everyone).map((item) => item.id);
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
