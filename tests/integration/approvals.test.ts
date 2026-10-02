import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@itsm/platform';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestPerson,
  type TestTenant,
} from '../support/harness.js';

/**
 * Approvals (MOD-17), end to end.
 *
 * The cases worth proving are the ones that go wrong quietly: a person
 * approving their own request, a step whose approvers cannot be found, an
 * approval that can never reach its quorum, and a delegate deciding in someone
 * else's name. Each of those either blocks a change forever or waves it through
 * without a decision.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('approvals');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('approvals');
  await closeHarness();
});

async function platform() {
  return import('@itsm/platform');
}

/** Opens an approval directly, the way a catalogue request will in MOD-05. */
async function openApproval(options: {
  subjectId: string;
  ticketId?: string;
  subjectUserId?: string | null;
  policyKey?: string;
}) {
  const { transaction, withContext } = await platform();
  const { approvalService } = await import('@itsm/module-approvals');
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, (tx) =>
      approvalService.requestApproval(ctx, tx, {
        subjectType: 'request',
        subjectId: options.subjectId,
        ticketId: options.ticketId ?? null,
        subjectUserId: options.subjectUserId ?? null,
        facts: {},
      }),
    ),
  );
}

async function setManager(userId: string, managerId: string | null): Promise<void> {
  const { transaction, withContext } = await platform();
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, (tx) => tx.user.update({ where: { id: userId }, data: { managerId } })),
  );
}

const uuid = () => crypto.randomUUID();

describe('the policy a tenant starts with', () => {
  it('seeds the line-manager policy, published', async () => {
    const response = await request<{ data: { key: string; status: string }[] }>('/api/v1/approval-policies', {
      token: tenant.people.admin!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.find((policy) => policy.key === 'manager-approval')?.status).toBe('published');
  });
});

describe('opening an approval', () => {
  it('resolves the requester\'s line manager as the approver', async () => {
    await setManager(tenant.people.requester!.id, tenant.people.lead!.id);
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });
    expect(created).not.toBeNull();

    const view = await request<{ steps: { approverIds: string[]; status: string }[] }>(
      `/api/v1/approvals/${created!.id}`,
      { token: tenant.people.admin!.token },
    );
    expect(view.status).toBe(200);
    expect(view.body.steps[0]!.status).toBe('open');
    expect(view.body.steps[0]!.approverIds).toEqual([tenant.people.lead!.id]);
  });

  it('shows the approver their queue', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/approvals', {
      token: tenant.people.lead!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('skips a step whose approvers cannot be found rather than blocking on it', async () => {
    // Nobody above them in the chain: the step is skipped with a reason, and the
    // request settles instead of waiting on an approver who does not exist.
    await setManager(tenant.people.otherRequester!.id, null);
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.otherRequester!.id });

    const view = await request<{ status: string; steps: { status: string }[] }>(
      `/api/v1/approvals/${created!.id}`,
      { token: tenant.people.admin!.token },
    );
    expect(view.body.steps[0]!.status).toBe('skipped');
    expect(view.body.status).toBe('approved');
  });
});

describe('segregation of duties', () => {
  it('never lets someone approve their own request', async () => {
    // The requester is their own manager: the only resolvable approver is the
    // person the approval is for, so they must be removed and the step skipped.
    await setManager(tenant.people.spare!.id, tenant.people.spare!.id);
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.spare!.id });

    const view = await request<{ steps: { approverIds: string[]; status: string }[] }>(
      `/api/v1/approvals/${created!.id}`,
      { token: tenant.people.admin!.token },
    );
    expect(view.body.steps[0]!.approverIds).not.toContain(tenant.people.spare!.id);
    expect(view.body.steps[0]!.status).toBe('skipped');
  });
});

describe('deciding', () => {
  it('approves, and settles the request', async () => {
    await setManager(tenant.people.requester!.id, tenant.people.lead!.id);
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });

    const decided = await request<{ requestStatus: string }>(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { decision: 'approved', comment: 'fine by me' },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.requestStatus).toBe('approved');
  });

  it('rejects, and settles the request the other way', async () => {
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });
    const decided = await request<{ requestStatus: string }>(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { decision: 'rejected', comment: 'not this quarter' },
    });
    expect(decided.body.requestStatus).toBe('rejected');
  });

  it('hides the approval from somebody who is not party to it', async () => {
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });
    // 404 rather than 403: whether a given person is an approver is itself
    // information about the approval.
    const response = await request(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: tenant.people.otherAgent!.token,
      body: { decision: 'approved' },
    });
    expect(response.status).toBe(404);
  });

  it('refuses a second decision from the same approver', async () => {
    const created = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });
    await request(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { decision: 'approved' },
    });
    const again = await request(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { decision: 'rejected' },
    });
    expect(again.status).toBe(409);
  });

  it('records the decision in the audit trail', async () => {
    const audit = await request<{ data: { action: string }[] }>('/api/v1/audit-events?limit=200', {
      token: tenant.people.admin!.token,
    });
    const actions = audit.body.data.map((row) => row.action);
    expect(actions).toContain('approval.decided');
    expect(actions).toContain('approval.requested');
  });
});

describe('withdrawn with the ticket (ADR-0059)', () => {
  // A request cancelled while its approval waited used to leave that approval
  // open: the approver kept being asked to decide something nobody wanted, and
  // a decision had nothing left to act on. Ending the ticket now withdraws it.

  interface ApprovalView {
    status: string;
    outcome: string | null;
    decidedAt: string | null;
    steps: { status: string; decidedAt: string | null; approverIds: string[] }[];
  }

  interface Problem {
    detail?: string;
  }

  const CANCELLED_SENTENCE = 'This approval was withdrawn because its ticket was cancelled';
  const CLOSED_SENTENCE = 'This approval was withdrawn because its ticket was closed';

  /**
   * Raises a catalogue request as the requester. The tenant's seeded policy
   * ("Line manager approves") opens its approval in the same transaction.
   */
  async function submitRequest(): Promise<{ ticketId: string; ticketNumber: string; approvalId: string }> {
    await setManager(tenant.people.requester!.id, tenant.people.lead!.id);
    const submitted = await request<{ ticketId: string; ticketNumber: string; approvalId: string | null }>(
      '/api/v1/catalogue/system-access/submit',
      {
        method: 'POST',
        token: tenant.people.requester!.token,
        body: { answers: { system: 'crm', accessLevel: 'read' } },
      },
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.approvalId).not.toBeNull();
    // Whatever another case left behind is settled first, so each case reads
    // only what its own ticket did.
    await drainEvents(tenant.id);
    return { ...submitted.body, approvalId: submitted.body.approvalId! };
  }

  async function transition(ticketNumber: string, to: string, token = tenant.people.admin!.token): Promise<void> {
    const moved = await request(`/api/v1/tickets/${ticketNumber}/transitions`, {
      method: 'POST',
      token,
      body: { to, reason: `Moved to ${to} by the approvals suite` },
    });
    expect(moved.status).toBe(200);
  }

  async function view(approvalId: string): Promise<ApprovalView> {
    const response = await request<ApprovalView>(`/api/v1/approvals/${approvalId}`, { token: tenant.people.admin!.token });
    expect(response.status).toBe(200);
    return response.body;
  }

  /** Whoever the open step is waiting on: the line manager, or their delegate. */
  async function approverOf(approvalId: string): Promise<TestPerson> {
    const open = (await view(approvalId)).steps.find((step) => step.status === 'open');
    expect(open).toBeDefined();
    const person = Object.values(tenant.people).find((candidate) => open!.approverIds.includes(candidate.id));
    expect(person).toBeDefined();
    return person!;
  }

  async function waitingOn(person: TestPerson): Promise<string[]> {
    const listed = await request<{ data: { id: string }[] }>('/api/v1/approvals', { token: person.token });
    expect(listed.status).toBe(200);
    return listed.body.data.map((row) => row.id);
  }

  async function decideAs(person: TestPerson, approvalId: string, decision: 'approved' | 'rejected' = 'approved') {
    return request<Problem & { requestStatus?: string }>(`/api/v1/approvals/${approvalId}/decide`, {
      method: 'POST',
      token: person.token,
      body: { decision },
    });
  }

  /** Reads rows the API does not show (audit, outbox, facts) inside the tenant. */
  async function read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const { transaction, withContext } = await platform();
    const ctx = contextFor(tenant.id);
    return withContext(ctx, () => transaction(ctx, work));
  }

  let cancelledApproval: { ticketId: string; approvalId: string } | undefined;

  it('1. cancelling the ticket withdraws its pending approval', async () => {
    const submitted = await submitRequest();
    const approver = await approverOf(submitted.approvalId);
    expect(await waitingOn(approver)).toContain(submitted.approvalId);

    // The requester withdrawing their own request, as the Help Portal does.
    await transition(submitted.ticketNumber, 'cancelled', tenant.people.requester!.token);
    await drainEvents(tenant.id);

    const after = await view(submitted.approvalId);
    expect(after.status).toBe('cancelled');
    expect(after.outcome).toBe('withdrawn');
    expect(after.decidedAt).not.toBeNull();
    expect(after.steps.length).toBeGreaterThan(0);
    expect(after.steps.every((step) => step.status === 'cancelled')).toBe(true);
    expect(after.steps.every((step) => step.decidedAt !== null)).toBe(true);

    // Gone from the approver's list, and from the requester's own progress line.
    expect(await waitingOn(approver)).not.toContain(submitted.approvalId);
    const progress = await request<{ data: { id: string }[] }>(`/api/v1/approvals?ticketId=${submitted.ticketId}`, {
      token: tenant.people.requester!.token,
    });
    expect(progress.body.data.map((row) => row.id)).not.toContain(submitted.approvalId);

    // Deciding it answers with why, not with "already decided".
    const decided = await decideAs(approver, submitted.approvalId);
    expect(decided.status).toBe(409);
    expect(decided.body.detail).toBe(CANCELLED_SENTENCE);

    // The withdrawal is in the audit trail, as the person who cancelled.
    const audit = await read((tx) =>
      tx.auditEvent.findMany({ where: { action: 'approval.withdrawn', targetId: submitted.approvalId } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toEqual({ status: 'pending' });
    expect(audit[0]!.after).toEqual({ status: 'cancelled', reason: 'ticket-cancelled' });
    expect(audit[0]!.actorId).toBe(tenant.people.requester!.id);

    cancelledApproval = submitted;
  });

  it('2. closing the ticket withdraws it the same way', async () => {
    const submitted = await submitRequest();
    const approver = await approverOf(submitted.approvalId);

    await transition(submitted.ticketNumber, 'resolved');
    await transition(submitted.ticketNumber, 'closed');
    await drainEvents(tenant.id);

    const after = await view(submitted.approvalId);
    expect(after.status).toBe('cancelled');
    expect(after.outcome).toBe('withdrawn');
    expect(after.steps.every((step) => step.status === 'cancelled')).toBe(true);
    expect(await waitingOn(approver)).not.toContain(submitted.approvalId);

    const decided = await decideAs(approver, submitted.approvalId, 'rejected');
    expect(decided.status).toBe(409);
    expect(decided.body.detail).toBe(CLOSED_SENTENCE);

    const audit = await read((tx) =>
      tx.auditEvent.findMany({ where: { action: 'approval.withdrawn', targetId: submitted.approvalId } }),
    );
    expect(audit.map((row) => row.after)).toEqual([{ status: 'cancelled', reason: 'ticket-closed' }]);
  });

  it('3. resolving the ticket withdraws nothing, because it can be reopened', async () => {
    const submitted = await submitRequest();
    const approver = await approverOf(submitted.approvalId);

    await transition(submitted.ticketNumber, 'resolved');
    await drainEvents(tenant.id);

    const after = await view(submitted.approvalId);
    expect(after.status).toBe('pending');
    expect(after.outcome).toBeNull();
    expect(after.steps.some((step) => step.status === 'open')).toBe(true);
    expect(await waitingOn(approver)).toContain(submitted.approvalId);
  });

  it('4. leaves an approval that was already decided exactly as it was', async () => {
    const submitted = await submitRequest();
    const approver = await approverOf(submitted.approvalId);
    const approved = await decideAs(approver, submitted.approvalId);
    expect(approved.status).toBe(200);
    expect(approved.body.requestStatus).toBe('approved');
    // The catalogue moves the request on once it is approved.
    await drainEvents(tenant.id);
    const before = await view(submitted.approvalId);

    await transition(submitted.ticketNumber, 'cancelled');
    await drainEvents(tenant.id);

    const after = await view(submitted.approvalId);
    expect(after.status).toBe('approved');
    expect(after.outcome).toBe('approved');
    expect(after.decidedAt).toBe(before.decidedAt);
    expect(after.steps.map((step) => step.status)).toEqual(before.steps.map((step) => step.status));

    const withdrawals = await read(async (tx) => ({
      audit: await tx.auditEvent.count({ where: { action: 'approval.withdrawn', targetId: submitted.approvalId } }),
      events: await tx.outboxEvent.count({ where: { type: 'approval.cancelled', aggregateId: submitted.approvalId } }),
    }));
    expect(withdrawals).toEqual({ audit: 0, events: 0 });
  });

  it('5. publishes approval.cancelled to the outbox, once', async () => {
    expect(cancelledApproval).toBeDefined();
    const { ticketId, approvalId } = cancelledApproval!;
    // A second delivery of the same status change finds nothing left to withdraw.
    await drainEvents(tenant.id);

    const rows = await read((tx) =>
      tx.outboxEvent.findMany({ where: { type: 'approval.cancelled', aggregateId: approvalId } }),
    );
    expect(rows).toHaveLength(1);
    const envelope = rows[0]!.envelope as { version: number; payload: Record<string, unknown> };
    expect(envelope.version).toBe(1);
    expect(envelope.payload).toEqual({
      requestId: approvalId,
      subjectType: 'request',
      subjectId: ticketId,
      ticketId,
      reason: 'ticket-cancelled',
    });
  });

  it('projects a withdrawn approval with no decider and no turnaround', async () => {
    expect(cancelledApproval).toBeDefined();
    const fact = await read((tx) => tx.factApproval.findFirst({ where: { requestId: cancelledApproval!.approvalId } }));
    expect(fact).not.toBeNull();
    expect(fact!.outcome).toBe('withdrawn');
    expect(fact!.decidedAt).not.toBeNull();
    expect(fact!.deciderId).toBeNull();
    expect(fact!.turnaroundMinutes).toBeNull();

    // Turnaround is measured over decisions only: approvals decided above are
    // in it, and no withdrawn one is.
    const turnaround = await request<{ groups?: { key: string | null; value: number | null }[] }>(
      '/api/v1/analytics/query',
      {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: { metricKey: 'approvals.turnaround', range: '30d', groupBy: 'outcome' },
      },
    );
    expect(turnaround.status).toBe(200);
    const outcomes = (turnaround.body.groups ?? []).map((group) => group.key);
    expect(outcomes).toContain('approved');
    expect(outcomes).not.toContain('withdrawn');
  });
});

describe('delegation', () => {
  it('lets a delegate decide in the approver\'s name, and records both', async () => {
    const now = Date.now();
    const created = await request('/api/v1/approval-delegations', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: {
        toUserId: tenant.people.agent!.id,
        startsAt: new Date(now - 3_600_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
        reason: 'annual leave',
      },
    });
    expect(created.status).toBe(201);

    const approval = await openApproval({ subjectId: uuid(), subjectUserId: tenant.people.requester!.id });
    // The step resolved to the manager, then redirected to their delegate.
    const view = await request<{ steps: { approverIds: string[] }[] }>(`/api/v1/approvals/${approval!.id}`, {
      token: tenant.people.admin!.token,
    });
    expect(view.body.steps[0]!.approverIds).toEqual([tenant.people.agent!.id]);

    const decided = await request<{ requestStatus: string }>(`/api/v1/approvals/${approval!.id}/decide`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { decision: 'approved' },
    });
    expect(decided.body.requestStatus).toBe('approved');

    const { transaction, withContext } = await platform();
    const ctx = contextFor(tenant.id);
    const decisions = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.approvalDecision.findMany({ orderBy: { decidedAt: 'desc' }, take: 1 })),
    );
    // The person who owed the decision and the person who made it are both kept.
    expect(decisions[0]!.approverId).toBe(tenant.people.agent!.id);
  });

  it('refuses a delegation to oneself', async () => {
    const now = Date.now();
    const response = await request('/api/v1/approval-delegations', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {
        toUserId: tenant.people.agent!.id,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
      },
    });
    expect(response.status).toBe(422);
  });
});

describe('policy administration', () => {
  it('refuses a policy naming approvers this phase cannot resolve', async () => {
    const response = await request<{ detail: string }>('/api/v1/approval-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'needs-catalogue',
        name: 'Service owner approves',
        subjectType: 'request',
        steps: [{ name: 'Owner', approvers: [{ kind: 'serviceOwner' }] }],
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/cannot be resolved yet/);
  });

  it('refuses an agent the policy list', async () => {
    const response = await request('/api/v1/approval-policies', { token: tenant.people.agent!.token });
    expect(response.status).toBe(403);
  });
});
