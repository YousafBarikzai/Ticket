import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { MajorIncidentRow, Me } from '@itsm/sdk';

/*
 * The deployment this file runs in: the four public origins. `@itsm/bff/areas`
 * reads them once per process, so they are set before anything imports it.
 */
process.env.PORTAL_ORIGIN = 'https://help.acme.test';
process.env.WORKBENCH_ORIGIN = 'https://desk.acme.test';
process.env.ADMIN_ORIGIN = 'https://admin.acme.test';
process.env.SITE_ORIGIN = 'https://itsm.example';

vi.mock('server-only', () => ({}));

/** The browser's session, and what `/me` answers for it. */
let session: { kind: 'oidc' | 'dev' | 'demo'; persona?: 'admin'; demoGeneration?: number; createdAt: number } | null = null;
let me: Me | null = null;
vi.mock('../bff.js', () => ({
  bff: {
    config: { defaultLanding: '/', appOrigin: 'https://admin.acme.test', demo: null },
    sessionFor: async () => session,
    latestSession: (value: unknown) => value,
    clientFor: () => ({}),
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'session-1' }) }),
  headers: async () => new Headers({ 'x-itsm-path': '/rules' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('@itsm/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@itsm/sdk')>();
  return { ...real, admin: () => ({ me: async () => me }) };
});

const { ADMINISTRATION_GATE, AREAS, buildAreaModel } = await import('@itsm/contracts/areas');
const { EXCLUDED, NAV } = await import('../navigation.js');
const { areaKeywords, currentAreas, majorIncidentChip, severityLabel } = await import('../server/session.js');

/**
 * Who is offered Administration, and what the area model gives its pages
 * (SPEC v3 §3.1, §3.2, §3.4, RV6, X-B2).
 *
 * The gate is defined once, in `@itsm/contracts/areas`; every key of it must
 * open at least one Administration page, so a person the switcher sends here
 * always finds something. The console keeps no copy of its own — v2's
 * `ADMIN_PERMISSIONS` lists and `switcherFor` are gone — and reads no origin.
 */

function person(keys: readonly string[], demo?: Me['demo']): Me {
  return {
    actor: { type: 'user', id: 'u-1', displayName: 'Ada Admin' },
    tenant: { id: 't-1', name: demo ? 'Northwind Traders (UK)' : 'Acme', slug: 'acme', region: 'eu-west' },
    permissions: keys.map((key) => ({ key, scope: 'any' })),
    organisations: [],
    teamIds: [],
    locale: 'en-GB',
    timeZone: 'Europe/London',
    ...(demo ? { demo } : {}),
  };
}

const DEMO_ME: Me['demo'] = {
  persona: 'admin',
  area: 'admin',
  generation: 3,
  company: 'Northwind Traders (UK)',
  disabledFeatures: [],
  personaUserIds: { employee: 'u-e', agent: 'u-a', admin: 'u-j' },
  agentTeamIds: ['team-sd'],
};

describe('the Administration gate', () => {
  const readGates = [...NAV.flatMap((item) => [...item.read, ...(item.tabs ?? []).flatMap((tab) => tab.read)]), ...EXCLUDED.flatMap((entry) => entry.read)];

  it('opens at least one Administration page for every key that lists the area', () => {
    const opensNothing = ADMINISTRATION_GATE.filter((key) => !readGates.includes(key));
    expect(opensNothing).toEqual([]);
  });

  it('is the one copy: the console defines no gate list, switcher or origin reader of its own', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') return [];
        if (statSync(path).isDirectory()) return walk(path);
        return /\.tsx?$/.test(name) ? [path] : [];
      });
    })(root);
    const offenders = files.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return ['ADMIN_PERMISSIONS', 'switcherFor', 'AppSwitcherItem'].filter((name) => source.includes(name)).map((name) => `${relative(root, path)}: ${name}`);
    });
    expect(offenders).toEqual([]);
    const layout = readFileSync(join(root, 'app/(console)/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/process\.env|originOf/);
    expect(layout).toContain('currentAreas()');
  });

  it('gives the palette each area’s words from the one table', () => {
    expect(areaKeywords()).toEqual({ portal: AREAS.portal.keywords, workbench: AREAS.workbench.keywords, admin: AREAS.admin.keywords });
    expect(areaKeywords().workbench).toContain('ticketing');
  });
});

describe('currentAreas()', () => {
  it('lists what a real person holds, each sibling through its /resume', async () => {
    session = { kind: 'oidc', createdAt: 0 };
    me = person(['admin.setting.read', 'ticket.update']);
    const areas = await currentAreas();
    expect(areas.current).toBe('admin');
    expect(areas.demo).toBe(false);
    expect(areas.workspace).toBe('Acme');
    expect(areas.areas.map((area) => [area.id, area.href])).toEqual([
      ['portal', 'https://help.acme.test/resume'],
      ['workbench', 'https://desk.acme.test/resume'],
      ['admin', '/'],
    ]);
    expect(areas.home).toBeUndefined();
  });

  it('leaves out the Service Desk for someone who does not work tickets', async () => {
    session = { kind: 'oidc', createdAt: 0 };
    me = person(['admin.setting.read']);
    expect((await currentAreas()).areas.map((area) => area.id)).toEqual(['portal', 'admin']);
  });

  it('lists all three areas in the demo, with each persona, Alex’s teams and the site', async () => {
    session = { kind: 'demo', persona: 'admin', demoGeneration: 3, createdAt: 0 };
    me = person(['admin.setting.read'], DEMO_ME);
    const areas = await currentAreas();
    expect(areas.demo).toBe(true);
    expect(areas.agentTeamIds).toEqual(['team-sd']);
    expect(areas.home).toEqual({ href: 'https://itsm.example/', label: 'IT Service Management home' });
    expect(areas.areas.map((area) => [area.id, area.persona?.name])).toEqual([
      ['portal', 'Emma Clarke'],
      ['workbench', 'Alex Morgan'],
      ['admin', 'Jordan Lee'],
    ]);
    expect(areas.areas[1]!.href).toBe('https://desk.acme.test/demo?persona=agent&demo=1&redirectTo=%2Fresume');
  });
});

describe('the frame’s major incident chip (SPEC v3 §3.4, RV6)', () => {
  const origins = { portal: 'https://help.acme.test', workbench: 'https://desk.acme.test', admin: 'https://admin.acme.test', site: 'https://itsm.example' };
  const real = buildAreaModel({ app: 'admin', held: ['ticket.update', 'admin.setting.read'], session: { kind: 'oidc' }, origins });
  const demo = buildAreaModel({ app: 'admin', held: [], session: { kind: 'demo', persona: 'admin' }, origins, agentTeamIds: ['team-sd'] });
  const noDesk = buildAreaModel({ app: 'admin', held: ['admin.setting.read'], session: { kind: 'oidc' }, origins });
  const row = (number: string, title = 'VPN sign-in failures', severity = 'SEV2'): MajorIncidentRow => ({
    number,
    title,
    severity,
    status: 'investigating',
    commanderId: null,
    customerFacing: true,
    declaredAt: '2026-10-02T08:00:00Z',
    resolvedAt: null,
    nextUpdateDueAt: null,
  });
  function reads(open: MajorIncidentRow[] | Error, ticket: { number: string; groupId: string | null } = { number: 'INC-000004', groupId: 'team-sd' }) {
    return {
      majorIncidents: vi.fn(async () => {
        if (open instanceof Error) throw open;
        return open;
      }),
      majorIncident: vi.fn(async () => ({ ticketId: 't-4' })),
      ticket: vi.fn(async () => ticket),
    };
  }
  const pending = (): boolean => true;
  const shipped = (): boolean => false;

  it('says nothing when no major incident is open, or when the read fails', async () => {
    expect(await majorIncidentChip(reads([]), real, pending)).toBeNull();
    expect(await majorIncidentChip(reads(new Error('down')), real, pending)).toBeNull();
  });

  it('names the incident in full and in short', async () => {
    const chip = await majorIncidentChip(reads([row('MI-0004')]), real, shipped);
    expect(chip).toMatchObject({ label: 'MI-0004 · VPN sign-in failures · Sev 2', compactLabel: 'MI-0004 · Sev 2' });
    expect(severityLabel('SEV1')).toBe('Sev 1');
    expect(severityLabel('critical')).toBe('critical');
  });

  it('links the major incident in the Service Desk once that route has shipped', async () => {
    expect((await majorIncidentChip(reads([row('MI-0004')]), real, shipped))?.href).toBe('https://desk.acme.test/major-incidents/MI-0004');
    expect((await majorIncidentChip(reads([row('MI-0004')]), demo, shipped))?.href).toBe(
      'https://desk.acme.test/demo?persona=agent&demo=1&redirectTo=%2Fmajor-incidents%2FMI-0004',
    );
  });

  it('links the major incident’s ticket while the route is pending — the rule as the build has it today', async () => {
    const source = reads([row('MI-0004')]);
    const chip = await majorIncidentChip(source, real);
    expect(chip?.href).toBe('https://desk.acme.test/tickets/INC-000004');
    expect(source.majorIncident).toHaveBeenCalledWith('MI-0004');
    expect(source.ticket).toHaveBeenCalledWith('t-4');
  });

  it('in the demo, links the ticket only when Alex Morgan’s teams can open it (X-B2)', async () => {
    expect((await majorIncidentChip(reads([row('MI-0004')]), demo, pending))?.href).toBe(
      'https://desk.acme.test/demo?persona=agent&demo=1&redirectTo=%2Ftickets%2FINC-000004',
    );
    const outside = await majorIncidentChip(reads([row('MI-0004')], { number: 'INC-000009', groupId: 'team-network' }), demo, pending);
    expect(outside).toMatchObject({ label: 'MI-0004 · VPN sign-in failures · Sev 2' });
    expect(outside).not.toHaveProperty('href');
  });

  it('draws the chip without a link for someone the Service Desk is not listed for', async () => {
    const chip = await majorIncidentChip(reads([row('MI-0004')]), noDesk, shipped);
    expect(chip).not.toHaveProperty('href');
  });

  it('counts two or more, to the register once it exists', async () => {
    const two = [row('MI-0004'), row('MI-0005', 'Payroll export failing', 'SEV1')];
    expect(await majorIncidentChip(reads(two), real, pending)).toEqual({ label: '2 major incidents', compactLabel: '2 major incidents' });
    expect((await majorIncidentChip(reads(two), real, shipped))?.href).toBe('https://desk.acme.test/major-incidents');
  });
});
