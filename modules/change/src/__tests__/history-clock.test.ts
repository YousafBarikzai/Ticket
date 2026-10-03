import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { approveRetrospectively, createChange, scheduleChange, submitChange, transition } from '../service/change-service.js';

/**
 * The change history clock (A4 §2.3, WP-43b): `createChange`, `submitChange`,
 * `scheduleChange`, `transition` and `approveRetrospectively` take `{ at }`.
 * The shared demo's forty-two changes were raised, approved, carried out and
 * closed over four months, and the calendar, the success rate and the
 * retrospective debt are read from those instants.
 *
 * Without a clock every write is today's: the clock is frozen, so "the
 * present" is one known instant, and a column the database dates by itself
 * is a key absent from the write. MOD-17 is stood in for, so what the change
 * module asks of it — with or without the clock — is visible.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, numbers: 0 }));
const approvals = vi.hoisted(() => ({ requestApproval: vi.fn() }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
    nextNumber: async (_tx: unknown, _ctx: unknown, _type: string, prefix: string, width = 6) => {
      platform.numbers += 1;
      return `${prefix}-${String(1150 + platform.numbers).padStart(width, '0')}`;
    },
  };
});

vi.mock('@itsm/module-approvals', () => ({ requestApproval: approvals.requestApproval }));

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => same(row[key], condition));
}

/** The calls the change service makes, on arrays, with every write kept as it was asked for. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const writes: { model: string; op: string; data: Row }[] = [];
  const table = (name: string) => (tables[name] ??= []);
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (value && typeof value === 'object' && 'increment' in value) row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
      else row[key] = value;
    }
  };
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      // What the database fills in when the write leaves it out.
      const row = { createdAt: STAMPED, updatedAt: STAMPED, version: 1, actualStartAt: null, retrospectiveApprovedAt: null, ...data };
      table(name).push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      writes.push({ model: name, op: 'update', data });
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      apply(row, data);
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
const DANIEL = '0190a000-0000-7000-8000-000000000002';
const JORDAN = '0190a000-0000-7000-8000-000000000003';
const REQUEST = '0190a000-0000-7000-8000-0000000000c1';

const NOW = new Date('2026-10-02T23:00:30.000Z');
/** What the database stamps on a column the write leaves out: a marker, so nobody mistakes it for a clock. */
const STAMPED = new Date('2000-01-01T00:00:00.000Z');
const RAISED = new Date('2026-08-10T09:00:00.000Z');
const SUBMITTED = new Date('2026-08-10T09:30:00.000Z');
const DECIDED = new Date('2026-08-11T14:00:00.000Z');
const SCHEDULED = new Date('2026-08-11T15:00:00.000Z');
const STARTED = new Date('2026-08-19T19:00:00.000Z');
const FINISHED = new Date('2026-08-19T20:40:00.000Z');
const CLOSED = new Date('2026-08-20T09:15:00.000Z');
const WINDOW = { plannedStartAt: new Date('2026-08-19T19:00:00.000Z'), plannedEndAt: new Date('2026-08-19T21:00:00.000Z') };

const as = (userId: string): TenantContext =>
  createContext({ tenantId: TENANT, actor: { type: 'user', id: userId, displayName: userId }, permissions: SYSTEM_PERMISSIONS });
const daniel = as(DANIEL);
const jordan = as(JORDAN);

const firmware = { title: 'Leeds core switch firmware 17.9', kind: 'normal' as const, risk: 'high' as const, backoutPlan: 'Boot the previous image.' };
const certificate = { title: 'Reissue the VPN gateway intermediate certificate', kind: 'emergency' as const, risk: 'high' as const };

let db: ReturnType<typeof memoryDb>;

function fresh() {
  db = memoryDb();
  platform.tx = db.tx;
  platform.numbers = 0;
  approvals.requestApproval.mockReset();
  approvals.requestApproval.mockResolvedValue({ id: REQUEST });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fresh();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A normal change from draft to closed, through the CAB, once with each step's instant and once without. */
async function normalChange(clocked: boolean) {
  const at = (instant: Date) => (clocked ? { at: instant } : {});
  const change = await createChange(daniel, firmware, at(RAISED));
  await submitChange(daniel, change.number, at(SUBMITTED));
  await transition(daniel, change.number, { to: 'approved' }, at(DECIDED));
  await scheduleChange(daniel, change.number, WINDOW, at(SCHEDULED));
  await transition(daniel, change.number, { to: 'implementing' }, at(STARTED));
  await transition(daniel, change.number, { to: 'review' }, at(FINISHED));
  await transition(daniel, change.number, { to: 'closed', closeCode: 'backed_out', notes: 'Stack 2 did not rejoin.' }, at(CLOSED));
  return change;
}

describe('without a clock, every write is today’s', () => {
  it('raises, submits, schedules and closes at the present, leaving the dates to the database', async () => {
    await normalChange(false);
    const [created] = db.written('change', 'create');
    expect(created).not.toHaveProperty('createdAt');
    expect(created).not.toHaveProperty('updatedAt');
    for (const write of db.written('change', 'update')) expect(write).not.toHaveProperty('updatedAt');

    const updates = db.written('change', 'update');
    expect(updates[0]).toMatchObject({ status: 'submitted', approvalRequestId: REQUEST });
    expect(updates[3]).toMatchObject({ status: 'implementing', actualStartAt: NOW });
    expect(updates[4]).toMatchObject({ status: 'review', actualEndAt: NOW });
    expect(updates[5]).toMatchObject({ status: 'closed', closeCode: 'backed_out', closedAt: NOW });
  });

  it('asks MOD-17 exactly as before: three arguments, no clock', async () => {
    const change = await createChange(daniel, firmware);
    await submitChange(daniel, change.number);
    expect(approvals.requestApproval).toHaveBeenCalledTimes(1);
    expect(approvals.requestApproval.mock.calls[0]).toHaveLength(3);
    expect(approvals.requestApproval.mock.calls[0]![2]).toMatchObject({ subjectType: 'change', subjectId: change.id });
  });

  it('approves an emergency change after the fact at the present', async () => {
    const change = await createChange(daniel, certificate);
    await submitChange(daniel, change.number);
    await approveRetrospectively(jordan, change.number, 'Reviewed at CAB.');
    const approval = db.written('change', 'update').at(-1)!;
    expect(approval).toMatchObject({ retrospectiveApprovedAt: NOW, retrospectiveApprovedBy: JORDAN });
    expect(approval).not.toHaveProperty('updatedAt');
  });
});

describe('with a clock, every step is dated when it happened', () => {
  it('raises the change at the instant', async () => {
    const change = await createChange(daniel, { ...firmware, ...WINDOW }, { at: RAISED });
    expect(change).toMatchObject({ createdAt: RAISED, updatedAt: RAISED, status: 'draft', requestedBy: DANIEL });
  });

  it('submits at the instant, and the CAB is asked then', async () => {
    const change = await createChange(daniel, firmware, { at: RAISED });
    await submitChange(daniel, change.number, { at: SUBMITTED });
    expect(approvals.requestApproval.mock.calls[0]![3]).toEqual({ at: SUBMITTED });
    expect(db.written('change', 'update')[0]).toMatchObject({ status: 'submitted', updatedAt: SUBMITTED });
  });

  it('records the CAB’s answer, then each step of the work, at its own instant', async () => {
    await normalChange(true);
    const updates = db.written('change', 'update');
    expect(updates[1]).toMatchObject({ status: 'approved', updatedAt: DECIDED });
    expect(updates[2]).toMatchObject({ status: 'scheduled', ...WINDOW, updatedAt: SCHEDULED });
    expect(updates[3]).toMatchObject({ status: 'implementing', actualStartAt: STARTED, updatedAt: STARTED });
    expect(updates[4]).toMatchObject({ status: 'review', actualEndAt: FINISHED, updatedAt: FINISHED });
    expect(updates[5]).toMatchObject({ status: 'closed', closeCode: 'backed_out', closedAt: CLOSED, updatedAt: CLOSED });
  });

  it('starts an emergency change, scheduled on submission, at the instant', async () => {
    const change = await createChange(daniel, certificate, { at: RAISED });
    await submitChange(daniel, change.number, { at: SUBMITTED });
    await transition(daniel, change.number, { to: 'implementing' }, { at: STARTED });
    expect(db.written('change', 'update').at(-1)).toMatchObject({ actualStartAt: STARTED });
  });

  it('approves an emergency change after the fact when it was approved', async () => {
    const change = await createChange(daniel, certificate, { at: RAISED });
    await submitChange(daniel, change.number, { at: SUBMITTED });
    await approveRetrospectively(jordan, change.number, undefined, { at: DECIDED });
    expect(db.written('change', 'update').at(-1)).toMatchObject({ retrospectiveApprovedAt: DECIDED, retrospectiveApprovedBy: JORDAN, updatedAt: DECIDED });
  });

  it('writes the same audit actions and events as a live change', async () => {
    const story = async (clocked: boolean) => {
      await normalChange(clocked);
      return { audit: db.table('auditEvent').map((row) => row.action), events: db.table('outboxEvent').map((row) => row.type) };
    };
    const live = await story(false);
    fresh();
    expect(await story(true)).toEqual(live);
    expect(live.events).toEqual(['change.submitted', 'change.scheduled', 'change.closed']);
  });
});

describe('a history only happens in the past, and after the change was raised', () => {
  it('refuses an instant in the future, or one that is not a date, before writing anything', async () => {
    await expect(createChange(daniel, firmware, { at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    await expect(createChange(daniel, firmware, { at: new Date('not a date') })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'invalid' }],
    });
    expect(db.written('change', 'create')).toEqual([]);
  });

  it('refuses a submission, a schedule, a move or a retrospective approval dated before the change was raised', async () => {
    const early = { at: new Date(RAISED.getTime() - 1) };
    const normal = await createChange(daniel, firmware, { at: RAISED });
    await expect(submitChange(daniel, normal.number, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_change' }] });
    await submitChange(daniel, normal.number, { at: SUBMITTED });
    await expect(transition(daniel, normal.number, { to: 'approved' }, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_change' }] });
    await transition(daniel, normal.number, { to: 'approved' }, { at: DECIDED });
    await expect(scheduleChange(daniel, normal.number, WINDOW, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_change' }] });

    const emergency = await createChange(daniel, certificate, { at: RAISED });
    await submitChange(daniel, emergency.number, { at: SUBMITTED });
    await expect(approveRetrospectively(jordan, emergency.number, undefined, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_change' }] });
    expect(approvals.requestApproval).toHaveBeenCalledTimes(1);
  });
});
