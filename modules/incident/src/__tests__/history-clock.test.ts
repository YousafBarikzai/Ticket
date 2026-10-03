import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { declare, postUpdate, setRoles, transition } from '../service/major-incident-service.js';
import { addAction, publishAndClose, saveReview, updateAction } from '../service/review-service.js';

/**
 * The major incident history clock (A4 §2.3, WP-43b): `declare`, `postUpdate`,
 * `transition` and `setRoles` take `{ at }`, and so do the review's
 * `saveReview`, `addAction`, `updateAction` and `publishAndClose`. The shared
 * demo writes three past incidents and the live one's first hour after the
 * fact, and the timeline is append-only: an entry dated wrongly at insert can
 * never be put right.
 *
 * The first block pins the other half of the promise: a caller that passes
 * no clock writes exactly the rows a live incident always wrote. The clock is
 * frozen, so "the present" is one known instant, and a column the database
 * dates by itself is a key absent from the write.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, numbers: 0 }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
    // No Redis here: every setting reads as unset, so the module's defaults apply.
    getSetting: async () => undefined,
    nextNumber: async (_tx: unknown, _ctx: unknown, _type: string, prefix: string, width = 6) => {
      platform.numbers += 1;
      return `${prefix}-${String(platform.numbers).padStart(width, '0')}`;
    },
  };
});

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

function satisfies(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return same(value, condition);
  return Object.entries(condition as Row).every(([op, arg]) => {
    if (op === 'in') return (arg as unknown[]).some((each) => same(value, each));
    if (op === 'notIn') return !(arg as unknown[]).some((each) => same(value, each));
    throw new Error(`the stand-in does not know the operator ${op}`);
  });
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => satisfies(row[key], condition));
}

function ordered(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [key, direction] = Object.entries(orderBy)[0]!;
  return [...rows].sort((a, b) => (direction === 'desc' ? -1 : 1) * compare(a[key], b[key]));
}

/** The calls the incident services make, on arrays, with every write kept as it was asked for. */
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
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => {
      const row = ordered(table(name).filter((each) => matches(each, where)), orderBy)[0];
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) =>
      ordered(table(name).filter((each) => matches(each, where)), orderBy).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      // What the database fills in when the write leaves it out.
      const row = { occurredAt: STAMPED, createdAt: STAMPED, updatedAt: STAMPED, ...data };
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
const COMMANDER = '0190a000-0000-7000-8000-000000000002';
const SCRIBE = '0190a000-0000-7000-8000-000000000003';
const TICKET = '0190a000-0000-7000-8000-0000000000a1';

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
/** What the database stamps on a column the write leaves out: a marker, so nobody mistakes it for a clock. */
const STAMPED = new Date('2000-01-01T00:00:00.000Z');
const RAISED = new Date('2026-08-02T08:50:00.000Z');
const DECLARED = new Date('2026-08-02T09:10:00.000Z');
const UPDATED = new Date('2026-08-02T09:25:00.000Z');
const IDENTIFIED = new Date('2026-08-02T09:40:00.000Z');
const HANDED = new Date('2026-08-02T09:45:00.000Z');
const RESOLVED = new Date('2026-08-02T10:00:00.000Z');
const REVIEWED = new Date('2026-08-04T14:00:00.000Z');
const AGREED = new Date('2026-08-04T14:30:00.000Z');
const DONE = new Date('2026-08-20T11:00:00.000Z');
const PUBLISHED = new Date('2026-08-05T16:00:00.000Z');

const ctx: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'user', id: COMMANDER, displayName: 'Daniel Hughes' },
  permissions: SYSTEM_PERMISSIONS,
});

let db: ReturnType<typeof memoryDb>;

const declaration = { title: 'Salesforce SSO failing', severity: 'SEV2' as const, commanderId: COMMANDER, ticketId: TICKET };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  platform.numbers = 0;
  db.table('ticket').push({ id: TICKET, tenantId: TENANT, number: 'INC-004501', createdAt: RAISED });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A whole incident, run once with every step at its own instant and once without a clock. */
async function runIncident(clocked: boolean) {
  const at = (instant: Date) => (clocked ? { at: instant } : {});
  const incident = await declare(ctx, declaration, at(DECLARED));
  await postUpdate(ctx, incident.number, { kind: 'comms', audience: 'stakeholders', body: 'Users cannot sign in to Salesforce.' }, at(UPDATED));
  await transition(ctx, incident.number, { to: 'identified', note: 'An expired SAML certificate.' }, at(IDENTIFIED));
  await setRoles(ctx, incident.number, { scribeId: SCRIBE }, at(HANDED));
  await transition(ctx, incident.number, { to: 'resolved', note: 'Certificate renewed; sign-in restored.' }, at(RESOLVED));
  await saveReview(ctx, incident.number, { summary: 'The SAML certificate expired unnoticed.' }, at(REVIEWED));
  const action = await addAction(ctx, incident.number, { description: 'Monitor certificate expiry', ownerId: SCRIBE }, at(AGREED));
  await publishAndClose(ctx, incident.number, at(PUBLISHED));
  await updateAction(ctx, action.id, { status: 'done' }, at(DONE));
  return incident;
}

describe('without a clock, every write is today’s', () => {
  it('declares now and leaves the timeline and the row to the database clock', async () => {
    await declare(ctx, declaration);
    const [row] = db.written('majorIncident', 'create');
    expect(row).toMatchObject({ declaredAt: NOW, nextUpdateDueAt: new Date(NOW.getTime() + 60 * MINUTE) });
    expect(row).not.toHaveProperty('updatedAt');
    const [entry] = db.written('majorIncidentUpdate', 'create');
    expect(entry).toMatchObject({ statusTo: 'declared', authorId: COMMANDER });
    expect(entry).not.toHaveProperty('occurredAt');
  });

  it('stamps every later step at the present, exactly as before', async () => {
    await runIncident(false);
    for (const entry of db.written('majorIncidentUpdate', 'create')) expect(entry).not.toHaveProperty('occurredAt');
    for (const write of db.written('majorIncident', 'update')) expect(write).not.toHaveProperty('updatedAt');

    const updates = db.written('majorIncident', 'update');
    expect(updates[0]).toEqual({ nextUpdateDueAt: new Date(NOW.getTime() + 60 * MINUTE) });
    expect(updates[1]).toMatchObject({ status: 'identified', identifiedAt: NOW, nextUpdateDueAt: new Date(NOW.getTime() + 60 * MINUTE) });
    expect(updates[3]).toMatchObject({ status: 'resolved', resolvedAt: NOW, nextUpdateDueAt: null });
    expect(updates[4]).toMatchObject({ status: 'closed', closedAt: NOW });

    const [review] = db.written('postIncidentReview', 'create');
    expect(review).toMatchObject({ status: 'draft', dueOn: new Date(NOW.getTime() + 5 * DAY) });
    expect(review).not.toHaveProperty('createdAt');
    const reviewUpdates = db.written('postIncidentReview', 'update');
    expect(reviewUpdates.at(-1)).toMatchObject({ status: 'published', publishedAt: NOW, publishedBy: COMMANDER });
    for (const write of reviewUpdates) expect(write).not.toHaveProperty('updatedAt');

    const [action] = db.written('actionItem', 'create');
    expect(action).not.toHaveProperty('createdAt');
    expect(db.written('actionItem', 'update')[0]).toEqual({ status: 'done' });
  });

  it('measures the duration from the declaration to now', async () => {
    const incident = await declare(ctx, declaration);
    vi.setSystemTime(new Date(NOW.getTime() + 50 * MINUTE));
    await transition(ctx, incident.number, { to: 'resolved', note: 'Restored.' });
    expect(db.written('postIncidentReview', 'create')[0]).toMatchObject({ durationMinutes: 50 });
  });
});

describe('with a clock, every step is dated when it happened', () => {
  it('declares at the instant, with the first update owed one interval later', async () => {
    const incident = await declare(ctx, { ...declaration, updateIntervalMinutes: 60 }, { at: DECLARED });
    expect(incident).toMatchObject({ declaredAt: DECLARED, updatedAt: DECLARED, nextUpdateDueAt: new Date(DECLARED.getTime() + 60 * MINUTE) });
    expect(db.written('majorIncidentUpdate', 'create')[0]).toMatchObject({ statusTo: 'declared', occurredAt: DECLARED });
  });

  it('dates each timeline entry at insert, and moves the promise from the update that kept it', async () => {
    await runIncident(true);
    const timeline = db.table('majorIncidentUpdate').map((entry) => [entry.statusTo ?? entry.kind, entry.occurredAt]);
    expect(timeline).toEqual([
      ['declared', DECLARED],
      ['comms', UPDATED],
      ['identified', IDENTIFIED],
      ['action', HANDED],
      ['resolved', RESOLVED],
      ['closed', PUBLISHED],
    ]);

    const updates = db.written('majorIncident', 'update');
    expect(updates[0]).toEqual({ nextUpdateDueAt: new Date(UPDATED.getTime() + 60 * MINUTE), updatedAt: UPDATED });
    expect(updates[1]).toMatchObject({ identifiedAt: IDENTIFIED, nextUpdateDueAt: new Date(IDENTIFIED.getTime() + 60 * MINUTE), updatedAt: IDENTIFIED });
    expect(updates[2]).toMatchObject({ scribeId: SCRIBE, updatedAt: HANDED });
    expect(updates[3]).toMatchObject({ resolvedAt: RESOLVED, nextUpdateDueAt: null, updatedAt: RESOLVED });
    expect(updates[4]).toMatchObject({ status: 'closed', closedAt: PUBLISHED, updatedAt: PUBLISHED });
  });

  it('opens the review at the resolution, due so many days after it, and measures the duration to it', async () => {
    await runIncident(true);
    const [review] = db.written('postIncidentReview', 'create');
    expect(review).toMatchObject({ createdAt: RESOLVED, updatedAt: RESOLVED, durationMinutes: 50, dueOn: new Date(RESOLVED.getTime() + 5 * DAY) });
  });

  it('dates the review’s edits, its actions and its publication', async () => {
    await runIncident(true);
    const reviewUpdates = db.written('postIncidentReview', 'update');
    expect(reviewUpdates[0]).toMatchObject({ status: 'in_review', updatedAt: REVIEWED });
    expect(reviewUpdates[1]).toMatchObject({ status: 'published', publishedAt: PUBLISHED, updatedAt: PUBLISHED });
    expect(db.written('actionItem', 'create')[0]).toMatchObject({ createdAt: AGREED, updatedAt: AGREED });
    expect(db.written('actionItem', 'update')[0]).toEqual({ status: 'done', updatedAt: DONE });
  });

  it('writes the same audit actions and events as a live incident', async () => {
    await runIncident(false);
    const live = { audit: db.table('auditEvent').map((row) => row.action), events: db.table('outboxEvent').map((row) => row.type) };
    db = memoryDb();
    platform.tx = db.tx;
    platform.numbers = 0;
    db.table('ticket').push({ id: TICKET, tenantId: TENANT, number: 'INC-004501', createdAt: RAISED });
    await runIncident(true);
    expect({ audit: db.table('auditEvent').map((row) => row.action), events: db.table('outboxEvent').map((row) => row.type) }).toEqual(live);
    expect(live.events).toContain('incident.major.resolved');
  });
});

describe('a history only runs forwards, and only in the past', () => {
  it('refuses an instant in the future, or one that is not a date', async () => {
    await expect(declare(ctx, declaration, { at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    await expect(declare(ctx, declaration, { at: new Date('not a date') })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'invalid' }],
    });
    expect(db.written('majorIncident', 'create')).toEqual([]);
  });

  it('refuses a declaration from a ticket before the ticket was raised', async () => {
    await expect(declare(ctx, declaration, { at: new Date(RAISED.getTime() - MINUTE) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'before_ticket' }],
    });
  });

  it('refuses a step before the incident’s latest timeline entry', async () => {
    const incident = await declare(ctx, declaration, { at: DECLARED });
    await postUpdate(ctx, incident.number, { body: 'Investigating.' }, { at: UPDATED });
    for (const attempt of [
      () => postUpdate(ctx, incident.number, { body: 'Earlier still.' }, { at: DECLARED }),
      () => transition(ctx, incident.number, { to: 'identified', note: 'Found it.' }, { at: new Date(UPDATED.getTime() - 1) }),
      () => setRoles(ctx, incident.number, { scribeId: SCRIBE }, { at: DECLARED }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'at', code: 'out_of_order' }] });
    }
    expect(db.table('majorIncidentUpdate')).toHaveLength(2);
  });

  it('refuses review work before the review was opened, and an action’s update before it was agreed', async () => {
    const incident = await declare(ctx, declaration, { at: DECLARED });
    await transition(ctx, incident.number, { to: 'resolved', note: 'Restored.' }, { at: RESOLVED });
    const early = { at: new Date(RESOLVED.getTime() - 1) };
    await expect(saveReview(ctx, incident.number, { summary: 'x' }, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_review' }] });
    await expect(addAction(ctx, incident.number, { description: 'x', ownerId: SCRIBE }, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_review' }] });
    await expect(publishAndClose(ctx, incident.number, early)).rejects.toMatchObject({ fieldErrors: [{ code: 'before_review' }] });

    const action = await addAction(ctx, incident.number, { description: 'Monitor expiry', ownerId: SCRIBE }, { at: AGREED });
    await expect(updateAction(ctx, action.id, { status: 'done' }, { at: new Date(AGREED.getTime() - 1) })).rejects.toMatchObject({
      fieldErrors: [{ code: 'before_action' }],
    });
  });

  it('refuses a close dated before the incident’s last timeline entry', async () => {
    const incident = await declare(ctx, declaration, { at: DECLARED });
    await transition(ctx, incident.number, { to: 'resolved', note: 'Restored.' }, { at: RESOLVED });
    await postUpdate(ctx, incident.number, { kind: 'observation', body: 'Holding steady.' }, { at: REVIEWED });
    await expect(publishAndClose(ctx, incident.number, { at: new Date(REVIEWED.getTime() - 1) })).rejects.toMatchObject({
      fieldErrors: [{ code: 'out_of_order' }],
    });
  });
});
