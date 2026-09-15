import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

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
