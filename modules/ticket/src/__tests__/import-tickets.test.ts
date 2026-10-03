import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContext, systemContext, type Tx } from '@itsm/platform';
import { importLinks, importTicket, importTickets, type ImportTicketInput } from '../service/import-tickets.js';
import * as ticketService from '../service/ticket-service.js';
import { insertTicketEvent } from '../repo/ticket-repo.js';

/**
 * Imports (MOD-24, and the shared demo's history, A4 §2.3), without a
 * database: what each call writes, row by row, against an in-memory stand-in
 * for the transaction. The integration suite (`tests/integration/demo-
 * imports.test.ts`) runs the same calls against PostgreSQL.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, transactions: [] as unknown[] }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>, options: unknown = {}) => {
      platform.transactions.push(options);
      return fn(platform.tx);
    },
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
      return ((condition as { in: unknown[] }).in).some((each) => same(row[key], each));
    }
    return same(row[key], condition);
  });
}

/** The calls an import makes, on arrays. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const counters: Record<string, number> = {};
  const table = (name: string) => (tables[name] ??= []);
  const defaults: Record<string, Row> = { ticket: { version: 1, deletedAt: null }, ticketComment: { deletedAt: null } };
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      const row = { ...defaults[name], ...data };
      table(name).push(row);
      return { ...row };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') {
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (!strings.join('?').includes('ticket_counter')) return [];
          const type = String(values[1]);
          counters[type] = (counters[type] ?? 0) + 1;
          return [{ allocated: counters[type] }];
        };
      }
      return model(name);
    },
  }) as unknown as Tx;
  return { tx, table };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const REQUESTER = '0190a000-0000-7000-8000-000000000007';
const AGENT = '0190a000-0000-7000-8000-000000000008';
const DESK = '0190a000-0000-7000-8000-000000000005';
const JOB = '0190a000-0000-7000-8000-0000000000bb';

const ctx = systemContext(TENANT);
let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  db = memoryDb();
  platform.tx = db.tx;
  platform.transactions = [];
});

const at = (iso: string) => new Date(iso);

/** A request as the demo's history writes one: its own timeline, replies by e-mail, a task. */
function historyTicket(n: number): ImportTicketInput {
  return {
    type: 'request',
    title: `New starter laptop ${n}`,
    status: 'resolved',
    priority: 'P3',
    requesterId: REQUESTER,
    assigneeId: AGENT,
    groupId: DESK,
    externalRef: `demo:g1:t:${String(n).padStart(4, '0')}`,
    sourceChannel: 'email',
    createdById: AGENT,
    createdAt: at('2026-09-01T08:00:00.000Z'),
    resolvedAt: at('2026-09-02T15:00:00.000Z'),
    comments: [
      { body: 'Could you confirm the start date?', authorId: AGENT, createdAt: at('2026-09-01T09:00:00.000Z'), channel: 'email' },
      { body: 'Monday the 7th, thanks.', authorId: REQUESTER, createdAt: at('2026-09-01T10:00:00.000Z'), channel: 'email' },
    ],
    events: [
      { type: 'created', payload: { channel: 'email' }, actorId: REQUESTER, occurredAt: at('2026-09-01T08:00:00.000Z') },
      { type: 'assigned', payload: { assigneeId: AGENT, groupId: DESK, method: 'manual' }, actorId: AGENT, occurredAt: at('2026-09-01T08:05:00.000Z') },
      { type: 'status.changed', payload: { from: 'new', to: 'in_progress' }, actorId: AGENT, occurredAt: at('2026-09-01T08:05:00.000Z') },
      { type: 'status.changed', payload: { from: 'in_progress', to: 'resolved' }, actorId: AGENT, occurredAt: at('2026-09-02T15:00:00.000Z') },
    ],
    tasks: [
      { title: 'Image the laptop', groupId: DESK, createdAt: at('2026-09-01T08:10:00.000Z'), completedAt: at('2026-09-02T11:00:00.000Z') },
      { title: 'Order a docking station', createdAt: at('2026-09-01T08:12:00.000Z') },
    ],
  };
}

/** A MOD-24 row: where the ticket ended, and its comments. Nothing else. */
function migrationTicket(ref = 'INC0012345'): ImportTicketInput {
  return {
    title: 'Outlook keeps asking for my password',
    status: 'closed',
    priority: 'P2',
    requesterId: REQUESTER,
    externalRef: ref,
    createdAt: at('2021-03-01T09:00:00.000Z'),
    resolvedAt: at('2021-03-02T09:00:00.000Z'),
    closedAt: at('2021-03-05T09:00:00.000Z'),
    comments: [{ body: 'Reset the profile.', authorId: AGENT, createdAt: at('2021-03-01T11:00:00.000Z') }],
    importJobId: JOB,
  };
}

describe('importTickets: a chunk of history', () => {
  it('marks every ticket imported, numbers them in order and returns them in the order given', async () => {
    const tickets = await importTickets(ctx, [historyTicket(1), historyTicket(2), historyTicket(3)], { audit: 'batch', label: 'demo g1 tickets 0001-0003' });
    expect(tickets.map((ticket) => ticket.number)).toEqual(['REQ-000001', 'REQ-000002', 'REQ-000003']);
    for (const row of db.table('ticket')) {
      expect(row).toMatchObject({ origin: 'import', sourceChannel: 'email', createdBy: AGENT, createdByType: 'user' });
    }
    // One transaction for the chunk, given the time a chunk needs.
    expect(platform.transactions).toEqual([{ timeout: 18_000 }]);
  });

  it('writes the timeline as it happened, and no `imported` line when it starts with `created`', async () => {
    const [ticket] = await importTickets(ctx, [historyTicket(1)]);
    const timeline = db.table('ticketEvent').filter((event) => event.ticketId === ticket!.id);
    expect(timeline.map((event) => event.type)).toEqual(['created', 'assigned', 'status.changed', 'status.changed']);
    expect(timeline[0]).toMatchObject({ occurredAt: at('2026-09-01T08:00:00.000Z'), actorType: 'user', actorId: REQUESTER });
    expect(timeline[3]).toMatchObject({ payload: { from: 'in_progress', to: 'resolved' }, occurredAt: at('2026-09-02T15:00:00.000Z') });
  });

  it('keeps the `imported` line when the timeline does not start with `created`, or there is none', async () => {
    const midway = { ...historyTicket(1), events: historyTicket(1).events!.slice(1) };
    const [first, second] = await importTickets(ctx, [midway, { ...historyTicket(2), events: [] }]);
    for (const ticket of [first!, second!]) {
      const imported = db.table('ticketEvent').filter((event) => event.ticketId === ticket.id && event.type === 'imported');
      expect(imported).toHaveLength(1);
      // Stamped by the database, as every migration's line always was.
      expect(imported[0]).not.toHaveProperty('occurredAt');
    }
  });

  it('writes the replies with their channel, the tasks with their dates, and the last touch of the history', async () => {
    const [ticket] = await importTickets(ctx, [historyTicket(1)]);
    expect(db.table('ticketComment').map((comment) => comment.channel)).toEqual(['email', 'email']);
    expect(db.table('ticketTask')).toEqual([
      expect.objectContaining({ ticketId: ticket!.id, title: 'Image the laptop', status: 'done', groupId: DESK, createdAt: at('2026-09-01T08:10:00.000Z'), completedAt: at('2026-09-02T11:00:00.000Z'), updatedAt: at('2026-09-02T11:00:00.000Z') }),
      expect.objectContaining({ title: 'Order a docking station', status: 'open', assigneeId: null, completedAt: null, updatedAt: at('2026-09-01T08:12:00.000Z') }),
    ]);
    expect(db.table('ticket')[0]!.updatedAt).toEqual(at('2026-09-02T15:00:00.000Z'));
  });

  it('writes one audit row for a batch, naming every ticket in it, with the reason given', async () => {
    await importTickets(ctx, [{ ...historyTicket(1), importJobId: JOB }, { ...historyTicket(2), importJobId: JOB }], {
      audit: 'batch',
      label: 'demo g1 tickets 0001-0002',
      reason: 'demo.build',
    });
    const audit = db.table('auditEvent');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'ticket.imported.batch',
      targetType: 'import_batch',
      targetId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      reason: 'demo.build',
      after: {
        label: 'demo g1 tickets 0001-0002',
        count: 2,
        first: 'REQ-000001',
        last: 'REQ-000002',
        externalRefs: ['demo:g1:t:0001', 'demo:g1:t:0002'],
        importJobId: JOB,
      },
    });
    // The projections still hear about each ticket.
    expect(db.table('outboxEvent').map((event) => event.type)).toEqual(['ticket.imported', 'ticket.imported']);
  });

  it('takes at most 50 tickets in a batch, so its row can name each one, and at most 200 in all', async () => {
    const chunk = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...migrationTicket(`REF-${from + index}`), comments: [] }));
    await importTickets(ctx, chunk(0, 50), { audit: 'batch' });
    expect((db.table('auditEvent')[0]!.after as { externalRefs: string[] }).externalRefs).toHaveLength(50);
    await expect(importTickets(ctx, chunk(50, 51), { audit: 'batch' })).rejects.toMatchObject({ status: 422 });
    expect(await importTickets(ctx, chunk(50, 200))).toHaveLength(200);
    await expect(importTickets(ctx, chunk(250, 201))).rejects.toThrow();
  });

  it('does nothing for an empty chunk', async () => {
    expect(await importTickets(ctx, [], { audit: 'batch' })).toEqual([]);
    expect(platform.transactions).toEqual([]);
    expect(db.table('auditEvent')).toEqual([]);
  });
});

describe('importTicket is importTickets with one ticket, audited row by row (MOD-24 unchanged)', () => {
  /** Every row the call wrote, with the ids it chose replaced by the order they appeared in. */
  function written() {
    const ids = new Map<unknown, string>();
    const name = (value: unknown) => {
      if (!ids.has(value)) ids.set(value, `#${ids.size}`);
      return ids.get(value)!;
    };
    // The audit chain's hashes and the instants stamped while writing differ
    // run to run whatever the code does.
    const ignored = new Set(['hash', 'prevHash', 'occurredAt', 'correlationId']);
    return Object.fromEntries(
      ['ticket', 'ticketEvent', 'ticketWatcher', 'ticketComment', 'ticketTask', 'auditEvent'].map((model) => [
        model,
        db.table(model).map((row) =>
          Object.fromEntries(
            Object.entries(row)
              .filter(([key]) => !ignored.has(key))
              .map(([key, value]) => [key, (key === 'id' || key.endsWith('Id')) && value != null ? name(value) : value]),
          ),
        ),
      ]),
    );
  }

  it('writes exactly what importTickets writes for that one ticket', async () => {
    await importTicket(ctx, migrationTicket());
    const single = written();
    db = memoryDb();
    platform.tx = db.tx;
    await importTickets(ctx, [migrationTicket()]);
    expect(written()).toEqual(single);
  });

  it('writes what a migration has always written', async () => {
    const ticket = await importTicket(ctx, migrationTicket());
    expect(ticket.number).toBe('INC-000001');
    expect(db.table('ticket')[0]).toMatchObject({
      origin: 'import',
      sourceChannel: 'import',
      status: 'closed',
      statusCategory: 'closed',
      createdBy: null,
      createdByType: 'system',
      // Closed, else resolved, else raised.
      updatedAt: at('2021-03-05T09:00:00.000Z'),
    });
    expect(db.table('ticketEvent')).toEqual([
      expect.objectContaining({ type: 'imported', payload: { number: 'INC-000001', externalRef: 'INC0012345', status: 'closed' }, actorType: 'system' }),
    ]);
    expect(db.table('ticketComment')).toEqual([expect.objectContaining({ channel: 'import', authorType: 'user' })]);
    expect(db.table('ticketWatcher')).toEqual([expect.objectContaining({ userId: REQUESTER, reason: 'requester' })]);
    expect(db.table('auditEvent')).toEqual([
      expect.objectContaining({
        action: 'ticket.imported',
        targetType: 'ticket',
        reason: null,
        after: { number: 'INC-000001', externalRef: 'INC0012345', status: 'closed', priority: 'P2', comments: 1, importJobId: JOB },
      }),
    ]);
    expect(db.table('outboxEvent').map((event) => event.type)).toEqual(['ticket.imported']);
    // One ticket keeps the transaction every other write has.
    expect(platform.transactions).toEqual([{}]);
  });

  it('is what ticketService exposes, so MOD-24 calls the same function', () => {
    expect(ticketService.importTicket).toBe(importTicket);
    expect(ticketService.importTickets).toBe(importTickets);
    expect(ticketService.importLinks).toBe(importLinks);
  });
});

describe('what an import refuses', () => {
  it('a reference already in the tenant, or twice in one chunk', async () => {
    await importTicket(ctx, migrationTicket());
    await expect(importTicket(ctx, migrationTicket())).rejects.toMatchObject({
      status: 409,
      message: 'a ticket with the external reference INC0012345 already exists (INC-000001)',
    });
    await expect(importTickets(ctx, [migrationTicket('A'), migrationTicket('A')])).rejects.toMatchObject({ status: 409 });
  });

  it('an unknown status, as before', async () => {
    await expect(importTicket(ctx, { ...migrationTicket(), status: 'on_hold' })).rejects.toMatchObject({ status: 422, message: 'unknown ticket status: on_hold' });
  });

  it('a history that does not hold together, naming the field', async () => {
    const before = { ...historyTicket(1), events: [{ type: 'created', occurredAt: at('2026-08-31T08:00:00.000Z') }] };
    const backwards = { ...historyTicket(2), events: [historyTicket(2).events![2]!, historyTicket(2).events![0]!] };
    const unknown = { ...historyTicket(3), events: [{ type: 'status.changed', payload: { from: 'new', to: 'parked' }, occurredAt: at('2026-09-01T09:00:00.000Z') }] };
    const task = { ...historyTicket(4), tasks: [{ title: 'Early', createdAt: at('2026-08-01T00:00:00.000Z') }] };

    for (const [input, field] of [
      [before, '0.events.0.occurredAt'],
      [backwards, '0.events.1.occurredAt'],
      [unknown, '0.events.0.payload.to'],
      [task, '0.tasks.0.createdAt'],
    ] as const) {
      const error = await importTickets(ctx, [input]).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ status: 422 });
      expect((error as { fieldErrors: { field: string }[] }).fieldErrors.map((each) => each.field)).toContain(field);
    }
    expect(db.table('ticket')).toEqual([]);
  });

  it('a caller who may not raise tickets for other people', async () => {
    const own = createContext({
      tenantId: TENANT,
      actor: { type: 'user', id: AGENT },
      permissions: { has: (key: string, scope?: string) => key === 'ticket.create' && scope !== 'any', scopeFor: () => 'own', keys: () => ['ticket.create'], isSystem: false },
    });
    await expect(importTickets(own, [historyTicket(1)])).rejects.toMatchObject({ status: 403 });
  });
});

describe('insertTicketEvent', () => {
  it('without options writes what it always has: the caller as actor, the database’s clock', async () => {
    await insertTicketEvent(db.tx, ctx, 'ticket-1', 'assigned', { assigneeId: AGENT });
    expect(db.table('ticketEvent')[0]).toMatchObject({ type: 'assigned', actorType: 'system', actorId: null });
    expect(db.table('ticketEvent')[0]).not.toHaveProperty('occurredAt');
  });

  it('with options writes when it happened and who did it', async () => {
    await insertTicketEvent(db.tx, ctx, 'ticket-1', 'assigned', {}, { occurredAt: at('2026-09-01T08:00:00.000Z'), actor: { type: 'user', id: AGENT } });
    expect(db.table('ticketEvent')[0]).toMatchObject({ occurredAt: at('2026-09-01T08:00:00.000Z'), actorType: 'user', actorId: AGENT });
  });
});

describe('importLinks', () => {
  async function three() {
    return importTickets(ctx, [historyTicket(1), historyTicket(2), historyTicket(3)]);
  }

  it('links both ends as linkTickets does, dated when it happened, with one audit row and no event', async () => {
    const [major, incident, other] = await three();
    db.table('auditEvent').length = 0;
    db.table('outboxEvent').length = 0;
    db.table('ticketEvent').length = 0;

    const result = await importLinks(
      ctx,
      [
        { from: incident!.number, to: major!.number, linkType: 'caused_by', at: at('2026-09-01T12:00:00.000Z') },
        { from: other!.id, to: major!.id, linkType: 'related_to', at: at('2026-09-01T13:00:00.000Z') },
      ],
      { label: 'demo g1 links' },
    );
    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(db.table('ticketLink').map((link) => [link.sourceId, link.targetId, link.linkType, link.createdAt])).toEqual([
      [incident!.id, major!.id, 'caused_by', at('2026-09-01T12:00:00.000Z')],
      [major!.id, incident!.id, 'blocks', at('2026-09-01T12:00:00.000Z')],
      [other!.id, major!.id, 'related_to', at('2026-09-01T13:00:00.000Z')],
      [major!.id, other!.id, 'related_to', at('2026-09-01T13:00:00.000Z')],
    ]);
    expect(db.table('ticketEvent')).toEqual([
      expect.objectContaining({ ticketId: incident!.id, type: 'linked', occurredAt: at('2026-09-01T12:00:00.000Z'), payload: { targetId: major!.id, targetNumber: major!.number, linkType: 'caused_by' } }),
      expect.objectContaining({ ticketId: other!.id, type: 'linked', occurredAt: at('2026-09-01T13:00:00.000Z') }),
    ]);
    expect(db.table('auditEvent')).toEqual([
      expect.objectContaining({ action: 'ticket.links.imported.batch', targetType: 'import_batch', after: expect.objectContaining({ label: 'demo g1 links', count: 2, skipped: 0 }) }),
    ]);
    expect(db.table('outboxEvent')).toEqual([]);

    // Again: nothing new, nothing audited.
    expect(await importLinks(ctx, [{ from: incident!.id, to: major!.id, linkType: 'caused_by', at: at('2026-09-01T12:00:00.000Z') }])).toEqual({ added: 0, skipped: 1 });
    expect(db.table('auditEvent')).toHaveLength(1);
  });

  it('refuses a ticket linked to itself, a ticket that is not there, and a link older than its tickets', async () => {
    const [first, second] = await three();
    await expect(importLinks(ctx, [{ from: first!.id, to: first!.id, linkType: 'related_to', at: at('2026-09-03T00:00:00.000Z') }])).rejects.toMatchObject({ status: 422 });
    await expect(importLinks(ctx, [{ from: first!.id, to: 'REQ-009999', linkType: 'related_to', at: at('2026-09-03T00:00:00.000Z') }])).rejects.toMatchObject({ status: 404 });
    await expect(importLinks(ctx, [{ from: first!.id, to: second!.id, linkType: 'related_to', at: at('2026-08-01T00:00:00.000Z') }])).rejects.toMatchObject({ status: 422 });
  });
});
