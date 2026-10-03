import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, buildPermissionSet, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { SAMPLE_DECISIONS_MAX, importSampleDecisions, type SampleDecisionInput } from '../service/sample-decisions.js';
import { pendingSuggestions } from '../domain/decisions.js';

/**
 * `importSampleDecisions` (D13; A4 §1.14, §2.3; WP-43b): the shared demo's
 * sixty triage decisions, written as `runTriage` records one in `suggest`
 * mode, without calling any provider. The door refuses any row that is not a
 * `sample`, and any tenant that is not the demo, before anything is written —
 * a customer's AI record is the evidence its `auto` gate is read from.
 *
 * The answers go through the live checks (the tenant's own triage questions,
 * `checkDecision`, the label decode, `planDecision`), so what the suggestion
 * card shows for a sample is computed exactly as for a live decision; the
 * card's own `pendingSuggestions` is run over what was stored to prove it.
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
    // No Redis here: the tenant's thresholds are the defaults.
    getSetting: async (_ctx: unknown, key: string) => ({ 'ai.decision.autoThreshold': 0.9, 'ai.decision.suggestThreshold': 0.6 })[key],
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

function satisfies(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return same(value, condition);
  return Object.entries(condition as Row).every(([op, arg]) => {
    if (op === 'in') return (arg as unknown[]).some((each) => same(value, each));
    if (op === 'not') return !same(value, arg);
    throw new Error(`the stand-in does not know the operator ${op}`);
  });
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => satisfies(row[key], condition));
}

/** The calls the AI module makes, on arrays, with every write kept. */
function memoryDb() {
  let tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    count: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { settled: null, settledAt: null, applied: {}, ...data };
      table(name).push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const rows = table(name).filter((each) => matches(each, where));
      rows.forEach((row) => Object.assign(row, data));
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
  const snapshot = () => {
    const copy = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
    return () => {
      tables = copy;
    };
  };
  return { tx, table, snapshot };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const GRACE = '0190a000-0000-7000-8000-000000000002';
const VPN = '0190a000-0000-7000-8000-0000000000c1';
const OUTLOOK = '0190a000-0000-7000-8000-0000000000c2';
const NETWORK = '0190a000-0000-7000-8000-0000000000d1';
const DESK = '0190a000-0000-7000-8000-0000000000d2';
const OPEN = '0190a000-0000-7000-8000-0000000000a1';
const RESOLVED_TICKET = '0190a000-0000-7000-8000-0000000000a2';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
const RAISED = new Date('2026-09-30T08:40:00.000Z');
const TRIAGED = new Date('2026-09-30T08:40:05.000Z');
const ANSWERED = new Date('2026-09-30T08:52:00.000Z');
const RESOLVED = new Date('2026-09-30T13:10:00.000Z');

const importer: TenantContext = createContext({
  tenantId: TENANT,
  actor: { type: 'system', id: null, displayName: 'demo-build' },
  permissions: SYSTEM_PERMISSIONS,
});

let db: ReturnType<typeof memoryDb>;

function setUp(kind: string | null) {
  db = memoryDb();
  platform.tx = db.tx;
  platform.snapshot = db.snapshot;
  if (kind) db.table('tenant').push({ id: TENANT, kind });
  db.table('category').push(
    { id: VPN, tenantId: TENANT, path: 'Network > VPN', isActive: true, deletedAt: null },
    { id: OUTLOOK, tenantId: TENANT, path: 'Email & collaboration > Outlook', isActive: true, deletedAt: null },
  );
  db.table('team').push({ id: NETWORK, tenantId: TENANT, name: 'Network', deletedAt: null }, { id: DESK, tenantId: TENANT, name: 'Service Desk', deletedAt: null });
  db.table('ticket').push(
    { id: OPEN, tenantId: TENANT, number: 'INC-004890', type: 'incident', categoryId: null, groupId: DESK, priority: 'P3', createdAt: RAISED, resolvedAt: null, deletedAt: null },
    // The category suggestion was accepted, so the ticket holds it now.
    { id: RESOLVED_TICKET, tenantId: TENANT, number: 'INC-004891', type: 'incident', categoryId: VPN, groupId: NETWORK, priority: 'P2', createdAt: RAISED, resolvedAt: RESOLVED, deletedAt: null },
  );
  db.table('user').push({ id: GRACE, tenantId: TENANT });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setUp('demo');
});

afterEach(() => {
  vi.useRealTimers();
});

const answers = {
  type: { value: 'incident', confidence: 0.95 },
  category: { value: 'Network > VPN', confidence: 0.86 },
  group: { value: 'Network', confidence: 0.82 },
  priority: { value: 'P2', confidence: 0.71 },
  majorIncident: { value: false, confidence: 0.9 },
};

const open: SampleDecisionInput = { provider: 'sample', ticketId: OPEN, createdAt: TRIAGED, answers };
const accepted: SampleDecisionInput = {
  provider: 'sample',
  ticketId: RESOLVED_TICKET,
  createdAt: TRIAGED,
  answers,
  baseline: { type: 'incident', categoryId: null, groupId: NETWORK, priority: 'P2' },
  responses: { category: { action: 'accepted', by: GRACE, at: ANSWERED } },
};

describe('a sample is recorded as runTriage records a decision in suggest mode', () => {
  it('names the sample provider and model, spends nothing, at the instant it was triaged', async () => {
    const [result] = await importSampleDecisions(importer, [open]);
    const [row] = db.table('aiDecision');
    expect(row).toMatchObject({
      id: result!.decisionId,
      purpose: 'triage',
      subjectType: 'ticket',
      subjectId: OPEN,
      mode: 'suggest',
      questionSetVersion: 1,
      provider: 'sample',
      // Answered, so it names what answered it: the table refuses a null model for anything but `rules`.
      model: 'sample',
      providerRequestId: null,
      outcome: 'suggested',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0n,
      periodKey: '2026-09',
      createdAt: TRIAGED,
      problems: [],
      omitted: [],
      attempts: [{ provider: 'sample', outcome: 'answered', reason: null, model: 'sample', ms: 0, costMicros: '0' }],
      baseline: { type: 'incident', categoryId: null, groupId: DESK, priority: 'P3' },
      responses: {},
    });
    expect(result).toEqual({ decisionId: row!.id, ticketNumber: 'INC-004890', outcome: 'suggested', settled: false });
  });

  it('decodes each label to the id a ticket stores, and plans what the tenant’s thresholds allow', async () => {
    await importSampleDecisions(importer, [open]);
    const [row] = db.table('aiDecision');
    expect(row!.proposed).toEqual({ type: 'incident', category: VPN, group: NETWORK, priority: 'P2', majorIncident: false });
    expect((row!.plan as { question: string; action: string }[]).map((entry) => [entry.question, entry.action])).toEqual([
      ['type', 'record'],
      ['category', 'suggest'],
      ['group', 'suggest'],
      ['priority', 'suggest'],
      ['majorIncident', 'suggest'],
    ]);
  });

  it('is what the suggestion card offers on an open ticket', async () => {
    await importSampleDecisions(importer, [open]);
    const [row] = db.table('aiDecision');
    const offered = pendingSuggestions({
      plan: row!.plan as never,
      answers: row!.answers as never,
      proposed: row!.proposed as never,
      baseline: row!.baseline as never,
      current: { type: 'incident', categoryId: null, groupId: DESK, priority: 'P3' },
      responded: new Set(Object.keys(row!.responses as object)),
    });
    expect(offered.map((each) => [each.question, each.display, each.value])).toEqual([
      ['category', 'Network > VPN', VPN],
      ['group', 'Network', NETWORK],
      ['priority', 'P2', 'P2'],
    ]);
  });

  it('keeps what agents did, as the card records it, and settles a resolved ticket at its resolution', async () => {
    const [result] = await importSampleDecisions(importer, [accepted]);
    const [row] = db.table('aiDecision');
    expect(row!.responses).toEqual({ category: { action: 'accepted', by: GRACE, at: ANSWERED.toISOString() } });
    expect(row!.settled).toEqual({ type: 'incident', category: VPN, group: NETWORK, priority: 'P2', majorIncident: false });
    expect(row!.settledAt).toEqual(RESOLVED);
    expect(result!.settled).toBe(true);
  });

  it('records a sample that offers nothing as shadowed, as live', async () => {
    const [result] = await importSampleDecisions(importer, [{ ...open, answers: { type: { value: 'incident', confidence: 0.9 }, category: { value: 'Network > VPN', confidence: 0.3 } } }]);
    expect(result!.outcome).toBe('shadowed');
    expect(db.table('aiDecision')[0]!.answers).toMatchObject({ group: { value: null, confidence: 0 }, priority: { value: null, confidence: 0 } });
  });

  it('spends nothing, announces nothing, queues nothing; one audit row names every ticket', async () => {
    await importSampleDecisions(importer, [open, accepted], { label: 'demo g42 AI samples', reason: 'demo.build' });
    expect(db.table('outboxEvent')).toEqual([]);
    expect(db.table('aiBudget')).toEqual([]);
    expect(db.table('auditEvent')).toHaveLength(1);
    expect(db.table('auditEvent')[0]).toMatchObject({ action: 'ai.decisions.imported.batch', targetType: 'import_batch', reason: 'demo.build' });
    expect(db.table('auditEvent')[0]!.after).toEqual({
      label: 'demo g42 AI samples',
      provider: 'sample',
      count: 2,
      first: 'INC-004890',
      last: 'INC-004891',
      tickets: ['INC-004890', 'INC-004891'],
    });
  });
});

describe('the door is narrow: samples only, into the demo only', () => {
  it('refuses any row that is not a sample, naming it, before anything is read', async () => {
    await expect(importSampleDecisions(importer, [open, { ...accepted, provider: 'jev' }])).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: '1.provider', code: 'not_sample' }],
    });
    expect(db.table('aiDecision')).toEqual([]);
  });

  it('refuses a standard tenant, and a tenant whose row cannot be read', async () => {
    for (const kind of ['standard', null]) {
      setUp(kind);
      await expect(importSampleDecisions(importer, [open])).rejects.toMatchObject({ status: 403 });
      expect(db.table('aiDecision')).toEqual([]);
    }
  });

  it('needs ai.manage', async () => {
    const reader = createContext({ tenantId: TENANT, actor: { type: 'user', id: GRACE }, permissions: buildPermissionSet([{ key: 'ai.read', scope: 'any' }]) });
    await expect(importSampleDecisions(reader, [open])).rejects.toMatchObject({ status: 403 });
  });
});

describe('what else a sample cannot be', () => {
  const refused = async (rows: SampleDecisionInput[], expected: object) => {
    await expect(importSampleDecisions(importer, rows)).rejects.toMatchObject(expected);
    expect(db.table('aiDecision')).toEqual([]);
  };

  it('dated in the future, before the ticket was raised or after it was resolved', async () => {
    await refused([{ ...open, createdAt: new Date(NOW.getTime() + 1) }], { fieldErrors: [{ field: '0.createdAt', code: 'in_future' }] });
    await refused([{ ...open, createdAt: new Date(RAISED.getTime() - 1) }], { fieldErrors: [{ field: '0.createdAt', code: 'before_ticket' }] });
    await refused([{ ...accepted, responses: {}, createdAt: new Date(RESOLVED.getTime() + HOUR) }], { fieldErrors: [{ field: '0.createdAt', code: 'after_resolved' }] });
  });

  it('an answer to a question not asked, or one the question does not allow', async () => {
    await refused([{ ...open, answers: { ...answers, impact: { value: 'high', confidence: 0.9 } } }], { fieldErrors: [{ field: '0.answers.impact', code: 'unknown_question' }] });
    await refused([{ ...open, answers: { ...answers, category: { value: 'Payroll', confidence: 0.9 } } }], { fieldErrors: [{ field: '0.answers.category', code: 'invalid' }] });
    await refused([{ ...open, answers: { ...answers, group: { value: 'Network', confidence: 1.4 } } }], { fieldErrors: [{ field: '0.answers.group', code: 'invalid' }] });
  });

  it('a response to a suggestion that was not made, by nobody, or before the decision', async () => {
    await refused([{ ...open, responses: { type: { action: 'dismissed', by: GRACE, at: ANSWERED } } }], { fieldErrors: [{ field: '0.responses.type', code: 'not_suggested' }] });
    await refused([{ ...open, responses: { group: { action: 'dismissed', by: VPN, at: ANSWERED } } }], { fieldErrors: [{ field: '0.responses.group.by', code: 'not_found' }] });
    await refused([{ ...open, responses: { group: { action: 'dismissed', by: GRACE, at: RAISED } } }], { fieldErrors: [{ field: '0.responses.group.at', code: 'before_decided' }] });
  });

  it('a second triage of one ticket, in one import or after an earlier one', async () => {
    await refused([open, accepted, open], { fieldErrors: [{ field: '2.ticketId', code: 'duplicate' }] });
    await importSampleDecisions(importer, [open]);
    await expect(importSampleDecisions(importer, [open])).rejects.toMatchObject({ status: 409 });
    expect(db.table('aiDecision')).toHaveLength(1);
  });

  it('more than one audit row can name', async () => {
    await refused(Array.from({ length: SAMPLE_DECISIONS_MAX + 1 }, () => open), { name: 'ZodError' });
  });
});

describe('the live triage is untouched', () => {
  it('a ticket a live triage already decided keeps its decision, and a sample for it is refused', async () => {
    db.table('aiDecision').push({ id: 'live', tenantId: TENANT, purpose: 'triage', subjectType: 'ticket', subjectId: OPEN, questionSetVersion: 1, provider: 'jev' });
    await expect(importSampleDecisions(importer, [open])).rejects.toMatchObject({ status: 409 });
    expect(db.table('aiDecision').map((row) => row.provider)).toEqual(['jev']);
  });
});
