import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { jobService } from '@itsm/module-migration';
import type { GatewayResponse } from '@itsm/module-integrations';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * Migration (MOD-24).
 *
 * The unit tests prove the mapping and the paging. This proves the move: a
 * CSV of teams and one of users, then the tickets from a ServiceNow-shaped
 * API through a stubbed gateway, then the journal as a separate export. Dry
 * run first, with nothing written; then the commit, with everything the
 * dry run said; then the same commit again, with nothing doubled. And the
 * point of ADR-0036: an imported ticket is resolved when it arrives, dated
 * when it was raised, findable in search, counted in reporting — and has no
 * SLA clock and sent nobody an email.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('migration');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('migration');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

interface Job {
  id: string;
  status: string;
  mode: string;
  counts: { seen: number; created: number; updated: number; unchanged: number; failed: number };
  error: string | null;
}

interface Record_ {
  rowNumber: number;
  externalKey: string | null;
  outcome: string;
  entityId: string | null;
  problems: string[];
}

async function upload(filename: string, content: string): Promise<string> {
  const response = await request<{ id: string }>('/api/v1/import/files', {
    method: 'POST',
    token: asAdmin(),
    headers: { 'content-type': 'text/csv', 'x-filename': filename },
    body: content,
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

/** Creates a job through the API and runs it in place, the way the worker would. */
async function runJob(body: unknown, deps: Parameters<typeof jobService.runJob>[2] = {}): Promise<{ job: Job; records: Record_[] }> {
  const created = await request<Job>('/api/v1/import/jobs', { method: 'POST', token: asAdmin(), body });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const context = ctx();
  await withContext(context, () => jobService.runJob(context, created.body.id, deps));
  const job = await request<Job>(`/api/v1/import/jobs/${created.body.id}`, { token: asAdmin() });
  const records = await request<{ data: Record_[] }>(`/api/v1/import/jobs/${created.body.id}/records`, { token: asAdmin() });
  return { job: job.body, records: records.body.data };
}

async function commit(jobId: string, deps: Parameters<typeof jobService.runJob>[2] = {}): Promise<{ job: Job; records: Record_[] }> {
  const committed = await request<Job>(`/api/v1/import/jobs/${jobId}/commit`, { method: 'POST', token: asAdmin() });
  expect(committed.status).toBe(201);
  const context = ctx();
  await withContext(context, () => jobService.runJob(context, committed.body.id, deps));
  const job = await request<Job>(`/api/v1/import/jobs/${committed.body.id}`, { token: asAdmin() });
  const records = await request<{ data: Record_[] }>(`/api/v1/import/jobs/${committed.body.id}/records`, { token: asAdmin() });
  return { job: job.body, records: records.body.data };
}

/** A gateway that answers one ServiceNow-shaped page. */
function servicenowGateway(rows: unknown[]) {
  const calls: { url: string; credential: unknown }[] = [];
  const callGateway = (async (_ctx: unknown, req: { url: string; credential?: unknown }) => {
    calls.push({ url: req.url, credential: req.credential ?? null });
    return { status: 200, headers: {}, body: { result: rows }, durationMs: 1 } satisfies GatewayResponse;
  }) as never;
  return { callGateway, calls };
}

describe('who may', () => {
  it('keeps imports to the administrator', async () => {
    expect((await request('/api/v1/import/jobs', { token: asLead() })).status).toBe(403);
    expect((await request('/api/v1/import/sources', { token: asAdmin() })).status).toBe(200);
  });

  it('refuses a mapping for a field the entity does not have, before anything runs', async () => {
    const fileId = await upload('x.csv', 'id,name\n1,x\n');
    const refused = await request<{ detail: string }>('/api/v1/import/jobs', {
      method: 'POST',
      token: asAdmin(),
      body: { name: 'bad', entity: 'teams', source: 'csv', config: { fileId }, mapping: { externalKeyFrom: 'id', fields: { name: 'name', colour: 'colour' } } },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/colour/);
  });
});

describe('teams and users from CSV', () => {
  let usersDry: Job;

  it('imports teams, deriving keys from names', async () => {
    const fileId = await upload('groups.csv', 'sys_id,name,description\ng-1,Payroll Support,Pay queries\ng-2,"Network, Core",Switches and routers\n');
    const { job, records } = await runJob({
      name: 'teams',
      entity: 'teams',
      source: 'csv',
      config: { fileId },
      mapping: { externalKeyFrom: 'sys_id', fields: { name: 'name', description: 'description' } },
      mode: 'commit',
    });
    expect(job.status).toBe('completed');
    expect(job.counts).toMatchObject({ seen: 2, created: 2, failed: 0 });
    expect(records.map((row) => row.outcome)).toEqual(['created', 'created']);
    const team = await read((tx) => tx.team.findFirst({ where: { key: 'network-core' } }));
    expect(team?.name).toBe('Network, Core');
  });

  it('previews users on a dry run and writes nothing', async () => {
    const before = await read((tx) => tx.user.count());
    const fileId = await upload(
      'users.csv',
      'sys_id,email,name,groups\nu-1,ada@legacy.test,Ada Lovelace,g-1\nu-2,grace@legacy.test,Grace Hopper,"g-1,g-2"\nu-3,,Nobody,\n',
    );
    const { job, records } = await runJob({
      name: 'users',
      entity: 'users',
      source: 'csv',
      config: { fileId },
      mapping: { externalKeyFrom: 'sys_id', fields: { email: 'email', displayName: 'name', teams: 'groups' } },
    });
    usersDry = job;
    expect(job.mode).toBe('dry_run');
    expect(job.status).toBe('completed');
    expect(job.counts).toMatchObject({ seen: 3, created: 2, failed: 1 });
    expect(records.find((row) => row.rowNumber === 3)!.problems.join(' ')).toMatch(/no value for email/);
    expect(await read((tx) => tx.user.count())).toBe(before);
  });

  it('commits the dry run: the good rows land, in their teams, and the bad one is reported', async () => {
    const { job, records } = await commit(usersDry.id);
    expect(job.mode).toBe('commit');
    expect(job.counts).toMatchObject({ seen: 3, created: 2, failed: 1 });
    expect(records.filter((row) => row.outcome === 'created')).toHaveLength(2);

    const grace = await read((tx) => tx.user.findFirst({ where: { email: 'grace@legacy.test' } }));
    expect(grace?.displayName).toBe('Grace Hopper');
    const memberships = await read((tx) => tx.teamMembership.findMany({ where: { userId: grace!.id } }));
    expect(memberships).toHaveLength(2);
    const link = await read((tx) => tx.importLink.findFirst({ where: { entity: 'users', externalKey: 'u-2' } }));
    expect(link?.entityId).toBe(grace!.id);
  });

  it('leaves everything alone when the same commit runs again', async () => {
    const before = await read((tx) => tx.user.count());
    const { job } = await commit(usersDry.id);
    expect(job.counts).toMatchObject({ seen: 3, created: 0, unchanged: 2, failed: 1 });
    expect(await read((tx) => tx.user.count())).toBe(before);
  });
});

describe('tickets from a ServiceNow-shaped API', () => {
  const rows = [
    {
      sys_id: 't-1',
      number: 'INC0010001',
      short_description: 'Payslip shows the wrong tax code',
      description: 'Since the April run.',
      state: '6',
      priority: '2',
      caller_id: { value: 'u-1' },
      assigned_to: { value: 'u-2' },
      assignment_group: { value: 'g-1' },
      opened_at: '2024-04-08 09:15:00',
      resolved_at: '2024-04-09 16:40:00',
    },
    {
      sys_id: 't-2',
      number: 'INC0010002',
      short_description: 'Cannot reach the VPN',
      state: '99',
      priority: '3',
      caller_id: { value: 'u-1' },
      opened_at: '2024-05-01 08:00:00',
    },
    {
      sys_id: 't-3',
      number: 'INC0010003',
      short_description: 'New starter laptop',
      state: '7',
      priority: '4',
      caller_id: { value: 'newbie@legacy.test' },
      opened_at: '2024-06-02 10:00:00',
      closed_at: '2024-06-05 10:00:00',
    },
  ];
  let dry: Job;

  it('previews with the references resolved, and reports the state the map does not name', async () => {
    const stub = servicenowGateway(rows);
    const result = await runJob(
      { name: 'incidents', entity: 'tickets', source: 'servicenow', config: { baseUrl: 'https://acme.service-now.com', credentialRef: 'snow-basic' }, mode: 'dry_run' },
      { callGateway: stub.callGateway },
    );
    dry = result.job;
    // The credential is not stored, so the run must not silently proceed
    // without it.
    expect(dry.status).toBe('failed');
    expect(dry.error).toMatch(/snow-basic/);
  });

  it('previews once the instance can be called', async () => {
    const stub = servicenowGateway(rows);
    const result = await runJob(
      { name: 'incidents', entity: 'tickets', source: 'servicenow', config: { baseUrl: 'https://acme.service-now.com' }, mode: 'dry_run' },
      { callGateway: stub.callGateway },
    );
    dry = result.job;
    expect(dry.status).toBe('completed');
    expect(dry.counts).toMatchObject({ seen: 3, created: 2, failed: 1 });
    expect(stub.calls[0]!.url).toMatch(/^https:\/\/acme\.service-now\.com\/api\/now\/table\/incident\?.*sysparm_offset=0/);
    const bad = result.records.find((row) => row.externalKey === 't-2')!;
    expect(bad.outcome).toBe('failed');
    expect(bad.problems.join(' ')).toMatch(/status "99" is not in valueMaps.status/);
    expect(await read((tx) => tx.ticket.count({ where: { sourceChannel: 'import' } }))).toBe(0);
  });

  it('commits: resolved on arrival, dated when raised, requester and team resolved, a stranger made external', async () => {
    const stub = servicenowGateway(rows);
    const { job, records } = await commit(dry.id, { callGateway: stub.callGateway });
    expect(job.counts).toMatchObject({ seen: 3, created: 2, failed: 1 });

    const first = await read((tx) => tx.ticket.findFirst({ where: { externalRef: 'INC0010001' } }));
    expect(first).not.toBeNull();
    expect(first!.status).toBe('resolved');
    expect(first!.statusCategory).toBe('resolved');
    expect(first!.priority).toBe('P2');
    expect(first!.sourceChannel).toBe('import');
    expect(first!.createdAt.toISOString()).toBe('2024-04-08T09:15:00.000Z');
    expect(first!.resolvedAt?.toISOString()).toBe('2024-04-09T16:40:00.000Z');
    const ada = await read((tx) => tx.user.findFirst({ where: { email: 'ada@legacy.test' } }));
    const grace = await read((tx) => tx.user.findFirst({ where: { email: 'grace@legacy.test' } }));
    const payroll = await read((tx) => tx.team.findFirst({ where: { key: 'payroll-support' } }));
    expect(first!.requesterId).toBe(ada!.id);
    expect(first!.assigneeId).toBe(grace!.id);
    expect(first!.groupId).toBe(payroll!.id);

    const third = await read((tx) => tx.ticket.findFirst({ where: { externalRef: 'INC0010003' } }));
    expect(third!.status).toBe('closed');
    const newbie = await read((tx) => tx.user.findFirst({ where: { email: 'newbie@legacy.test' } }));
    expect(newbie?.isExternal).toBe(true);
    expect(third!.requesterId).toBe(newbie!.id);
    expect(records.find((row) => row.externalKey === 't-3')!.problems.join(' ')).toMatch(/warning: requester newbie@legacy.test was not known/);
  });

  it('set no SLA clock running and sent nobody an email, but is in search and in the reporting facts', async () => {
    await drainEvents(tenant.id);
    const first = await read((tx) => tx.ticket.findFirst({ where: { externalRef: 'INC0010001' } }));
    expect(await read((tx) => tx.slaTimer.count({ where: { ticketId: first!.id } }))).toBe(0);
    expect(await read((tx) => tx.notification.count({ where: { ticketId: first!.id } }))).toBe(0);
    const indexed = await read((tx) => tx.searchDocument.findFirst({ where: { entityType: 'ticket', entityId: first!.id } }));
    expect(indexed).not.toBeNull();
    expect(indexed!.title).toContain('Payslip shows the wrong tax code');
    const fact = await read((tx) => tx.factTicket.findFirst({ where: { ticketId: first!.id } }));
    expect(fact).not.toBeNull();
    expect(fact!.status).toBe('resolved');
  });

  it('adds nothing when committed again', async () => {
    const stub = servicenowGateway(rows);
    const { job } = await commit(dry.id, { callGateway: stub.callGateway });
    expect(job.counts).toMatchObject({ created: 0, unchanged: 2, failed: 1 });
    expect(await read((tx) => tx.ticket.count({ where: { sourceChannel: 'import' } }))).toBe(2);
  });

  it('tells the administrator who started it how it went', async () => {
    const notification = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.admin!.id, templateKey: 'import.job.finished' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(notification).not.toBeNull();
    expect(notification!.body).toMatch(/Failed: 1/);
  });
});

describe('the journal as a separate export', () => {
  it('puts each entry on the ticket it belongs to, internal when it was a work note', async () => {
    const fileId = await upload(
      'journal.csv',
      'sys_id,element_id,element,value,sys_created_by,sys_created_on\nj-1,t-1,comments,Thanks for raising this,ada@legacy.test,2024-04-08 09:30:00\nj-2,t-1,work_notes,Tax code table was stale,grace@legacy.test,2024-04-09 16:00:00\nj-3,t-9,comments,Orphan,ada@legacy.test,2024-04-09 16:00:00\n',
    );
    const { job, records } = await runJob({
      name: 'journal',
      entity: 'comments',
      source: 'csv',
      config: { fileId },
      mapping: {
        externalKeyFrom: 'sys_id',
        fields: { ticket: 'element_id', body: 'value', author: 'sys_created_by', createdAt: 'sys_created_on', visibility: 'element' },
        valueMaps: { visibility: { comments: 'public', work_notes: 'internal' } },
      },
      mode: 'commit',
    });
    expect(job.counts).toMatchObject({ seen: 3, created: 2, failed: 1 });
    expect(records.find((row) => row.externalKey === 'j-3')!.problems.join(' ')).toMatch(/t-9 was not imported/);

    const ticket = await read((tx) => tx.ticket.findFirst({ where: { externalRef: 'INC0010001' } }));
    const comments = await read((tx) => tx.ticketComment.findMany({ where: { ticketId: ticket!.id }, orderBy: { createdAt: 'asc' } }));
    expect(comments.map((comment) => comment.visibility)).toEqual(['public', 'internal']);
    expect(comments[0]!.createdAt.toISOString()).toBe('2024-04-08T09:30:00.000Z');
    const grace = await read((tx) => tx.user.findFirst({ where: { email: 'grace@legacy.test' } }));
    expect(comments[1]!.authorId).toBe(grace!.id);
    expect(comments[1]!.channel).toBe('import');
  });
});
