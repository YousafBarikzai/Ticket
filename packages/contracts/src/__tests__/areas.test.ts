import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ADMINISTRATION_GATE,
  AREAS,
  AREA_ORDER,
  CROSS_AREA_DEMO_TEAM_NOTE,
  PRODUCT_NAME,
  SERVICE_DESK_GATE,
  SERVICE_DESK_NAV_PREVIEW,
  SERVICE_DESK_OVERVIEW_PURPOSE,
  SERVICE_DESK_PENDING,
  SITE,
  appOrigins,
  buildAreaModel,
  crossAreaHref,
  crossAreaTicketHref,
  holdsArea,
  isAreaId,
  isServiceDeskRoutePending,
  normaliseOrigin,
  type AreaId,
  type AreaInput,
  type AreaModel,
  type Origins,
} from '../areas.js';
import { DEMO_PERSONAS } from '../demo.js';
import type { DemoArea, DemoPersonaKey } from '../demo.js';

/**
 * The area model's rules, one row each (SPEC v3 §3.1–§3.3; A2 §3.3 and §15.1).
 *
 * Every switcher row, every "Open in Service Desk" and every demo hop is
 * computed by these few functions, so a wrong row here is a wrong link in all
 * three apps at once — and in a demo, a link that drops a prospect on a 404
 * or on somebody else's persona.
 */

const ORIGINS: Origins = {
  portal: 'https://help.example.com',
  workbench: 'https://desk.example.com',
  admin: 'https://admin.example.com',
  site: 'https://www.example.com',
};

const real = (app: AreaId, held: Iterable<string>, extra: Partial<AreaInput> = {}): AreaModel =>
  buildAreaModel({ app, held, session: { kind: 'oidc' }, origins: ORIGINS, ...extra });

const demo = (app: AreaId, extra: Partial<AreaInput> = {}): AreaModel =>
  buildAreaModel({
    app,
    held: [],
    session: { kind: 'demo', persona: DEMO_PERSONAS.find((persona) => persona.area === app)!.key },
    origins: ORIGINS,
    ...extra,
  });

const ids = (model: AreaModel): AreaId[] => model.areas.map((row) => row.id);
const persona = (key: DemoPersonaKey) => DEMO_PERSONAS.find((one) => one.key === key)!;

/** The permission keys a seeded system role grants, read from the identity module rather than copied. */
async function systemRoles(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  // A variable specifier, so type-checking the contracts package does not pull
  // the identity module (and the platform behind it) into its program.
  const identity = '@itsm/module-identity';
  const { SYSTEM_ROLES } = (await import(/* @vite-ignore */ identity)) as {
    SYSTEM_ROLES: readonly { readonly key: string; readonly permissions: readonly { readonly key: string }[] }[];
  };
  return new Map(SYSTEM_ROLES.map((role) => [role.key, new Set(role.permissions.map((p) => p.key))]));
}

describe('names (§3.1)', () => {
  it('names the product and its three areas once', () => {
    expect(PRODUCT_NAME).toBe('IT Service Management');
    expect(AREA_ORDER).toEqual(['portal', 'workbench', 'admin']);
    expect(AREA_ORDER.map((id) => AREAS[id].name)).toEqual(['Help Portal', 'Service Desk', 'Administration']);
    expect(AREA_ORDER.map((id) => AREAS[id].description)).toEqual([
      'Get help, request things and follow your requests',
      'Work tickets, queues and SLAs',
      'Set up rules, SLAs, people and reports',
    ]);
    expect(AREA_ORDER.map((id) => AREAS[id].icon)).toEqual(['life-buoy', 'inbox', 'settings-2']);
    expect(AREA_ORDER.map((id) => AREAS[id].home)).toEqual(['/', '/overview', '/']);
    for (const id of AREA_ORDER) expect(AREAS[id].id).toBe(id);
  });

  it('lets the palette find the Service Desk by its old name and by "ticketing"', () => {
    expect(AREAS.workbench.keywords).toEqual(expect.arrayContaining(['ticketing', 'workbench']));
    for (const id of AREA_ORDER) expect(AREAS[id].keywords.length, id).toBeGreaterThan(0);
  });

  it('reads each origin from its own variable, defaulting to the app’s dev server', () => {
    expect(AREA_ORDER.map((id) => [AREAS[id].originEnv, AREAS[id].devOrigin])).toEqual([
      ['PORTAL_ORIGIN', 'http://localhost:3200'],
      ['WORKBENCH_ORIGIN', 'http://localhost:3100'],
      ['ADMIN_ORIGIN', 'http://localhost:3300'],
    ]);
    expect(SITE).toEqual({ originEnv: 'SITE_ORIGIN', devOrigin: 'http://localhost:3400', homeLabel: 'IT Service Management home' });
  });

  it('matches the dev origins each app’s BFF declares', () => {
    const root = resolve(import.meta.dirname, '..', '..', '..', '..');
    for (const id of AREA_ORDER) {
      const source = readFileSync(join(root, 'apps', id, 'src', 'bff.ts'), 'utf8');
      expect(source, id).toContain(`originEnvVar: '${AREAS[id].originEnv}'`);
      expect(source, id).toContain(`defaultOrigin: '${AREAS[id].devOrigin}'`);
    }
  });

  it('is frozen: client code receives the same objects', () => {
    expect(Object.isFrozen(AREAS)).toBe(true);
    expect(Object.isFrozen(AREAS.portal)).toBe(true);
    expect(Object.isFrozen(AREAS.portal.keywords)).toBe(true);
    expect(Object.isFrozen(AREA_ORDER)).toBe(true);
  });

  it('is the demo’s set of areas, one persona each', () => {
    expectTypeOf<AreaId>().toEqualTypeOf<DemoArea>();
    expect([...new Set(DEMO_PERSONAS.map((one) => one.area))].sort()).toEqual([...AREA_ORDER].sort());
  });

  it('only accepts its own ids', () => {
    for (const id of AREA_ORDER) expect(isAreaId(id)).toBe(true);
    for (const other of ['site', 'Portal', '', 'toString', '__proto__', null, undefined, 1]) expect(isAreaId(other)).toBe(false);
  });

  it('draws every icon from the design system’s registry', () => {
    // Read as text: the contracts package does not depend on @itsm/ui.
    const root = resolve(import.meta.dirname, '..', '..', '..', '..');
    const registry = readFileSync(join(root, 'packages', 'ui', 'src', 'icons', 'registry.ts'), 'utf8');
    const names = new Set([...registry.matchAll(/^\s+'?([a-z0-9-]+)'?: '[a-z0-9-]+',/gm)].map((match) => match[1]));
    expect(names.size).toBeGreaterThan(50);
    for (const icon of [...AREA_ORDER.map((id) => AREAS[id].icon), ...SERVICE_DESK_NAV_PREVIEW.map((item) => item.icon)]) {
      expect(names.has(icon), icon).toBe(true);
    }
  });
});

describe('gates (§3.2)', () => {
  it('opens the Service Desk to anyone who works tickets', () => {
    expect([...SERVICE_DESK_GATE]).toEqual(['ticket.update', 'ticket.assign', 'ticket.comment.internal']);
  });

  it('opens Administration to anyone who sets something up, by the thirteen keys', () => {
    expect([...ADMINISTRATION_GATE]).toEqual([
      'admin.setting.read',
      'admin.setting.manage',
      'admin.flag.manage',
      'identity.user.manage',
      'rules.rule.read',
      'workflow.manage',
      'sla.policy.read',
      'analytics.read',
      'audit.read',
      'integration.action.read',
      'catalogue.manage',
      'ticket.config.manage',
      'platform.tenant.read',
    ]);
  });

  it('gates on permissions some module declares, with one known exception', async () => {
    const runtime = '@itsm/runtime';
    const { ALL_MODULES } = (await import(/* @vite-ignore */ runtime)) as {
      ALL_MODULES: readonly { readonly permissions: readonly { readonly key: string }[] }[];
    };
    const declared = new Set(ALL_MODULES.flatMap((manifest) => manifest.permissions.map((p) => p.key)));
    expect(declared.size).toBeGreaterThan(50);
    // `platform.tenant.read` is in the gate because the apps' copies of it had
    // it (SPEC §3.2 keeps the list as it was), but no module declares it yet:
    // operators hold `platform.tenant.manage`. Pinned, so whoever declares it
    // — or drops it from the gate — sees this row and updates it.
    const undeclared = [...SERVICE_DESK_GATE, ...ADMINISTRATION_GATE].filter((key) => !declared.has(key));
    expect(undeclared).toEqual(['platform.tenant.read']);
  }, 60_000);

  it('lists the Help Portal for everyone, and the others by any one key', () => {
    const none = new Set<string>();
    expect(holdsArea('portal', none)).toBe(true);
    expect(holdsArea('workbench', none)).toBe(false);
    expect(holdsArea('admin', none)).toBe(false);
    expect(holdsArea('workbench', new Set(['ticket.comment.internal']))).toBe(true);
    expect(holdsArea('admin', new Set(['platform.tenant.read']))).toBe(true);
    // Reading tickets is not working them: a requester reads their own.
    expect(holdsArea('workbench', new Set(['ticket.read', 'ticket.create']))).toBe(false);
  });

  it('gives each seeded role the areas of the §3.2 table', async () => {
    const roles = await systemRoles();
    const areasOf = (role: string) => ids(real('portal', roles.get(role)!));
    expect(areasOf('requester')).toEqual(['portal']);
    expect(areasOf('agent')).toEqual(['portal', 'workbench']);
    expect(areasOf('team_lead')).toEqual(['portal', 'workbench', 'admin']);
    expect(areasOf('service_owner')).toEqual(['portal', 'workbench', 'admin']);
    expect(areasOf('administrator')).toEqual(['portal', 'workbench', 'admin']);
    // Alex Morgan's roles (agent + team lead) list all three even outside the demo.
    const alex = new Set([...roles.get('agent')!, ...roles.get('team_lead')!]);
    expect(ids(real('workbench', alex))).toEqual(['portal', 'workbench', 'admin']);
  }, 60_000);
});

describe('buildAreaModel (§3.3)', () => {
  const agent = ['ticket.read', 'ticket.update', 'ticket.assign'];
  const everything = [...SERVICE_DESK_GATE, ...ADMINISTRATION_GATE];

  it('gives a requester a lockup: one area, not interactive', () => {
    const model = real('portal', ['ticket.create', 'ticket.read']);
    expect(ids(model)).toEqual(['portal']);
    expect(model.visible).toBe(false);
    expect(model.product).toBe('IT Service Management');
    expect(model.current).toBe('portal');
    expect(model.demo).toBe(false);
  });

  it('gives an agent the Help Portal and the Service Desk', () => {
    const model = real('workbench', agent);
    expect(ids(model)).toEqual(['portal', 'workbench']);
    expect(model.visible).toBe(true);
  });

  it('always lists the area the person is in, whatever the gates', () => {
    // An agent may open a read-only Administration page by URL.
    expect(ids(real('admin', agent))).toEqual(['portal', 'workbench', 'admin']);
    expect(ids(real('workbench', []))).toEqual(['portal', 'workbench']);
  });

  it('sends the current row to the area’s home, or to the home the app passes', () => {
    const current = real('workbench', agent).areas.find((row) => row.current)!;
    expect(current).toMatchObject({ id: 'workbench', href: '/overview', origin: null, current: true });
    expect(real('workbench', agent, { homePath: '/inbox' }).areas.find((row) => row.current)!.href).toBe('/inbox');
    // A home that is not a path on this origin is ignored, not linked.
    for (const homePath of ['//evil.example', 'https://evil.example', '/\\evil']) {
      expect(real('workbench', agent, { homePath }).areas.find((row) => row.current)!.href, homePath).toBe('/overview');
    }
  });

  it('sends a real row to the sibling’s /resume', () => {
    const model = real('portal', everything);
    expect(model.areas.map((row) => [row.id, row.href, row.origin, row.current])).toEqual([
      ['portal', '/', null, true],
      ['workbench', 'https://desk.example.com/resume', 'https://desk.example.com', false],
      ['admin', 'https://admin.example.com/resume', 'https://admin.example.com', false],
    ]);
    for (const row of model.areas) expect(row.persona, row.id).toBeUndefined();
    expect(model.areas[1]).toMatchObject({ name: 'Service Desk', description: 'Work tickets, queues and SLAs', icon: 'inbox' });
  });

  it('normalises an origin that arrives with a path or a trailing slash', () => {
    const model = real('portal', everything, { origins: { workbench: 'https://desk.example.com/', admin: ' https://admin.example.com/x?y ' } });
    expect(model.areas.map((row) => row.href)).toEqual(['/', 'https://desk.example.com/resume', 'https://admin.example.com/resume']);
  });

  it('leaves out a sibling whose origin is unknown, never linking to nowhere', () => {
    expect(ids(real('portal', everything, { origins: { admin: ORIGINS.admin } }))).toEqual(['portal', 'admin']);
    expect(ids(real('portal', everything, { origins: { workbench: 'not a url', admin: 'javascript:alert(1)' } }))).toEqual(['portal']);
    expect(real('portal', everything, { origins: {} }).visible).toBe(false);
    // The current area needs no origin: its row is a same-origin path.
    expect(ids(real('admin', everything, { origins: { portal: ORIGINS.portal } }))).toEqual(['portal', 'admin']);
  });

  it('lists all three in a demo, whatever the persona holds (D7, D11)', () => {
    for (const app of AREA_ORDER) {
      const model = demo(app);
      expect(ids(model), app).toEqual(['portal', 'workbench', 'admin']);
      expect(model.demo).toBe(true);
      expect(model.visible).toBe(true);
    }
  });

  it('sends a demo row through the sibling’s /demo page, as that area’s persona, resuming', () => {
    const model = demo('workbench');
    expect(model.areas.map((row) => row.href)).toEqual([
      'https://help.example.com/demo?persona=employee&demo=1&redirectTo=%2Fresume',
      '/overview',
      'https://admin.example.com/demo?persona=admin&demo=1&redirectTo=%2Fresume',
    ]);
  });

  it('says who you are here and who you will be there', () => {
    const model = demo('workbench');
    expect(model.areas.map((row) => row.persona)).toEqual([
      { key: 'employee', name: persona('employee').name, title: persona('employee').title },
      { key: 'agent', name: persona('agent').name, title: persona('agent').title },
      { key: 'admin', name: persona('admin').name, title: persona('admin').title },
    ]);
    expect(model.areas[1]!.persona).toEqual({ key: 'agent', name: 'Alex Morgan', title: 'Service Desk team lead' });
  });

  it('takes the current row’s persona from the session, and the area’s own when the session names none', () => {
    const named = buildAreaModel({ app: 'portal', held: [], session: { kind: 'demo', persona: 'employee' }, origins: ORIGINS });
    expect(named.areas[0]!.persona?.key).toBe('employee');
    const unnamed = buildAreaModel({ app: 'admin', held: [], session: { kind: 'demo' }, origins: ORIGINS });
    expect(unnamed.areas[2]!.persona?.key).toBe('admin');
  });

  it('keeps a demo switcher interactive even when only one row can be drawn', () => {
    const model = demo('portal', { origins: {} });
    expect(ids(model)).toEqual(['portal']);
    expect(model.visible).toBe(true);
  });

  it('links home to the site only in a demo, and only when the site is known (D18)', () => {
    expect(demo('portal').home).toEqual({ href: 'https://www.example.com/', label: 'IT Service Management home' });
    expect(demo('portal', { origins: { ...ORIGINS, site: undefined } }).home).toBeUndefined();
    expect(real('portal', everything).home).toBeUndefined();
    expect('home' in real('portal', everything)).toBe(false);
  });

  it('carries the workspace, and the agent’s teams only in a demo', () => {
    expect(real('portal', [], { workspace: 'Northwind Traders (UK)' }).workspace).toBe('Northwind Traders (UK)');
    expect(real('portal', [], { agentTeamIds: ['t1'] }).agentTeamIds).toBeUndefined();
    expect(demo('portal', { agentTeamIds: ['t1', 't2'] }).agentTeamIds).toEqual(['t1', 't2']);
  });

  it('builds a frozen, serialisable model a server page can hand to a client component', () => {
    const model = demo('workbench', { workspace: 'Northwind Traders (UK)', agentTeamIds: ['t1'] });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.areas)).toBe(true);
    expect(Object.isFrozen(model.areas[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it('reads the held keys once, from any iterable', () => {
    function* held() {
      yield 'ticket.update';
    }
    expect(ids(real('portal', held()))).toEqual(['portal', 'workbench']);
  });
});

describe('crossAreaHref (§3.3)', () => {
  const staff = real('admin', [...SERVICE_DESK_GATE, ...ADMINISTRATION_GATE]);

  it('returns the path itself in the current area', () => {
    expect(crossAreaHref(staff, 'admin', '/rules')).toBe('/rules');
  });

  it('deep-links a real sibling, which keeps the path through a sign-in', () => {
    expect(crossAreaHref(staff, 'workbench', '/tickets/INC-000004')).toBe('https://desk.example.com/tickets/INC-000004');
    expect(crossAreaHref(staff, 'portal', '/catalogue/laptop?from=admin')).toBe('https://help.example.com/catalogue/laptop?from=admin');
  });

  it('goes through the sibling’s /demo page in a demo, with the path as where to land', () => {
    expect(crossAreaHref(demo('admin'), 'workbench', '/tickets/INC-000004')).toBe(
      'https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004',
    );
    expect(crossAreaHref(demo('workbench'), 'portal', '/knowledge?q=vpn&page=2')).toBe(
      'https://help.example.com/demo?persona=employee&demo=1&redirectTo=%2Fknowledge%3Fq%3Dvpn%26page%3D2',
    );
  });

  it('is null for an area the person is not offered', () => {
    const requester = real('portal', ['ticket.create']);
    expect(crossAreaHref(requester, 'workbench', '/tickets/INC-000004')).toBeNull();
    expect(crossAreaHref(real('portal', ['ticket.update'], { origins: {} }), 'workbench', '/inbox')).toBeNull();
  });

  it('refuses anything that is not a path on the target’s own origin', () => {
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'tickets', '', '/a\nb', '/a\u0000b', '/a\u007fb', '/a\u0085b', '/a\tb']) {
      expect(crossAreaHref(staff, 'workbench', path), JSON.stringify(path)).toBeNull();
      expect(crossAreaHref(staff, 'admin', path), JSON.stringify(path)).toBeNull();
      expect(crossAreaHref(demo('admin'), 'workbench', path), JSON.stringify(path)).toBeNull();
    }
    expect(crossAreaHref(staff, 'workbench', undefined as unknown as string)).toBeNull();
  });
});

describe('crossAreaTicketHref (X-B2)', () => {
  const ticket = { number: 'INC-000004', groupId: 'team-service-desk' };

  it('links a real session to the ticket whenever the Service Desk is listed', () => {
    expect(crossAreaTicketHref(real('portal', ['ticket.update']), ticket)).toBe('https://desk.example.com/tickets/INC-000004');
    expect(crossAreaTicketHref(real('portal', ['ticket.update']), { ...ticket, groupId: null })).toBe('https://desk.example.com/tickets/INC-000004');
    expect(crossAreaTicketHref(real('portal', ['ticket.create']), ticket)).toBeNull();
  });

  it('links a demo session only to a ticket in the agent persona’s teams', () => {
    const model = demo('portal', { agentTeamIds: ['team-service-desk'] });
    expect(crossAreaTicketHref(model, ticket)).toBe(
      'https://desk.example.com/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004',
    );
    expect(crossAreaTicketHref(model, { ...ticket, groupId: 'team-networks' })).toBeNull();
    expect(crossAreaTicketHref(model, { ...ticket, groupId: null })).toBeNull();
    expect(crossAreaTicketHref(demo('portal'), ticket)).toBeNull();
  });

  it('keeps an odd ticket number inside one path segment, and refuses an empty one', () => {
    expect(crossAreaTicketHref(real('portal', ['ticket.update']), { number: 'A/B?c', groupId: null })).toBe(
      'https://desk.example.com/tickets/A%2FB%3Fc',
    );
    expect(crossAreaTicketHref(real('portal', ['ticket.update']), { number: '', groupId: null })).toBeNull();
  });

  it('explains a disabled control with the agent persona’s name', () => {
    expect(CROSS_AREA_DEMO_TEAM_NOTE).toBe('In the demo the Service Desk opens as Alex Morgan, who works the Service Desk queue.');
    expect(CROSS_AREA_DEMO_TEAM_NOTE).toContain(persona('agent').name);
    expect(CROSS_AREA_DEMO_TEAM_NOTE).toContain(AREAS.workbench.name);
  });
});

describe('appOrigins (§3.3)', () => {
  it('trims and normalises each origin', () => {
    expect(
      appOrigins({
        NODE_ENV: 'production',
        PORTAL_ORIGIN: '  https://help.example.com/  ',
        WORKBENCH_ORIGIN: 'https://desk.example.com/inbox?x=1',
        ADMIN_ORIGIN: 'http://admin.internal:8080',
        SITE_ORIGIN: 'https://www.example.com',
      }),
    ).toEqual({
      portal: 'https://help.example.com',
      workbench: 'https://desk.example.com',
      admin: 'http://admin.internal:8080',
      site: 'https://www.example.com',
    });
  });

  it('uses the dev servers outside production when a variable is unset or blank', () => {
    expect(appOrigins({})).toEqual({
      portal: 'http://localhost:3200',
      workbench: 'http://localhost:3100',
      admin: 'http://localhost:3300',
      site: 'http://localhost:3400',
    });
    expect(appOrigins({ NODE_ENV: 'test', ADMIN_ORIGIN: '   ' }).admin).toBe('http://localhost:3300');
  });

  it('leaves an unset origin unset in production, rather than linking to localhost', () => {
    expect(appOrigins({ NODE_ENV: 'production', PORTAL_ORIGIN: 'https://help.example.com' })).toEqual({ portal: 'https://help.example.com' });
  });

  it('drops a value that is not an http(s) URL, even in development', () => {
    const origins = appOrigins({ WORKBENCH_ORIGIN: 'desk.example.com', ADMIN_ORIGIN: 'javascript:alert(1)', SITE_ORIGIN: 'ftp://www.example.com' });
    expect(origins.workbench).toBeUndefined();
    expect(origins.admin).toBeUndefined();
    expect(origins.site).toBeUndefined();
    expect(origins.portal).toBe('http://localhost:3200');
    expect(Object.isFrozen(origins)).toBe(true);
  });

  it('normalises one value by the same rule', () => {
    expect(normaliseOrigin('https://a.example.com/b')).toBe('https://a.example.com');
    for (const value of [undefined, null, '', ' ', 'a.example.com', 'mailto:x@example.com', 'data:,x']) {
      expect(normaliseOrigin(value), String(value)).toBeUndefined();
    }
  });
});

describe('the Service Desk as data', () => {
  it('states the Overview’s purpose once, as a purpose line', () => {
    expect(SERVICE_DESK_OVERVIEW_PURPOSE).toBe("Your queue at a glance — what's due, what's waiting and how the team is doing");
    expect(SERVICE_DESK_OVERVIEW_PURPOSE.endsWith('.')).toBe(false);
  });

  it('previews the shipped nav: Overview, then the Tickets views', () => {
    expect(SERVICE_DESK_NAV_PREVIEW.map((item) => [item.label, item.icon, item.section ?? null])).toEqual([
      ['Overview', 'home', null],
      ['My work', 'user', 'Tickets'],
      ['Unassigned', 'user-plus', 'Tickets'],
      ['Due soon', 'clock', 'Tickets'],
      ['Waiting on others', 'hourglass', 'Tickets'],
      ['All open', 'inbox', 'Tickets'],
      ['Recently resolved', 'circle-check', 'Tickets'],
    ]);
    expect(new Set(SERVICE_DESK_NAV_PREVIEW.map((item) => item.id)).size).toBe(SERVICE_DESK_NAV_PREVIEW.length);
    expect(Object.isFrozen(SERVICE_DESK_NAV_PREVIEW)).toBe(true);
    expect(Object.isFrozen(SERVICE_DESK_NAV_PREVIEW[0])).toBe(true);
  });

  it('never previews an item the product does not have yet', () => {
    const labels = SERVICE_DESK_NAV_PREVIEW.map((item) => item.label);
    for (const missing of ['Inbox', 'Board', 'SLA', 'Insights', 'Major incidents', 'Changes', 'Problems', 'Knowledge']) {
      expect(labels, missing).not.toContain(missing);
    }
  });
});

describe('the pending Service Desk routes (RV6)', () => {
  it('holds the board and every Phase 2 and 3 route until its page lands', () => {
    expect([...SERVICE_DESK_PENDING].sort()).toEqual(['/board', '/changes', '/knowledge', '/major-incidents', '/problems', '/team']);
  });

  it('matches a pending route and anything under it', () => {
    expect(isServiceDeskRoutePending('/board')).toBe(true);
    expect(isServiceDeskRoutePending('/board/')).toBe(true);
    expect(isServiceDeskRoutePending('/major-incidents')).toBe(true);
    expect(isServiceDeskRoutePending('/major-incidents/MI-0004')).toBe(true);
    expect(isServiceDeskRoutePending('/major-incidents/MI-0004?tab=updates')).toBe(true);
    expect(isServiceDeskRoutePending('/problems/PRB-0001#notes')).toBe(true);
  });

  it('matches whole segments only', () => {
    expect(isServiceDeskRoutePending('/team')).toBe(true);
    expect(isServiceDeskRoutePending('/teams')).toBe(false);
    expect(isServiceDeskRoutePending('/boards')).toBe(false);
    expect(isServiceDeskRoutePending('/major-incidents-archive')).toBe(false);
  });

  it('never holds back a shipped route', () => {
    for (const route of ['/', '/overview', '/inbox', '/inbox/mine', '/inbox/team/abc', '/tickets/INC-000004', '/queue', '']) {
      expect(isServiceDeskRoutePending(route), route).toBe(false);
    }
    expect(isServiceDeskRoutePending(undefined as unknown as string)).toBe(false);
  });
});
