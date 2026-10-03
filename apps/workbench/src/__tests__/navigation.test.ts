// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SERVICE_DESK_NAV_PREVIEW,
  SERVICE_DESK_OVERVIEW_PURPOSE,
  SERVICE_DESK_PENDING,
  buildAreaModel,
  isServiceDeskRoutePending,
} from '@itsm/contracts/areas';
import type { NavItem, NavModel } from '@itsm/ui/shell';
import { deskTabs } from '../components/DeskShell.js';
import { VIEWS, navWithCounts } from '../inbox/views.js';
import * as navigation from '../navigation.js';

/**
 * The Service Desk's map, held to its invariants (v3 §3.5, RV6, V-m2; A2
 * §5.4.1, §7.1, §15.1):
 *
 *   - every `page.tsx` is on the map — an item, a record under a section, a
 *     redirect or a page outside the frame — and every route on the map that
 *     is not pending has its page;
 *   - a pending route has no page: the day its page lands this fails, and the
 *     integrator's edit to `SERVICE_DESK_PENDING` turns it green (§15.1);
 *   - nav gate = page gate: an item, a tab or a palette place is offered to
 *     exactly the people its page opens for, and never while it is pending;
 *   - the landing page's preview of this navigation is this navigation
 *     (the drift guard of X-M2 / V-m2).
 *
 * Until WP-46 lands the Overview (same wave, rule 8), the "has a page"
 * check fails on `/overview`; the integrator runs the pair.
 */

const { DESK_HOME, PENDING, ROUTES, deskDestinations, deskFrame, deskNavModel, deskTabLinks, incidentChip, isPending, mayOpen, routeEntry, routeFor } =
  navigation;

// Paths from the file's own location: under jsdom `URL` is the DOM's, which `fileURLToPath` refuses.
const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'api') out.push(...pagesUnder(path));
    } else if (name === 'page.tsx') {
      out.push(path);
    }
  }
  return out;
}

/** `(desk)/tickets/[id]/page.tsx` → `/tickets/[id]`: route groups do not appear in URLs. */
function routeOfFile(file: string): string {
  const parts = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((part) => !/^\(.*\)$/.test(part));
  return `/${parts.join('/')}`;
}

const builtRoutes = new Set(pagesUnder(appDir).map(routeOfFile));
const everyGateKey = [...new Set(ROUTES.flatMap((entry) => entry.gate))];
const held = (...keys: string[]): ReadonlySet<string> => new Set(keys);
const AGENT = held('ticket.read', 'ticket.update', 'ticket.create', 'incident.major.read', 'knowledge.read', 'search.query');
const LEAD = held(...AGENT, 'analytics.read', 'change.read', 'problem.read', 'knowledge.write');
const TEAM = { id: '9b2c1a40-1111-4a2b-8c3d-0123456789ab', name: 'Service Desk L1' };
const ORIGINS = { portal: 'https://help.example', workbench: 'https://desk.example', admin: 'https://admin.example', site: 'https://itsm.example' };

function items(model: NavModel): NavItem[] {
  return model.sections.flatMap((section) => section.items);
}

/**
 * The navigation module with the pending set replaced, as the integrators of
 * waves 5–7 will leave it (RV6). The contracts' `isServiceDeskRoutePending`
 * reads the set from inside its own module, so both are replaced together.
 */
async function withPending(pending: readonly string[]): Promise<typeof navigation> {
  vi.resetModules();
  vi.doMock('@itsm/contracts/areas', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@itsm/contracts/areas')>();
    const set: ReadonlySet<string> = new Set(pending);
    const isPendingRoute = (route: string): boolean => {
      const path = route.split(/[?#]/, 1)[0] ?? '';
      return [...set].some((entry) => path === entry || path.startsWith(`${entry}/`));
    };
    return { ...actual, SERVICE_DESK_PENDING: set, isServiceDeskRoutePending: isPendingRoute };
  });
  return import('../navigation.js');
}

afterEach(() => {
  vi.doUnmock('@itsm/contracts/areas');
  vi.resetModules();
});

describe('every page is on the map', () => {
  it('finds the Service Desk’s pages', () => {
    expect(builtRoutes.has('/inbox/[view]')).toBe(true);
    expect(builtRoutes.has('/tickets/[id]')).toBe(true);
    expect(builtRoutes.has('/demo')).toBe(true);
  });

  it('maps every page.tsx to an item, a record, a redirect or a page outside the frame', () => {
    expect([...builtRoutes].filter((route) => routeEntry(route) === null)).toEqual([]);
  });

  it('has a page for every route that is not pending, and none for a pending one', () => {
    for (const { route } of ROUTES) {
      if (isPending(route)) {
        expect(builtRoutes.has(route), `${route} has a page now: take it out of SERVICE_DESK_PENDING (§15.1)`).toBe(false);
      } else {
        expect(builtRoutes.has(route), `${route} is on the map but has no page.tsx`).toBe(true);
      }
    }
  });

  it('holds only Phase 2 and 3 routes and the Board as pending, all of them on the map (RV6)', () => {
    expect(PENDING).toBe(SERVICE_DESK_PENDING);
    expect(isPending).toBe(isServiceDeskRoutePending);
    expect(isPending('/board')).toBe(true);
    for (const route of PENDING) {
      expect(routeEntry(route), route).not.toBeNull();
      expect(['/board', '/major-incidents', '/team', '/changes', '/problems', '/knowledge']).toContain(route);
    }
  });

  it('finds the pattern a path is served by, a literal segment first', () => {
    expect(routeFor('/')).toBe('/');
    expect(routeFor('/overview')).toBe('/overview');
    expect(routeFor('/inbox/mine?q=vpn')).toBe('/inbox/[view]');
    expect(routeFor('/inbox/team/abc')).toBe('/inbox/team/[teamId]');
    expect(routeFor('/tickets/INC-000123')).toBe('/tickets/[id]');
    expect(routeFor('/knowledge/new')).toBe('/knowledge/new');
    expect(routeFor('/knowledge/KB-0001')).toBe('/knowledge/[key]');
    expect(routeFor('/nowhere/at/all')).toBeNull();
  });
});

describe('nav gate = page gate', () => {
  it('offers an item to a permission exactly when its page opens for it and has shipped', () => {
    for (const key of everyGateKey) {
      const person = held(key);
      const visible = new Set(items(deskNavModel({ held: person, teams: [TEAM] })).map((item) => item.href));
      const candidates = items(deskNavModel({ held: held(...everyGateKey), teams: [TEAM] }));
      for (const item of candidates) {
        expect(visible.has(item.href), `${item.href} for someone holding only ${key}`).toBe(mayOpen(person, item.href) && !isPending(item.href));
      }
    }
  });

  it('links every item, tab and palette place to a page that opens for the person and is not pending', () => {
    for (const person of [held(), AGENT, LEAD, ...everyGateKey.map((key) => held(key))]) {
      const links = [
        ...items(deskNavModel({ held: person, teams: [TEAM] })),
        ...deskTabLinks(person),
        ...deskDestinations(person),
      ];
      for (const link of links) {
        expect(routeFor(link.href), link.href).not.toBeNull();
        expect(isPending(link.href), link.href).toBe(false);
        expect(mayOpen(person, link.href), link.href).toBe(true);
      }
    }
  });

  it('closes an address the map does not know', () => {
    expect(mayOpen(held(...everyGateKey), '/no-such-page')).toBe(false);
  });

  it('gates the pages that check in their own source with their own route', () => {
    for (const file of pagesUnder(appDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/mayOpen\([^,]+,\s*'([^']+)'\)/g)) expect(routeFor(match[1]!), file).toBe(routeOfFile(file));
    }
  });
});

describe('the sidebar (v3 §3.5)', () => {
  it('reads Overview, then Tickets, then Teams for an agent, while Operations is pending', () => {
    const model = deskNavModel({ held: AGENT, teams: [TEAM] });
    expect(model.sections.map((section) => [section.id, section.label])).toEqual([
      ['overview', undefined],
      ['views', 'Tickets'],
      ['teams', 'Teams'],
    ]);
    expect(model.sections[1]!.items.map((item) => item.href)).toEqual(VIEWS.map((view) => `/inbox/${view.id}`));
    expect(model.sections[2]!.items).toEqual([expect.objectContaining({ label: 'Service Desk L1', href: `/inbox/team/${TEAM.id}`, description: 'Open work for Service Desk L1' })]);
    expect(model.label).toBe('Service Desk');
    expect(model.pinned).toEqual({ enabled: true, max: 8 });
    expect(model.recent).toEqual({ enabled: true, max: 8 });
  });

  it('never lists the Board: it is a layout of a view and the phone’s tab', () => {
    expect(items(deskNavModel({ held: LEAD, teams: [TEAM] })).some((item) => item.href === '/board' || item.label === 'Board')).toBe(false);
  });

  it('gives every item its purpose line, and Overview the contract’s own (V-m2)', () => {
    const model = deskNavModel({ held: AGENT, teams: [TEAM] });
    for (const item of items(model)) expect(item.description, item.id).toMatch(/^[A-Z][^.]*[^.\s]$/);
    expect(items(model)[0]).toMatchObject({ id: 'overview', href: '/overview', description: SERVICE_DESK_OVERVIEW_PURPOSE, match: 'exact' });
    // Imported, never retyped.
    const source = readFileSync(join(here, '..', 'navigation.ts'), 'utf8');
    expect(source).not.toContain(SERVICE_DESK_OVERVIEW_PURPOSE.slice(0, 24));
  });

  it('matches the landing’s preview of it, label and icon, entry for entry (X-M2 drift guard)', () => {
    const model = deskNavModel({ held: AGENT, teams: [] });
    for (const entry of SERVICE_DESK_NAV_PREVIEW) {
      const section = model.sections.find((one) => one.items.some((item) => item.id === entry.id));
      const item = section?.items.find((one) => one.id === entry.id);
      expect(item, entry.id).toBeDefined();
      expect(item!.label, entry.id).toBe(entry.label);
      expect(item!.icon, entry.id).toBe(entry.icon);
      if (entry.section) expect(section!.label, entry.id).toBe(entry.section);
    }
  });

  it('shows nothing of the tickets without ticket.read', () => {
    const model = deskNavModel({ held: held('incident.major.read'), teams: [TEAM] });
    expect(model.sections).toEqual([]);
    expect(model.pinned?.enabled).toBe(false);
  });

  it('titles a ticket "‹ {the view it was opened from}", from the last-view cookie', () => {
    const route = (lastView: string | null) => deskNavModel({ held: AGENT, teams: [TEAM], lastView }).routes!.find((one) => one.pattern === '/tickets/[id]');
    expect(route('due')).toEqual({ pattern: '/tickets/[id]', title: 'Due soon', href: '/inbox/due', purpose: VIEWS.find((view) => view.id === 'due')!.description });
    expect(route(`team/${TEAM.id}`)).toMatchObject({ title: 'Service Desk L1', href: `/inbox/team/${TEAM.id}` });
    expect(route(null)).toMatchObject({ title: 'My work', href: '/inbox/mine' });
    expect(route('nonsense')).toMatchObject({ title: 'My work' });
    expect(deskNavModel({ held: AGENT, teams: [] }).routes!.find((one) => one.pattern === '/major-incidents/[number]')).toMatchObject({
      title: 'Major incidents',
      href: '/major-incidents',
    });
  });

  it('puts the counts on in the browser, by view id and team key', () => {
    const model = navWithCounts(deskNavModel({ held: AGENT, teams: [TEAM] }), { mine: { count: 3, capped: false }, [`team:${TEAM.id}`]: { count: 120, capped: true } });
    const byId = Object.fromEntries(items(model).map((item) => [item.id, item.badge]));
    expect(byId.mine).toMatchObject({ value: 3, label: '3 tickets' });
    expect(byId[`team:${TEAM.id}`]).toMatchObject({ value: 120, label: 'more than 99 tickets' });
    expect(byId.overview).toBeUndefined();
  });

  it('adds Team performance for leads and Operations by permission once those pages ship', async () => {
    const shipped = await withPending([]);
    const lead = shipped.deskNavModel({ held: LEAD, teams: [TEAM] });
    expect(lead.sections.map((section) => section.id)).toEqual(['overview', 'views', 'teams', 'operations']);
    expect(lead.sections[2]!.items[0]).toMatchObject({ label: 'Team performance', href: '/team', icon: 'chart-bar' });
    expect(lead.sections[3]!.items.map((item) => [item.label, item.icon])).toEqual([
      ['Major incidents', 'siren'],
      ['Changes', 'calendar'],
      ['Problems', 'bug'],
      ['Knowledge', 'knowledge'],
    ]);
    const agent = shipped.deskNavModel({ held: AGENT, teams: [TEAM] });
    expect(agent.sections[2]!.items.map((item) => item.label)).toEqual(['Service Desk L1']);
    expect(agent.sections[3]!.items.map((item) => item.label)).toEqual(['Major incidents', 'Knowledge']);
  });
});

describe('the phone’s tab bar (A2 §7.1, RV6)', () => {
  const actions = { openSearch: () => undefined, sheetOpen: false, attention: false };

  it('reads Overview · My work · Search · More while the Board is pending', () => {
    const tabs = deskTabs(deskTabLinks(AGENT), actions);
    expect(tabs.map((tab) => tab.label)).toEqual(['Overview', 'My work', 'Search', 'More']);
    expect(tabs[2]).toMatchObject({ haspopup: 'dialog' });
    expect(tabs[3]).toMatchObject({ haspopup: 'dialog', controls: 'itsm-nav-sheet', expanded: false });
    // Each label fits a 320 px bar: nine characters at most (X-91).
    for (const tab of tabs) expect(tab.label.length, tab.label).toBeLessThanOrEqual(9);
  });

  it('reads Overview · My work · Board · Search · More once the Board ships', async () => {
    const shipped = await withPending(['/major-incidents', '/team', '/changes', '/problems', '/knowledge']);
    const tabs = deskTabs(shipped.deskTabLinks(AGENT), actions);
    expect(tabs.map((tab) => tab.label)).toEqual(['Overview', 'My work', 'Board', 'Search', 'More']);
    expect(tabs[2]).toMatchObject({ href: '/board', icon: 'columns-3' });
    expect(shipped.deskDestinations(AGENT).map((place) => [place.label, place.shortcut])).toEqual([
      ['Overview', 'g o'],
      ['Board', 'g b'],
    ]);
  });

  it('marks More with a dot when a count is a danger one, and current while the sheet is open', () => {
    const tabs = deskTabs(deskTabLinks(AGENT), { ...actions, sheetOpen: true, attention: true });
    expect(tabs.at(-1)).toMatchObject({ expanded: true, dot: { label: expect.any(String) } });
  });

  it('offers no ticket tabs without ticket.read', () => {
    expect(deskTabLinks(held())).toEqual([]);
  });
});

describe('the frame’s major-incident chip (A2 §5.2.4, RV6)', () => {
  const mi = { number: 'MI-0004', title: 'VPN sign-in failures', severity: 'SEV2', ticketId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };

  it('links the incident’s ticket while /major-incidents is pending', () => {
    expect(incidentChip([mi])).toEqual({
      label: 'MI-0004 · VPN sign-in failures · Sev 2',
      compactLabel: 'MI-0004 · Sev 2',
      href: `/tickets/${mi.ticketId}`,
    });
    expect(incidentChip([{ ...mi, ticketId: null }])).toEqual({ label: 'MI-0004 · VPN sign-in failures · Sev 2', compactLabel: 'MI-0004 · Sev 2' });
    expect(incidentChip([])).toBeNull();
  });

  it('links /major-incidents/MI-0004 once it is not, and the register for two or more', async () => {
    const shipped = await withPending([]);
    expect(shipped.incidentChip([mi])).toMatchObject({ href: '/major-incidents/MI-0004' });
    expect(shipped.incidentChip([mi, { ...mi, number: 'MI-0005' }])).toEqual({
      label: '2 major incidents',
      compactLabel: '2 major incidents',
      href: '/major-incidents',
    });
  });
});

describe('the links out (A2 §3.7, §5.2.6; D18)', () => {
  it('reaches the Help Portal’s knowledge and the person’s notification settings, real sessions', () => {
    const areas = buildAreaModel({ app: 'workbench', held: ['ticket.update'], session: { kind: 'oidc' }, origins: ORIGINS });
    const { links } = deskFrame({ held: AGENT, teams: [], areas });
    expect(links).toEqual({
      knowledge: 'https://help.example/knowledge',
      knowledgePersona: null,
      notificationSettings: 'https://help.example/profile#notifications',
      home: null,
      howItWorks: null,
    });
  });

  it('in a demo, opens the Help Portal as Emma, offers no settings that are not Alex’s, and links the site', () => {
    const areas = buildAreaModel({ app: 'workbench', held: [], session: { kind: 'demo', persona: 'agent' }, origins: ORIGINS });
    const { links } = deskFrame({ held: AGENT, teams: [], areas });
    expect(links.knowledge).toBe('https://help.example/demo?persona=employee&demo=1&redirectTo=%2Fknowledge');
    expect(links.knowledgePersona).toBe("You'll continue as Emma Clarke, Finance Manager");
    expect(links.notificationSettings).toBeNull();
    expect(links.home).toEqual({ href: 'https://itsm.example/', label: 'IT Service Management home' });
    expect(links.howItWorks).toBe('https://itsm.example/#how-it-works');
  });

  it('starts at the area’s home', () => {
    expect(DESK_HOME).toBe('/overview');
  });
});
