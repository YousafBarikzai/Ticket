import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { createProblem, linkTickets, publishKnownError, transition } from '../service/problem-service.js';
import * as knownErrorService from '../service/known-error-service.js';

/**
 * The problem history clock (A4 §2.3, WP-43b): `createProblem`,
 * `linkTickets`, `transition` and `publishKnownError` take `{ at }`. The
 * shared demo's eight problems were raised weeks before the build, gathered
 * their incidents as they arrived, published workarounds and were fixed; each
 * of those moments is on the record, and the problem list sorts and ages by
 * them.
 *
 * Without a clock every write is today's. The clock is frozen, so "the
 * present" is one known instant, and a column the database dates by itself
 * is a key absent from the write. `publishKnownError` has a live twin in
 * `known-error-service.ts` (no clock; no owner this wave): with no clock the
 * two must write the same rows, audit and event, which the last block pins.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, numbers: 0 }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
    nextNumber: async (_tx: unknown, _ctx: unknown, _type: string, prefix: string, width = 6) => {
      platform.numbers += 1;
      return `${prefix}-${String(410 + platform.numbers).padStart(width, '0')}`;
    },
  };
});

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => same(row[key], condition));
}

/** The calls the problem services make, on arrays, with every write kept as it was asked for. */
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
    count: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).length,
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      // What the database fills in when the write leaves it out.
      const row = { createdAt: STAMPED, updatedAt: STAMPED, linkedAt: STAMPED, publishedAt: STAMPED, version: 1, rootCause: null, ...data };
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
const OWNER = '0190a000-0000-7000-8000-000000000002';
const FIRST = '0190a000-0000-7000-8000-0000000000a1';
const SECOND = '0190a000-0000-7000-8000-0000000000a2';

const DAY = 86_400_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
/** What the database stamps on a column the write leaves out: a marker, so nobody mistakes it for a clock. */
const STAMPED = new Date('2000-01-01T00:00:00.000Z');
const FIRST_RAISED = new Date('2026-07-20T08:00:00.000Z');
const SECOND_RAISED = new Date('2026-08-10T10:00:00.000Z');
const RAISED = new Date('2026-08-01T09:00:00.000Z');
const LINKED = new Date('2026-08-12T11:00:00.000Z');
const WORKAROUND = new Date('2026-08-14T15:00:00.000Z');
const RESOLVED = new Date('2026-09-11T16:30:00.000Z');

const ctx: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'user', id: OWNER, displayName: 'Aisha Rahman' },
  permissions: SYSTEM_PERMISSIONS,
});

const outlook = { title: 'Outlook re-prompts for a password after a password change', ownerId: OWNER };
const workaround = { symptom: 'Outlook keeps asking for my password', workaround: 'Remove the cached credential, then restart Outlook.', articleKey: 'outlook-password-prompt' };

let db: ReturnType<typeof memoryDb>;

function fresh() {
  db = memoryDb();
  platform.tx = db.tx;
  platform.numbers = 0;
  db.table('ticket').push({ id: FIRST, tenantId: TENANT, createdAt: FIRST_RAISED }, { id: SECOND, tenantId: TENANT, createdAt: SECOND_RAISED });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fresh();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('without a clock, every write is today’s', () => {
  it('raises, links and moves a problem at the present, leaving the dates to the database', async () => {
    const problem = await createProblem(ctx, { ...outlook, ticketIds: [FIRST] });
    await linkTickets(ctx, problem.number, { ticketIds: [SECOND] });
    await publishKnownError(ctx, problem.number, workaround);
    await transition(ctx, problem.number, { to: 'resolved', rootCause: 'A stale cached token.' });

    const [created] = db.written('problem', 'create');
    expect(created).not.toHaveProperty('createdAt');
    expect(created).not.toHaveProperty('updatedAt');
    for (const link of db.written('problemTicket', 'create')) expect(link).not.toHaveProperty('linkedAt');
    expect(db.written('knownError', 'create')[0]).not.toHaveProperty('publishedAt');

    const [knownError, resolved] = db.written('problem', 'update');
    expect(knownError).toEqual({ status: 'known_error', version: { increment: 1 } });
    expect(resolved).toEqual({ status: 'resolved', version: { increment: 1 }, rootCause: 'A stale cached token.', resolvedAt: NOW });
    expect(db.written('knownError', 'update')[0]).toMatchObject({ status: 'retired', retiredAt: NOW });
  });

  it('closes at the present', async () => {
    const problem = await createProblem(ctx, outlook);
    await transition(ctx, problem.number, { to: 'resolved' });
    await transition(ctx, problem.number, { to: 'closed' });
    expect(db.written('problem', 'update')[1]).toEqual({ status: 'closed', version: { increment: 1 }, closedAt: NOW });
  });
});

describe('with a clock, every step is dated when it happened', () => {
  it('raises the problem, and links the incidents it already knew of, at the instant', async () => {
    const problem = await createProblem(ctx, { ...outlook, ticketIds: [FIRST] }, { at: RAISED });
    expect(problem).toMatchObject({ createdAt: RAISED, updatedAt: RAISED });
    expect(db.written('problemTicket', 'create')[0]).toMatchObject({ ticketId: FIRST, linkedAt: RAISED });
  });

  it('links later incidents when they were linked', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    const result = await linkTickets(ctx, problem.number, { ticketIds: [SECOND], workaroundApplied: true }, { at: LINKED });
    expect(result).toEqual({ linked: 1, total: 1 });
    expect(db.written('problemTicket', 'create')[0]).toMatchObject({ ticketId: SECOND, workaroundApplied: true, linkedAt: LINKED });
  });

  it('publishes the workaround when it was published, which is when the problem became a known error', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    const knownError = await publishKnownError(ctx, problem.number, workaround, { at: WORKAROUND });
    expect(knownError).toMatchObject({ status: 'published', publishedAt: WORKAROUND, publishedBy: OWNER });
    expect(db.written('problem', 'update')[0]).toEqual({ status: 'known_error', version: { increment: 1 }, updatedAt: WORKAROUND });
  });

  it('republishes a withdrawn workaround at the instant', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    await publishKnownError(ctx, problem.number, workaround, { at: WORKAROUND });
    await transition(ctx, problem.number, { to: 'resolved' }, { at: new Date(RESOLVED.getTime() - 10 * DAY) });
    await transition(ctx, problem.number, { to: 'investigating', note: 'It came back.' }, { at: new Date(RESOLVED.getTime() - DAY) });
    await publishKnownError(ctx, problem.number, workaround, { at: RESOLVED });
    expect(db.written('knownError', 'update').at(-1)).toMatchObject({ status: 'published', publishedAt: RESOLVED, retiredAt: null });
  });

  it('resolves at the instant, retires the workaround then, and counts the days open to it', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    await publishKnownError(ctx, problem.number, workaround, { at: WORKAROUND });
    await transition(ctx, problem.number, { to: 'resolved', rootCause: 'A stale cached token.' }, { at: RESOLVED });

    expect(db.written('problem', 'update')[1]).toEqual({
      status: 'resolved',
      version: { increment: 1 },
      updatedAt: RESOLVED,
      rootCause: 'A stale cached token.',
      resolvedAt: RESOLVED,
    });
    expect(db.written('knownError', 'update')[0]).toMatchObject({ status: 'retired', retiredAt: RESOLVED });
    const resolvedEvent = db.table('outboxEvent').find((row) => row.type === 'problem.resolved');
    expect((resolvedEvent?.envelope as { payload: { openDays: number } }).payload.openDays).toBe(41);
  });

  it('closes at the instant', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    await transition(ctx, problem.number, { to: 'resolved' }, { at: LINKED });
    await transition(ctx, problem.number, { to: 'closed' }, { at: RESOLVED });
    expect(db.written('problem', 'update')[1]).toEqual({ status: 'closed', version: { increment: 1 }, updatedAt: RESOLVED, closedAt: RESOLVED });
  });

  it('writes the same audit actions and events as a live problem', async () => {
    const story = async (clocked: boolean) => {
      const at = (instant: Date) => (clocked ? { at: instant } : {});
      const problem = await createProblem(ctx, { ...outlook, ticketIds: [FIRST] }, at(RAISED));
      await linkTickets(ctx, problem.number, { ticketIds: [SECOND] }, at(LINKED));
      await publishKnownError(ctx, problem.number, workaround, at(WORKAROUND));
      await transition(ctx, problem.number, { to: 'resolved' }, at(RESOLVED));
      return { audit: db.table('auditEvent').map((row) => row.action), events: db.table('outboxEvent').map((row) => row.type) };
    };
    const live = await story(false);
    fresh();
    expect(await story(true)).toEqual(live);
    expect(live.events).toEqual(['problem.created', 'knownerror.published', 'knownerror.retired', 'problem.resolved']);
  });
});

describe('a history only happens in the past, and in order', () => {
  it('refuses an instant in the future, or one that is not a date, before writing anything', async () => {
    await expect(createProblem(ctx, outlook, { at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    await expect(createProblem(ctx, outlook, { at: new Date('not a date') })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'invalid' }],
    });
    expect(db.written('problem', 'create')).toEqual([]);
  });

  it('refuses a link to an incident that had not been raised yet', async () => {
    await expect(createProblem(ctx, { ...outlook, ticketIds: [SECOND] }, { at: RAISED })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'before_ticket' }],
    });
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    await expect(linkTickets(ctx, problem.number, { ticketIds: [SECOND] }, { at: new Date(SECOND_RAISED.getTime() - 1) })).rejects.toMatchObject({
      fieldErrors: [{ code: 'before_ticket' }],
    });
  });

  it('refuses a link, a workaround or a move dated before the problem was raised', async () => {
    const problem = await createProblem(ctx, outlook, { at: RAISED });
    const early = { at: new Date(RAISED.getTime() - 1) };
    await expect(linkTickets(ctx, problem.number, { ticketIds: [FIRST] }, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_problem' }] });
    await expect(publishKnownError(ctx, problem.number, workaround, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_problem' }] });
    await expect(transition(ctx, problem.number, { to: 'resolved' }, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_problem' }] });
    expect(db.written('problem', 'update')).toEqual([]);
  });
});

describe('the clocked publishKnownError and the live one write the same thing', () => {
  async function publishWith(publisher: 'clocked' | 'live', republish: boolean) {
    fresh();
    const problem = await createProblem(ctx, outlook);
    const call = () =>
      publisher === 'clocked' ? publishKnownError(ctx, problem.number, workaround) : knownErrorService.publishKnownError(ctx, problem.number, workaround);
    await call();
    if (republish) await call();
    const strip = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && key !== 'hash' && key !== 'prevHash' && key !== 'occurredAt'));
    const written = {
      knownError: db.table('knownError').map((row) => strip(row)),
      problem: db.written('problem', 'update'),
      audit: db.table('auditEvent').map((row) => ({ action: row.action, after: row.after })),
      events: db.table('outboxEvent').map((row) => ({ type: row.type, payload: (row.envelope as { payload: unknown }).payload })),
    };
    // Each run raises its own problem; its id is the one thing that may differ.
    return JSON.parse(JSON.stringify(written).replaceAll(problem.id, 'the-problem')) as unknown;
  }

  it('on a first publication', async () => {
    expect(await publishWith('clocked', false)).toEqual(await publishWith('live', false));
  });

  it('on a republication', async () => {
    expect(await publishWith('clocked', true)).toEqual(await publishWith('live', true));
  });

  it('refuses a fixed problem with the same words', async () => {
    const refusal = async (publisher: 'clocked' | 'live') => {
      fresh();
      const problem = await createProblem(ctx, outlook);
      await transition(ctx, problem.number, { to: 'resolved' });
      const call = publisher === 'clocked' ? publishKnownError : knownErrorService.publishKnownError;
      return call(ctx, problem.number, workaround).catch((error: Error) => error.message);
    };
    expect(await refusal('clocked')).toBe(await refusal('live'));
  });
});
