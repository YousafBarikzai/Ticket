import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError, systemContext, type Tx } from '@itsm/platform';
import { createTeam, createUser } from '../service/user-service.js';

/**
 * The identity half of the history clocks (A4 §2.3, WP-43a): a person's
 * joining date on an import or the seed, and a team's business calendar.
 * Both are new optional inputs, so each block first pins that a caller who
 * passes nothing new writes exactly the row it wrote before.
 *
 * No database: the transaction is an in-memory stand-in that keeps every
 * write as it was asked for, so "the column was left to the database's own
 * clock" is the absence of the key in the write, which is what it is in SQL.
 * The integration suite (`tests/integration/demo-module-imports-core.test.ts`)
 * runs the same calls against PostgreSQL in a seeding demo tenant.
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
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && 'in' in (condition as Row)) {
      return (condition as { in: unknown[] }).in.some((each) => same(row[key], each));
    }
    return same(row[key], condition);
  });
}

/** The calls the identity service makes, on arrays, with every write kept as it was asked for. */
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
      table(name).push({ ...data });
      return { ...data };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  const created = (name: string) => writes.filter((write) => write.model === name && write.op === 'create').map((write) => write.data);
  return { tx, table, writes, created };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const ORG = '0190a000-0000-7000-8000-000000000002';
const CALENDAR = '0190a000-0000-7000-8000-0000000000c1';
const NOW = new Date('2026-10-02T23:00:30.000Z');
const JOINED = new Date('2024-03-04T09:00:00.000Z');

const ctx = systemContext(TENANT);
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
});

afterEach(() => {
  vi.useRealTimers();
});

const person = { email: 'Priya.Shah@Northwind.example', displayName: 'Priya Shah', primaryOrgId: ORG };

describe('createUser: when the person joined', () => {
  it('writes exactly the row it always wrote when no joining date is given', async () => {
    await createUser(ctx, person, 'admin');

    const [user] = db.created('user');
    // Today's row, key for key: both timestamps are the database's own clock.
    expect(Object.keys(user!).sort()).toEqual(
      ['createdBy', 'displayName', 'email', 'id', 'idpSubject', 'isExternal', 'locale', 'managerId', 'primaryOrgId', 'tenantId', 'timeZone', 'updatedBy'].sort(),
    );
    expect(user).toMatchObject({ email: 'priya.shah@northwind.example', displayName: 'Priya Shah', primaryOrgId: ORG, locale: 'en-GB', timeZone: 'Europe/London' });
    const [audit] = db.created('auditEvent');
    expect(audit).toMatchObject({ action: 'user.provisioned', after: { email: 'priya.shah@northwind.example', displayName: 'Priya Shah', source: 'admin' } });
    expect(audit!.after).not.toHaveProperty('createdAt');
  });

  it.each(['import', 'seed'] as const)('dates the account when the %s says when they joined', async (source) => {
    await createUser(ctx, { ...person, createdAt: JOINED }, source);

    const [user] = db.created('user');
    // Nothing has happened to the account since it arrived, so it was last
    // changed when it was created.
    expect(user).toMatchObject({ createdAt: JOINED, updatedAt: JOINED });
    const [audit] = db.created('auditEvent');
    // The audit row is written now; it names the date the source gave.
    expect(audit!.after).toEqual({ email: 'priya.shah@northwind.example', displayName: 'Priya Shah', source, createdAt: JOINED.toISOString() });
  });

  it('takes the joining date as an ISO string, as a migration file carries it', async () => {
    await createUser(ctx, { ...person, createdAt: '2024-03-04T09:00:00.000Z' as unknown as Date }, 'import');
    expect(db.created('user')[0]).toMatchObject({ createdAt: JOINED });
  });

  it.each(['admin', 'jit', 'scim'] as const)('refuses a joining date from %s, and writes nothing', async (source) => {
    const attempt = createUser(ctx, { ...person, createdAt: JOINED }, source);
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'createdAt', code: 'not_allowed' }] });
    expect(db.writes).toEqual([]);
  });

  it('refuses a joining date in the future', async () => {
    await expect(createUser(ctx, { ...person, createdAt: new Date(NOW.getTime() + 60_000) }, 'import')).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'createdAt', code: 'in_future' }],
    });
    expect(db.writes).toEqual([]);
  });

  it('accepts the present itself: a seed run now is not in the future', async () => {
    await createUser(ctx, { ...person, createdAt: NOW }, 'seed');
    expect(db.created('user')[0]).toMatchObject({ createdAt: NOW });
  });
});

describe('createTeam: the business calendar', () => {
  const team = { key: 'service-desk', name: 'Service Desk', orgId: ORG };

  it('writes exactly the row it always wrote when no calendar is given', async () => {
    await createTeam(ctx, team);

    const [row] = db.created('team');
    expect(Object.keys(row!).sort()).toEqual(['createdBy', 'id', 'key', 'name', 'orgId', 'tenantId', 'type'].sort());
    expect(row).toMatchObject({ key: 'service-desk', name: 'Service Desk', orgId: ORG, type: 'support_group' });
    expect(db.created('auditEvent')[0]!.after).toEqual({ key: 'service-desk', name: 'Service Desk' });
  });

  it('treats a null calendar as none', async () => {
    await createTeam(ctx, { ...team, calendarId: null });
    expect(db.created('team')[0]).not.toHaveProperty('calendarId');
  });

  it('stores the calendar the team works to, and says so in the audit row', async () => {
    db.table('businessCalendar').push({ id: CALENDAR, key: 'northwind-uk', tenantId: TENANT });

    const created = await createTeam(ctx, { ...team, calendarId: CALENDAR });

    expect(created).toMatchObject({ key: 'service-desk', calendarId: CALENDAR });
    expect(db.created('team')[0]).toMatchObject({ calendarId: CALENDAR });
    expect(db.created('auditEvent')[0]!.after).toEqual({ key: 'service-desk', name: 'Service Desk', calendarId: CALENDAR });
  });

  it('refuses a calendar that does not exist rather than measuring the team around the clock', async () => {
    await expect(createTeam(ctx, { ...team, calendarId: CALENDAR })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'calendarId', code: 'not_found', message: CALENDAR }],
    });
    expect(db.writes).toEqual([]);
  });

  it('refuses a calendar given by its key instead of its id', async () => {
    await expect(createTeam(ctx, { ...team, calendarId: 'northwind-uk' })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'calendarId', code: 'invalid' }],
    });
    expect(db.writes).toEqual([]);
  });
});
