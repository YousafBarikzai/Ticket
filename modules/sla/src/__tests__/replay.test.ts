import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlersFor, systemContext, type Tx } from '@itsm/platform';
import { STATES } from '@itsm/module-ticket';
import { partitionFor } from '../manifest.js';
import { DEFAULT_TARGETS, OFFICE_HOURS } from '../seed/default-policy.js';
import {
  breachDue,
  matchPolicy,
  meetTimer,
  pauseTimers,
  restartUpdateCycle,
  resumeTimers,
  startTimersForTicket,
  stopTimers,
  tickPartition,
} from '../service/timer-service.js';
import { ReplayRefusedError, replaySteps, replayTimers } from '../service/replay.js';
import '../handlers/index.js';

/**
 * The SLA replay of an imported ticket (A4 §2.6), without a database.
 *
 * The claim worth proving is that a replay builds the clocks the live engine
 * would have built. So every fixture below is run twice against an in-memory
 * store: once *live* — the module's own registered handlers fed the ticket's
 * events at the moments they happened, and the real `tickPartition` run each
 * time something falls due, with the system clock set to that moment — and
 * once *replayed*, from the rows an import leaves, with the system clock
 * parked years away so any stamp read from it shows. The timers, their pauses
 * and breach records must come out identical.
 *
 * The live tick here runs at the instant each deadline falls, a tick that is
 * never late. A real tick runs up to a minute late and stamps what it saw;
 * that minute is the only disagreement A4 §1.11 allows the build's check.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    // Every transaction is the in-memory store's.
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
  };
});

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the Prisma client: just the calls the SLA
// engine makes, with Prisma's semantics for them (`@updatedAt` included).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matches(row: Row, where: Row = {}): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Row[]).some((each) => matches(row, each))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(condition as Row[]).every((each) => matches(row, each))) return false;
      continue;
    }
    const value = row[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
      for (const [op, arg] of Object.entries(condition as Row)) {
        if (op === 'in' && !(arg as unknown[]).some((each) => same(value, each))) return false;
        if (op === 'not' && same(value, arg)) return false;
        if (op === 'lte' && (value == null || compare(value, arg) > 0)) return false;
        if (op === 'lt' && (value == null || compare(value, arg) >= 0)) return false;
        if (op === 'gte' && (value == null || compare(value, arg) < 0)) return false;
        if (op === 'gt' && (value == null || compare(value, arg) <= 0)) return false;
      }
    } else if (!same(value, condition)) {
      return false;
    }
  }
  return true;
}

function sorted(rows: Row[], orderBy?: Row | Row[]): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((entry) => Object.entries(entry));
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const order = compare(a[key], b[key]) * (direction === 'desc' ? -1 : 1);
      if (order !== 0) return order;
    }
    return 0;
  });
}

const DEFAULTS: Record<string, () => Row> = {
  slaTimer: () => ({
    taskId: null,
    pausedAt: null,
    elapsedMs: 0,
    warningsFired: [],
    metAt: null,
    breachedAt: null,
    cycle: 1,
    cycleStartedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  slaPause: () => ({ to: null }),
  ticket: () => ({ createdAt: new Date(), updatedAt: new Date(), dueAt: null, slaPolicyId: null, deletedAt: null }),
};
/** The models whose `updatedAt` Prisma keeps (`@updatedAt`). */
const TRACKED = new Set(['slaTimer', 'ticket']);

function apply(model: string, row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as Row)) {
      row[key] = (row[key] as number) + ((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
  if (TRACKED.has(model) && !('updatedAt' in data)) row.updatedAt = new Date();
}

function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const withIncludes = (row: Row, include?: Row): Row => {
    if (!include) return row;
    const out = { ...row };
    if (include.targets) out.targets = table('slaTarget').filter((target) => target.policyId === row.id);
    if (include.exceptions) out.exceptions = [];
    return out;
  };
  const model = (name: string) => ({
    // Reads return copies, as Prisma's do: a row read before a write keeps
    // what it said when it was read.
    findFirst: async (args: { where?: Row; orderBy?: Row | Row[]; include?: Row } = {}) => {
      const row = sorted(table(name).filter((each) => matches(each, args.where)), args.orderBy)[0];
      return row ? withIncludes({ ...row }, args.include) : null;
    },
    findMany: async (args: { where?: Row; orderBy?: Row | Row[]; include?: Row; take?: number } = {}) =>
      sorted(table(name).filter((each) => matches(each, args.where)), args.orderBy)
        .slice(0, args.take ?? Infinity)
        .map((row) => withIncludes({ ...row }, args.include)),
    count: async (args: { where?: Row } = {}) => table(name).filter((each) => matches(each, args.where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { ...(DEFAULTS[name]?.() ?? {}), ...data };
      table(name).push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} to update`);
      apply(name, row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = table(name).filter((each) => matches(each, where));
      for (const row of rows) apply(name, row, data);
      return { count: rows.length };
    },
  });
  const tx = new Proxy({} as Row, { get: (_, name: string) => model(name) }) as unknown as Tx;
  return { tx, tables, table };
}

// ---------------------------------------------------------------------------
// The tenant: the default P1–P4 policy, a UK office calendar, two teams.
// ---------------------------------------------------------------------------

const TENANT = '0190a000-0000-7000-8000-000000000001';
const POLICY = '0190a000-0000-7000-8000-000000000002';
const OFFICE = '0190a000-0000-7000-8000-000000000003';
const LONDON_24X7 = '0190a000-0000-7000-8000-000000000004';
const DESK = '0190a000-0000-7000-8000-000000000005';
const NETWORK = '0190a000-0000-7000-8000-000000000006';
const REQUESTER = '0190a000-0000-7000-8000-000000000007';
const AGENT = '0190a000-0000-7000-8000-000000000008';
const TICKET = '0190a000-0000-7000-8000-0000000000aa';

const ctx = systemContext(TENANT);

function seedTenant(db: ReturnType<typeof memoryDb>): void {
  db.table('businessCalendar').push(
    { id: OFFICE, timeZone: 'Europe/London', hours: OFFICE_HOURS },
    {
      id: LONDON_24X7,
      timeZone: 'Europe/London',
      hours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ start: '00:00', end: '24:00' }]])),
    },
  );
  db.table('team').push({ id: DESK, calendarId: OFFICE }, { id: NETWORK, calendarId: LONDON_24X7 });
  db.table('slaPolicy').push({
    id: POLICY,
    key: 'default',
    orgId: null,
    status: 'published',
    specificity: 0,
    match: { always: true },
    calendarMode: 'group',
    calendarId: OFFICE,
    version: 1,
  });
  for (const row of DEFAULT_TARGETS) {
    for (const targetType of ['response', 'update', 'resolution'] as const) {
      db.table('slaTarget').push({
        id: `${row.priority}-${targetType}`,
        policyId: POLICY,
        priority: row.priority,
        targetType,
        minutes: row[targetType],
        warningThresholds: [50, 75, 90],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// A ticket's life, run live and replayed.
// ---------------------------------------------------------------------------

type LifeStep = { at: Date; status: string } | { at: Date; reply: string | null };

interface Life {
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  groupId: string;
  createdAt: Date;
  steps: LifeStep[];
  upTo: Date;
}

/** A moment parked far from every fixture: any stamp read from the clock would show it. */
const ELSEWHERE = new Date('2031-06-01T12:00:00.000Z');

function ticketRow(life: Life, status: string): Row {
  return {
    id: TICKET,
    tenantId: TENANT,
    number: 'INC-004101',
    orgId: null,
    type: 'incident',
    priority: life.priority,
    status,
    statusCategory: STATES[status as keyof typeof STATES].category,
    serviceId: null,
    categoryId: null,
    groupId: life.groupId,
    requesterId: REQUESTER,
    sourceChannel: 'email',
    origin: 'native',
    createdAt: life.createdAt,
    updatedAt: life.createdAt,
    resolvedAt: null,
    closedAt: null,
    deletedAt: null,
  };
}

function finalStatus(life: Life): string {
  return [...life.steps].reverse().find((step): step is { at: Date; status: string } => 'status' in step)?.status ?? 'new';
}

async function runSlaHandler(eventType: string, payload: Row): Promise<void> {
  for (const handler of handlersFor(eventType).filter((each) => each.consumer === 'sla')) {
    await handler.handle(ctx, { type: eventType, payload } as never, platform.tx as Tx);
  }
}

/** Runs every tick a never-late scheduler would have run up to `limit`, each at its instant. */
async function tickUntil(db: ReturnType<typeof memoryDb>, limit: Date): Promise<void> {
  for (let guard = 0; guard < 500; guard += 1) {
    const instants = db
      .table('slaTimer')
      .filter((timer) => timer.state === 'running')
      .flatMap((timer) => [timer.dueAt, timer.nextWarningAt])
      .filter((at): at is Date => at instanceof Date && at <= limit);
    if (instants.length === 0) return;
    const next = instants.reduce((min, at) => (at < min ? at : min));
    vi.setSystemTime(next);
    await tickPartition(ctx, partitionFor(TICKET));
  }
  throw new Error('the live tick never settled');
}

async function live(life: Life) {
  const db = memoryDb();
  platform.tx = db.tx;
  seedTenant(db);
  const ticket = ticketRow(life, 'new');
  db.table('ticket').push(ticket);

  vi.setSystemTime(life.createdAt);
  await runSlaHandler('ticket.created', { ticketId: TICKET });

  for (const step of life.steps) {
    await tickUntil(db, step.at);
    vi.setSystemTime(step.at);
    if ('status' in step) {
      ticket.status = step.status;
      ticket.statusCategory = STATES[step.status as keyof typeof STATES].category;
      if (step.status === 'resolved') ticket.resolvedAt = step.at;
      if (step.status === 'closed' || step.status === 'cancelled') ticket.closedAt = step.at;
      await runSlaHandler('ticket.status.changed', { ticketId: TICKET, to: step.status, toCategory: ticket.statusCategory });
    } else {
      await runSlaHandler('ticket.comment.added', { ticketId: TICKET, visibility: 'public', authorId: step.reply });
    }
  }
  await tickUntil(db, life.upTo);
  return db;
}

/** The rows an import leaves for the same life: the final state, the timeline and the replies. */
function imported(life: Life) {
  const db = memoryDb();
  platform.tx = db.tx;
  seedTenant(db);
  const status = finalStatus(life);
  const resolved = [...life.steps].reverse().find((step) => 'status' in step && step.status === 'resolved');
  const closed = life.steps.find((step) => 'status' in step && (step.status === 'closed' || step.status === 'cancelled'));
  const lastTouched = life.steps.reduce((max, step) => (step.at > max ? step.at : max), life.createdAt);
  db.table('ticket').push({
    ...ticketRow(life, status),
    origin: 'import',
    updatedAt: lastTouched,
    resolvedAt: resolved?.at ?? null,
    closedAt: closed?.at ?? null,
  });
  let previous = 'new';
  life.steps.forEach((step, index) => {
    if ('status' in step) {
      db.table('ticketEvent').push({
        id: `e${String(index).padStart(3, '0')}`,
        ticketId: TICKET,
        type: 'status.changed',
        payload: { from: previous, to: step.status },
        occurredAt: step.at,
      });
      previous = step.status;
    } else {
      db.table('ticketComment').push({
        id: `c${String(index).padStart(3, '0')}`,
        ticketId: TICKET,
        visibility: 'public',
        authorId: step.reply,
        createdAt: step.at,
        deletedAt: null,
      });
    }
  });
  return db;
}

async function replayed(life: Life) {
  const db = imported(life);
  vi.setSystemTime(ELSEWHERE);
  const result = await replayTimers(ctx, TICKET, { upTo: life.upTo });
  return { db, result };
}

/** Everything the SLA engine wrote, without the row ids it chose. */
function clocks(db: ReturnType<typeof memoryDb>) {
  const timers = db.table('slaTimer');
  const target = (timerId: unknown) => timers.find((timer) => timer.id === timerId)?.targetType;
  const ticket = db.table('ticket')[0]!;
  return {
    timers: sorted(timers, { targetType: 'asc' }).map((timer) => ({
      targetType: timer.targetType,
      policyId: timer.policyId,
      calendarId: timer.calendarId,
      targetMs: timer.targetMs,
      startedAt: timer.startedAt,
      dueAt: timer.dueAt,
      pausedAt: timer.pausedAt,
      lastResumedAt: timer.lastResumedAt,
      elapsedMs: timer.elapsedMs,
      remainingMs: timer.remainingMs,
      state: timer.state,
      warningsFired: timer.warningsFired,
      nextWarningAt: timer.nextWarningAt,
      metAt: timer.metAt,
      breachedAt: timer.breachedAt,
      cycle: timer.cycle,
      cycleStartedAt: timer.cycleStartedAt,
      partition: timer.partition,
      // Reporting reads a cancelled timer's stop from its last write.
      ...(timer.state === 'cancelled' ? { updatedAt: timer.updatedAt } : {}),
    })),
    pauses: sorted(
      db.table('slaPause').map((pause) => ({ target: target(pause.timerId), reason: pause.reason, from: pause.from, to: pause.to })),
      [{ from: 'asc' }, { target: 'asc' }],
    ),
    breaches: sorted(
      db.table('breachRecord').map((breach) => ({ target: target(breach.timerId), breachedAt: breach.breachedAt })),
      [{ breachedAt: 'asc' }, { target: 'asc' }],
    ),
    ticket: { dueAt: ticket.dueAt, slaPolicyId: ticket.slaPolicyId },
    events: db
      .table('outboxEvent')
      .map((event) => `${String(event.type)}:${String((event.envelope as { payload: { targetType?: string } }).payload.targetType)}`),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Wall-clock UK times, written as UTC instants. */
const at = (iso: string) => new Date(iso);

const FIXTURES: Record<string, Life> = {
  // Answered, put on hold for the requester overnight, picked up, resolved and
  // closed: the resolution clock stops for the wait and its due time moves.
  'a pause, then resolution in time': {
    priority: 'P3',
    groupId: DESK,
    createdAt: at('2026-10-14T08:30:00.000Z'), // Wed 09:30 BST
    steps: [
      { at: at('2026-10-14T09:15:00.000Z'), reply: AGENT },
      { at: at('2026-10-14T10:00:00.000Z'), status: 'in_progress' },
      { at: at('2026-10-14T10:30:00.000Z'), status: 'pending_requester' },
      { at: at('2026-10-15T09:00:00.000Z'), status: 'in_progress' },
      { at: at('2026-10-15T10:00:00.000Z'), reply: AGENT },
      { at: at('2026-10-15T14:00:00.000Z'), status: 'resolved' },
      { at: at('2026-10-19T08:00:00.000Z'), status: 'closed' },
    ],
    upTo: at('2026-10-20T12:00:00.000Z'),
  },
  // A P2 answered quickly, then left: the four-hour update cycle is missed
  // once (one breach record), the next reply carries the cadence on (U5), and
  // at resolution the update verdict stays breached (U6). The eight-hour
  // resolution target breaches too, on Monday evening.
  'update cycles, a missed cycle and a breach': {
    priority: 'P2',
    groupId: DESK,
    createdAt: at('2026-10-12T08:00:00.000Z'), // Mon 09:00 BST
    steps: [
      { at: at('2026-10-12T08:30:00.000Z'), reply: AGENT },
      { at: at('2026-10-12T09:05:00.000Z'), status: 'in_progress' },
      { at: at('2026-10-13T10:00:00.000Z'), reply: AGENT },
      { at: at('2026-10-13T13:00:00.000Z'), reply: AGENT },
      { at: at('2026-10-13T15:00:00.000Z'), status: 'resolved' },
    ],
    upTo: at('2026-10-14T12:00:00.000Z'),
  },
  // Nobody answers a P1 on the network team's round-the-clock London calendar
  // across the night the clocks go back: every target breaches, each at its
  // own due time, after its warnings.
  'a breach of every target across the clocks going back': {
    priority: 'P1',
    groupId: NETWORK,
    createdAt: at('2026-10-24T23:30:00.000Z'), // Sun 00:30 BST
    steps: [],
    upTo: at('2026-10-25T06:00:00.000Z'),
  },
  // Still open at the end, part-way through its clocks: the replay leaves
  // running timers for the live tick to carry on.
  'still running at the end': {
    priority: 'P4',
    groupId: DESK,
    createdAt: at('2026-10-16T14:00:00.000Z'), // Fri 15:00 BST
    steps: [{ at: at('2026-10-19T09:00:00.000Z'), reply: AGENT }],
    upTo: at('2026-10-19T11:00:00.000Z'),
  },
  // Withdrawn while waiting on the requester: every clock is cancelled at that
  // moment, with no verdict.
  'cancelled while waiting': {
    priority: 'P3',
    groupId: DESK,
    createdAt: at('2026-10-14T08:30:00.000Z'),
    steps: [
      { at: at('2026-10-14T11:00:00.000Z'), status: 'pending_requester' },
      { at: at('2026-10-16T10:00:00.000Z'), status: 'cancelled' },
    ],
    upTo: at('2026-10-20T12:00:00.000Z'),
  },
  // Resolved, reopened and resolved again. Live, a reopen restarts nothing (the
  // timers stopped at the first resolution), and the replay keeps that gap.
  // A system acknowledgement meets the response target but is no update, and
  // the requester's own reply is neither.
  'reopened, with a system reply and the requester’s own': {
    priority: 'P3',
    groupId: DESK,
    createdAt: at('2026-10-14T08:30:00.000Z'),
    steps: [
      { at: at('2026-10-14T08:31:00.000Z'), reply: null },
      { at: at('2026-10-14T09:00:00.000Z'), reply: REQUESTER },
      { at: at('2026-10-14T13:00:00.000Z'), status: 'resolved' },
      { at: at('2026-10-15T09:00:00.000Z'), status: 'reopened' },
      { at: at('2026-10-15T10:00:00.000Z'), reply: AGENT },
      { at: at('2026-10-15T12:00:00.000Z'), status: 'resolved' },
    ],
    upTo: at('2026-10-20T12:00:00.000Z'),
  },
};

describe('replayTimers reproduces the live engine', () => {
  for (const [name, life] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const expected = clocks(await live(life));
      const { db, result } = await replayed(life);
      expect(clocks(db)).toEqual(expected);
      // The result names each target's verdict, as the build's check reads it.
      expect(result.timers.map((timer) => timer.targetType)).toEqual(['resolution', 'response', 'update']);
      expect(result.met + result.breached + result.cancelled + result.running).toBe(3);
    });
  }

  it('the fixtures between them cover a pause, an update cycle, a breach, a cancellation and a running clock', async () => {
    const pause = clocks((await replayed(FIXTURES['a pause, then resolution in time']!)).db);
    expect(pause.pauses).toEqual([
      { target: 'resolution', reason: 'pending_requester', from: at('2026-10-14T10:30:00.000Z'), to: at('2026-10-15T09:00:00.000Z') },
      { target: 'update', reason: 'pending_requester', from: at('2026-10-14T10:30:00.000Z'), to: at('2026-10-15T09:00:00.000Z') },
    ]);
    expect(pause.timers.find((timer) => timer.targetType === 'resolution')).toMatchObject({ state: 'met', metAt: at('2026-10-15T14:00:00.000Z') });

    const cycles = await replayed(FIXTURES['update cycles, a missed cycle and a breach']!);
    const update = cycles.result.timers.find((timer) => timer.targetType === 'update')!;
    // Cycle 2 (from Monday 09:30 BST) missed at 13:30; Tuesday's two replies made 3 and 4.
    expect(update).toMatchObject({ verdict: 'breached', cycle: 4, breachedAt: at('2026-10-12T12:30:00.000Z'), metAt: at('2026-10-13T15:00:00.000Z') });
    expect(clocks(cycles.db).breaches).toEqual([
      { target: 'update', breachedAt: at('2026-10-12T12:30:00.000Z') },
      { target: 'resolution', breachedAt: at('2026-10-12T16:00:00.000Z') },
    ]);
    expect(cycles.result).toMatchObject({ met: 1, breached: 2, cancelled: 0, running: 0 });

    const night = await replayed(FIXTURES['a breach of every target across the clocks going back']!);
    expect(night.result).toMatchObject({ breached: 3, running: 0 });
    // 15, 30 and 240 real minutes after 23:30 UTC, through the repeated hour.
    expect(clocks(night.db).breaches).toEqual([
      { target: 'response', breachedAt: at('2026-10-24T23:45:00.000Z') },
      { target: 'update', breachedAt: at('2026-10-25T00:00:00.000Z') },
      { target: 'resolution', breachedAt: at('2026-10-25T03:30:00.000Z') },
    ]);

    const open = await replayed(FIXTURES['still running at the end']!);
    expect(open.result).toMatchObject({ met: 1, running: 2 });

    const cancelled = await replayed(FIXTURES['cancelled while waiting']!);
    expect(cancelled.result).toMatchObject({ cancelled: 2, breached: 1 });
    for (const timer of clocks(cancelled.db).timers.filter((each) => each.state === 'cancelled')) {
      expect(timer.updatedAt).toEqual(at('2026-10-16T10:00:00.000Z'));
    }
  });

  it('reads no clock: nothing it writes is stamped with the present', async () => {
    for (const life of Object.values(FIXTURES)) {
      const { db } = await replayed(life);
      for (const timer of db.table('slaTimer')) {
        for (const key of ['startedAt', 'dueAt', 'pausedAt', 'lastResumedAt', 'metAt', 'breachedAt', 'cycleStartedAt', 'nextWarningAt']) {
          expect(timer[key] === null || (timer[key] as Date) < ELSEWHERE).toBe(true);
        }
      }
      // The ticket's last touch is the history's, not the replay's.
      expect(db.table('ticket')[0]!.updatedAt).toEqual(life.steps.reduce((max, step) => (step.at > max ? step.at : max), life.createdAt));
    }
  });

  it('leaves out history after upTo, and says so', async () => {
    const life = FIXTURES['a pause, then resolution in time']!;
    const { result } = await replayed({ ...life, upTo: at('2026-10-14T12:00:00.000Z') });
    expect(result.steps).toBe(3);
    expect(result.skipped).toBe(4);
    expect(result.timers.find((timer) => timer.targetType === 'resolution')).toMatchObject({ state: 'paused', verdict: 'running' });
  });
});

describe('the replay’s guard', () => {
  const life = FIXTURES['a pause, then resolution in time']!;

  it('refuses a ticket that was not imported', async () => {
    const db = imported(life);
    db.table('ticket')[0]!.origin = 'native';
    await expect(replayTimers(ctx, TICKET, { upTo: life.upTo })).rejects.toMatchObject({ refusal: 'not-imported', status: 409 });
    expect(db.table('slaTimer')).toEqual([]);
  });

  it('refuses a ticket that already has timers, so a replay never runs twice', async () => {
    await replayed(life);
    const error = await replayTimers(ctx, TICKET, { upTo: life.upTo }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReplayRefusedError);
    expect(error).toMatchObject({ refusal: 'has-timers' });
  });

  it('refuses a window that ends before the ticket was raised, and a ticket that is not there', async () => {
    imported(life);
    await expect(replayTimers(ctx, TICKET, { upTo: new Date(life.createdAt.getTime() - 1) })).rejects.toMatchObject({ status: 422 });
    await expect(replayTimers(ctx, '0190a000-0000-7000-8000-0000000000ff', { upTo: life.upTo })).rejects.toMatchObject({ status: 404 });
  });

  it('needs sla.override at tenant scope', async () => {
    imported(life);
    const narrow = systemContext(TENANT, {
      permissions: { has: (_key: string, scope?: string) => scope !== 'any', scopeFor: () => 'team', keys: () => [], isSystem: false },
    });
    await expect(replayTimers(narrow, TICKET, { upTo: life.upTo })).rejects.toMatchObject({ status: 403 });
  });
});

describe('replaySteps', () => {
  const base = { requesterId: REQUESTER, status: 'new', resolvedAt: null, closedAt: null, statusChanges: [], publicComments: [] };

  it('counts a reply as the live handler does: anyone but the requester, a system reply included', () => {
    const steps = replaySteps({
      ...base,
      publicComments: [
        { at: at('2026-10-14T10:00:00.000Z'), authorId: REQUESTER },
        { at: at('2026-10-14T09:00:00.000Z'), authorId: null },
        { at: at('2026-10-14T11:00:00.000Z'), authorId: AGENT },
      ],
    });
    expect(steps).toEqual([
      { kind: 'reply', at: at('2026-10-14T09:00:00.000Z'), authorId: null },
      { kind: 'reply', at: at('2026-10-14T11:00:00.000Z'), authorId: AGENT },
    ]);
  });

  it('treats an authorless reply on a ticket with no requester as the requester’s, as live', () => {
    expect(replaySteps({ ...base, requesterId: null, publicComments: [{ at: at('2026-10-14T09:00:00.000Z'), authorId: null }] })).toEqual([]);
  });

  it('puts a reply before a status change at the same instant', () => {
    const same = at('2026-10-14T12:00:00.000Z');
    expect(
      replaySteps({
        ...base,
        statusChanges: [{ at: same, from: 'in_progress', to: 'resolved' }],
        publicComments: [{ at: same, authorId: AGENT }],
      }).map((step) => step.kind),
    ).toEqual(['reply', 'status']);
  });

  it('gives a migrated ticket with no timeline the steps its columns prove, and invents no others', () => {
    expect(
      replaySteps({
        ...base,
        status: 'closed',
        resolvedAt: at('2026-10-14T12:00:00.000Z'),
        closedAt: at('2026-10-16T12:00:00.000Z'),
      }),
    ).toEqual([
      { kind: 'status', at: at('2026-10-14T12:00:00.000Z'), from: null, to: 'resolved' },
      { kind: 'status', at: at('2026-10-16T12:00:00.000Z'), from: null, to: 'closed' },
    ]);
    expect(replaySteps({ ...base, status: 'cancelled', closedAt: at('2026-10-16T12:00:00.000Z') })).toEqual([
      { kind: 'status', at: at('2026-10-16T12:00:00.000Z'), from: null, to: 'cancelled' },
    ]);
    expect(replaySteps({ ...base, status: 'pending_requester' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Every new clock parameter defaults to today's behaviour: omitted, the
// present; given, that instant.
// ---------------------------------------------------------------------------

describe('the clock parameters default to the present', () => {
  const NOW = at('2026-10-14T08:30:00.000Z');
  const THEN = at('2026-10-14T08:00:00.000Z');
  const life: Life = { priority: 'P3', groupId: DESK, createdAt: THEN, steps: [], upTo: NOW };

  function fresh() {
    const db = memoryDb();
    platform.tx = db.tx;
    seedTenant(db);
    db.table('ticket').push(ticketRow(life, 'in_progress'));
    vi.setSystemTime(NOW);
    return db;
  }

  const stamped = (db: ReturnType<typeof memoryDb>, target: string, key: string) =>
    db.table('slaTimer').find((timer) => timer.targetType === target)?.[key];

  it('startTimersForTicket and matchPolicy', async () => {
    const omitted = fresh();
    await startTimersForTicket(ctx, omitted.tx, TICKET);
    expect(stamped(omitted, 'resolution', 'startedAt')).toEqual(NOW);
    const given = fresh();
    await startTimersForTicket(ctx, given.tx, TICKET, THEN);
    expect(stamped(given, 'resolution', 'startedAt')).toEqual(THEN);

    // A policy that matches on the time sees the clock it was given.
    const timed = fresh();
    timed.table('slaPolicy')[0]!.match = { before: [{ var: 'now' }, '2026-10-14T08:15:00.000Z'] };
    expect(await matchPolicy(timed.tx, ctx, timed.table('ticket')[0] as never, THEN)).not.toBeNull();
    expect(await matchPolicy(timed.tx, ctx, timed.table('ticket')[0] as never)).toBeNull();
  });

  it('pauseTimers, resumeTimers, meetTimer and stopTimers', async () => {
    for (const clock of [undefined, THEN] as const) {
      const db = fresh();
      await startTimersForTicket(ctx, db.tx, TICKET, at('2026-10-14T07:00:00.000Z'));
      const expected = clock ?? NOW;
      await meetTimer(ctx, db.tx, TICKET, 'response', clock);
      expect(stamped(db, 'response', 'metAt')).toEqual(expected);
      await pauseTimers(ctx, db.tx, TICKET, 'pending_requester', clock);
      expect(stamped(db, 'resolution', 'pausedAt')).toEqual(expected);
      expect(db.table('slaPause')[0]!.from).toEqual(expected);
      await resumeTimers(ctx, db.tx, TICKET, clock);
      expect(stamped(db, 'resolution', 'lastResumedAt')).toEqual(expected);
      await stopTimers(ctx, db.tx, TICKET, 'met', clock);
      expect(stamped(db, 'resolution', 'metAt')).toEqual(expected);
    }
  });

  it('a cancellation stamps its own instant only when given one', async () => {
    const omitted = fresh();
    await startTimersForTicket(ctx, omitted.tx, TICKET, THEN);
    await stopTimers(ctx, omitted.tx, TICKET, 'cancelled');
    expect(stamped(omitted, 'resolution', 'updatedAt')).toEqual(NOW);

    const given = fresh();
    await startTimersForTicket(ctx, given.tx, TICKET, THEN);
    await stopTimers(ctx, given.tx, TICKET, 'cancelled', THEN);
    expect(stamped(given, 'resolution', 'updatedAt')).toEqual(THEN);
  });

  it('restartUpdateCycle reads the ticket’s state from the row unless told it', async () => {
    const db = fresh();
    await startTimersForTicket(ctx, db.tx, TICKET, THEN);
    db.table('ticket')[0]!.status = 'resolved';
    // The row says resolved: nothing restarts.
    expect(await restartUpdateCycle(ctx, db.tx, TICKET, NOW)).toBe(false);
    // The replay says the reply found it in progress: the cycle restarts.
    expect(await restartUpdateCycle(ctx, db.tx, TICKET, NOW, { status: 'in_progress' })).toBe(true);
    expect(stamped(db, 'update', 'cycle')).toBe(2);
  });
});

describe('breachDue and the live tick share one body', () => {
  function started(priority: Life['priority'], groupId: string, createdAt: Date) {
    const db = memoryDb();
    platform.tx = db.tx;
    seedTenant(db);
    db.table('ticket').push(ticketRow({ priority, groupId, createdAt, steps: [], upTo: createdAt }, 'new'));
    return db;
  }

  it('the tick stamps what it saw, late as it was, and escalates — as it always has', async () => {
    const db = started('P1', NETWORK, at('2026-10-14T08:00:00.000Z'));
    await startTimersForTicket(ctx, db.tx, TICKET, at('2026-10-14T08:00:00.000Z'));
    db.table('escalationRule').push({ id: 'esc', policyId: POLICY, on: 'breach', step: 1, notify: {}, action: {} });
    const escalations = vi.spyOn(db.table('escalationRule'), 'filter');

    // The response target fell due at 08:15; the tick runs 40 seconds late.
    vi.setSystemTime(at('2026-10-14T08:15:40.000Z'));
    const result = await tickPartition(ctx, partitionFor(TICKET));
    expect(result.breaches).toBeGreaterThanOrEqual(1);
    expect(result.maxLatenessMs).toBe(40_000);
    expect(db.table('breachRecord').find((row) => row.breachedAt)!.breachedAt).toEqual(at('2026-10-14T08:15:40.000Z'));
    expect(escalations).toHaveBeenCalled();
  });

  it('breachDue stamps each deadline at its own instant and escalates nothing', async () => {
    const db = started('P1', NETWORK, at('2026-10-14T08:00:00.000Z'));
    await startTimersForTicket(ctx, db.tx, TICKET, at('2026-10-14T08:00:00.000Z'));
    db.table('escalationRule').push({ id: 'esc', policyId: POLICY, on: 'breach', step: 1, notify: {}, action: {} });
    const escalations = vi.spyOn(db.table('escalationRule'), 'filter');
    vi.setSystemTime(ELSEWHERE);

    const result = await breachDue(ctx, db.tx, TICKET, at('2026-10-14T08:40:00.000Z'));
    // Response (15 min) and update (30 min) breached, each after its 50, 75
    // and 90 % warnings, as live.
    expect(result).toEqual({ breaches: 2, warnings: 6 });
    expect(sorted(db.table('breachRecord'), { breachedAt: 'asc' }).map((row) => row.breachedAt)).toEqual([
      at('2026-10-14T08:15:00.000Z'),
      at('2026-10-14T08:30:00.000Z'),
    ]);
    const response = db.table('slaTimer').find((timer) => timer.targetType === 'response')!;
    expect(response).toMatchObject({ state: 'breached', breachedAt: at('2026-10-14T08:15:00.000Z'), warningsFired: [50, 75, 90] });
    expect(escalations).not.toHaveBeenCalled();
    // Nothing more is due, so a second call does nothing.
    expect(await breachDue(ctx, db.tx, TICKET, at('2026-10-14T08:40:00.000Z'))).toEqual({ breaches: 0, warnings: 0 });
  });

  it('breachDue across the night the clocks go back measures real time', async () => {
    // 01:45 BST: 30 real minutes later is 01:15 GMT, inside the repeated hour.
    const db = started('P1', NETWORK, at('2026-10-25T00:45:00.000Z'));
    await startTimersForTicket(ctx, db.tx, TICKET, at('2026-10-25T00:45:00.000Z'));
    await breachDue(ctx, db.tx, TICKET, at('2026-10-25T01:20:00.000Z'));
    expect(db.table('slaTimer').find((timer) => timer.targetType === 'update')).toMatchObject({
      state: 'breached',
      breachedAt: at('2026-10-25T01:15:00.000Z'),
    });
  });

  it('a later missed update cycle breaches once (U4), in the replay as live', async () => {
    const db = started('P1', NETWORK, at('2026-10-14T08:00:00.000Z'));
    await startTimersForTicket(ctx, db.tx, TICKET, at('2026-10-14T08:00:00.000Z'));
    await breachDue(ctx, db.tx, TICKET, at('2026-10-14T08:31:00.000Z'));
    await restartUpdateCycle(ctx, db.tx, TICKET, at('2026-10-14T08:31:00.000Z'), { status: 'in_progress' });
    await breachDue(ctx, db.tx, TICKET, at('2026-10-14T09:10:00.000Z'));
    const update = db.table('slaTimer').find((timer) => timer.targetType === 'update')!;
    expect(update).toMatchObject({ state: 'breached', breachedAt: at('2026-10-14T08:30:00.000Z'), cycle: 2 });
    expect(db.table('breachRecord').filter((row) => row.timerId === update.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MOD-07: a warning threshold is a share of the target's business-time budget
// (of the current cycle, for an update timer). Before v3 each later threshold
// was scheduled from the instant the previous one fired, against the whole
// target again, so on a clock nobody paused only the 50 % warning ever fired:
// the 75 % one fell at 125 % of the target, after the breach, and escalations
// registered on `warning:75` or `warning:90` never ran.
// ---------------------------------------------------------------------------

describe('warnings fall at their share of the target, before the deadline', () => {
  /** The warnings one target announced, as [threshold, instant], in the order they fired. */
  function warnings(db: ReturnType<typeof memoryDb>, targetType: string) {
    return db
      .table('outboxEvent')
      .map((event) => event.envelope as { type: string; occurredAt: string; payload: { targetType: string; threshold: number } })
      .filter((envelope) => envelope.type === 'sla.timer.warning' && envelope.payload.targetType === targetType)
      .map((envelope) => [envelope.payload.threshold, envelope.occurredAt]);
  }

  it('an uninterrupted clock warns at 50, 75 and 90 per cent of its target, live and replayed', async () => {
    // A P1 nobody answers, on the round-the-clock calendar: response 15 min,
    // update 30, resolution 240.
    const life: Life = { priority: 'P1', groupId: NETWORK, createdAt: at('2026-10-14T08:00:00.000Z'), steps: [], upTo: at('2026-10-14T12:30:00.000Z') };
    const db = await live(life);

    expect(warnings(db, 'response')).toEqual([
      [50, '2026-10-14T08:07:30.000Z'],
      [75, '2026-10-14T08:11:15.000Z'],
      [90, '2026-10-14T08:13:30.000Z'],
    ]);
    expect(warnings(db, 'update')).toEqual([
      [50, '2026-10-14T08:15:00.000Z'],
      [75, '2026-10-14T08:22:30.000Z'],
      [90, '2026-10-14T08:27:00.000Z'],
    ]);
    expect(warnings(db, 'resolution')).toEqual([
      [50, '2026-10-14T10:00:00.000Z'],
      [75, '2026-10-14T11:00:00.000Z'],
      [90, '2026-10-14T11:36:00.000Z'],
    ]);
    // Every warning before its breach, and the breaches where they always were.
    expect(clocks(db).breaches).toEqual([
      { target: 'response', breachedAt: at('2026-10-14T08:15:00.000Z') },
      { target: 'update', breachedAt: at('2026-10-14T08:30:00.000Z') },
      { target: 'resolution', breachedAt: at('2026-10-14T12:00:00.000Z') },
    ]);
    for (const timer of clocks(db).timers) expect(timer.warningsFired).toEqual([50, 75, 90]);

    // The replay shares the body, so it writes the same.
    expect(clocks((await replayed(life)).db)).toEqual(clocks(db));
  });

  it('a clock that waited counts only the business time it ran: the pause moves its warnings, not their share', async () => {
    // A P2 on the round-the-clock calendar (resolution 8 h): one hour used,
    // three hours waiting on the requester, then running again from 12:00.
    const life: Life = {
      priority: 'P2',
      groupId: NETWORK,
      createdAt: at('2026-10-14T08:00:00.000Z'),
      steps: [
        { at: at('2026-10-14T08:10:00.000Z'), reply: AGENT },
        { at: at('2026-10-14T09:00:00.000Z'), status: 'pending_requester' },
        { at: at('2026-10-14T12:00:00.000Z'), status: 'in_progress' },
      ],
      upTo: at('2026-10-14T19:30:00.000Z'),
    };
    const db = await live(life);

    // 240, 360 and 432 of the 480 minutes used: 60 before the pause, the rest after 12:00.
    expect(warnings(db, 'resolution')).toEqual([
      [50, '2026-10-14T15:00:00.000Z'],
      [75, '2026-10-14T17:00:00.000Z'],
      [90, '2026-10-14T18:12:00.000Z'],
    ]);
    // The update cycle the 08:10 reply started (240 min) had used 50 minutes
    // when the ticket began to wait.
    expect(warnings(db, 'update')).toEqual([
      [50, '2026-10-14T13:10:00.000Z'],
      [75, '2026-10-14T14:10:00.000Z'],
      [90, '2026-10-14T14:46:00.000Z'],
    ]);
    expect(clocks(db).breaches).toEqual([
      { target: 'update', breachedAt: at('2026-10-14T15:10:00.000Z') },
      { target: 'resolution', breachedAt: at('2026-10-14T19:00:00.000Z') },
    ]);

    expect(clocks((await replayed(life)).db)).toEqual(clocks(db));
  });

  it('a tick that runs late moves no later warning', async () => {
    const db = memoryDb();
    platform.tx = db.tx;
    seedTenant(db);
    const createdAt = at('2026-10-14T08:00:00.000Z');
    db.table('ticket').push(ticketRow({ priority: 'P1', groupId: NETWORK, createdAt, steps: [], upTo: createdAt }, 'new'));
    await startTimersForTicket(ctx, db.tx, TICKET, createdAt);

    // The response's 50 % warning fell due at 08:07:30; the tick runs 40 s late.
    vi.setSystemTime(at('2026-10-14T08:08:10.000Z'));
    await tickPartition(ctx, partitionFor(TICKET));
    expect(db.table('slaTimer').find((timer) => timer.targetType === 'response')).toMatchObject({
      warningsFired: [50],
      nextWarningAt: at('2026-10-14T08:11:15.000Z'),
    });
  });
});
