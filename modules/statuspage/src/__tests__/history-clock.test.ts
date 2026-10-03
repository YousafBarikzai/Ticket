import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, buildPermissionSet, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { importIncident, importMaintenance, openIncident, postUpdate, resolveIncident } from '../service/incident-service.js';

/**
 * The status page's history (A4 §1.9.6, §2.3; WP-43b).
 *
 * `resolveIncident` takes the instant it was resolved, as `postUpdate` and
 * `openIncident` already do; omitted, it is now, exactly as before. And two
 * import doors write a past incident with its timeline, and a maintenance
 * window as it was announced, without the subscriber e-mail job or the
 * webhook event the live doors set off — the job a tenant being built refuses
 * (A4 §2.4 Q2), and the event a line from last month is not.
 *
 * The clock is frozen, so "the present" is one known instant. `enqueue` is
 * stood in for, so every job a door asks for is visible.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, jobs: [] as { queue: string; name: string; payload: unknown }[] }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
    enqueue: async (_ctx: unknown, queue: string, name: string, payload: unknown) => {
      platform.jobs.push({ queue, name, payload });
      return 'job';
    },
  };
});

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function satisfies(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return same(value, condition);
  return Object.entries(condition as Row).every(([op, arg]) => {
    if (op === 'in') return (arg as unknown[]).some((each) => same(value, each));
    if (op === 'not') return !same(value, arg);
    throw new Error(`the stand-in does not know the operator ${op}`);
  });
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => satisfies(row[key], condition));
}

/** The calls the status page makes, on arrays, with every write kept as it was asked for. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const writes: { model: string; op: string; data: Row }[] = [];
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      // What the database fills in when the write leaves it out.
      const row = { createdAt: STAMPED, updatedAt: STAMPED, isVisible: true, ...data };
      table(name).push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      for (const each of data) {
        writes.push({ model: name, op: 'create', data: each });
        table(name).push({ ...each });
      }
      return { count: data.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      writes.push({ model: name, op: 'update', data });
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      Object.assign(row, data);
      return { ...row };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  const written = (name: string, op: string) => writes.filter((write) => write.model === name && write.op === op).map((write) => write.data);
  return { tx, table, written };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const OPERATOR = '0190a000-0000-7000-8000-000000000002';
const PAGE = '0190a000-0000-7000-8000-0000000000d1';
const VPN = '0190a000-0000-7000-8000-0000000000d2';
const IDENTITY = '0190a000-0000-7000-8000-0000000000d3';
const MAJOR = '0190a000-0000-7000-8000-0000000000e1';
const CHANGE = '0190a000-0000-7000-8000-0000000000f1';

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
/** What the database stamps on a column the write leaves out: a marker, so nobody mistakes it for a clock. */
const STAMPED = new Date('2000-01-01T00:00:00.000Z');
const OPENED = new Date('2026-09-20T09:10:00.000Z');
const IDENTIFIED = new Date('2026-09-20T09:25:00.000Z');
const RESOLVED = new Date('2026-09-20T10:00:00.000Z');

const ctx: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'user', id: OPERATOR, displayName: 'Jordan Lee' },
  permissions: SYSTEM_PERMISSIONS,
});

let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  platform.jobs = [];
  db.table('statusPage').push({ id: PAGE, tenantId: TENANT, name: 'Northwind status' });
  db.table('tenant').push({ id: TENANT, slug: 'demo' });
  db.table('statusComponent').push(
    { id: VPN, tenantId: TENANT, pageId: PAGE, key: 'network-vpn', name: 'VPN', order: 1, status: 'operational' },
    { id: IDENTITY, tenantId: TENANT, pageId: PAGE, key: 'identity-access', name: 'Identity & access', order: 2, status: 'operational' },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const component = (id: string) => db.table('statusComponent').find((row) => row.id === id)!.status;

describe('resolveIncident takes the instant it was resolved', () => {
  async function opened() {
    return openIncident(ctx, db.tx, { title: 'VPN sign-in failures', impact: 'major', status: 'investigating', componentIds: [VPN], body: 'Investigating.', source: 'manual' }, OPENED);
  }

  it('without one, resolves now, and still tells the subscribers and the webhooks, exactly as before', async () => {
    const incident = await opened();
    await resolveIncident(ctx, db.tx, incident.id, 'Fixed.', 'manual');
    expect(db.written('statusIncident', 'update').at(-1)).toEqual({ status: 'resolved', resolvedAt: NOW });
    expect(db.written('statusUpdate', 'create').at(-1)).toMatchObject({ status: 'resolved', postedAt: NOW });
    expect(platform.jobs.map((job) => job.name)).toEqual(['status.notify', 'status.notify']);
    expect(db.table('outboxEvent').map((row) => row.type)).toEqual(['status.incident.updated', 'status.incident.updated']);
    expect(component(VPN)).toBe('operational');
  });

  it('with one, resolves then', async () => {
    const incident = await opened();
    await resolveIncident(ctx, db.tx, incident.id, 'Fixed.', 'manual', null, RESOLVED);
    expect(db.written('statusIncident', 'update').at(-1)).toEqual({ status: 'resolved', resolvedAt: RESOLVED });
    expect(db.written('statusUpdate', 'create').at(-1)).toMatchObject({ status: 'resolved', postedAt: RESOLVED });
  });

  it('resolves once, whichever door is second', async () => {
    const incident = await opened();
    await resolveIncident(ctx, db.tx, incident.id, 'Fixed.', 'manual', null, RESOLVED);
    expect(await resolveIncident(ctx, db.tx, incident.id, 'Fixed again.', 'major_incident', null, RESOLVED)).toBeNull();
  });
});

describe('importIncident: a past incident, with its timeline, and nobody told', () => {
  const vpn = {
    title: 'VPN sign-in failures for remote staff',
    impact: 'major' as const,
    componentKeys: ['network-vpn'],
    updates: [
      { body: 'We are investigating reports that remote staff cannot connect to the VPN.', at: OPENED },
      { status: 'identified' as const, body: 'An expired intermediate certificate.', at: IDENTIFIED },
      { status: 'resolved' as const, body: 'The certificate has been reissued and everyone can connect.', at: RESOLVED },
    ],
  };

  it('writes the incident and every line, each posted when it was', async () => {
    const { incident, updates } = await importIncident(ctx, vpn, { reason: 'demo.build' });
    expect(incident).toMatchObject({
      title: vpn.title,
      impact: 'major',
      status: 'resolved',
      componentIds: [VPN],
      startedAt: OPENED,
      resolvedAt: RESOLVED,
      createdAt: OPENED,
      updatedAt: RESOLVED,
      createdBy: OPERATOR,
      pageId: PAGE,
    });
    expect(updates.map((line) => [line.status, line.postedAt])).toEqual([
      ['investigating', OPENED],
      ['identified', IDENTIFIED],
      ['resolved', RESOLVED],
    ]);
    expect(db.table('statusUpdate').every((line) => line.incidentId === incident.id && line.source === 'manual' && line.postedBy === OPERATOR)).toBe(true);
  });

  it('sets nothing off: no job, no event; one audit row with the reason', async () => {
    await importIncident(ctx, vpn, { reason: 'demo.build' });
    expect(platform.jobs).toEqual([]);
    expect(db.table('outboxEvent')).toEqual([]);
    const audit = db.table('auditEvent');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'statuspage.incident.imported', reason: 'demo.build' });
    expect(audit[0]!.after).toMatchObject({ status: 'resolved', updates: 3, resolvedAt: RESOLVED.toISOString() });
  });

  it('leaves the components as they are now: red for an open incident, green once it is resolved', async () => {
    await importIncident(ctx, { ...vpn, updates: vpn.updates.slice(0, 2) });
    expect(component(VPN)).toBe('partial_outage');
    expect(component(IDENTITY)).toBe('operational');
    await importIncident(ctx, { ...vpn, title: 'Earlier VPN trouble', updates: vpn.updates.map((line) => ({ ...line, at: new Date(line.at.getTime() - DAY) })) });
    expect(component(VPN)).toBe('partial_outage');
    expect(db.table('statusIncident').map((row) => [row.status, row.resolvedAt ?? null])).toEqual([
      ['identified', null],
      ['resolved', new Date(RESOLVED.getTime() - DAY)],
    ]);
  });

  it('keeps a line with no status in the status before it, and stamps the resolution where it happened', async () => {
    const { incident, updates } = await importIncident(ctx, {
      ...vpn,
      updates: [
        { body: 'Investigating.', at: OPENED },
        { status: 'resolved', body: 'Fixed.', at: IDENTIFIED },
        { body: 'A note after the fix.', at: RESOLVED },
      ],
    });
    expect(updates.map((line) => line.status)).toEqual(['investigating', 'resolved', 'resolved']);
    expect(incident).toMatchObject({ status: 'resolved', resolvedAt: IDENTIFIED, updatedAt: RESOLVED });
  });

  it('links the major incident behind it, once', async () => {
    db.table('majorIncident').push({ id: MAJOR, tenantId: TENANT });
    const { incident } = await importIncident(ctx, { ...vpn, majorIncidentId: MAJOR });
    expect(incident.majorIncidentId).toBe(MAJOR);
    await expect(importIncident(ctx, { ...vpn, majorIncidentId: MAJOR })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a timeline in the future, out of order, on unknown components or behind an unknown major incident', async () => {
    await expect(importIncident(ctx, { ...vpn, updates: [{ body: 'Soon.', at: new Date(NOW.getTime() + MINUTE) }] })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'updates.0.at', code: 'in_future' }],
    });
    await expect(importIncident(ctx, { ...vpn, updates: [vpn.updates[1]!, vpn.updates[0]!] })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'updates.1.at', code: 'out_of_order' }],
    });
    await expect(importIncident(ctx, { ...vpn, componentKeys: ['payroll'] })).rejects.toMatchObject({ status: 422 });
    await expect(importIncident(ctx, { ...vpn, majorIncidentId: MAJOR })).rejects.toMatchObject({ status: 404 });
    expect(db.table('statusIncident')).toEqual([]);
  });

  it('needs statuspage.manage', async () => {
    const reader = createContext({ tenantId: TENANT, actor: { type: 'user', id: OPERATOR }, permissions: buildPermissionSet([{ key: 'statuspage.read', scope: 'any' }]) });
    await expect(importIncident(reader, vpn)).rejects.toMatchObject({ status: 403 });
  });
});

describe('importMaintenance: a window as it was announced, and nobody told', () => {
  const firewall = {
    title: 'Firewall firmware 9.1.4 — Leeds',
    body: 'The Leeds firewall restarts twice.',
    componentKeys: ['network-vpn'],
    startsAt: new Date(NOW.getTime() + 5 * DAY),
    endsAt: new Date(NOW.getTime() + 5 * DAY + 2 * 60 * MINUTE),
    at: new Date(NOW.getTime() - 3 * DAY),
  };

  it('writes the window when it was announced, scheduled because it is still ahead', async () => {
    db.table('change').push({ id: CHANGE, tenantId: TENANT });
    const window = await importMaintenance(ctx, { ...firewall, changeId: CHANGE }, { reason: 'demo.build' });
    expect(window).toMatchObject({ status: 'scheduled', changeId: CHANGE, createdAt: firewall.at, updatedAt: firewall.at, startsAt: firewall.startsAt, componentIds: [VPN] });
    expect(platform.jobs).toEqual([]);
    expect(db.table('outboxEvent')).toEqual([]);
    expect(db.table('auditEvent')[0]).toMatchObject({ action: 'statuspage.maintenance.imported', reason: 'demo.build' });
    expect(component(VPN)).toBe('operational');
  });

  it('reads a past window as completed and a current one as in progress, unless the import says otherwise', async () => {
    const past = await importMaintenance(ctx, { ...firewall, startsAt: new Date(NOW.getTime() - 2 * DAY), endsAt: new Date(NOW.getTime() - DAY) });
    expect(past.status).toBe('completed');
    const now = await importMaintenance(ctx, { ...firewall, startsAt: new Date(NOW.getTime() - MINUTE), endsAt: new Date(NOW.getTime() + MINUTE) });
    expect(now.status).toBe('in_progress');
    expect(component(VPN)).toBe('maintenance');
    const cancelled = await importMaintenance(ctx, { ...firewall, status: 'cancelled' });
    expect(cancelled.status).toBe('cancelled');
  });

  it('refuses a window that ends before it starts, an announcement in the future, an unknown change, and a change that already has one', async () => {
    await expect(importMaintenance(ctx, { ...firewall, endsAt: firewall.startsAt })).rejects.toMatchObject({ status: 422 });
    await expect(importMaintenance(ctx, { ...firewall, at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    await expect(importMaintenance(ctx, { ...firewall, changeId: CHANGE })).rejects.toMatchObject({ status: 404 });
    db.table('change').push({ id: CHANGE, tenantId: TENANT });
    await importMaintenance(ctx, { ...firewall, changeId: CHANGE });
    await expect(importMaintenance(ctx, { ...firewall, changeId: CHANGE })).rejects.toMatchObject({ status: 409 });
    expect(db.table('maintenanceWindow')).toHaveLength(1);
  });
});

describe('the live doors are unchanged', () => {
  it('openIncident and postUpdate still announce each line and queue the subscribers’ e-mail', async () => {
    const incident = await openIncident(ctx, db.tx, { title: 'VPN', impact: 'minor', status: 'investigating', componentIds: [VPN], body: 'Looking.', source: 'manual' });
    await postUpdate(ctx, db.tx, incident.id, { status: 'identified', body: 'Found it.', source: 'manual' });
    expect(db.written('statusIncident', 'create')[0]).toMatchObject({ startedAt: NOW });
    expect(db.written('statusIncident', 'create')[0]).not.toHaveProperty('createdAt');
    expect(db.table('statusUpdate').map((line) => line.postedAt)).toEqual([NOW, NOW]);
    expect(platform.jobs).toHaveLength(2);
    expect(db.table('outboxEvent')).toHaveLength(2);
    expect(component(VPN)).toBe('degraded');
  });
});
