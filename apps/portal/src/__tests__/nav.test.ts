import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_GATE, AREAS, SERVICE_DESK_GATE, buildAreaModel } from '@itsm/contracts/areas';
import {
  PRIMARY_NAV,
  ROUTES,
  TAB_LABEL_MAX,
  approvalsWaitingLabel,
  holdsAny,
  mayOpen,
  pageGate,
  portalCan,
  portalFrame,
  routeFor,
  showsNewRequest,
  type PortalCan,
} from '../navigation.js';

/**
 * The portal's map, held to its invariants (SPEC §5.1, §5.4, X-44, X-84,
 * X-91).
 *
 *   - Every `page.tsx` under `(portal)` is on the map, and every built route
 *     on the map has a page (a planned one is marked pending).
 *   - Nav gate = page gate: a pill is shown to exactly the people its pages
 *     let in.
 *   - Approvals are never a pill or a tab; they are a row in the avatar menu
 *     with a count, and a count on *Me* and the avatar.
 *   - The tab bar is five tabs at most, with labels short enough for 320 px.
 *   - *New request* is not offered where the page already has it.
 *   - Who may use the other areas is `@itsm/contracts/areas`' to say (v3
 *     §3.2): the rules that were `switcherFor`'s are rows of that package's
 *     `areas.test.ts` now, and this file holds the portal to having no copy.
 */

const appDir = fileURLToPath(new URL('../app/', import.meta.url));
const portalDir = join(appDir, '(portal)');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pagesUnder(path));
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}

/** `(portal)/tickets/[id]/page.tsx` → `/tickets/[id]`. Route groups do not appear in URLs. */
function routeOfFile(file: string): string {
  const parts = relative(portalDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((part) => !/^\(.*\)$/.test(part));
  return `/${parts.join('/')}`;
}

const builtRoutes = new Set(pagesUnder(portalDir).map(routeOfFile));

const everyone: PortalCan = { readCatalogue: true, readKnowledge: true, readApprovals: true, createTickets: true, search: true };
const nobody: PortalCan = { readCatalogue: false, readKnowledge: false, readApprovals: false, createTickets: false, search: false };

describe('every page is on the map', () => {
  it('finds the portal’s pages', () => {
    expect(builtRoutes.size).toBeGreaterThanOrEqual(10);
    expect(builtRoutes.has('/')).toBe(true);
    expect(builtRoutes.has('/tickets/[id]')).toBe(true);
  });

  it('has an entry for every page', () => {
    const mapped = new Set(ROUTES.map((entry) => entry.route));
    expect([...builtRoutes].filter((route) => !mapped.has(route))).toEqual([]);
  });

  it('names no page that does not exist, unless it is marked as planned', () => {
    expect(ROUTES.filter((entry) => !entry.pending && !builtRoutes.has(entry.route)).map((entry) => entry.route)).toEqual([]);
    // A planned page that has since been built should lose its marker.
    expect(ROUTES.filter((entry) => entry.pending && builtRoutes.has(entry.route)).map((entry) => entry.route)).toEqual([]);
  });

  it('lists each route once', () => {
    const routes = ROUTES.map((entry) => entry.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('finds the entry for a URL, parameters included', () => {
    expect(routeFor('/tickets/INC-000123')?.route).toBe('/tickets/[id]');
    expect(routeFor('/tickets/')?.route).toBe('/tickets');
    expect(routeFor('/knowledge/set-up-vpn?x=1')?.route).toBe('/knowledge/[key]');
    expect(routeFor('/')?.route).toBe('/');
    expect(routeFor('/nowhere/at/all')).toBeNull();
  });
});

describe('nav gate = page gate', () => {
  const keys = [...new Set(ROUTES.flatMap((entry) => entry.read))];

  it('shows each pill to exactly the people who may open its pages', () => {
    for (const key of [...keys, 'unrelated.permission']) {
      const held = new Set([key]);
      const pills = portalFrame(portalCan(held), 0).nav.sections.flatMap((section) => section.items.map((item) => item.id));
      for (const entry of PRIMARY_NAV) {
        const pages = ROUTES.filter((route) => route.section === entry.id && !route.pending);
        const opens = pages.some((route) => mayOpen(route.route, held));
        expect(pills.includes(entry.id), `${entry.id} for ${key}`).toBe(opens);
      }
    }
  });

  it('reads each pill’s gate from the same list its pages use', () => {
    for (const entry of PRIMARY_NAV) {
      for (const route of ROUTES.filter((candidate) => candidate.section === entry.id)) expect(route.read, route.route).toEqual(entry.read);
    }
  });

  it('gates Services and Knowledge, and nothing a requester needs to get help', () => {
    expect(pageGate('/catalogue')).toEqual(['catalogue.read']);
    expect(pageGate('/knowledge/[key]')).toEqual(['knowledge.read']);
    expect(pageGate('/approvals')).toEqual(['approval.read']);
    expect(pageGate('/')).toEqual([]);
    expect(pageGate('/tickets')).toEqual([]);
    expect(() => pageGate('/nowhere')).toThrow();
    expect(holdsAny(new Set(), [])).toBe(true);
  });
});

describe('approvals are never primary navigation (X-44)', () => {
  it('are not a pill or a tab, however many are waiting', () => {
    const frame = portalFrame(everyone, 7);
    expect(frame.nav.sections.flatMap((section) => section.items).map((item) => item.href)).not.toContain('/approvals');
    expect(frame.tabs.map((tab) => tab.href)).not.toContain('/approvals');
  });

  it('are a row in the avatar menu, with the count, for whoever holds approval.read', () => {
    const waiting = portalFrame(everyone, 2).menu.find((item) => 'id' in item && item.id === 'approvals');
    expect(waiting).toMatchObject({ label: 'Approvals', href: '/approvals', description: '2 approvals waiting' });
    const none = portalFrame(everyone, 0).menu.find((item) => 'id' in item && item.id === 'approvals');
    expect(none).toMatchObject({ description: 'Nothing waiting on you' });
    expect(portalFrame({ ...everyone, readApprovals: false }, 0).menu.some((item) => 'id' in item && item.id === 'approvals')).toBe(false);
  });

  it('put the count on the avatar and on Me, only when something is waiting', () => {
    const frame = portalFrame(everyone, 3);
    expect(frame.avatarBadge).toEqual({ value: 3, label: '3 approvals waiting' });
    expect(frame.tabs.at(-1)).toMatchObject({ id: 'me', href: '/profile', badge: { value: 3, tone: 'accent', label: '3 approvals waiting' } });
    const quiet = portalFrame(everyone, 0);
    expect(quiet.avatarBadge).toBeUndefined();
    expect(quiet.tabs.at(-1)?.badge).toBeUndefined();
    expect(portalFrame({ ...everyone, readApprovals: false }, 3).avatarBadge).toBeUndefined();
  });

  it('say the count in words, capped as the badge is', () => {
    expect(approvalsWaitingLabel(1)).toBe('1 approval waiting');
    expect(approvalsWaitingLabel(12)).toBe('12 approvals waiting');
    expect(approvalsWaitingLabel(140)).toBe('99+ approvals waiting');
  });
});

describe('the pills and the tab bar (X-91)', () => {
  it('are Home, My requests, Services, Knowledge — nav label = H1 noun', () => {
    const items = portalFrame(everyone, 0).nav.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.label)).toEqual(['Home', 'My requests', 'Services', 'Knowledge']);
    expect(items[0]).toMatchObject({ href: '/', match: 'exact' });
  });

  it('dock five tabs, Me last, each label short enough for a fifth of 320 px', () => {
    const tabs = portalFrame(everyone, 0).tabs;
    expect(tabs.map((tab) => tab.label)).toEqual(['Home', 'Requests', 'Services', 'Knowledge', 'Me']);
    expect(tabs.length).toBeLessThanOrEqual(5);
    for (const tab of tabs) {
      expect(tab.label.length, tab.label).toBeLessThanOrEqual(TAB_LABEL_MAX);
      expect(tab.icon, tab.label).toBeTruthy();
    }
  });

  it('leave out what the person cannot open', () => {
    const tabs = portalFrame(nobody, 0).tabs;
    expect(tabs.map((tab) => tab.id)).toEqual(['home', 'tickets', 'me']);
  });

  it('put Profile first in the avatar menu', () => {
    expect(portalFrame(nobody, 0).menu).toEqual([{ id: 'profile', label: 'Profile', icon: 'profile', href: '/profile' }]);
  });
});

describe('New request in the top bar (X-84)', () => {
  it('is not offered where the page already has it, nor on the report page', () => {
    for (const path of ['/', '/tickets', '/tickets/', '/report', '/tickets?show=needs']) expect(showsNewRequest(path, everyone), path).toBe(false);
  });

  it('is not offered beside a request’s own primary action, nor inside a service’s form', () => {
    for (const path of ['/tickets/INC-000123', '/tickets/INC-000123?fixed=no', '/tickets/REQ-000002/', '/catalogue/new-laptop', '/catalogue/new-laptop#top']) {
      expect(showsNewRequest(path, everyone), path).toBe(false);
    }
  });

  it('is offered everywhere else', () => {
    for (const path of ['/catalogue', '/catalogue?q=vpn', '/knowledge', '/knowledge/vpn', '/profile', '/approvals', '/search']) expect(showsNewRequest(path, everyone), path).toBe(true);
  });

  it('is never offered without ticket.create', () => {
    expect(showsNewRequest('/catalogue', nobody)).toBe(false);
  });
});

describe('the other areas (v3 §3.1–§3.2)', () => {
  const source = readFileSync(fileURLToPath(new URL('../navigation.ts', import.meta.url)), 'utf8');

  it('keeps no copy of the area gates or the v2 switcher here', () => {
    expect(source).not.toMatch(/switcherFor|AppSwitcherItem|WORKBENCH_PERMISSIONS|ADMIN_PERMISSIONS/);
    for (const key of [...SERVICE_DESK_GATE, ...ADMINISTRATION_GATE]) expect(source, key).not.toContain(`'${key}'`);
  });

  it('names the portal as the one table does: a requester sees the "Help Portal" lockup and nothing to switch to', () => {
    const model = buildAreaModel({ app: 'portal', held: ['ticket.create', 'ticket.read', 'approval.read'], session: { kind: 'oidc' }, origins: {} });
    expect(model.visible).toBe(false);
    expect(model.areas.map((area) => area.name)).toEqual([AREAS.portal.name]);
    expect(AREAS.portal.name).toBe('Help Portal');
  });
});
