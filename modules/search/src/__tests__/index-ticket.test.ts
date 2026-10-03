import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlersFor, systemContext, type TenantContext, type Tx } from '@itsm/platform';
import { aclForTicket, indexDocument, indexTicket, reprojectTickets } from '../service/search-service.js';
import '../handlers/index.js';

/**
 * Indexing a ticket (A4 §2.8). The body of the search handler moved into the
 * service as `indexTicket`, so the handler and the bulk rebuild
 * (`reprojectTickets`) write the same document. What this pins is that the
 * move changed nothing the handler does: the reference below is the handler's
 * body as it stood, and the handler must write exactly what it wrote.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, transactions: 0 }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      platform.transactions += 1;
      return fn(platform.tx);
    },
  };
});

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === 'object' && 'gt' in (condition as Row)) {
      return String(row[key]) > String((condition as { gt: unknown }).gt);
    }
    return (row[key] ?? null) === condition;
  });
}

function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) =>
      table(name)
        .filter((each) => matches(each, where))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(0, take ?? Infinity)
        .map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      table(name).push({ ...data });
      return { ...data };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = table(name).find((each) => matches(each, where))!;
      Object.assign(row, data);
      return { ...row };
    },
  });
  const tx = new Proxy({} as Row, { get: (_, name: string) => model(name) }) as unknown as Tx;
  return { tx, table };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const REQUESTER = '0190a000-0000-7000-8000-000000000007';
const AGENT = '0190a000-0000-7000-8000-000000000008';
const WATCHER = '0190a000-0000-7000-8000-000000000009';
const DESK = '0190a000-0000-7000-8000-000000000005';
const ORG = '0190a000-0000-7000-8000-000000000010';

const ctx = systemContext(TENANT);
let db: ReturnType<typeof memoryDb>;

function ticket(n: number, extra: Row = {}): Row {
  return {
    id: `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    tenantId: TENANT,
    number: `INC-${String(4100 + n).padStart(6, '0')}`,
    title: `Printer on the third floor ${n}`,
    description: n % 2 ? 'Jams on every second page.' : null,
    orgId: ORG,
    type: 'incident',
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    requesterId: REQUESTER,
    affectedUserId: REQUESTER,
    assigneeId: AGENT,
    groupId: DESK,
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    deletedAt: null,
    ...extra,
  };
}

beforeEach(() => {
  db = memoryDb();
  platform.tx = db.tx;
  platform.transactions = 0;
});

/** The search handler's body before it moved into the service, verbatim. */
async function referenceHandler(context: TenantContext, tx: Tx, ticketId: string): Promise<void> {
  const ticket = (await tx.ticket.findFirst({ where: { id: ticketId, deletedAt: null } })) as Row & Parameters<typeof aclForTicket>[0] | null;
  if (!ticket) return;

  const watchers = await tx.ticketWatcher.findMany({ where: { ticketId } });
  await indexDocument(tx, context, {
    entityType: 'ticket',
    entityId: ticket.id as string,
    title: `${ticket.number as string} ${ticket.title as string}`,
    bodyText: [ticket.title as string, (ticket.description as string | null) ?? ''].join('\n'),
    orgId: ticket.orgId,
    acl: aclForTicket(ticket, watchers.map((w) => w.userId)),
    facets: {
      type: ticket.type as string,
      status: ticket.status as string,
      statusCategory: ticket.statusCategory as string,
      priority: ticket.priority as string,
      number: ticket.number as string,
    },
    sourceUpdatedAt: ticket.updatedAt as Date,
  });
}

/** What was written, without the row ids and event envelopes each run chooses. */
function written() {
  return {
    documents: db.table('searchDocument').map(({ id: _id, ...rest }) => rest),
    events: db.table('outboxEvent').map((event) => ({ type: event.type, aggregateId: event.aggregateId })),
  };
}

function seed(...rows: Row[]) {
  for (const row of rows) db.table('ticket').push(row);
  db.table('ticketWatcher').push({ id: 'w1', ticketId: rows[0]!.id, userId: WATCHER });
}

describe('the search handler, after the move', () => {
  for (const eventType of ['ticket.created', 'ticket.imported', 'ticket.updated', 'ticket.status.changed']) {
    it(`writes for ${eventType} exactly what it wrote before`, async () => {
      const subject = ticket(1);
      seed(subject);
      await referenceHandler(ctx, db.tx, subject.id as string);
      // And once more over the document now there: the update path.
      db.table('ticket')[0]!.status = 'resolved';
      await referenceHandler(ctx, db.tx, subject.id as string);
      const expected = written();

      db = memoryDb();
      platform.tx = db.tx;
      seed(ticket(1));
      const [handler] = handlersFor(eventType).filter((each) => each.consumer === 'search');
      await handler!.handle(ctx, { type: eventType, payload: { ticketId: subject.id } } as never, db.tx);
      db.table('ticket')[0]!.status = 'resolved';
      await handler!.handle(ctx, { type: eventType, payload: { ticketId: subject.id } } as never, db.tx);

      expect(written()).toEqual(expected);
      expect(expected.documents).toEqual([
        expect.objectContaining({
          entityType: 'ticket',
          title: 'INC-004101 Printer on the third floor 1',
          bodyText: 'Printer on the third floor 1\nJams on every second page.',
          facets: expect.objectContaining({ status: 'resolved', number: 'INC-004101' }),
          acl: expect.objectContaining({ userIds: [REQUESTER, AGENT, WATCHER], teamIds: [DESK], everyone: false }),
        }),
      ]);
      expect(expected.events).toEqual([
        { type: 'search.document.indexed', aggregateId: subject.id },
        { type: 'search.document.indexed', aggregateId: subject.id },
      ]);
    });
  }
});

describe('indexTicket', () => {
  it('announces the document by default, as the handler always has', async () => {
    seed(ticket(1));
    expect(await indexTicket(db.tx, ctx, ticket(1).id as string)).toBe(true);
    expect(written().events).toHaveLength(1);
  });

  it('writes the document without the event when told not to announce it', async () => {
    seed(ticket(1));
    expect(await indexTicket(db.tx, ctx, ticket(1).id as string, { announce: false })).toBe(true);
    expect(written().documents).toHaveLength(1);
    expect(written().events).toEqual([]);
  });

  it('writes nothing for a ticket that was deleted or is not there', async () => {
    seed(ticket(1, { deletedAt: new Date('2026-09-02T00:00:00.000Z') }));
    expect(await indexTicket(db.tx, ctx, ticket(1).id as string)).toBe(false);
    expect(await indexTicket(db.tx, ctx, ticket(9).id as string)).toBe(false);
    expect(written()).toEqual({ documents: [], events: [] });
  });
});

describe('reprojectTickets', () => {
  it('indexes every ticket that is not deleted, a batch to a transaction, announcing nothing', async () => {
    seed(...[1, 2, 3, 4, 5].map((n) => ticket(n)), ticket(6, { deletedAt: new Date('2026-09-02T00:00:00.000Z') }));
    expect(await reprojectTickets(ctx, { batch: 2 })).toBe(5);
    expect(written().documents.map((document) => document.title)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `INC-${String(4100 + n).padStart(6, '0')} Printer on the third floor ${n}`),
    );
    expect(written().events).toEqual([]);
    // 2 + 2 + 1: the short page ends the walk.
    expect(platform.transactions).toBe(3);
  });

  it('writes the document the handler writes', async () => {
    seed(ticket(1));
    await reprojectTickets(ctx);
    const rebuilt = written().documents;
    db = memoryDb();
    platform.tx = db.tx;
    seed(ticket(1));
    await referenceHandler(ctx, db.tx, ticket(1).id as string);
    expect(written().documents).toEqual(rebuilt);
  });

  it('indexDocument still announces unless told otherwise', async () => {
    const input = {
      entityType: 'article',
      entityId: '0190a000-0000-7000-8000-0000000000a1',
      title: 'Reset your password',
      bodyText: 'Use the self-service page.',
      orgId: null,
      acl: { userIds: [], teamIds: [], orgId: null, tenantWide: true, everyone: true },
      facets: {},
      sourceUpdatedAt: new Date('2026-09-01T10:00:00.000Z'),
    };
    await indexDocument(db.tx, ctx, input);
    await indexDocument(db.tx, ctx, input, { announce: false });
    expect(written().events).toHaveLength(1);
  });
});
