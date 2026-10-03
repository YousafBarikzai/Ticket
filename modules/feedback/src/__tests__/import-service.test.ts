import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_PERMISSIONS, buildPermissionSet, createContext, type TenantContext, type Tx } from '@itsm/platform';
import { IMPORT_SURVEYS_MAX, importInvitations, importResponses } from '../service/import-service.js';
import { record } from '../service/response-service.js';
import { DEFAULT_SURVEY } from '../seed/defaults.js';

/**
 * `importResponses` and `importInvitations` (A4 §1.11, §2.3; WP-43b): who was
 * asked about a resolved ticket and what those who answered said, dated when
 * it happened and setting nothing off — no `survey.invited` e-mail, no chat
 * post queued, no `survey.responded` webhook — so the shared demo's build can
 * write four months of satisfaction into a quiet tenant.
 *
 * The answers go through the same `evaluateAnswers` a live answer does, so an
 * imported 4 out of 5 is stored as the same 75 the portal would store. The
 * clock is frozen. The last block pins the live door, `record`, unchanged.
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
    // An import must never queue anything; a tenant being built refuses it.
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

/** The calls the feedback module makes, on arrays, with every write kept. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const model = (name: string) => ({
    findFirst: async ({ where, include }: { where?: Row; include?: Row } = {}) => {
      const row = table(name).find((each) => matches(each, where));
      if (!row) return null;
      // `record` reads the version with its survey's key.
      if (include?.definition) return { ...row, definition: table('surveyDefinition').find((each) => each.id === row.definitionId) };
      return { ...row };
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      const row = { ...data };
      table(name).push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      Object.assign(row, data);
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
      for (const name of Object.keys(tables)) tables[name] = copy[name] ?? [];
    };
  };
  return { tx, table, snapshot };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const OLIVIA = '0190a000-0000-7000-8000-000000000002';
const RAVI = '0190a000-0000-7000-8000-000000000003';
const SURVEY = '0190a000-0000-7000-8000-0000000000b1';
const VERSION = '0190a000-0000-7000-8000-0000000000b2';
const ON_RESOLVE = '0190a000-0000-7000-8000-0000000000b3';
const DRAFT = '0190a000-0000-7000-8000-0000000000b4';
const FIRST = '0190a000-0000-7000-8000-0000000000a1';
const SECOND = '0190a000-0000-7000-8000-0000000000a2';
const NOBODY = '0190a000-0000-7000-8000-0000000000a3';
const LIVE = '0190a000-0000-7000-8000-0000000000c1';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-02T23:00:30.000Z');
const RAISED = new Date('2026-09-10T08:00:00.000Z');
const SENT = new Date('2026-09-11T16:00:00.000Z');
const ANSWERED = new Date('2026-09-12T09:30:00.000Z');

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
  db.table('surveyDefinition').push(
    { id: SURVEY, tenantId: TENANT, key: 'csat', name: 'How did we do?', status: 'published', version: 1 },
    { id: DRAFT, tenantId: TENANT, key: 'onboarding', name: 'Onboarding', status: 'draft', version: 0 },
  );
  db.table('surveyVersion').push({ id: VERSION, tenantId: TENANT, definitionId: SURVEY, version: 1, document: DEFAULT_SURVEY.document });
  db.table('surveyTrigger').push({ id: ON_RESOLVE, tenantId: TENANT, surveyId: SURVEY, kind: 'ticket.resolved', expiryDays: 10, createdAt: RAISED });
  db.table('ticket').push(
    { id: FIRST, tenantId: TENANT, number: 'INC-004501', requesterId: OLIVIA, createdAt: RAISED },
    { id: SECOND, tenantId: TENANT, number: 'REQ-003201', requesterId: RAVI, createdAt: RAISED },
    { id: NOBODY, tenantId: TENANT, number: 'INC-004502', requesterId: null, createdAt: RAISED },
  );
  db.table('user').push({ id: OLIVIA, tenantId: TENANT }, { id: RAVI, tenantId: TENANT });
});

afterEach(() => {
  vi.useRealTimers();
});

const answered = {
  surveyKey: 'csat',
  ticketId: FIRST,
  trigger: 'ticket.resolved' as const,
  sentAt: SENT,
  respondedAt: ANSWERED,
  answers: { rating: 4, comment: '  Quick and friendly — thanks Grace.  ' },
  via: 'portal' as const,
};

describe('importResponses: an answer, as it was given', () => {
  it('writes the invitation, responded, and the response with the score the live door would store', async () => {
    const [result] = await importResponses(importer, [answered]);
    const [invitation] = db.table('surveyInvitation');
    expect(invitation).toMatchObject({
      surveyId: SURVEY,
      versionId: VERSION,
      triggerId: ON_RESOLVE,
      ticketId: FIRST,
      recipientId: OLIVIA,
      status: 'responded',
      sentAt: SENT,
      expiresAt: new Date(SENT.getTime() + 10 * DAY),
      respondedAt: ANSWERED,
      channels: ['email'],
    });
    const [response] = db.table('surveyResponse');
    expect(response).toMatchObject({
      invitationId: invitation!.id,
      surveyId: SURVEY,
      versionId: VERSION,
      ticketId: FIRST,
      respondentId: OLIVIA,
      answers: { rating: 4, comment: '  Quick and friendly — thanks Grace.  ' },
      score: 75,
      scale: '1-5',
      comment: 'Quick and friendly — thanks Grace.',
      via: 'portal',
      respondedAt: ANSWERED,
    });
    expect(result).toEqual({ invitationId: invitation!.id, responseId: response!.id, ticketNumber: 'INC-004501', score: 75 });
  });

  it('normalises each rating as the live door does: 1 is 0, 3 is 50, 5 is 100', async () => {
    const results = await importResponses(importer, [
      { ...answered, answers: { rating: 1 } },
      { ...answered, ticketId: SECOND, answers: { rating: 3 } },
      { ...answered, recipientId: RAVI, answers: { rating: 5 } },
    ]);
    expect(results.map((each) => each.score)).toEqual([0, 50, 100]);
    expect(db.table('surveyResponse').map((row) => row.comment)).toEqual([null, null, null]);
  });

  it('gives each invitation a token hash no link can match', async () => {
    await importResponses(importer, [answered, { ...answered, ticketId: SECOND }]);
    const hashes = db.table('surveyInvitation').map((row) => row.tokenHash as string);
    expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(new Set(hashes).size).toBe(2);
  });

  it('sets nothing off: no event and no job (the stand-in for enqueue throws)', async () => {
    await importResponses(importer, [answered]);
    expect(db.table('outboxEvent')).toEqual([]);
  });

  it('audits row by row by default, and as one batch row naming every ticket when asked', async () => {
    await importResponses(importer, [answered], { reason: 'demo.build' });
    expect(db.table('auditEvent').map((row) => [row.action, row.reason])).toEqual([['survey.response.imported', 'demo.build']]);
    db.table('auditEvent').length = 0;
    await importResponses(importer, [{ ...answered, ticketId: SECOND, answers: { rating: 5 } }, { ...answered, ticketId: SECOND, recipientId: OLIVIA, answers: { rating: 2 } }], {
      audit: 'batch',
      label: 'demo g42 csat 0001-0002',
      reason: 'demo.build',
    });
    const [batch] = db.table('auditEvent');
    expect(db.table('auditEvent')).toHaveLength(1);
    expect(batch).toMatchObject({ action: 'survey.responses.imported.batch', targetType: 'import_batch', reason: 'demo.build' });
    expect(batch!.after).toEqual({ label: 'demo g42 csat 0001-0002', count: 2, first: 'REQ-003201', last: 'REQ-003201', tickets: ['REQ-003201', 'REQ-003201'], meanScore: 62.5 });
  });
});

describe('importInvitations: an ask nobody answered', () => {
  const asked = { surveyKey: 'csat', ticketId: FIRST, sentAt: SENT };

  it('is pending while its link would still work, and expired once it would not', async () => {
    const recent = new Date(NOW.getTime() - 2 * DAY);
    const ids = await importInvitations(importer, [asked, { ...asked, ticketId: SECOND, sentAt: recent, channels: ['portal'] }]);
    expect(ids).toHaveLength(2);
    expect(db.table('surveyInvitation').map((row) => [row.status, row.expiresAt, row.respondedAt, row.triggerId, row.channels])).toEqual([
      ['expired', new Date(SENT.getTime() + 14 * DAY), null, null, ['email']],
      ['pending', new Date(recent.getTime() + 14 * DAY), null, null, ['portal']],
    ]);
    expect(db.table('surveyResponse')).toEqual([]);
    expect(db.table('outboxEvent')).toEqual([]);
  });

  it('takes an explicit expiry, and the trigger’s otherwise', async () => {
    await importInvitations(importer, [{ ...asked, expiresAt: new Date(NOW.getTime() + DAY) }, { ...asked, ticketId: SECOND, trigger: 'ticket.resolved' }]);
    expect(db.table('surveyInvitation').map((row) => [row.status, row.expiresAt])).toEqual([
      ['pending', new Date(NOW.getTime() + DAY)],
      ['expired', new Date(SENT.getTime() + 10 * DAY)],
    ]);
  });

  it('audits as one batch row when asked', async () => {
    await importInvitations(importer, [asked, { ...asked, ticketId: SECOND }], { audit: 'batch', label: 'demo g42 asks', reason: 'demo.build' });
    expect(db.table('auditEvent')).toEqual([expect.objectContaining({ action: 'survey.invitations.imported.batch', reason: 'demo.build' })]);
    expect(db.table('auditEvent')[0]!.after).toMatchObject({ count: 2, first: 'INC-004501', last: 'REQ-003201' });
  });
});

describe('what an import refuses, before anything is written', () => {
  const refused = async (call: () => Promise<unknown>, expected: object) => {
    await expect(call()).rejects.toMatchObject(expected);
    expect(db.table('surveyInvitation')).toEqual([]);
    expect(db.table('surveyResponse')).toEqual([]);
  };

  it('instants in the future, an answer before the ask or after the link expired, an expiry before the ask', async () => {
    await refused(() => importResponses(importer, [{ ...answered, respondedAt: new Date(NOW.getTime() + 1) }]), { fieldErrors: [{ field: '0.respondedAt', code: 'in_future' }] });
    await refused(() => importResponses(importer, [{ ...answered, respondedAt: new Date(SENT.getTime() - 1) }]), { fieldErrors: [{ field: '0.respondedAt', code: 'before_sent' }] });
    await refused(() => importResponses(importer, [{ ...answered, respondedAt: new Date(SENT.getTime() + 11 * DAY) }]), { fieldErrors: [{ field: '0.respondedAt', code: 'after_expiry' }] });
    await refused(() => importInvitations(importer, [{ surveyKey: 'csat', ticketId: FIRST, sentAt: SENT, expiresAt: SENT }]), { fieldErrors: [{ field: '0.expiresAt', code: 'before_sent' }] });
  });

  it('an ask before the ticket was raised', async () => {
    await refused(() => importResponses(importer, [{ ...answered, sentAt: new Date(RAISED.getTime() - HOUR) }]), { fieldErrors: [{ field: '0.sentAt', code: 'before_ticket' }] });
  });

  it('a survey that is unknown or unpublished, or a trigger it does not have', async () => {
    await refused(() => importResponses(importer, [{ ...answered, surveyKey: 'nps' }]), { status: 404 });
    await refused(() => importResponses(importer, [{ ...answered, surveyKey: 'onboarding' }]), { status: 422 });
    await refused(() => importResponses(importer, [{ ...answered, trigger: 'incident.major.resolved' }]), { fieldErrors: [{ field: '0.trigger', code: 'not_found' }] });
  });

  it('a person not in the directory, or nobody to have asked', async () => {
    await refused(() => importResponses(importer, [{ ...answered, recipientId: SURVEY }]), { fieldErrors: [{ field: '0.recipientId', code: 'not_found' }] });
    await refused(() => importResponses(importer, [{ ...answered, ticketId: NOBODY }]), { fieldErrors: [{ field: '0.recipientId', code: 'required' }] });
  });

  it('the same ask twice, in one import or across two', async () => {
    await refused(() => importResponses(importer, [answered, answered]), { fieldErrors: [{ field: '1.ticketId', code: 'duplicate' }] });
    await importResponses(importer, [answered]);
    await expect(importInvitations(importer, [{ surveyKey: 'csat', ticketId: FIRST, sentAt: SENT }])).rejects.toMatchObject({ status: 409 });
    expect(db.table('surveyInvitation')).toHaveLength(1);
  });

  it('answers the survey does not accept, named at the question', async () => {
    await refused(() => importResponses(importer, [{ ...answered, answers: { rating: 9 } }]), { status: 422, fieldErrors: [{ field: '0.answers.rating', code: 'invalid' }] });
    await refused(() => importResponses(importer, [{ ...answered, answers: { comment: 'no rating' } }]), { fieldErrors: [{ field: '0.answers.rating' }] });
  });

  it('more than one batch row can name, and an importer without feedback.manage', async () => {
    await refused(() => importResponses(importer, Array.from({ length: IMPORT_SURVEYS_MAX + 1 }, () => answered)), { name: 'ZodError' });
    const reader = createContext({ tenantId: TENANT, actor: { type: 'user', id: OLIVIA }, permissions: buildPermissionSet([{ key: 'feedback.read', scope: 'any' }]) });
    await refused(() => importResponses(reader, [answered]), { status: 403 });
  });
});

describe('the live door is unchanged', () => {
  it('record still answers now and announces the score', async () => {
    db.table('surveyInvitation').push({ id: LIVE, tenantId: TENANT, surveyId: SURVEY, versionId: VERSION, ticketId: FIRST, recipientId: OLIVIA, status: 'pending', expiresAt: new Date(NOW.getTime() + DAY) });
    const respondent = createContext({ tenantId: TENANT, actor: { type: 'user', id: OLIVIA }, permissions: buildPermissionSet([]) });
    const result = await record(respondent, db.tx, LIVE, { rating: 5 }, 'email');
    expect(result.score).toBe(100);
    expect(db.table('surveyResponse')[0]).toMatchObject({ respondedAt: NOW, via: 'email' });
    expect(db.table('surveyInvitation')[0]).toMatchObject({ status: 'responded', respondedAt: NOW });
    expect(db.table('outboxEvent').map((row) => row.type)).toEqual(['survey.responded']);
  });
});
