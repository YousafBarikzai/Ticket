import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError, createContext, SYSTEM_PERMISSIONS, systemContext, type Tx } from '@itsm/platform';
import type { FormDefinition } from '@itsm/contracts';
import { describeAnswers } from '../domain/describe-answers.js';
import { importSubmission, importSubmissions, submitRequest, SUBMISSION_BATCH_MAX, type ImportSubmissionInput } from '../service/catalogue-service.js';

/**
 * Imported catalogue submissions (A4 §2.3 and §5.3, WP-43a): the
 * `form_submission` behind a request whose ticket the demo's history
 * imported, checked against the published form as the submitter and dated
 * when it was made. And the other half of the promise: a live submission
 * writes exactly what it always wrote.
 *
 * No database: an in-memory stand-in for the transaction keeps every write as
 * it was asked for. The ticket and approval modules are stood in for, so the
 * live submission can be followed without them.
 */

const platform = vi.hoisted(() => ({ tx: null as unknown }));
const neighbours = vi.hoisted(() => ({ createRequestFromCatalogue: vi.fn(), requestApproval: vi.fn() }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
  };
});
vi.mock('@itsm/module-ticket', () => ({ ticketService: { createRequestFromCatalogue: neighbours.createRequestFromCatalogue } }));
vi.mock('@itsm/module-approvals', () => ({ approvalService: { requestApproval: neighbours.requestApproval } }));

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && 'in' in (condition as Row)) {
      return (condition as { in: unknown[] }).in.some((each) => same(row[key], each));
    }
    return same(row[key], condition);
  });
}

/** The calls the catalogue makes, on arrays, with every write kept as it was asked for. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const writes: { model: string; op: string; data: Row }[] = [];
  const table = (name: string) => (tables[name] ??= []);
  const defaults: Record<string, Row> = { ticket: { deletedAt: null }, user: { deletedAt: null } };
  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = table(name).find((each) => matches({ ...defaults[name], ...each }, where));
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) =>
      table(name).filter((each) => matches({ ...defaults[name], ...each }, where)).map((row) => ({ ...row })),
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      table(name).push({ ...data });
      return { ...data };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  const created = (name: string) => writes.filter((write) => write.model === name && write.op === 'create').map((write) => write.data);
  return { tx, table, writes, created };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const ORG = '0190a000-0000-7000-8000-000000000002';
const REQUESTER = '0190a000-0000-7000-8000-000000000007';
const MANAGER = '0190a000-0000-7000-8000-000000000008';
const ITEM = '0190a000-0000-7000-8000-0000000000d1';
const SERVICE = '0190a000-0000-7000-8000-0000000000d2';
const FORM = '0190a000-0000-7000-8000-0000000000e1';
const VERSION_1 = '0190a000-0000-7000-8000-0000000000e2';
const VERSION_2 = '0190a000-0000-7000-8000-0000000000e3';
const TICKET = '0190a000-0000-7000-8000-0000000000f1';

const NOW = new Date('2026-10-02T23:00:30.000Z');
const RAISED = new Date('2026-09-14T09:12:00.000Z');

/**
 * Laptop, as the demo's catalogue asks for one: a choice with labelled
 * options, a reason that only a performance model needs, a person to deliver
 * it to, and two questions whose visibility reads the submitter's facts and
 * the moment of submission.
 */
const LAPTOP: FormDefinition = {
  key: 'laptop',
  version: 2,
  title: 'Laptop',
  schema: {
    type: 'object',
    properties: {
      model: { type: 'string', title: 'Model', enum: ['standard', 'performance'] },
      reason: { type: 'string', title: 'What it is for', minLength: 10, maxLength: 2000 },
      deliverTo: { type: 'string', title: 'Deliver to' },
      dock: { type: 'boolean', title: 'Docking station', default: false },
      executiveSpec: { type: 'string', title: 'Executive specification' },
      earlyBird: { type: 'string', title: 'Autumn refresh slot' },
    },
    required: ['model'],
  },
  ui: {
    elements: [
      {
        kind: 'field',
        field: 'model',
        control: 'select',
        label: 'Model',
        options: [
          { value: 'standard', label: 'Standard (Dell Latitude 5450)' },
          { value: 'performance', label: 'Performance (Dell Precision 3591)' },
        ],
      },
      {
        kind: 'field',
        field: 'reason',
        control: 'longtext',
        label: 'What it is for',
        requiredWhen: { eq: [{ var: 'form.model' }, 'performance'] },
      },
      { kind: 'field', field: 'deliverTo', control: 'user', label: 'Deliver to' },
      { kind: 'field', field: 'dock', control: 'checkbox', label: 'Docking station' },
      // Asked only of a VIP: the submitter's facts decide, not the importer's.
      { kind: 'field', field: 'executiveSpec', control: 'text', label: 'Executive specification', visibleWhen: { eq: [{ var: 'user.vip' }, true] } },
      // Asked only until 20 September: the moment of submission decides, not today.
      { kind: 'field', field: 'earlyBird', control: 'text', label: 'Autumn refresh slot', visibleWhen: { before: [{ var: 'now' }, '2026-09-20T00:00:00.000Z'] } },
    ],
  },
} as unknown as FormDefinition;

const system = systemContext(TENANT);
let db: ReturnType<typeof memoryDb>;

function seed() {
  db.table('requestType').push({ id: ITEM, key: 'laptop', name: 'Laptop', serviceId: SERVICE, formKey: 'laptop', status: 'published', groupId: null, priority: 'P3', entitlement: null });
  db.table('service').push({ id: SERVICE, key: 'end-user-devices', groupId: null });
  db.table('formDefinitionRecord').push({ id: FORM, key: 'laptop', status: 'published', version: 2 });
  db.table('formVersionRecord').push({ id: VERSION_1, definitionId: FORM, version: 1, document: { ...LAPTOP, version: 1 } });
  db.table('formVersionRecord').push({ id: VERSION_2, definitionId: FORM, version: 2, document: LAPTOP });
  db.table('user').push({ id: REQUESTER, displayName: 'Hamza Ali', primaryOrgId: ORG, vip: false, tier: null, isExternal: false });
  db.table('user').push({ id: MANAGER, displayName: 'Emma Clarke', primaryOrgId: ORG, vip: true, tier: null, isExternal: false });
  db.table('ticket').push({ id: TICKET, number: 'REQ-003377', type: 'request', origin: 'import', createdAt: RAISED });
}

function submission(over: Partial<ImportSubmissionInput> = {}): ImportSubmissionInput {
  return {
    requestTypeKey: 'laptop',
    ticketId: TICKET,
    answers: { model: 'performance', reason: 'Power BI models for the month-end pack.', deliverTo: MANAGER, earlyBird: 'Week 38' },
    submittedBy: REQUESTER,
    at: RAISED,
    ...over,
  };
}

function importOne(over: Partial<ImportSubmissionInput> = {}, options = {}) {
  return importSubmission(system, db.tx, submission(over), options);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  neighbours.createRequestFromCatalogue.mockReset();
  neighbours.requestApproval.mockReset();
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('importSubmission: the form_submission behind an imported request', () => {
  it('writes the submission dated when it was made, against the published version', async () => {
    const result = await importOne();

    const [row] = db.created('formSubmission');
    expect(row).toEqual({
      id: result.submissionId,
      tenantId: TENANT,
      requestTypeId: ITEM,
      formVersionId: VERSION_2,
      ticketId: TICKET,
      submittedBy: REQUESTER,
      // What validation kept, with the checkbox's default applied — as a live submission stores it.
      answers: { model: 'performance', reason: 'Power BI models for the month-end pack.', deliverTo: MANAGER, dock: false, earlyBird: 'Week 38' },
      createdAt: RAISED,
    });
    expect(result).toMatchObject({ ticketId: TICKET, ticketNumber: 'REQ-003377', formVersionId: VERSION_2, answers: row!.answers });
  });

  it('returns the description a live submission would write, so history and live requests read alike', async () => {
    const result = await importOne();

    const names = new Map([[MANAGER.toLowerCase(), 'Emma Clarke']]);
    expect(result.description).toBe(describeAnswers(LAPTOP, result.answers, names));
    expect(result.description).toContain('Model: Performance (Dell Precision 3591)');
    expect(result.description).toContain('Deliver to: Emma Clarke');
  });

  it('reads visibility as the submitter, not as the importer', async () => {
    // The importer is the system, which holds everything; the submitter is no
    // VIP, so the executive question was never asked and its stray answer goes.
    const result = await importOne({ answers: { model: 'standard', executiveSpec: '64 GB' } });
    expect(result.answers).not.toHaveProperty('executiveSpec');

    db.table('ticket').push({ id: '0190a000-0000-7000-8000-0000000000f2', number: 'REQ-003378', type: 'request', origin: 'import', createdAt: RAISED });
    const vip = await importOne({ ticketId: '0190a000-0000-7000-8000-0000000000f2', submittedBy: MANAGER, answers: { model: 'standard', executiveSpec: '64 GB' } });
    expect(vip.answers).toMatchObject({ executiveSpec: '64 GB' });
  });

  it('reads "now" as the moment it was submitted', async () => {
    // Asked until 20 September: kept for a request made on the 14th…
    expect((await importOne()).answers).toMatchObject({ earlyBird: 'Week 38' });

    // …and dropped for one made on the 25th, as the form did then.
    db.table('ticket').push({ id: '0190a000-0000-7000-8000-0000000000f3', number: 'REQ-003379', type: 'request', origin: 'import', createdAt: RAISED });
    const late = await importOne({ ticketId: '0190a000-0000-7000-8000-0000000000f3', at: new Date('2026-09-25T10:00:00.000Z') });
    expect(late.answers).not.toHaveProperty('earlyBird');
  });

  it('refuses answers the form would have refused, naming each one', async () => {
    const attempt = importOne({ answers: { model: 'performance' } });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'answers.reason', code: 'invalid' }] });
    expect(db.created('formSubmission')).toEqual([]);
  });

  it('refuses an answer that is not a value a form can hold, such as a link object', async () => {
    // Every link in imported content is https: or mailto: (D23); a form answer
    // is never a link at all, so one shaped like a link is refused outright.
    await expect(importOne({ answers: { model: 'performance', reason: { href: 'javascript:alert(1)' } as unknown as string } })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'answers.reason', code: 'wrong_type', message: 'the question holds text' }],
    });
    expect(db.created('formSubmission')).toEqual([]);
  });

  it('refuses an answer of the wrong type for its question, which a live form never sends', async () => {
    await expect(importOne({ answers: { model: 'standard', dock: 'yes' as unknown as boolean } })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'answers.dock', code: 'wrong_type', message: 'the question holds yes or no' }],
    });
  });

  it('sets nothing off: no event, no approval, nothing but the row and its audit line', async () => {
    await importOne();
    expect(db.writes.map((write) => write.model)).toEqual(['formSubmission', 'auditEvent']);
    expect(neighbours.requestApproval).not.toHaveBeenCalled();
  });

  it('writes one audit row per submission by default, with the reason given', async () => {
    await importOne({}, { reason: 'demo.build' });
    expect(db.created('auditEvent')).toEqual([
      expect.objectContaining({
        action: 'request.submission.imported',
        targetType: 'ticket',
        targetId: TICKET,
        reason: 'demo.build',
        after: { requestType: 'laptop', number: 'REQ-003377', submittedBy: REQUESTER, at: RAISED.toISOString() },
      }),
    ]);
  });
});

describe('importSubmissions: a chunk, audited as one batch', () => {
  function tickets(count: number) {
    return Array.from({ length: count }, (_, index) => {
      const id = `0190a000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`;
      const number = `REQ-00${3401 + index}`;
      db.table('ticket').push({ id, number, type: 'request', origin: 'import', createdAt: RAISED });
      return { id, number };
    });
  }

  it('writes the chunk in order with one audit row naming every ticket', async () => {
    const chunk = tickets(3);
    const written = await importSubmissions(
      system,
      db.tx,
      chunk.map((ticket) => submission({ ticketId: ticket.id, answers: { model: 'standard' } })),
      { audit: 'batch', label: 'demo g42 submissions 0001-0003', reason: 'demo.build' },
    );

    expect(written.map((each) => each.ticketNumber)).toEqual(['REQ-003401', 'REQ-003402', 'REQ-003403']);
    expect(db.created('formSubmission')).toHaveLength(3);
    const audit = db.created('auditEvent');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'request.submissions.imported.batch',
      targetType: 'import_batch',
      reason: 'demo.build',
      after: { label: 'demo g42 submissions 0001-0003', count: 3, first: 'REQ-003401', last: 'REQ-003403', tickets: ['REQ-003401', 'REQ-003402', 'REQ-003403'] },
    });
  });

  it('names a refused answer by its place in the chunk', async () => {
    const chunk = tickets(2);
    await expect(
      importSubmissions(system, db.tx, [submission({ ticketId: chunk[0]!.id }), submission({ ticketId: chunk[1]!.id, answers: { model: 'performance' } })]),
    ).rejects.toMatchObject({ fieldErrors: [{ field: '1.answers.reason' }] });
  });

  it('refuses a ticket twice in one chunk, and a batch too large for its audit row to name', async () => {
    await expect(importSubmissions(system, db.tx, [submission(), submission()])).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: '1.ticketId', code: 'duplicate' }],
    });
    const many = tickets(SUBMISSION_BATCH_MAX + 1).map((ticket) => submission({ ticketId: ticket.id, answers: { model: 'standard' } }));
    await expect(importSubmissions(system, db.tx, many, { audit: 'batch' })).rejects.toBeInstanceOf(ValidationError);
    expect(db.writes).toEqual([]);
  });

  it('writes nothing for an empty chunk', async () => {
    expect(await importSubmissions(system, db.tx, [], { audit: 'batch' })).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe('importSubmission refuses what history cannot hold', () => {
  it('refuses a ticket raised here: its submission was written when it was raised', async () => {
    db.table('ticket')[0]!.origin = 'native';
    await expect(importOne()).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a ticket that is not a request', async () => {
    db.table('ticket')[0]!.type = 'incident';
    await expect(importOne()).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'ticketId', code: 'not_a_request' }] });
  });

  it('refuses a second submission for the same ticket', async () => {
    await importOne();
    await expect(importOne()).rejects.toBeInstanceOf(ConflictError);
    expect(db.created('formSubmission')).toHaveLength(1);
  });

  it('refuses a submission before its ticket was raised, or in the future', async () => {
    await expect(importOne({ at: new Date(RAISED.getTime() - 60_000) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'before_ticket' }],
    });
    await expect(importOne({ at: new Date(NOW.getTime() + 60_000) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
  });

  it('refuses a submitter who is not in the directory', async () => {
    await expect(importOne({ submittedBy: '0190a000-0000-7000-8000-0000000000ff' })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'submittedBy', code: 'not_found' }],
    });
  });

  it('refuses an unknown item, an item with no form, and a form nobody published', async () => {
    await expect(importOne({ requestTypeKey: 'standing-desk' })).rejects.toBeInstanceOf(NotFoundError);
    db.table('requestType')[0]!.formKey = null;
    await expect(importOne()).rejects.toMatchObject({ fieldErrors: [{ field: 'requestTypeKey', code: 'no_form' }] });
    db.table('requestType')[0]!.formKey = 'laptop';
    db.table('formDefinitionRecord')[0]!.status = 'draft';
    await expect(importOne()).rejects.toMatchObject({ fieldErrors: [{ field: 'requestTypeKey', code: 'not_published' }] });
  });

  it('refuses a ticket that does not exist', async () => {
    await expect(importOne({ ticketId: '0190a000-0000-7000-8000-0000000000fe' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('needs catalogue.manage: an import writes on somebody else’s behalf', async () => {
    const requester = createContext({
      tenantId: TENANT,
      actor: { type: 'user', id: REQUESTER, displayName: 'Hamza Ali' },
      permissions: {
        ...SYSTEM_PERMISSIONS,
        isSystem: false,
        has: (key: string) => key !== 'catalogue.manage',
        scopeFor: (key: string) => (key === 'catalogue.manage' ? undefined : 'any'),
      },
    });
    await expect(importSubmission(requester, db.tx, submission())).rejects.toMatchObject({ status: 403 });
    expect(db.writes).toEqual([]);
  });
});

describe('a live submission is unchanged', () => {
  it('writes the submission to the database clock, with the signed-in requester’s facts, and asks for its approval as before', async () => {
    neighbours.createRequestFromCatalogue.mockResolvedValue({ id: TICKET, number: 'REQ-003500' });
    neighbours.requestApproval.mockResolvedValue(null);
    const requester = createContext({
      tenantId: TENANT,
      actor: { type: 'user', id: REQUESTER, displayName: 'Hamza Ali' },
      permissions: SYSTEM_PERMISSIONS,
      organisationIds: [ORG],
    });

    const result = await submitRequest(requester, 'laptop', { model: 'standard', executiveSpec: '64 GB', earlyBird: 'Week 38' });

    const [row] = db.created('formSubmission');
    // Today's row, key for key: `created_at` is the database's own clock.
    expect(Object.keys(row!).sort()).toEqual(['answers', 'formVersionId', 'id', 'requestTypeId', 'submittedBy', 'tenantId', 'ticketId'].sort());
    // Live "now" is today (2 October), so the September-only question is gone;
    // the requester is no VIP, so the executive one is too.
    expect(row!.answers).toEqual({ model: 'standard', dock: false });
    expect(result).toEqual({ ticketId: TICKET, ticketNumber: 'REQ-003500', submissionId: row!.id, approvalId: null });
    expect(neighbours.requestApproval).toHaveBeenCalledTimes(1);
    expect(neighbours.requestApproval.mock.calls[0]).toHaveLength(3);
    expect(db.created('auditEvent').map((audit) => audit.action)).toEqual(['request.submitted']);
  });
});
