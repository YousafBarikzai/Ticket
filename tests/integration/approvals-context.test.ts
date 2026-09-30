import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * What an approval says about itself (PA2, PA3) and `includeDecided` read as a
 * real boolean.
 *
 * The context an approver sees — the ticket, the requester, the answers — is
 * read without the approver's own ticket permissions, because a line manager
 * must see what they are approving. That makes the interesting cases the ones
 * about who else gets it: the requester, an administrator who may read every
 * approval, somebody asking about a ticket that is not theirs. Each of those is
 * a way to read a ticket through the approvals API that the tickets API would
 * refuse.
 */

let tenant: TestTenant;

interface Step {
  sequence: number;
  name: string;
  status: string;
  dueAt: string | null;
  quorum: number;
  decidedCount: number;
}

interface Subject {
  kind: string;
  ticketNumber?: string;
  title: string | null;
  itemName?: string;
  requesterName: string | null;
}

interface Answer {
  field: string;
  label: string;
  value: unknown;
  display: string;
}

interface Row {
  id: string;
  status: string;
  ticketId: string | null;
  stepCount: number;
  currentStep: Step | null;
  subject: Subject | null;
}

interface Detail extends Row {
  answers: Answer[] | null;
  steps: { approverIds: string[] }[];
}

/** A catalogue request raised by Ada, waiting on its first approval step. */
let raised: { ticketId: string; ticketNumber: string; approvalId: string };

const JUSTIFICATION = 'Quarterly reporting for the sales team';

beforeAll(async () => {
  tenant = await createTestTenant('approvals-context');

  // Two steps, so progress has somewhere to go: the lead first, then both the
  // agent and the spare person, who must all approve.
  const created = await request('/api/v1/approval-policies', {
    method: 'POST',
    token: tenant.people.admin!.token,
    body: {
      key: 'two-step-access',
      name: 'Access needs two sign-offs',
      subjectType: 'request',
      specificity: 900,
      steps: [
        { name: 'Line manager', approvers: [{ kind: 'user', userId: tenant.people.lead!.id }], timeout: 'P2D' },
        {
          name: 'System owners',
          approvers: [
            { kind: 'user', userId: tenant.people.agent!.id },
            { kind: 'user', userId: tenant.people.spare!.id },
          ],
          quorum: 'all',
        },
      ],
    },
  });
  expect(created.status).toBe(201);
  const published = await request('/api/v1/approval-policies/two-step-access/publish', {
    method: 'POST',
    token: tenant.people.admin!.token,
  });
  expect(published.status).toBe(200);

  const submitted = await request<{ ticketId: string; ticketNumber: string; approvalId: string | null }>(
    '/api/v1/catalogue/system-access/submit',
    {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: { system: 'crm', accessLevel: 'write', justification: JUSTIFICATION, until: '2026-12-31' } },
    },
  );
  expect(submitted.status).toBe(201);
  expect(submitted.body.approvalId).not.toBeNull();
  raised = {
    ticketId: submitted.body.ticketId,
    ticketNumber: submitted.body.ticketNumber,
    approvalId: submitted.body.approvalId!,
  };
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('approvals-context');
  await closeHarness();
});

async function queue(person: string, query = ''): Promise<{ status: number; rows: Row[] }> {
  const response = await request<{ data: Row[] }>(`/api/v1/approvals${query}`, { token: tenant.people[person]!.token });
  return { status: response.status, rows: response.body.data };
}

async function detail(person: string, id = raised.approvalId) {
  return request<Detail>(`/api/v1/approvals/${id}`, { token: tenant.people[person]!.token });
}

async function decide(person: string, decision: 'approved' | 'rejected', id = raised.approvalId) {
  const response = await request<{ requestStatus: string }>(`/api/v1/approvals/${id}/decide`, {
    method: 'POST',
    token: tenant.people[person]!.token,
    body: { decision, ...(decision === 'rejected' ? { comment: 'Not this quarter' } : {}) },
  });
  expect(response.status).toBe(200);
  return response.body;
}

describe('what an approver sees (PA2)', () => {
  it('lists the request with what it is about and how far it has got', async () => {
    const { status, rows } = await queue('lead');
    expect(status).toBe(200);
    const row = rows.find((candidate) => candidate.id === raised.approvalId);
    expect(row).toBeDefined();

    expect(row!.subject).toEqual({
      kind: 'request',
      ticketNumber: raised.ticketNumber,
      title: 'Access to a system',
      itemName: 'Access to a system',
      requesterName: tenant.people.requester!.displayName,
    });
    expect(row!.stepCount).toBe(2);
    expect(row!.currentStep).toMatchObject({ sequence: 1, name: 'Line manager', status: 'open', quorum: 1, decidedCount: 0 });
    // The step has a two-day timeout, so it has a due date.
    expect(Date.parse(row!.currentStep!.dueAt!)).toBeGreaterThan(Date.now());
  });

  it('shows the approver the answers in words, in the order the form asked them', async () => {
    const response = await detail('lead');
    expect(response.status).toBe(200);
    expect(response.body.answers).toEqual([
      { field: 'system', label: 'System', value: 'crm', display: 'CRM' },
      { field: 'accessLevel', label: 'Access level', value: 'write', display: 'Read and write' },
      { field: 'justification', label: 'Why you need it', value: JUSTIFICATION, display: JUSTIFICATION },
      { field: 'until', label: 'Needed until', value: '2026-12-31', display: '2026-12-31' },
    ]);
    expect(response.body.subject?.ticketNumber).toBe(raised.ticketNumber);
    // The detail keeps everything it had before.
    expect(response.body.steps).toHaveLength(2);
  });

  it('gives the requester progress on their own approval, but not the context', async () => {
    // Ada raised it, so she may read it; the context is for approvers, and she
    // can never be one of her own.
    const response = await detail('requester');
    expect(response.status).toBe(200);
    expect(response.body.subject).toBeNull();
    expect(response.body.answers).toBeNull();
    expect(response.body.currentStep).toMatchObject({ sequence: 1, name: 'Line manager' });
  });

  it('gives an administrator who may read every approval no context either', async () => {
    // approval.read at `any` is a reason to see that an approval exists, not a
    // way to read a ticket the tickets API would decide about on its own terms.
    const response = await detail('admin');
    expect(response.status).toBe(200);
    expect(response.body.subject).toBeNull();
    expect(response.body.answers).toBeNull();
    expect(response.body.stepCount).toBe(2);
  });

  it('still hides the approval from somebody who is not party to it', async () => {
    expect((await detail('otherAgent')).status).toBe(404);
  });

  it('does not list the request to a later approver before their step opens', async () => {
    const { rows } = await queue('agent');
    expect(rows.map((row) => row.id)).not.toContain(raised.approvalId);
  });
});

describe('progress through the steps', () => {
  it('moves to the second step once the first approves, and counts its decisions', async () => {
    expect((await decide('lead', 'approved')).requestStatus).toBe('pending');

    const agent = (await queue('agent')).rows.find((row) => row.id === raised.approvalId);
    expect(agent?.currentStep).toMatchObject({ sequence: 2, name: 'System owners', status: 'open', quorum: 2, decidedCount: 0 });
    expect(agent?.subject?.ticketNumber).toBe(raised.ticketNumber);

    await decide('agent', 'approved');
    const spare = (await queue('spare')).rows.find((row) => row.id === raised.approvalId);
    expect(spare?.currentStep).toMatchObject({ sequence: 2, decidedCount: 1, quorum: 2 });
  });

  it('keeps the context for an approver whose own step is behind them', async () => {
    // The lead decided step one. Asked for decided approvals too, they must
    // still recognise the request: a past approver is still an approver.
    const { rows } = await queue('lead', '?includeDecided=true');
    const row = rows.find((candidate) => candidate.id === raised.approvalId);
    expect(row?.subject?.title).toBe('Access to a system');
    expect(row?.currentStep?.sequence).toBe(2);
  });
});

describe('includeDecided is a real boolean', () => {
  it('reads false as false', async () => {
    // `z.coerce.boolean()` read the text "false" as true, so spelling out the
    // default listed every approval the lead had ever decided.
    const spelledOut = await queue('lead', '?includeDecided=false');
    expect(spelledOut.status).toBe(200);
    expect(spelledOut.rows.map((row) => row.id)).not.toContain(raised.approvalId);

    const absent = await queue('lead');
    expect(absent.rows.map((row) => row.id)).not.toContain(raised.approvalId);
  });

  it('reads true as true', async () => {
    const { rows } = await queue('lead', '?includeDecided=true');
    expect(rows.map((row) => row.id)).toContain(raised.approvalId);
  });

  it('refuses anything else rather than guessing', async () => {
    for (const value of ['1', 'yes', '']) {
      const response = await request(`/api/v1/approvals?includeDecided=${value}`, {
        token: tenant.people.lead!.token,
      });
      expect(response.status).toBe(422);
    }
  });
});

describe("the requester's progress on their own ticket (PA3)", () => {
  it('lists the approvals on a ticket for the person who raised it, with progress and no context', async () => {
    const { status, rows } = await queue('requester', `?ticketId=${raised.ticketId}`);
    expect(status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: raised.approvalId,
      ticketId: raised.ticketId,
      status: 'pending',
      stepCount: 2,
      subject: null,
    });
    expect(rows[0]!.currentStep).toMatchObject({ sequence: 2, name: 'System owners', decidedCount: 1, quorum: 2 });
    // Progress, not people: nothing in a row says who is deciding.
    expect(JSON.stringify(rows[0])).not.toContain(tenant.people.spare!.id);
  });

  it('answers somebody else asking about the ticket with an empty list', async () => {
    // Empty, not 403 or 404: the answer for "not yours" is the answer for "no
    // approvals", so the parameter cannot be used to find out whose requests
    // are waiting on a decision.
    for (const person of ['otherRequester', 'agent', 'otherAgent', 'lead']) {
      const { status, rows } = await queue(person, `?ticketId=${raised.ticketId}`);
      expect(status).toBe(200);
      expect(rows).toEqual([]);
    }
  });

  it('answers a ticket that does not exist the same way', async () => {
    const { status, rows } = await queue('requester', `?ticketId=${crypto.randomUUID()}`);
    expect(status).toBe(200);
    expect(rows).toEqual([]);
  });

  it('lets a reader of every approval see them, still without context', async () => {
    const { rows } = await queue('admin', `?ticketId=${raised.ticketId}`);
    expect(rows.map((row) => row.id)).toEqual([raised.approvalId]);
    expect(rows[0]!.subject).toBeNull();
  });

  it('includes the person the ticket affects', async () => {
    // "Own" in the portal means requester or affected user, and both see the
    // ticket waiting for approval.
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);
    await withContext(ctx, () =>
      transaction(ctx, (tx) =>
        tx.ticket.update({ where: { id: raised.ticketId }, data: { affectedUserId: tenant.people.otherRequester!.id } }),
      ),
    );
    const { rows } = await queue('otherRequester', `?ticketId=${raised.ticketId}`);
    expect(rows.map((row) => row.id)).toEqual([raised.approvalId]);
  });

  it('refuses a ticket id that is not an id', async () => {
    const response = await request(`/api/v1/approvals?ticketId=${raised.ticketNumber}`, {
      token: tenant.people.requester!.token,
    });
    expect(response.status).toBe(422);
  });

  it('drops a settled approval unless decided ones are asked for, and then it has no current step', async () => {
    const last = await decide('spare', 'approved');
    expect(last.requestStatus).toBe('approved');

    const pending = await queue('requester', `?ticketId=${raised.ticketId}`);
    expect(pending.rows).toEqual([]);

    const all = await queue('requester', `?ticketId=${raised.ticketId}&includeDecided=true`);
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ status: 'approved', currentStep: null, stepCount: 2 });
  });
});

describe('an approval whose subject cannot be found', () => {
  it('still lists, with an empty subject rather than an error', async () => {
    // Opened directly, the way a module with no ticket behind it would: the
    // approver still needs the row, and the reader falls back to the step name.
    const { transaction, withContext } = await import('@itsm/platform');
    const { approvalService } = await import('@itsm/module-approvals');
    const ctx = contextFor(tenant.id);
    const opened = await withContext(ctx, () =>
      transaction(ctx, (tx) =>
        approvalService.requestApproval(ctx, tx, {
          subjectType: 'request',
          subjectId: crypto.randomUUID(),
          subjectUserId: tenant.people.requester!.id,
          facts: {},
        }),
      ),
    );
    expect(opened).not.toBeNull();

    const row = (await queue('lead')).rows.find((candidate) => candidate.id === opened!.id);
    expect(row?.subject).toEqual({ kind: 'request', title: null, requesterName: null });
    expect(row?.currentStep?.name).toBe('Line manager');

    const view = await detail('lead', opened!.id);
    expect(view.status).toBe(200);
    // Not a catalogue request anyone can find, so there are no answers to show.
    expect(view.body.answers).toBeNull();
  });
});
