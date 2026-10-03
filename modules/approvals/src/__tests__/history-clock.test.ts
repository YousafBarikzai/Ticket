import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext, systemContext, type TenantContext, type Tx } from '@itsm/platform';
import { decide, openNextStep, requestApproval } from '../service/approval-service.js';

/**
 * The approval history clock (A4 §2.3, WP-43a): `requestApproval(…, { at })`,
 * `openNextStep(…, open, at)` and `decide(…, { at })`. The shared demo writes
 * four months of approvals after the fact, and each must be due, decided and
 * settled when it was then — not two days after the build ran.
 *
 * The first block pins the other half of the promise: a caller that passes
 * no clock writes exactly the rows a live approval always wrote. The clock is
 * frozen, so "the present" is one known instant, and a column the database
 * dates by itself is a key absent from the write.
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

function satisfies(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return same(value, condition);
  return Object.entries(condition as Row).every(([op, arg]) => {
    if (op === 'in') return (arg as unknown[]).some((each) => same(value, each));
    if (op === 'has') return Array.isArray(value) && value.includes(arg);
    if (op === 'lte') return Number(value) <= Number(arg);
    if (op === 'gte') return Number(value) >= Number(arg);
    throw new Error(`the stand-in does not know the operator ${op}`);
  });
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => satisfies(row[key], condition));
}

function ordered(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [key, direction] = Object.entries(orderBy)[0]!;
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * (Number(a[key]) - Number(b[key])));
}

/** The calls the approval service makes, on arrays, with every write kept as it was asked for. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const writes: { model: string; op: string; data: Row; where?: Row }[] = [];
  const table = (name: string) => (tables[name] ??= []);
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
  };
  const model = (name: string) => ({
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => {
      const row = ordered(table(name).filter((each) => matches(each, where)), orderBy)[0];
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) =>
      ordered(table(name).filter((each) => matches(each, where)), orderBy).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      table(name).push({ ...data });
      return { ...data };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      writes.push({ model: name, op: 'update', data, where });
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      apply(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      writes.push({ model: name, op: 'updateMany', data, where });
      const rows = table(name).filter((each) => matches(each, where));
      rows.forEach((row) => apply(row, data));
      return { count: rows.length };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  const rows = (name: string) => table(name);
  const written = (name: string, op: string) => writes.filter((write) => write.model === name && write.op === op).map((write) => write.data);
  return { tx, table, rows, writes, written };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const REQUESTER = '0190a000-0000-7000-8000-000000000007';
const MANAGER = '0190a000-0000-7000-8000-000000000008';
const CAB = '0190a000-0000-7000-8000-000000000009';
const TICKET = '0190a000-0000-7000-8000-0000000000a1';
const POLICY = '0190a000-0000-7000-8000-0000000000b1';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-02T23:00:30.000Z');
const REQUESTED = new Date('2026-09-14T09:12:00.000Z');
const DECIDED = new Date('2026-09-14T12:40:00.000Z');
const SECOND = new Date('2026-09-15T08:05:00.000Z');

const system = systemContext(TENANT);
const as = (userId: string): TenantContext =>
  createContext({ tenantId: TENANT, actor: { type: 'user', id: userId, displayName: userId }, permissions: SYSTEM_PERMISSIONS });

let db: ReturnType<typeof memoryDb>;

/** A published request policy: the line manager, then (when it applies) the change board. */
function policy(steps: Row[]) {
  db.table('approvalPolicy').push({
    id: POLICY,
    tenantId: TENANT,
    key: 'manager-approval',
    subjectType: 'request',
    status: 'published',
    version: 1,
    specificity: 0,
    match: { always: true },
    steps,
  });
}

const managerStep = { name: 'Line manager', approvers: [{ kind: 'user', userId: MANAGER }], quorum: 1, timeout: 'P2D', onTimeout: 'escalate' };
const cabStep = { name: 'Change board', approvers: [{ kind: 'user', userId: CAB }], quorum: 1, timeout: 'P3D', onTimeout: 'escalate' };

function request(clock?: { at?: Date }) {
  return requestApproval(
    system,
    db.tx,
    { subjectType: 'request', subjectId: TICKET, ticketId: TICKET, subjectUserId: REQUESTER, facts: { requestType: { key: 'laptop' } } },
    clock,
  );
}

function step(sequence: number): Row {
  return db.rows('approvalStep').find((row) => row.sequence === sequence)!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('without a clock: exactly what a live approval writes', () => {
  it('leaves the request to the database clock and opens, dates and settles at the present', async () => {
    policy([managerStep]);

    const opened = await request();
    const [created] = db.written('approvalRequest', 'create');
    // `requested_at` has always been the database's default.
    expect(created).not.toHaveProperty('requestedAt');
    expect(step(1)).toMatchObject({ status: 'open', openedAt: NOW, dueAt: new Date(NOW.getTime() + 2 * DAY), approverIds: [MANAGER] });

    await decide(as(MANAGER), opened!.id as string, { decision: 'approved' });
    const [decision] = db.written('approvalDecision', 'create');
    // `decided_at` on the decision row is the database's default too.
    expect(decision).not.toHaveProperty('decidedAt');
    expect(step(1)).toMatchObject({ status: 'approved', decidedAt: NOW });
    expect(db.rows('approvalRequest')[0]).toMatchObject({ status: 'approved', outcome: 'approved', decidedAt: NOW });
  });

  it('dates a skipped step at the present', async () => {
    policy([{ ...managerStep, when: { eq: [{ var: 'requestType.key' }, 'mobile-phone'] } }, cabStep]);
    await request();
    expect(step(1)).toMatchObject({ status: 'skipped', decidedAt: NOW });
    expect(step(2)).toMatchObject({ status: 'open', openedAt: NOW, dueAt: new Date(NOW.getTime() + 3 * DAY) });
  });

  it('keeps openNextStep callable as before, with no clock', async () => {
    policy([managerStep]);
    await request({ at: REQUESTED });
    db.rows('approvalStep')[0]!.status = 'waiting';
    await openNextStep(system, db.tx, db.rows('approvalRequest')[0]!.id as string, { subjectUserId: REQUESTER, serviceId: null, facts: {} });
    expect(step(1)).toMatchObject({ status: 'open', openedAt: NOW });
  });
});

describe('with a clock: the approval is dated when it happened', () => {
  it('requests, opens and makes the step due from the instant given', async () => {
    policy([managerStep]);

    await request({ at: REQUESTED });

    expect(db.written('approvalRequest', 'create')[0]).toMatchObject({ requestedAt: REQUESTED, status: 'pending' });
    expect(step(1)).toMatchObject({ status: 'open', openedAt: REQUESTED, dueAt: new Date(REQUESTED.getTime() + 2 * DAY) });
  });

  it('decides, settles the step and the request, and opens the next step at the decision', async () => {
    policy([managerStep, cabStep]);
    const opened = await request({ at: REQUESTED });

    const first = await decide(as(MANAGER), opened!.id as string, { decision: 'approved', comment: 'Fine for the Power BI work.', via: 'email' }, { at: DECIDED });

    expect(first).toEqual({ requestStatus: 'pending', stepStatus: 'approved' });
    expect(db.written('approvalDecision', 'create')[0]).toMatchObject({ approverId: MANAGER, decision: 'approved', via: 'email', decidedAt: DECIDED });
    expect(step(1)).toMatchObject({ status: 'approved', decidedAt: DECIDED });
    expect(step(2)).toMatchObject({ status: 'open', openedAt: DECIDED, dueAt: new Date(DECIDED.getTime() + 3 * DAY), approverIds: [CAB] });

    const second = await decide(as(CAB), opened!.id as string, { decision: 'approved' }, { at: SECOND });

    expect(second).toEqual({ requestStatus: 'approved', stepStatus: 'approved' });
    expect(db.rows('approvalRequest')[0]).toMatchObject({ status: 'approved', outcome: 'approved', decidedAt: SECOND });
  });

  it('settles a rejection at the decision', async () => {
    policy([managerStep, cabStep]);
    const opened = await request({ at: REQUESTED });

    await decide(as(MANAGER), opened!.id as string, { decision: 'rejected' }, { at: DECIDED });

    expect(step(1)).toMatchObject({ status: 'rejected', decidedAt: DECIDED });
    expect(step(2)).toMatchObject({ status: 'waiting' });
    expect(db.rows('approvalRequest')[0]).toMatchObject({ status: 'rejected', outcome: 'rejected', decidedAt: DECIDED });
  });

  it('dates a skipped step, and one nobody could be found for, at the instant given', async () => {
    policy([
      { ...managerStep, when: { eq: [{ var: 'requestType.key' }, 'mobile-phone'] } },
      { ...managerStep, name: 'Nobody', approvers: [{ kind: 'manager', levels: 1 }] },
      cabStep,
    ]);

    await request({ at: REQUESTED });

    expect(step(1)).toMatchObject({ status: 'skipped', decidedAt: REQUESTED });
    expect(step(2)).toMatchObject({ status: 'skipped', decidedAt: REQUESTED });
    expect(step(3)).toMatchObject({ status: 'open', openedAt: REQUESTED });
  });

  it('settles at the instant given when every step is skipped', async () => {
    policy([{ ...managerStep, when: { eq: [{ var: 'requestType.key' }, 'mobile-phone'] } }]);
    await request({ at: REQUESTED });
    expect(db.rows('approvalRequest')[0]).toMatchObject({ status: 'approved', decidedAt: REQUESTED });
  });

  it('writes the same audit trail and events as a live approval', async () => {
    policy([managerStep]);
    const opened = await request({ at: REQUESTED });
    await decide(as(MANAGER), opened!.id as string, { decision: 'approved' }, { at: DECIDED });

    expect(db.written('auditEvent', 'create').map((row) => row.action)).toEqual([
      'approval.step.opened',
      'approval.requested',
      'approval.decided',
      'approval.approved',
    ]);
    expect(db.written('outboxEvent', 'create').map((row) => row.type)).toEqual(['approval.requested', 'approval.decided']);
  });
});

describe('the clock is refused when it cannot be true', () => {
  it('refuses a request dated in the future, and writes nothing', async () => {
    policy([managerStep]);
    await expect(request({ at: new Date(NOW.getTime() + HOUR) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    expect(db.writes).toEqual([]);
  });

  it('refuses a time that is not a date', async () => {
    policy([managerStep]);
    await expect(request({ at: new Date('not a date') })).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'at', code: 'invalid' }] });
  });

  it('refuses a decision dated in the future', async () => {
    policy([managerStep]);
    const opened = await request({ at: REQUESTED });
    await expect(decide(as(MANAGER), opened!.id as string, { decision: 'approved' }, { at: new Date(NOW.getTime() + HOUR) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    expect(step(1)).toMatchObject({ status: 'open' });
  });

  it('refuses a decision made before its step was opened', async () => {
    policy([managerStep]);
    const opened = await request({ at: REQUESTED });
    await expect(decide(as(MANAGER), opened!.id as string, { decision: 'approved' }, { at: new Date(REQUESTED.getTime() - 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'before_opened' }],
    });
    expect(db.written('approvalDecision', 'create')).toEqual([]);
    expect(step(1)).toMatchObject({ status: 'open' });
  });

  it('tells somebody who is not an approver nothing about the step, whatever clock they give', async () => {
    policy([managerStep]);
    const opened = await request({ at: REQUESTED });
    // 404, as for any non-approver: not the 422 that would reveal when the step opened.
    await expect(decide(as(REQUESTER), opened!.id as string, { decision: 'approved' }, { at: new Date(REQUESTED.getTime() - 1) })).rejects.toMatchObject({
      status: 404,
    });
  });
});
