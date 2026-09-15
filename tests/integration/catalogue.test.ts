import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * The service catalogue and its forms (MOD-05, MOD-02), end to end.
 *
 * Submitting a request is the one place where an unprivileged person's input
 * becomes a ticket with a service, a group and a priority attached. The cases
 * here are the ones where that goes wrong: routing chosen by the requester, an
 * entitlement that only filters the list, and a form whose rules the browser
 * enforced but the server did not.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('catalogue');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('catalogue');
  await closeHarness();
});

describe('what a tenant starts with', () => {
  it('has a published item with a working form', async () => {
    const list = await request<{ data: { key: string; name: string }[] }>('/api/v1/catalogue', {
      token: tenant.people.requester!.token,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.map((item) => item.key)).toContain('system-access');

    const opened = await request<{ form: { schema: { properties: Record<string, unknown> } } | null }>(
      '/api/v1/catalogue/system-access',
      { token: tenant.people.requester!.token },
    );
    expect(opened.status).toBe(200);
    expect(Object.keys(opened.body.form!.schema.properties)).toContain('accessLevel');
  });
});

describe('submitting a request', () => {
  it('raises a ticket of type request, routed by the catalogue', async () => {
    const submitted = await request<{ ticketNumber: string; ticketId: string }>(
      '/api/v1/catalogue/system-access/submit',
      {
        method: 'POST',
        token: tenant.people.requester!.token,
        body: { answers: { system: 'crm', accessLevel: 'read' } },
      },
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.ticketNumber).toMatch(/^REQ-\d+$/);

    const ticket = await request<{ type: string; priority: string; serviceId: string | null; custom: Record<string, unknown> }>(
      `/api/v1/tickets/${submitted.body.ticketNumber}`,
      { token: tenant.people.agent!.token },
    );
    expect(ticket.body.type).toBe('request');
    expect(ticket.body.serviceId).not.toBeNull();
    expect(ticket.body.custom).toMatchObject({ system: 'crm', accessLevel: 'read' });
  });

  it('ignores routing and priority sent in the request body', async () => {
    // A requester who could name their own group could route work anywhere, and
    // one who could name their own priority could make everything a P1. The
    // schema has no way to express either; this proves it is not smuggled through.
    const submitted = await request<{ ticketNumber: string }>('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: {
        answers: { system: 'hr', accessLevel: 'read' },
        priority: 'P1',
        groupId: tenant.otherTeamId,
        type: 'incident',
      },
    });
    expect(submitted.status).toBe(201);

    const ticket = await request<{ priority: string; groupId: string | null; type: string }>(
      `/api/v1/tickets/${submitted.body.ticketNumber}`,
      { token: tenant.people.admin!.token },
    );
    expect(ticket.body.priority).toBe('P3');
    expect(ticket.body.groupId).not.toBe(tenant.otherTeamId);
    expect(ticket.body.type).toBe('request');
  });
});

describe('the server validates the form, not the browser', () => {
  it('refuses a submission missing a required answer', async () => {
    const response = await request<{ detail: string }>('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: { system: 'finance' } },
    });
    expect(response.status).toBe(422);
  });

  it('enforces a conditional requirement the browser would have shown', async () => {
    // Administrator access requires a justification; read access does not. The
    // condition is an expression, and the server runs the same one the browser did.
    const refused = await request('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: { system: 'finance', accessLevel: 'admin' } },
    });
    expect(refused.status).toBe(422);

    const accepted = await request('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: {
        answers: {
          system: 'finance',
          accessLevel: 'admin',
          justification: 'I run the month-end close and need to post journals.',
        },
      },
    });
    expect(accepted.status).toBe(201);
  });

  it('refuses a value outside the allowed set', async () => {
    const response = await request('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: { system: 'nuclear-launch', accessLevel: 'admin', justification: 'x'.repeat(30) } },
    });
    expect(response.status).toBe(422);
  });

  it('drops an answer to a field the person could not see', async () => {
    // `justification` is hidden when the level is `read`. A stale value left in
    // the browser must not be stored, and must not fail the submission either.
    const submitted = await request<{ ticketNumber: string }>('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: { system: 'crm', accessLevel: 'read', justification: 'left over from an earlier answer' } },
    });
    expect(submitted.status).toBe(201);

    const ticket = await request<{ custom: Record<string, unknown> }>(
      `/api/v1/tickets/${submitted.body.ticketNumber}`,
      { token: tenant.people.admin!.token },
    );
    expect(ticket.body.custom.justification).toBeUndefined();
  });
});

describe('entitlement', () => {
  const restricted = `directors-only-${Date.now()}`;

  beforeAll(async () => {
    const created = await request('/api/v1/request-types', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: restricted,
        serviceKey: 'business-applications',
        name: 'Director expenses card',
        // Only people holding the administrator role.
        entitlement: { in: ['administrator', { var: 'requester.roleKeys' }] },
      },
    });
    expect(created.status).toBe(201);
    await request(`/api/v1/request-types/${restricted}/publish`, {
      method: 'POST',
      token: tenant.people.admin!.token,
    });
  });

  it('hides an item the requester is not entitled to', async () => {
    // Its name alone discloses that such a thing exists and who is likely to
    // have one, so it must not appear at all.
    const list = await request<{ data: { key: string }[] }>('/api/v1/catalogue', {
      token: tenant.people.requester!.token,
    });
    expect(list.body.data.map((item) => item.key)).not.toContain(restricted);
  });

  it('shows it to somebody who is entitled', async () => {
    const list = await request<{ data: { key: string }[] }>('/api/v1/catalogue', {
      token: tenant.people.admin!.token,
    });
    expect(list.body.data.map((item) => item.key)).toContain(restricted);
  });

  it('refuses a submission from somebody who guessed the key', async () => {
    // Filtering the list is presentation; this is the control. 404 rather than
    // 403, so an item you cannot raise is indistinguishable from one that does
    // not exist.
    const response = await request(`/api/v1/catalogue/${restricted}/submit`, {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { answers: {} },
    });
    expect(response.status).toBe(404);
  });

  it('refuses to open it directly, too', async () => {
    const response = await request(`/api/v1/catalogue/${restricted}`, { token: tenant.people.requester!.token });
    expect(response.status).toBe(404);
  });
});

describe('form administration', () => {
  it('refuses a form whose element names a property that does not exist', async () => {
    const response = await request<{ detail: string }>('/api/v1/forms', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `broken-binding-${Date.now()}`,
        name: 'Broken binding',
        document: {
          key: 'broken-binding',
          schema: { type: 'object', properties: { real: { type: 'string' } } },
          ui: { elements: [{ kind: 'field', field: 'imaginary', control: 'text' }] },
        },
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/could not be filled in/);
  });

  it('refuses a form requiring something it never asks for', async () => {
    const response = await request('/api/v1/forms', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `unanswerable-${Date.now()}`,
        name: 'Unanswerable',
        document: {
          key: 'unanswerable',
          schema: {
            type: 'object',
            properties: { shown: { type: 'string' }, hidden: { type: 'string' } },
            required: ['hidden'],
          },
          ui: { elements: [{ kind: 'field', field: 'shown', control: 'text' }] },
        },
      },
    });
    expect(response.status).toBe(422);
  });

  it('refuses a condition that reads a path nothing provides', async () => {
    // `values.x` is the obvious guess and is always undefined — the condition
    // never holds, the field never appears, and nothing says why. Caught at
    // save, the same way the rules engine catches an unknown fact.
    const response = await request<{ detail: string }>('/api/v1/forms', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `wrong-path-${Date.now()}`,
        name: 'Reads the wrong path',
        document: {
          key: 'wrong-path',
          schema: { type: 'object', properties: { level: { type: 'string' }, why: { type: 'string' } } },
          ui: {
            elements: [
              { kind: 'field', field: 'level', control: 'text' },
              { kind: 'field', field: 'why', control: 'text', visibleWhen: { eq: [{ var: 'values.level' }, 'admin'] } },
            ],
          },
        },
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/could not be filled in/);
  });

  it('refuses a condition naming a property the schema does not have', async () => {
    const response = await request('/api/v1/forms', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `unknown-prop-${Date.now()}`,
        name: 'Condition on a missing property',
        document: {
          key: 'unknown-prop',
          schema: { type: 'object', properties: { level: { type: 'string' } } },
          ui: {
            elements: [
              { kind: 'field', field: 'level', control: 'text', visibleWhen: { eq: [{ var: 'form.absent' }, 'x'] } },
            ],
          },
        },
      },
    });
    expect(response.status).toBe(422);
  });

  it('accepts a condition that reads a real property under form.', async () => {
    const response = await request('/api/v1/forms', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `sound-condition-${Date.now()}`,
        name: 'Sound condition',
        document: {
          key: 'sound-condition',
          schema: { type: 'object', properties: { level: { type: 'string' }, why: { type: 'string' } } },
          ui: {
            elements: [
              { kind: 'field', field: 'level', control: 'text' },
              { kind: 'field', field: 'why', control: 'text', visibleWhen: { eq: [{ var: 'form.level' }, 'admin'] } },
            ],
          },
        },
      },
    });
    expect(response.status).toBe(201);
  });

  it('refuses a catalogue item pointing at an unpublished form', async () => {
    const response = await request('/api/v1/request-types', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `dangling-${Date.now()}`,
        serviceKey: 'business-applications',
        name: 'Points at nothing',
        formKey: 'no-such-form',
      },
    });
    expect(response.status).toBe(422);
  });
});

describe('approvals close the loop', () => {
  it('cancels the request when its approval is refused', async () => {
    // Without this a refused request sits in the queue looking actionable,
    // which is how one quietly gets fulfilled anyway.
    await request('/api/v1/approval-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: `catalogue-approval-${Date.now()}`,
        name: 'Every request needs the manager',
        subjectType: 'request',
        specificity: 900,
        steps: [{ name: 'Manager', approvers: [{ kind: 'user', userId: tenant.people.lead!.id }] }],
      },
    });
    const policies = await request<{ data: { key: string; subjectType: string }[] }>('/api/v1/approval-policies', {
      token: tenant.people.admin!.token,
    });
    const key = policies.body.data.find((p) => p.key.startsWith('catalogue-approval-'))!.key;
    await request(`/api/v1/approval-policies/${key}/publish`, { method: 'POST', token: tenant.people.admin!.token });

    const submitted = await request<{ ticketNumber: string; approvalId: string | null }>(
      '/api/v1/catalogue/system-access/submit',
      {
        method: 'POST',
        token: tenant.people.requester!.token,
        body: { answers: { system: 'hr', accessLevel: 'read' } },
      },
    );
    expect(submitted.body.approvalId).not.toBeNull();

    await request(`/api/v1/approvals/${submitted.body.approvalId}/decide`, {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { decision: 'rejected', comment: 'Not this quarter' },
    });
    await drainEvents(tenant.id);

    const ticket = await request<{ status: string }>(`/api/v1/tickets/${submitted.body.ticketNumber}`, {
      token: tenant.people.admin!.token,
    });
    expect(ticket.body.status).toBe('cancelled');
  });
});

describe('permissions', () => {
  it('refuses an agent the catalogue administration', async () => {
    const response = await request('/api/v1/services', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { key: 'nope', name: 'Nope' },
    });
    expect(response.status).toBe(403);
  });
});
