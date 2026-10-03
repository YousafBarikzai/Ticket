import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AreaModel } from '@itsm/contracts/areas';
import type { Environment } from '../config.js';

/**
 * `areasFor()`, the server wrapper the apps build their area model with
 * (SPEC v3 §3.1; A2 §3.3 and §15.1).
 *
 * The rules of the model are `@itsm/contracts/areas`'s and tested there; what
 * is tested here is the wrapper's own job: reading the origins from the
 * environment, treating anything but a demo session as a real one, and saying
 * once — not once per request — when a deployment left an area out.
 *
 * The module keeps per-process state (the origins it read, the warnings it
 * gave), so each case loads a fresh copy.
 */

async function load() {
  vi.resetModules();
  return import('../areas.js');
}

const ENV: Environment = {
  NODE_ENV: 'production',
  PORTAL_ORIGIN: 'https://help.example.com',
  WORKBENCH_ORIGIN: 'https://desk.example.com/',
  ADMIN_ORIGIN: 'https://admin.example.com',
  SITE_ORIGIN: 'https://www.example.com',
};

const AGENT = ['ticket.read', 'ticket.update'];
const ids = (model: AreaModel) => model.areas.map((row) => row.id);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('areasFor', () => {
  it('builds the model from the environment’s origins', async () => {
    const { areasFor } = await load();
    const model = areasFor({ app: 'portal', held: AGENT, session: { kind: 'oidc' }, env: ENV });
    expect(model.areas.map((row) => row.href)).toEqual(['/', 'https://desk.example.com/resume']);
    expect(model.demo).toBe(false);
    expect(model.home).toBeUndefined();
  });

  it('treats no session, or a session with no kind, as a real one', async () => {
    const { areasFor } = await load();
    for (const session of [null, {}, { kind: 'dev' as const }]) {
      const model = areasFor({ app: 'portal', held: ['ticket.create'], session, env: ENV });
      expect(model.demo, JSON.stringify(session)).toBe(false);
      expect(ids(model)).toEqual(['portal']);
      expect(model.visible).toBe(false);
    }
  });

  it('lists every area for a demo session, as each area’s persona', async () => {
    const { areasFor } = await load();
    const model = areasFor({
      app: 'workbench',
      held: [],
      session: { kind: 'demo', persona: 'agent' },
      workspace: 'Northwind Traders (UK)',
      agentTeamIds: ['team-1'],
      env: ENV,
    });
    expect(ids(model)).toEqual(['portal', 'workbench', 'admin']);
    expect(model.areas.map((row) => row.persona?.key)).toEqual(['employee', 'agent', 'admin']);
    expect(model.areas[0]!.href).toBe('https://help.example.com/demo?persona=employee&demo=1&redirectTo=%2Fresume');
    expect(model.home).toEqual({ href: 'https://www.example.com/', label: 'IT Service Management home' });
    expect(model.workspace).toBe('Northwind Traders (UK)');
    expect(model.agentTeamIds).toEqual(['team-1']);
  });

  it('passes the app’s own home through', async () => {
    const { areasFor } = await load();
    const model = areasFor({ app: 'workbench', held: AGENT, session: null, homePath: '/inbox', env: ENV });
    expect(model.areas.find((row) => row.current)!.href).toBe('/inbox');
  });

  it('accepts held keys that can be walked only once', async () => {
    const { areasFor } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function* held() {
      yield 'ticket.update';
      yield 'audit.read';
    }
    // Both the warning (Administration's origin is missing) and the model
    // (the Service Desk row) need the keys, so they are collected first.
    const model = areasFor({ app: 'portal', held: held(), session: null, env: { ...ENV, ADMIN_ORIGIN: undefined } });
    expect(ids(model)).toEqual(['portal', 'workbench']);
    expect(warn).toHaveBeenCalledWith('[bff] areas: ADMIN_ORIGIN is not set; Administration left out of the switcher');
  });

  it('says once per process that an unset origin left an area out', async () => {
    const { areasFor } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ...ENV, WORKBENCH_ORIGIN: undefined };
    for (let i = 0; i < 3; i += 1) {
      expect(ids(areasFor({ app: 'portal', held: AGENT, session: null, env }))).toEqual(['portal']);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[bff] areas: WORKBENCH_ORIGIN is not set; Service Desk left out of the switcher');
  });

  it('names an origin that is set but unusable differently from one that is missing', async () => {
    const { areasFor } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    areasFor({ app: 'workbench', held: [], session: { kind: 'demo', persona: 'agent' }, env: { ...ENV, ADMIN_ORIGIN: 'admin.example.com' } });
    expect(warn).toHaveBeenCalledWith('[bff] areas: ADMIN_ORIGIN is not an http(s) URL; Administration left out of the switcher');
  });

  it('says nothing about an area the person would not be offered anyway, or about their own', async () => {
    const { areasFor } = await load();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A requester is not offered the Service Desk or Administration; the
    // portal's own origin is never needed for its own row.
    areasFor({ app: 'portal', held: ['ticket.create'], session: null, env: { NODE_ENV: 'production' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads process.env once per process when no environment is passed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORTAL_ORIGIN', 'https://help.example.com');
    vi.stubEnv('WORKBENCH_ORIGIN', 'https://desk.example.com');
    const { areasFor } = await load();
    const first = areasFor({ app: 'portal', held: AGENT, session: null });
    expect(first.areas[1]!.href).toBe('https://desk.example.com/resume');

    vi.stubEnv('WORKBENCH_ORIGIN', 'https://moved.example.com');
    const second = areasFor({ app: 'portal', held: AGENT, session: null });
    expect(second.areas[1]!.href).toBe('https://desk.example.com/resume');
  });

  it('reads an explicit environment on every call', async () => {
    const { areasFor } = await load();
    const read: string[] = [];
    const env = new Proxy(ENV, {
      get(target, name: string) {
        read.push(name);
        return target[name];
      },
    });
    areasFor({ app: 'portal', held: AGENT, session: null, env });
    expect(read.filter((name) => name.endsWith('_ORIGIN')).sort()).toEqual(['ADMIN_ORIGIN', 'PORTAL_ORIGIN', 'SITE_ORIGIN', 'WORKBENCH_ORIGIN']);
    const before = read.length;
    areasFor({ app: 'portal', held: AGENT, session: null, env });
    expect(read.length).toBeGreaterThan(before);
  });
});
