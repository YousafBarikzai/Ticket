import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, buildPermissionSet, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { IMPORT_ENTRIES_MAX, importEntries, logEntry } from '../service/entry-service.js';

/**
 * `importEntries` (A4 §1.8, §2.3; WP-43b): the time people logged on tickets
 * resolved before the platform knew about them. Each entry is priced and
 * counted against the budgets as a live one is, but names its own person and
 * instant and announces nothing — no `time.entry.logged`, no job — so the
 * shared demo's build can write four months of it into a quiet tenant.
 *
 * The clock is frozen, so "the present" is one known instant. The last block
 * pins that `logEntry`, the live door, is unchanged.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
  };
});

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((each) => matches(row, each));
    // A compound unique key, e.g. `budgetId_periodStart`, names the fields it is made of.
    if (key.includes('_') && condition && typeof condition === 'object' && !(condition instanceof Date)) return matches(row, condition as Row);
    return same(row[key], condition);
  });
}

/** The calls the time module makes, on arrays, with every write kept. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      const row = { ...data };
      table(name).push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      Object.assign(row, data);
      return { ...row };
    },
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      const row = table(name).find((each) => matches(each, where));
      if (row) return { ...row };
      table(name).push({ warnedAt: null, reachedAt: null, ...create });
      return { warnedAt: null, reachedAt: null, ...create };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  return { tx, table };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const GRACE = '0190a000-0000-7000-8000-000000000002';
const PRIYA = '0190a000-0000-7000-8000-000000000003';
const SERVICE_DESK = '0190a000-0000-7000-8000-0000000000b1';
const TICKET = '0190a000-0000-7000-8000-0000000000a1';
const OTHER = '0190a000-0000-7000-8000-0000000000a2';
const TASK = '0190a000-0000-7000-8000-0000000000c1';
const INVESTIGATION = '0190a000-0000-7000-8000-0000000000e1';
const ELAPSED = '0190a000-0000-7000-8000-0000000000e2';
const BUDGET = '0190a000-0000-7000-8000-0000000000f1';

const MINUTE = 60_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
const RAISED = new Date('2026-09-14T08:40:00.000Z');
const LOGGED = new Date('2026-09-14T10:05:00.000Z');
const LATER = new Date('2026-09-15T16:20:00.000Z');

const importer: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'system', id: null, displayName: 'demo-build' },
  permissions: SYSTEM_PERMISSIONS,
});

let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  db.table('ticket').push(
    { id: TICKET, tenantId: TENANT, number: 'INC-004501', groupId: SERVICE_DESK, serviceId: null, orgId: null, requesterId: PRIYA, assigneeId: GRACE, createdAt: RAISED, deletedAt: null },
    { id: OTHER, tenantId: TENANT, number: 'REQ-003201', groupId: null, serviceId: null, orgId: null, requesterId: PRIYA, assigneeId: null, createdAt: RAISED, deletedAt: null },
  );
  db.table('user').push({ id: GRACE, tenantId: TENANT }, { id: PRIYA, tenantId: TENANT });
  db.table('ticketTask').push({ id: TASK, tenantId: TENANT, ticketId: TICKET });
  db.table('activityType').push(
    { id: INVESTIGATION, tenantId: TENANT, key: 'investigation', billable: false, ratePerHour: 40, currency: 'GBP', isSystem: false, isActive: true },
    { id: ELAPSED, tenantId: TENANT, key: 'elapsed', billable: false, ratePerHour: 0, currency: 'GBP', isSystem: true, isActive: true },
  );
  // The Service Desk's own rate, which wins over the activity's default.
  db.table('costRate').push({ id: 'rate', tenantId: TENANT, activityTypeId: INVESTIGATION, teamId: SERVICE_DESK, ratePerHour: 32, currency: 'GBP' });
});

afterEach(() => {
  vi.useRealTimers();
});

const entry = { ticketId: TICKET, userId: GRACE, activityKey: 'investigation', minutes: 15, loggedAt: LOGGED };

describe('importing time as it was logged', () => {
  it('writes each entry with its person and instant, priced at the team’s rate, in the order given', async () => {
    const rows = await importEntries(importer, [entry, { ...entry, ticketId: OTHER, userId: PRIYA, minutes: 90, loggedAt: LATER, note: 'Set up the new starter' }]);
    expect(rows.map((row) => [row.ticketId, row.userId, row.minutes, row.loggedAt, Number(row.ratePerHour), Number(row.cost)])).toEqual([
      [TICKET, GRACE, 15, LOGGED, 32, 8],
      [OTHER, PRIYA, 90, LATER, 40, 60],
    ]);
    expect(rows[0]).toMatchObject({ kind: 'manual', startedAt: null, endedAt: null, billable: false, createdBy: null, taskId: null });
    expect(rows[1]).toMatchObject({ note: 'Set up the new starter' });
  });

  it('keeps a timer’s run, and the task the time was spent on', async () => {
    const started = new Date(LOGGED.getTime() - 25 * MINUTE);
    const [row] = await importEntries(importer, [{ ...entry, kind: 'timer', minutes: 25, startedAt: started, endedAt: LOGGED, taskId: TASK }]);
    expect(row).toMatchObject({ kind: 'timer', startedAt: started, endedAt: LOGGED, taskId: TASK });
  });

  it('announces nothing: no event, so no webhook and no projector is told now about last month', async () => {
    await importEntries(importer, [entry, entry]);
    expect(db.table('outboxEvent')).toEqual([]);
  });

  it('audits row by row by default, and as one batch row naming every ticket when asked', async () => {
    await importEntries(importer, [entry], { reason: 'demo.build' });
    expect(db.table('auditEvent')).toEqual([
      expect.objectContaining({ action: 'time.entry.imported', targetType: 'time_entry', reason: 'demo.build' }),
    ]);
    expect(db.table('auditEvent')[0]!.after).toMatchObject({ ticket: 'INC-004501', userId: GRACE, minutes: 15, loggedAt: LOGGED.toISOString() });

    db.table('auditEvent').length = 0;
    await importEntries(importer, [entry, { ...entry, ticketId: OTHER, minutes: 30 }], { audit: 'batch', label: 'demo g42 time 0001-0002', reason: 'demo.build' });
    const [batch] = db.table('auditEvent');
    expect(db.table('auditEvent')).toHaveLength(1);
    expect(batch).toMatchObject({ action: 'time.entries.imported.batch', targetType: 'import_batch', reason: 'demo.build' });
    expect(batch!.after).toEqual({ label: 'demo g42 time 0001-0002', count: 2, minutes: 45, first: 'INC-004501', last: 'REQ-003201', tickets: ['INC-004501', 'REQ-003201'] });
  });

  it('counts the spend against the budgets, and stamps a line it crosses when the entry was logged', async () => {
    db.table('budget').push({ id: BUDGET, tenantId: TENANT, key: 'it-support', name: 'IT support', scopeType: 'tenant', scopeId: null, periodKind: 'year', amount: 100, currency: 'GBP', warnAt: 80, ownerId: null, isActive: true });
    await importEntries(importer, [{ ...entry, minutes: 165 }]);
    const [period] = db.table('budgetPeriod');
    expect(Number(period!.spent)).toBe(88);
    expect(period!.warnedAt).toEqual(LOGGED);
    expect(period!.reachedAt).toBeNull();
  });

  it('writes nothing for an empty list', async () => {
    expect(await importEntries(importer, [])).toEqual([]);
    expect(db.table('timeEntry')).toEqual([]);
  });
});

describe('what an import refuses, before anything is written', () => {
  const refused = async (input: Parameters<typeof importEntries>[1], expected: object) => {
    await expect(importEntries(importer, input)).rejects.toMatchObject(expected);
    expect(db.table('timeEntry')).toEqual([]);
  };

  it('an instant in the future, or before the ticket was raised', async () => {
    await refused([entry, { ...entry, loggedAt: new Date(NOW.getTime() + 1) }], { status: 422, fieldErrors: [{ field: '1.loggedAt', code: 'in_future' }] });
    await refused([{ ...entry, loggedAt: new Date(RAISED.getTime() - 1) }], { status: 422, fieldErrors: [{ field: '0.loggedAt', code: 'before_ticket' }] });
    await refused([{ ...entry, kind: 'timer', startedAt: new Date(RAISED.getTime() - MINUTE), endedAt: LOGGED }], { fieldErrors: [{ field: '0.startedAt', code: 'before_ticket' }] });
  });

  it('a manual entry that claims a timer’s run, and a timer without one or with one that runs backwards or past its logging', async () => {
    await refused([{ ...entry, startedAt: RAISED }], { fieldErrors: [{ field: '0.startedAt', code: 'not_allowed' }] });
    await refused([{ ...entry, kind: 'timer', startedAt: RAISED }], { fieldErrors: [{ field: '0.endedAt', code: 'required' }] });
    await refused([{ ...entry, kind: 'timer', startedAt: LOGGED, endedAt: LOGGED }], { fieldErrors: [{ field: '0.endedAt', code: 'before_started' }] });
    await refused([{ ...entry, kind: 'timer', startedAt: RAISED, endedAt: LATER }], { fieldErrors: [{ field: '0.endedAt', code: 'after_logged' }] });
  });

  it('elapsed time, which the platform measures', async () => {
    await refused([{ ...entry, kind: 'automatic' as never }], { name: 'ZodError' });
    await refused([{ ...entry, activityKey: 'elapsed' }], { status: 422 });
  });

  it('a ticket, person, activity or task this tenant does not have', async () => {
    await refused([{ ...entry, ticketId: '0190a000-0000-7000-8000-0000000000ff' }], { status: 404 });
    await refused([{ ...entry, userId: '0190a000-0000-7000-8000-0000000000ff' }], { status: 422, fieldErrors: [{ field: '0.userId', code: 'not_found' }] });
    await refused([{ ...entry, activityKey: 'travel' }], { status: 404 });
    await refused([{ ...entry, ticketId: OTHER, taskId: TASK }], { status: 404 });
  });

  it('more than one batch row can name', async () => {
    await refused(Array.from({ length: IMPORT_ENTRIES_MAX + 1 }, () => entry), { name: 'ZodError' });
  });

  it('an importer without tenant-wide time.log', async () => {
    const lead = createContext({ tenantId: TENANT, actor: { type: 'user', id: GRACE }, permissions: buildPermissionSet([{ key: 'time.log', scope: 'team' }]) });
    await expect(importEntries(lead, [entry])).rejects.toMatchObject({ status: 403 });
  });
});

describe('the live door is unchanged', () => {
  it('logEntry still logs now, announces the entry and audits it as logged', async () => {
    const agent = createContext({ tenantId: TENANT, actor: { type: 'user', id: GRACE }, permissions: SYSTEM_PERMISSIONS });
    const row = await logEntry(agent, { ticketId: TICKET, activityKey: 'investigation', minutes: 15 });
    expect(row).toMatchObject({ loggedAt: NOW, userId: GRACE, createdBy: GRACE, kind: 'manual' });
    expect(db.table('outboxEvent').map((event) => event.type)).toEqual(['time.entry.logged']);
    expect(db.table('auditEvent').map((event) => event.action)).toEqual(['time.entry.logged']);
  });
});
