import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SYSTEM_PERMISSIONS,
  consumersFor,
  createContext,
  systemContext,
  transaction,
  withContext,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { reindexTenant, searchService } from '@itsm/module-search';
import { outboxPublisher } from '@itsm/module-integrations';
import { replayTimers, ReplayRefusedError } from '../../modules/sla/src/service/replay.js';
import { reprojectFromSource } from '../../modules/analytics/src/service/reproject-service.js';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, settleSearch, type TestTenant } from '../support/harness.js';

/**
 * History imports, the SLA replay and the reprojection (WP-36; A4 §2.3–§2.8),
 * against PostgreSQL.
 *
 * The shared demo's four months of history are written through these calls,
 * and the demo is what prospects judge the product by, so the question this
 * file answers is the one the build depends on: does a tenant whose history
 * was imported, replayed and reprojected read exactly as one whose history
 * happened live? Its last block proves the reprojection half of that: the
 * facts and the rollup the live projection builds from a tenant's events,
 * and the ones `reprojectFromSource` builds from its rows alone, are equal.
 * (The replay half is proved fixture by fixture in the SLA module's own
 * `replay.test.ts`, where the clock can be stood at every instant.)
 */

const SLUG = 'demo-imports';
let tenant: TestTenant;
let ctx: TenantContext;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A Wednesday at least two weeks ago, 10:00 UTC (10:00 or 11:00 in London),
 * so every history below sits in office hours and wholly in the past.
 */
function pastWednesday(): Date {
  const day = new Date(Date.now() - 14 * DAY);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 10));
  while (start.getUTCDay() !== 3) start.setTime(start.getTime() - DAY);
  return start;
}
const BASE = pastWednesday();
const t = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(ctx, () => transaction(ctx, fn));
}

/** Hands every event the tenant's outbox holds to every consumer, oldest first, until none is left. */
async function drainAll(): Promise<number> {
  const context = systemContext(tenant.id, { region: 'eu-west' });
  let cursor: { createdAt: Date; id: string } | undefined;
  let delivered = 0;
  for (;;) {
    const after = cursor;
    const rows = await withContext(context, () =>
      transaction(context, (tx) =>
        tx.outboxEvent.findMany({
          where: after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {},
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 200,
        }),
      ),
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      for (const consumer of consumersFor(row.type)) {
        await outboxPublisher.dispatchToConsumer(consumer, row.envelope as never);
        delivered += 1;
      }
    }
    const last = rows.at(-1)!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  await settleSearch();
  return delivered;
}

function person(key: string): string {
  return tenant.people[key]!.id;
}

function asPerson(key: string): TenantContext {
  return createContext({
    tenantId: tenant.id,
    actor: { type: 'user', id: person(key), displayName: key },
    permissions: SYSTEM_PERMISSIONS,
    organisationIds: [tenant.orgId],
  });
}

/** One imported history, in the shape the demo build writes. */
function history(
  key: string,
  options: {
    priority: 'P1' | 'P2' | 'P3' | 'P4';
    type?: 'incident' | 'request';
    steps: ({ at: number; status: string } | { at: number; reply: 'agent' | 'requester' })[];
  },
) {
  const statuses = options.steps.filter((step): step is { at: number; status: string } => 'status' in step);
  const final = statuses.at(-1)?.status ?? 'new';
  const resolved = [...statuses].reverse().find((step) => step.status === 'resolved');
  const closed = statuses.find((step) => step.status === 'closed' || step.status === 'cancelled');
  let previous = 'new';
  return {
    type: options.type ?? 'incident',
    title: `Imported history ${key}`,
    description: `The ${key} ticket of the import suite.`,
    status: final,
    priority: options.priority,
    requesterId: person('requester'),
    assigneeId: person('agent'),
    groupId: tenant.teamId,
    orgId: tenant.orgId,
    externalRef: `wp36:${key}`,
    sourceChannel: 'email' as const,
    createdById: person('agent'),
    createdAt: t(0),
    resolvedAt: resolved ? t(resolved.at) : null,
    closedAt: closed ? t(closed.at) : null,
    comments: options.steps
      .filter((step): step is { at: number; reply: 'agent' | 'requester' } => 'reply' in step)
      .map((step) => ({ body: `A reply from the ${step.reply}.`, authorId: person(step.reply), createdAt: t(step.at), channel: 'email' as const })),
    events: [
      { type: 'created', payload: { channel: 'email' }, actorId: person('requester'), occurredAt: t(0) },
      ...statuses.map((step) => {
        const event = { type: 'status.changed', payload: { from: previous, to: step.status }, actorId: person('agent'), occurredAt: t(step.at) };
        previous = step.status;
        return event;
      }),
    ],
  };
}

/** The histories, once the tenant they name people of exists. */
const histories = () => ({
  // Answered in five minutes, resolved in thirty: every target met.
  quick: history('quick', {
    priority: 'P3',
    steps: [
      { at: 5 * MINUTE, reply: 'agent' },
      { at: 6 * MINUTE, status: 'in_progress' },
      { at: 30 * MINUTE, status: 'resolved' },
      { at: 3 * DAY, status: 'closed' },
    ],
  }),
  // Waited a day on the requester: paused clocks, then met.
  paused: history('paused', {
    priority: 'P3',
    steps: [
      { at: 10 * MINUTE, reply: 'agent' },
      { at: 60 * MINUTE, status: 'pending_requester' },
      { at: DAY, reply: 'requester' },
      { at: DAY + 5 * MINUTE, status: 'in_progress' },
      { at: DAY + HOUR, status: 'resolved' },
    ],
  }),
  // A critical incident nobody answered for ten hours, on the round-the-clock
  // calendar: every target breached, each at its own due time.
  ignored: history('ignored', {
    priority: 'P1',
    steps: [
      { at: 10 * HOUR, reply: 'agent' },
      { at: 10 * HOUR + MINUTE, status: 'in_progress' },
      { at: 11 * HOUR, status: 'resolved' },
    ],
  }),
  // Withdrawn the next day: the clocks that were running are cancelled.
  withdrawn: history('withdrawn', {
    priority: 'P4',
    type: 'request',
    steps: [
      { at: 20 * MINUTE, reply: 'agent' },
      { at: DAY, status: 'cancelled' },
    ],
  }),
  // Still open: running clocks for the live tick to carry on.
  open: history('open', {
    priority: 'P2',
    steps: [
      { at: 15 * MINUTE, reply: 'agent' },
      { at: 20 * MINUTE, status: 'in_progress' },
    ],
  }),
});

let HISTORIES: ReturnType<typeof histories>;
let imported: Record<keyof typeof HISTORIES, { id: string; number: string }>;

beforeAll(async () => {
  tenant = await createTestTenant(SLUG);
  HISTORIES = histories();
  ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS, organisationIds: [tenant.orgId] });
}, 120_000);

afterAll(async () => {
  await deleteTestTenant(SLUG);
  await closeHarness();
});

describe('importTickets', () => {
  it('imports a chunk in one transaction, marked as imported, with one audit row for it', async () => {
    const keys = Object.keys(HISTORIES) as (keyof typeof HISTORIES)[];
    const tickets = await withContext(ctx, () =>
      ticketService.importTickets(ctx, keys.map((key) => HISTORIES[key]), { audit: 'batch', label: 'wp36 tickets 1-5', reason: 'demo.build' }),
    );
    imported = Object.fromEntries(keys.map((key, index) => [key, { id: tickets[index]!.id, number: tickets[index]!.number }])) as typeof imported;
    const ids = tickets.map((ticket) => ticket.id);

    const rows = await read((tx) => tx.ticket.findMany({ where: { id: { in: ids } } }));
    expect(rows.every((row) => row.origin === 'import' && row.sourceChannel === 'email' && row.createdBy === person('agent'))).toBe(true);

    const audit = await read((tx) => tx.auditEvent.findMany({ where: { OR: [{ targetId: { in: ids } }, { action: 'ticket.imported.batch' }] } }));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'ticket.imported.batch',
      targetType: 'import_batch',
      reason: 'demo.build',
      after: expect.objectContaining({ label: 'wp36 tickets 1-5', count: 5, first: tickets[0]!.number, last: tickets[4]!.number, externalRefs: keys.map((key) => `wp36:${key}`) }),
    });

    // The projections hear about every ticket.
    const announced = await read((tx) => tx.outboxEvent.count({ where: { type: 'ticket.imported', aggregateId: { in: ids } } }));
    expect(announced).toBe(5);
  });

  it('writes the timeline as it happened, and no `imported` line when it starts with `created`', async () => {
    const events = await read((tx) =>
      tx.ticketEvent.findMany({ where: { ticketId: imported.paused.id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
    );
    expect(events.map((event) => event.type)).toEqual(['created', 'status.changed', 'status.changed', 'status.changed']);
    expect(events[0]).toMatchObject({ occurredAt: t(0), actorType: 'user', actorId: person('requester') });
    expect(events[1]).toMatchObject({ occurredAt: t(HOUR), payload: { from: 'new', to: 'pending_requester' } });
    const comments = await read((tx) => tx.ticketComment.findMany({ where: { ticketId: imported.paused.id } }));
    expect(comments.map((comment) => comment.channel)).toEqual(['email', 'email']);
  });

  it('leaves a MOD-24 import as it was: an `imported` line and a row of audit of its own', async () => {
    const ticket = await withContext(ctx, () =>
      ticketService.importTicket(ctx, {
        title: 'Migrated: Outlook keeps asking for my password',
        status: 'closed',
        priority: 'P3',
        requesterId: person('requester'),
        externalRef: 'wp36:INC0012345',
        createdAt: t(-DAY),
        resolvedAt: t(-DAY + HOUR),
        closedAt: t(-DAY + 2 * HOUR),
        comments: [{ body: 'Reset the profile.', authorId: person('agent'), createdAt: t(-DAY + 30 * MINUTE) }],
      }),
    );
    const events = await read((tx) => tx.ticketEvent.findMany({ where: { ticketId: ticket.id } }));
    expect(events.map((event) => event.type)).toEqual(['imported']);
    const audit = await read((tx) => tx.auditEvent.findMany({ where: { targetId: ticket.id } }));
    expect(audit.map((row) => row.action)).toEqual(['ticket.imported']);
    expect(ticket).toMatchObject({ origin: 'import', sourceChannel: 'import' });
  });
});

describe('importLinks', () => {
  it('links imported tickets as they were linked, once', async () => {
    const at = t(2 * HOUR);
    const first = await withContext(ctx, () =>
      ticketService.importLinks(ctx, [{ from: imported.ignored.number, to: imported.open.number, linkType: 'related_to', at }], { label: 'wp36 links' }),
    );
    expect(first).toEqual({ added: 1, skipped: 0 });
    const links = await read((tx) => tx.ticketLink.findMany({ where: { OR: [{ sourceId: imported.ignored.id }, { targetId: imported.ignored.id }] } }));
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.createdAt.getTime() === at.getTime())).toBe(true);
    const linked = await read((tx) => tx.ticketEvent.findFirst({ where: { ticketId: imported.ignored.id, type: 'linked' } }));
    expect(linked!.occurredAt).toEqual(at);

    const again = await withContext(ctx, () =>
      ticketService.importLinks(ctx, [{ from: imported.ignored.id, to: imported.open.id, linkType: 'related_to', at }]),
    );
    expect(again).toEqual({ added: 0, skipped: 1 });
  });
});

describe('replayTimers', () => {
  const upTo = () => new Date(Date.now() - MINUTE);

  it('rebuilds each imported ticket’s clocks from its own history', async () => {
    const results = Object.fromEntries(
      await Promise.all(
        (Object.keys(HISTORIES) as (keyof typeof HISTORIES)[]).map(async (key) => [key, await withContext(ctx, () => replayTimers(ctx, imported[key].id, { upTo: upTo() }))] as const),
      ),
    );
    expect(results.quick).toMatchObject({ met: 3, breached: 0, cancelled: 0, running: 0 });
    expect(results.paused).toMatchObject({ met: 3, breached: 0 });
    expect(results.ignored).toMatchObject({ breached: 3, met: 0 });
    expect(results.withdrawn!.timers.filter((timer) => timer.targetType !== 'response').map((timer) => timer.verdict)).toEqual(['cancelled', 'cancelled']);
    expect(results.open!.timers.find((timer) => timer.targetType === 'response')!.verdict).toBe('met');
  });

  it('dates every breach at its deadline, records the wait and keeps the ticket’s last touch', async () => {
    const timers = await read((tx) => tx.slaTimer.findMany({ where: { ticketId: imported.ignored.id } }));
    const breaches = await read((tx) => tx.breachRecord.findMany({ where: { ticketId: imported.ignored.id } }));
    // 15, 30 and 240 minutes after it was raised, on the round-the-clock
    // calendar: each at its deadline, not when the replay ran.
    expect(breaches.map((breach) => (breach.breachedAt.getTime() - BASE.getTime()) / MINUTE).sort((a, b) => a - b)).toEqual([15, 30, 240]);
    for (const timer of timers) {
      expect(breaches.find((breach) => breach.timerId === timer.id)!.breachedAt).toEqual(timer.breachedAt);
      // The late reply started the update promise's second cycle, so its
      // deadline moved on; the other two still show the deadline they missed.
      if (timer.targetType !== 'update') expect(timer.breachedAt).toEqual(timer.dueAt);
    }
    // That second cycle was missed too, half an hour before the resolution:
    // breached once (one record, U4), and not stopped as met.
    expect(timers.find((timer) => timer.targetType === 'update')).toMatchObject({ state: 'breached', cycle: 2, metAt: null, dueAt: t(10 * HOUR + 30 * MINUTE) });

    const pauses = await read((tx) => tx.slaPause.findMany({ where: { timer: { ticketId: imported.paused.id } } }));
    expect(pauses.map((pause) => [pause.reason, pause.from, pause.to])).toEqual([
      ['pending_requester', t(HOUR), t(DAY + 5 * MINUTE)],
      ['pending_requester', t(HOUR), t(DAY + 5 * MINUTE)],
    ]);

    const ticket = await read((tx) => tx.ticket.findFirst({ where: { id: imported.paused.id } }));
    expect(ticket!.updatedAt).toEqual(t(DAY + HOUR));
  });

  it('refuses a ticket that was raised here, and a second replay', async () => {
    await expect(withContext(ctx, () => replayTimers(ctx, tenant.ticketIds[0]!, { upTo: upTo() }))).rejects.toMatchObject({ refusal: 'not-imported' });
    const error = await withContext(ctx, () => replayTimers(ctx, imported.quick.id, { upTo: upTo() })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReplayRefusedError);
    expect(error).toMatchObject({ refusal: 'has-timers', status: 409 });
  });
});

// ---------------------------------------------------------------------------
// The reprojection equals the live projection.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function without(row: Row, keys: string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

/**
 * Every fact and rollup row of the tenant, less what records *when* it was
 * projected rather than what it says: row ids, the row's own `updatedAt`, the
 * event a fact last saw, and a still-running timer's minutes so far, which
 * live and here are measured to the moment of projection. The rollup's zero rows are left out: the live
 * path can leave a row every counter of which went back to nought, and a
 * rebuild writes none.
 */
async function projection() {
  const bookkeeping = ['id', 'updatedAt', 'lastEventId', 'lastEventAt'];
  return read(async (tx) => ({
    tickets: (await tx.factTicket.findMany({ orderBy: { ticketId: 'asc' } })).map((row) => without(row, bookkeeping)),
    timers: (await tx.factSlaTimer.findMany({ orderBy: { timerId: 'asc' } })).map((row) =>
      without(row, row.outcome === 'running' ? [...bookkeeping, 'businessMinutes', 'pausedMinutes'] : bookkeeping),
    ),
    tasks: (await tx.factTask.findMany({ orderBy: { taskId: 'asc' } })).map((row) => without(row, bookkeeping)),
    approvals: (await tx.factApproval.findMany({ orderBy: { requestId: 'asc' } })).map((row) => without(row, bookkeeping)),
    surveys: (await tx.factSurvey.findMany({ orderBy: { responseId: 'asc' } })).map((row) => without(row, bookkeeping)),
    time: (await tx.factTimeEntry.findMany({ orderBy: { entryId: 'asc' } })).map((row) => without(row, bookkeeping)),
    notifications: (await tx.factNotification.findMany({ orderBy: { notificationId: 'asc' } })).map((row) => without(row, bookkeeping)),
    rollup: (await tx.rollupTicketDaily.findMany({ orderBy: [{ date: 'asc' }, { groupingKey: 'asc' }] }))
      .map((row) => without(row, ['id', 'updatedAt', 'rebuiltAt']))
      .filter((row) =>
        ['created', 'resolved', 'closed', 'reopened', 'breached', 'resolveMinutesSum', 'resolveMinutesCount', 'firstResponseMinutesSum', 'firstResponseMinutesCount'].some(
          (key) => row[key] !== 0,
        ),
      ),
  }));
}

describe('reprojectFromSource', () => {
  it('builds from the rows alone the facts and rollup the live projection built from the events', async () => {
    // Some work done live as well, so both kinds of history are in the window.
    const agent = asPerson('agent');
    const live = await withContext(agent, () =>
      ticketService.createTicket(agent, {
        type: 'incident',
        title: 'Live: the VPN drops every hour',
        priority: 'P2',
        requesterId: person('requester'),
        groupId: tenant.teamId,
        orgId: tenant.orgId,
        sourceChannel: 'email',
      }),
    );
    await withContext(agent, () => ticketService.transitionTicket(agent, live.id, 'in_progress'));
    await withContext(agent, () => ticketService.addComment(agent, live.id, { body: 'Looking at the concentrator logs now.', visibility: 'public' }));
    const task = await withContext(agent, () => ticketService.createTask(agent, live.id, { title: 'Collect the client logs', groupId: tenant.teamId }));
    await withContext(agent, () => ticketService.completeTask(agent, task.id));
    await withContext(agent, () => ticketService.transitionTicket(agent, live.id, 'resolved'));

    expect(await drainAll()).toBeGreaterThan(0);
    const expected = await projection();
    expect(expected.tickets.length).toBeGreaterThanOrEqual(10);
    expect(expected.timers.filter((row) => row.outcome === 'breached').length).toBeGreaterThanOrEqual(3);
    expect(expected.timers.some((row) => row.outcome === 'cancelled')).toBe(true);
    expect(expected.tickets.some((row) => row.breached === true)).toBe(true);
    expect(expected.tasks).toHaveLength(1);
    expect(expected.rollup.length).toBeGreaterThan(0);

    await read(async (tx) => {
      for (const model of ['factTicket', 'factSlaTimer', 'factTask', 'factApproval', 'factSurvey', 'factTimeEntry', 'factNotification', 'rollupTicketDaily'] as const) {
        await (tx[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({});
      }
    });
    expect((await projection()).tickets).toEqual([]);

    const result = await withContext(ctx, () =>
      reprojectFromSource(ctx, { from: new Date(BASE.getTime() - 2 * DAY), to: new Date(Date.now() + DAY), batch: 3, parallelism: 2 }),
    );
    expect(result.tickets).toBe(expected.tickets.length);
    expect(result.timers).toBe(expected.timers.length);
    expect(result.rollupDays).toBeGreaterThan(14);

    expect(await projection()).toEqual(expected);
  }, 180_000);

  it('projects what only the rows record: the tasks an import brought', async () => {
    // An import announces the ticket and nothing else (ADR-0036), so no live
    // projector ever hears of its tasks; the reprojection reads them.
    const [ticket] = await withContext(ctx, () =>
      ticketService.importTickets(ctx, [
        { ...HISTORIES.quick, externalRef: 'wp36:tasks', tasks: [{ title: 'Image the laptop', createdAt: t(MINUTE), completedAt: t(20 * MINUTE) }] },
      ]),
    );
    const result = await withContext(ctx, () => reprojectFromSource(ctx, { from: t(0), to: t(DAY), sources: ['tasks'] }));
    expect(result).toMatchObject({ tasks: 1, tickets: 0, rollupDays: 0 });
    const fact = await read((tx) => tx.factTask.findFirst({ where: { ticketId: ticket!.id } }));
    // No team, so round the clock: nineteen minutes.
    expect(fact).toMatchObject({ createdAt: t(MINUTE), completedAt: t(20 * MINUTE), completionMinutes: 19 });
  });
});

describe('search', () => {
  it('reprojectTickets writes the documents the handler wrote, and reindexTenant pushes them', async () => {
    // Not `sourceUpdatedAt`: the SLA engine's handlers write the ticket row
    // during the same drain, so whether the search handler saw that write
    // depends on which consumer ran first. The rebuild reads the row as it
    // ends, which the last check below holds it to.
    const select = { entityType: true, entityId: true, title: true, bodyText: true, orgId: true, acl: true, facets: true } as const;
    await drainAll();
    const byHandler = await read((tx) => tx.searchDocument.findMany({ where: { entityType: 'ticket' }, orderBy: { entityId: 'asc' }, select }));
    const tickets = await read((tx) => tx.ticket.count({ where: { deletedAt: null } }));
    expect(byHandler).toHaveLength(tickets);

    await read((tx) => tx.searchDocument.deleteMany({ where: { entityType: 'ticket' } }));
    const before = await read((tx) => tx.outboxEvent.count({}));
    expect(await withContext(ctx, () => searchService.reprojectTickets(ctx, { batch: 4 }))).toBe(tickets);
    expect(await read((tx) => tx.searchDocument.findMany({ where: { entityType: 'ticket' }, orderBy: { entityId: 'asc' }, select }))).toEqual(byHandler);
    const stamps = await read((tx) => tx.searchDocument.findMany({ where: { entityType: 'ticket' }, select: { entityId: true, sourceUpdatedAt: true } }));
    const rows = await read((tx) => tx.ticket.findMany({ where: { deletedAt: null }, select: { id: true, updatedAt: true } }));
    for (const stamp of stamps) expect(stamp.sourceUpdatedAt).toEqual(rows.find((row) => row.id === stamp.entityId)!.updatedAt);
    // The rebuild announces nothing per document; the bulk push is the caller's.
    expect(await read((tx) => tx.outboxEvent.count({}))).toBe(before);

    const pushed = await withContext(ctx, () => reindexTenant(ctx, 'ticket'));
    expect(pushed).toBe(process.env.MEILISEARCH_URL ? tickets : 0);
  });
});
