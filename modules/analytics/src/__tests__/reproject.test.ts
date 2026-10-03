import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@itsm/contracts';
import { createContext, systemContext, type Tx } from '@itsm/platform';
import { isRetryableConflict, reprojectFromSource, REPROJECT_SOURCES } from '../service/reproject-service.js';
import * as projector from '../service/ticket-projector.js';
import { refreshTimerFact } from '../service/sla-projector.js';
import { refreshApprovalFact } from '../service/approval-projector.js';
import { refreshTaskFact } from '../service/task-projector.js';
import { refreshSurveyFact } from '../service/survey-projector.js';
import { refreshTimeFact } from '../service/time-projector.js';
import { refreshNotificationFact } from '../service/notification-projector.js';
import { rebuildRange } from '../service/rebuild-service.js';
import { bumpQueryVersion } from '../service/query-cache.js';

/**
 * The reprojection from source rows (A4 §2.7), without a database: which rows
 * it walks, in what batches, what it hands each projector, and what it does
 * once they are done. That its facts equal the live projection's is proved
 * against PostgreSQL in `tests/integration/demo-imports.test.ts`.
 *
 * Also here: the `rollups` option on `refreshTicketFact`, which defaults to
 * today's behaviour — the rollup moves with every refresh — and is turned off
 * only by the reprojection.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, transactions: [] as unknown[], failures: [] as unknown[] }));
const repos = vi.hoisted(() => ({
  applyEntries: vi.fn(async () => undefined),
  writeTicketFact: vi.fn(async () => undefined),
  findTicketFact: vi.fn(async () => null as unknown),
  advanceCursor: vi.fn(async () => undefined),
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>, options: unknown = {}) => {
      platform.transactions.push(options);
      const failure = platform.failures.shift();
      const result = await fn(platform.tx);
      // A failure queued for this transaction is raised after its work, as a
      // commit that loses a race would be.
      if (failure) throw failure;
      return result;
    },
  };
});
vi.mock('../repo/rollup-repo.js', () => ({ applyEntries: repos.applyEntries }));
vi.mock('../repo/fact-repo.js', () => ({
  findTicketFact: repos.findTicketFact,
  writeTicketFact: repos.writeTicketFact,
  advanceCursor: repos.advanceCursor,
}));
vi.mock('../repo/dimension-repo.js', () => ({
  ensureTeam: vi.fn(),
  ensureService: vi.fn(),
  ensureCategory: vi.fn(),
  ensureChannel: vi.fn(),
  ensureUser: vi.fn(),
  ensureDate: vi.fn(),
}));
vi.mock('../service/ticket-projector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service/ticket-projector.js')>();
  return { ...actual, refreshTicketFact: vi.fn(async () => undefined), markBreached: vi.fn(async () => undefined), actual };
});
vi.mock('../service/sla-projector.js', () => ({ refreshTimerFact: vi.fn(async () => undefined) }));
vi.mock('../service/approval-projector.js', () => ({ refreshApprovalFact: vi.fn(async () => undefined) }));
vi.mock('../service/task-projector.js', () => ({ refreshTaskFact: vi.fn(async () => undefined) }));
vi.mock('../service/survey-projector.js', () => ({ refreshSurveyFact: vi.fn(async () => undefined) }));
vi.mock('../service/time-projector.js', () => ({ refreshTimeFact: vi.fn(async () => undefined) }));
vi.mock('../service/notification-projector.js', () => ({ refreshNotificationFact: vi.fn(async () => undefined) }));
vi.mock('../service/rebuild-service.js', () => ({ rebuildRange: vi.fn(async () => ({ days: 3, facts: 0 })) }));
vi.mock('../service/query-cache.js', () => ({ bumpQueryVersion: vi.fn(async () => undefined) }));

type Row = Record<string, unknown>;

const TENANT = '0190a000-0000-7000-8000-000000000001';
const ctx = systemContext(TENANT);
const FROM = new Date('2026-06-01T00:00:00.000Z');
const TO = new Date('2026-10-02T00:00:00.000Z');

/** The column each table is windowed on. */
const WINDOWED: Record<string, string> = {
  ticket: 'createdAt',
  slaTimer: 'startedAt',
  approvalRequest: 'requestedAt',
  ticketTask: 'createdAt',
  surveyResponse: 'respondedAt',
  timeEntry: 'loggedAt',
  notification: 'createdAt',
};

function memoryDb(tables: Record<string, Row[]>) {
  const reads: { model: string; where: Row; take: unknown }[] = [];
  const model = (name: string) => ({
    findMany: async ({ where, take }: { where: Row; take: number }) => {
      reads.push({ model: name, where, take });
      const window = where[WINDOWED[name]!] as { gte: Date; lt: Date };
      const after = (where.id as { gt?: string } | undefined)?.gt;
      return (tables[name] ?? [])
        .filter((row) => (row[WINDOWED[name]!] as Date) >= window.gte && (row[WINDOWED[name]!] as Date) < window.lt)
        .filter((row) => !after || String(row.id) > after)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, take)
        .map((row) => ({ id: row.id }));
    },
    findFirst: async ({ where }: { where: Row }) => (tables[name] ?? []).find((row) => row.id === where.id) ?? null,
  });
  return { tx: new Proxy({} as Row, { get: (_, name: string) => model(name) }) as unknown as Tx, reads };
}

const day = (n: number) => new Date(FROM.getTime() + n * 86_400_000);
const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`;

function sourceRows(): Record<string, Row[]> {
  return {
    ticket: [
      ...Array.from({ length: 5 }, (_, n) => ({ id: id('t', n), createdAt: day(n) })),
      // Outside the window on both sides; `to` itself is outside.
      { id: id('t', 90), createdAt: new Date(FROM.getTime() - 1) },
      { id: id('t', 91), createdAt: TO },
    ],
    slaTimer: [
      { id: id('s', 1), ticketId: id('t', 1), startedAt: day(1), breachedAt: null },
      { id: id('s', 2), ticketId: id('t', 2), startedAt: day(2), breachedAt: day(3) },
      { id: id('s', 3), ticketId: id('t', 2), startedAt: day(2), breachedAt: null },
    ],
    approvalRequest: [{ id: id('a', 1), requestedAt: day(4) }],
    ticketTask: [{ id: id('k', 1), createdAt: day(4) }],
    surveyResponse: [{ id: id('r', 1), respondedAt: day(5) }],
    timeEntry: [{ id: id('e', 1), loggedAt: day(5) }],
    notification: [{ id: id('n', 1), createdAt: day(6) }],
  };
}

let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(sourceRows());
  platform.tx = db.tx;
  platform.transactions = [];
  platform.failures = [];
});

/** The envelope each call of a projector mock was handed, and the row id. */
function calls(mock: unknown, idIndex = 3): { envelope: EventEnvelope; id: unknown }[] {
  return (mock as ReturnType<typeof vi.fn>).mock.calls.map((call) => ({ envelope: call[2] as EventEnvelope, id: call[idIndex] }));
}

describe('reprojectFromSource', () => {
  it('walks every source in the window, in id order, and counts what it projected', async () => {
    const result = await reprojectFromSource(ctx, { from: FROM, to: TO });
    expect(result).toEqual({ tickets: 5, timers: 3, approvals: 1, tasks: 1, surveys: 1, time: 1, notifications: 1, rollupDays: 3 });
    expect(calls(projector.refreshTicketFact).map((call) => call.id)).toEqual([0, 1, 2, 3, 4].map((n) => id('t', n)));
    expect(calls(refreshTimerFact).map((call) => call.id)).toEqual([id('s', 1), id('s', 2), id('s', 3)]);
    expect(calls(refreshApprovalFact).map((call) => call.id)).toEqual([id('a', 1)]);
    expect(calls(refreshTaskFact).map((call) => call.id)).toEqual([id('k', 1)]);
    expect(calls(refreshSurveyFact).map((call) => call.id)).toEqual([id('r', 1)]);
    expect(calls(refreshTimeFact).map((call) => call.id)).toEqual([id('e', 1)]);
    expect(calls(refreshNotificationFact).map((call) => call.id)).toEqual([id('n', 1)]);
    // Tickets before timers, so a breached timer finds its ticket's fact.
    const order = db.reads.map((read) => read.model).filter((model, index, all) => all.indexOf(model) === index);
    expect(order).toEqual(['ticket', 'slaTimer', 'approvalRequest', 'ticketTask', 'surveyResponse', 'timeEntry', 'notification']);
    expect(REPROJECT_SOURCES).toHaveLength(7);
  });

  it('skips the rollup diff on every ticket, and marks a ticket breached from its timer', async () => {
    await reprojectFromSource(ctx, { from: FROM, to: TO });
    for (const call of (projector.refreshTicketFact as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[4]).toEqual({});
      expect(call[5]).toEqual({ rollups: false });
    }
    // Only the timer with a breach, once, without the rollup diff.
    expect((projector.markBreached as ReturnType<typeof vi.fn>).mock.calls.map((call) => [call[3], call[4]])).toEqual([[id('t', 2), { rollups: false }]]);
    // The in-app channel every notification was queued on; an attempt names its own.
    expect((refreshNotificationFact as ReturnType<typeof vi.fn>).mock.calls[0]![4]).toBe('inapp');
  });

  it('hands each batch one synthetic envelope, a transaction per batch', async () => {
    await reprojectFromSource(ctx, { from: FROM, to: TO, batch: 2, sources: ['tickets'] });
    const envelopes = calls(projector.refreshTicketFact).map((call) => call.envelope);
    // 2 + 2 + 1.
    expect(new Set(envelopes.map((envelope) => envelope.id)).size).toBe(3);
    expect(envelopes[0]!.id).toBe(envelopes[1]!.id);
    expect(envelopes[1]!.id).not.toBe(envelopes[2]!.id);
    expect(envelopes[0]).toMatchObject({
      type: 'analytics.reprojected',
      version: 1,
      tenantId: TENANT,
      aggregate: { type: 'tenant', id: TENANT },
      payload: { source: 'tickets', from: FROM.toISOString(), to: TO.toISOString() },
      meta: { source: 'replay' },
    });
    // One read of the ids, then three batches with the time a batch needs.
    expect(platform.transactions).toEqual([{}, { timeout: 120_000 }, { timeout: 120_000 }, { timeout: 120_000 }]);
  });

  it('rebuilds the rollup over the window once, then moves the cache version on', async () => {
    await reprojectFromSource(ctx, { from: FROM, to: TO });
    expect(rebuildRange).toHaveBeenCalledTimes(1);
    expect(rebuildRange).toHaveBeenCalledWith(ctx, FROM, TO);
    expect(bumpQueryVersion).toHaveBeenCalledTimes(1);
    expect(bumpQueryVersion).toHaveBeenCalledWith(TENANT);
    const rebuilt = (rebuildRange as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect((bumpQueryVersion as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!).toBeGreaterThan(rebuilt);
  });

  it('leaves the rollup alone when neither tickets nor timers were walked, and still bumps the cache', async () => {
    const result = await reprojectFromSource(ctx, { from: FROM, to: TO, sources: ['approvals', 'surveys'] });
    expect(result).toMatchObject({ approvals: 1, surveys: 1, tickets: 0, timers: 0, rollupDays: 0 });
    expect(rebuildRange).not.toHaveBeenCalled();
    expect(projector.refreshTicketFact).not.toHaveBeenCalled();
    expect(bumpQueryVersion).toHaveBeenCalledTimes(1);
  });

  it('runs batches side by side when asked, and runs again a batch that lost a race on a shared row', async () => {
    // The second transaction is the first batch: a unique violation on a
    // dimension row another batch created first.
    platform.failures = [undefined, Object.assign(new Error('Unique constraint failed on the fields: (`team_id`)'), { code: 'P2002' })];
    const result = await reprojectFromSource(ctx, { from: FROM, to: TO, batch: 1, sources: ['tickets'], parallelism: 3 });
    expect(result.tickets).toBe(5);
    // Six transactions for five batches: one ran twice.
    expect(platform.transactions.filter((options) => (options as { timeout?: number }).timeout)).toHaveLength(6);
    expect(new Set(calls(projector.refreshTicketFact).map((call) => call.id)).size).toBe(5);
  });

  it('does not retry a failure that is not a lost race', async () => {
    platform.failures = [undefined, new Error('relation "fact_ticket" does not exist')];
    await expect(reprojectFromSource(ctx, { from: FROM, to: TO, sources: ['tickets'] })).rejects.toThrow('does not exist');
    expect(bumpQueryVersion).not.toHaveBeenCalled();
  });

  it('gives up on a batch that keeps losing', async () => {
    const race = () => Object.assign(new Error('deadlock detected'), { code: 'P2034' });
    platform.failures = [undefined, race(), race(), race(), race()];
    await expect(reprojectFromSource(ctx, { from: FROM, to: TO, sources: ['tickets'] })).rejects.toThrow('deadlock');
  });

  it('needs analytics.admin', async () => {
    const reader = createContext({
      tenantId: TENANT,
      actor: { type: 'user', id: '0190a000-0000-7000-8000-000000000007' },
      permissions: { has: (key: string) => key === 'analytics.read', scopeFor: (key: string) => (key === 'analytics.read' ? 'any' : undefined), keys: () => ['analytics.read'], isSystem: false },
    });
    await expect(reprojectFromSource(reader, { from: FROM, to: TO })).rejects.toMatchObject({ status: 403 });
    expect(platform.transactions).toEqual([]);
  });

  it('refuses a window that ends before it starts, a batch out of range and an unknown source', async () => {
    await expect(reprojectFromSource(ctx, { from: TO, to: FROM })).rejects.toMatchObject({ status: 422 });
    await expect(reprojectFromSource(ctx, { from: FROM, to: FROM })).rejects.toMatchObject({ status: 422 });
    await expect(reprojectFromSource(ctx, { from: FROM, to: TO, batch: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(reprojectFromSource(ctx, { from: FROM, to: TO, parallelism: 9 })).rejects.toMatchObject({ status: 422 });
    await expect(reprojectFromSource(ctx, { from: FROM, to: TO, sources: ['facts' as never] })).rejects.toMatchObject({ status: 422 });
    expect(platform.transactions).toEqual([]);
  });

  it('knows a lost race from a failure', () => {
    expect(isRetryableConflict(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(true);
    expect(isRetryableConflict(Object.assign(new Error('x'), { code: '40P01' }))).toBe(true);
    expect(isRetryableConflict(new Error('could not serialize access due to concurrent update'))).toBe(true);
    expect(isRetryableConflict(new Error('statement timeout'))).toBe(false);
    expect(isRetryableConflict(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refreshTicketFact's `rollups` option, on the real projector.
// ---------------------------------------------------------------------------

describe('refreshTicketFact { rollups }', () => {
  const actual = (projector as unknown as { actual: typeof projector }).actual;
  const TICKET = '0190a000-0000-7000-8000-0000000000aa';
  const envelope = { id: '0190a000-0000-7000-8000-0000000000ee', type: 'ticket.updated', occurredAt: '2026-09-01T10:00:00.000Z' } as EventEnvelope;
  const tx = {
    ticket: {
      findFirst: async () => ({
        id: TICKET,
        number: 'INC-004101',
        type: 'incident',
        status: 'resolved',
        priority: 'P3',
        serviceId: null,
        categoryId: null,
        groupId: null,
        assigneeId: null,
        requesterId: null,
        sourceChannel: 'email',
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        resolvedAt: new Date('2026-09-01T12:00:00.000Z'),
        closedAt: null,
        reopenCount: 0,
      }),
    },
    ticketComment: { count: async () => 0, findFirst: async () => null },
  } as unknown as Tx;

  it('moves the rollup by default, as every live event always has', async () => {
    await actual.refreshTicketFact(ctx, tx, envelope, TICKET);
    expect(repos.writeTicketFact).toHaveBeenCalledTimes(1);
    expect(repos.applyEntries).toHaveBeenCalledTimes(1);
    expect((repos.applyEntries.mock.calls[0] as unknown[])[2]).not.toEqual([]);
  });

  it('writes the same fact and leaves the rollup alone with rollups: false', async () => {
    await actual.refreshTicketFact(ctx, tx, envelope, TICKET);
    const live = (repos.writeTicketFact.mock.calls[0] as unknown[])[2];
    vi.clearAllMocks();
    await actual.refreshTicketFact(ctx, tx, envelope, TICKET, {}, { rollups: false });
    expect((repos.writeTicketFact.mock.calls[0] as unknown[])[2]).toEqual(live);
    expect(repos.applyEntries).not.toHaveBeenCalled();
  });

  it('markBreached passes the option on, and still sets the flag', async () => {
    await actual.markBreached(ctx, tx, envelope, TICKET, { rollups: false });
    expect((repos.writeTicketFact.mock.calls[0] as unknown[])[2]).toMatchObject({ breached: true });
    expect(repos.applyEntries).not.toHaveBeenCalled();
    await actual.markBreached(ctx, tx, envelope, TICKET);
    expect(repos.applyEntries).toHaveBeenCalledTimes(1);
  });
});
