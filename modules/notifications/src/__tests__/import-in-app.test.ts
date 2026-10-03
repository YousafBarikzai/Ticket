import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, buildPermissionSet, createContext, type TenantContext, type Tx } from '@itsm/platform';
import {
  DEMO_SAMPLE_EVENT_TYPE,
  DEMO_SAMPLE_RULE_KEY,
  IN_APP_SAMPLES_MAX,
  SAMPLE_KINDS,
  importInApp,
  sampleKindOf,
  sampleTemplateKey,
  type InAppSampleInput,
} from '../service/import-in-app.js';
import { listInbox } from '../service/notification-service.js';

/**
 * `importInApp` (A4 §1.14, §2.3; WP-43b): what each persona's bell holds in
 * the shared demo, written straight into the inbox as `notification` rows,
 * `sent`, with `eventType = 'demo.sample'` and `ruleKey = 'demo-sample'` —
 * no rule, no event, no delivery attempt, no job — and read by the live
 * `listInbox` like any other notification.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, snapshot: (() => () => undefined) as () => () => void }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    // A refusal part-way through a call rolls back what the call wrote, as the database does.
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      const restore = platform.snapshot();
      try {
        return await fn(platform.tx);
      } catch (error) {
        restore();
        throw error;
      }
    },
    enqueue: async () => {
      throw new Error('an import queued a job');
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

/** The calls the inbox makes, on arrays, with every write kept. */
function memoryDb() {
  let tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy, take }: { where?: Row; orderBy?: Row; take?: number } = {}) => {
      const rows = table(name).filter((each) => matches(each, where));
      if (orderBy) {
        const [key, direction] = Object.entries(orderBy)[0]!;
        rows.sort((a, b) => (direction === 'desc' ? -1 : 1) * ((a[key] as Date).getTime() - (b[key] as Date).getTime()));
      }
      return rows.slice(0, take ?? rows.length).map((row) => ({ ...row }));
    },
    count: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data };
      table(name).push(row);
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
  const snapshot = () => {
    const copy = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
    return () => {
      tables = copy;
    };
  };
  return { tx, table, snapshot };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const ALEX = '0190a000-0000-7000-8000-000000000002';
const EMMA = '0190a000-0000-7000-8000-000000000003';
const LEFT = '0190a000-0000-7000-8000-000000000004';
const HERO = '0190a000-0000-7000-8000-0000000000a1';

const MINUTE = 60_000;
const NOW = new Date('2026-10-02T15:00:30.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

const importer: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'system', id: null, displayName: 'demo-build' },
  permissions: SYSTEM_PERMISSIONS,
});

let db: ReturnType<typeof memoryDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  platform.snapshot = db.snapshot;
  db.table('user').push(
    { id: ALEX, tenantId: TENANT, status: 'active', deletedAt: null },
    { id: EMMA, tenantId: TENANT, status: 'active', deletedAt: null },
    { id: LEFT, tenantId: TENANT, status: 'deactivated', deletedAt: null },
  );
  db.table('ticket').push({ id: HERO, tenantId: TENANT, number: 'INC-004890' });
});

afterEach(() => {
  vi.useRealTimers();
});

const alex: InAppSampleInput[] = [
  { recipientId: ALEX, ticketId: HERO, subject: 'INC-004890 was assigned to you', body: 'Wi-Fi drops in the Leeds warehouse aisles 10–14.', createdAt: ago(200), readAt: ago(190), kind: 'assigned' },
  { recipientId: ALEX, subject: 'MI-0004 declared: VPN sign-in failures for remote staff', body: 'SEV2. Daniel Hughes is commanding.', createdAt: ago(55), kind: 'major_incident' },
  { recipientId: ALEX, ticketId: HERO, subject: 'Olivia Bennett replied on INC-004890', body: 'It dropped again at 10:40.', createdAt: ago(20) },
];

describe('a sample is a notification already in the inbox', () => {
  it('writes each row sent, dated when it arrived, read or unread, marked as a demo sample with its own event', async () => {
    const rows = await importInApp(importer, alex);
    expect(rows.map((row) => [row.recipientId, row.ticketId, row.createdAt, row.readAt, row.status])).toEqual([
      [ALEX, HERO, ago(200), ago(190), 'sent'],
      [ALEX, null, ago(55), null, 'sent'],
      [ALEX, HERO, ago(20), null, 'sent'],
    ]);
    for (const row of rows) expect(row).toMatchObject({ eventType: DEMO_SAMPLE_EVENT_TYPE, ruleKey: DEMO_SAMPLE_RULE_KEY, tenantId: TENANT });
    expect(new Set(rows.map((row) => row.eventId)).size).toBe(3);
    expect(rows.map((row) => row.templateKey)).toEqual(['demo-sample.assigned', 'demo-sample.major_incident', 'demo-sample']);
  });

  it('sets nothing off: no delivery attempt, no event, no job (the stand-in for enqueue throws)', async () => {
    await importInApp(importer, alex);
    expect(db.table('deliveryAttempt')).toEqual([]);
    expect(db.table('outboxEvent')).toEqual([]);
  });

  it('writes one audit row for the call', async () => {
    await importInApp(importer, [...alex, { recipientId: EMMA, subject: 'Approval requested: Tableau Creator', body: 'Olivia Bennett asked for a paid licence.', createdAt: ago(180), kind: 'approval' }], {
      label: 'demo g42 bells',
      reason: 'demo.build',
    });
    expect(db.table('auditEvent')).toHaveLength(1);
    expect(db.table('auditEvent')[0]).toMatchObject({ action: 'notifications.inapp.imported.batch', targetType: 'import_batch', reason: 'demo.build' });
    expect(db.table('auditEvent')[0]!.after).toEqual({ label: 'demo g42 bells', count: 4, unread: 3, recipients: [ALEX, EMMA] });
  });

  it('is what the live inbox reads: newest first, with the unread count', async () => {
    await importInApp(importer, alex);
    const reader = createContext({ tenantId: TENANT, actor: { type: 'user', id: ALEX }, permissions: buildPermissionSet([{ key: 'notification.read', scope: 'own' }]) });
    const inbox = await listInbox(reader, { limit: 10 });
    expect(inbox.unread).toBe(2);
    expect(inbox.data.map((row) => row.subject)).toEqual([alex[2]!.subject, alex[1]!.subject, alex[0]!.subject]);
  });
});

describe('the bell’s tile for a sample', () => {
  it('is kept in the template key and read back, for samples only', () => {
    for (const kind of SAMPLE_KINDS) {
      expect(sampleKindOf({ eventType: DEMO_SAMPLE_EVENT_TYPE, templateKey: sampleTemplateKey(kind) })).toBe(kind);
    }
    expect(sampleKindOf({ eventType: DEMO_SAMPLE_EVENT_TYPE, templateKey: sampleTemplateKey() })).toBeNull();
    expect(sampleKindOf({ eventType: DEMO_SAMPLE_EVENT_TYPE, templateKey: 'demo-sample.unheard-of' })).toBeNull();
    expect(sampleKindOf({ eventType: 'approval.requested', templateKey: 'demo-sample.approval' })).toBeNull();
  });
});

describe('what an import refuses, before anything is written', () => {
  const refused = async (rows: InAppSampleInput[], expected: object) => {
    await expect(importInApp(importer, rows)).rejects.toMatchObject(expected);
    expect(db.table('notification')).toEqual([]);
  };

  it('an arrival in the future, a reading in the future or before the arrival', async () => {
    await refused([{ ...alex[0]!, createdAt: new Date(NOW.getTime() + 1) }], { status: 422, fieldErrors: [{ field: '0.createdAt', code: 'in_future' }] });
    await refused([{ ...alex[0]!, readAt: new Date(NOW.getTime() + 1) }], { fieldErrors: [{ field: '0.readAt', code: 'in_future' }] });
    await refused([alex[1]!, { ...alex[0]!, readAt: ago(201) }], { fieldErrors: [{ field: '1.readAt', code: 'before_created' }] });
  });

  it('a recipient who is not an active person here, and a ticket this tenant does not have', async () => {
    await refused([alex[0]!, { ...alex[1]!, recipientId: LEFT }], { status: 422, fieldErrors: [{ field: '1.recipientId', code: 'not_found' }] });
    await refused([{ ...alex[0]!, ticketId: EMMA }], { status: 404 });
  });

  it('a kind the bell does not draw, more than one audit row can name, and an importer without the permission', async () => {
    await refused([{ ...alex[0]!, kind: 'party' as never }], { name: 'ZodError' });
    await refused(Array.from({ length: IN_APP_SAMPLES_MAX + 1 }, () => alex[1]!), { name: 'ZodError' });
    const agent = createContext({ tenantId: TENANT, actor: { type: 'user', id: ALEX }, permissions: buildPermissionSet([{ key: 'notification.read', scope: 'own' }]) });
    await expect(importInApp(agent, alex)).rejects.toMatchObject({ status: 403 });
    expect(db.table('notification')).toEqual([]);
  });

  it('nothing for an empty list', async () => {
    expect(await importInApp(importer, [])).toEqual([]);
    expect(db.table('auditEvent')).toEqual([]);
  });
});
