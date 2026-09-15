import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * MOD-08-E3 change management, end to end.
 *
 * The unit tests pin the three trades between control and coverage. What is
 * proved here is that they hold through the API: a blackout refuses, a standard
 * change needs no approval of its own, and an emergency change is recorded
 * before anybody signs it off — and then chased until somebody does.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('change');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('change');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Change {
  number: string;
  kind: string;
  status: string;
  approvalNote: string | null;
  retrospectiveApprovedAt: string | null;
  templateVersion: number | null;
  hasBackoutPlan: boolean;
  closeCode: string | null;
  inWindows?: string[];
  outsideWindows?: boolean;
  detail?: string;
}

async function raise(body: Record<string, unknown> = {}, token = asAgent()) {
  return request<Change>('/api/v1/changes', {
    method: 'POST',
    token,
    body: {
      title: 'Upgrade the database',
      kind: 'normal',
      backoutPlan: 'Restore the snapshot taken before the upgrade.',
      ...body,
    },
  });
}

const get = async (number: string, token = asAgent()) => {
  const response = await request<Change>(`/api/v1/changes/${number}`, { token });
  expect(response.status).toBe(200);
  return response.body;
};

describe('a normal change', () => {
  it('needs a back-out plan before it may be submitted', async () => {
    // The one field worth refusing over: a change nobody can undo at 2am is
    // what turns a bad deploy into an outage.
    const raised = await raise({ backoutPlan: undefined });
    expect(raised.status).toBe(201);
    const attempt = await request<{ detail: string }>(`/api/v1/changes/${raised.body.number}/submit`, {
      method: 'POST',
      token: asAgent(),
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/back-out plan/);
  });

  it('is approved with the reason recorded when no CAB policy matches', async () => {
    // A tenant that has not written a CAB policy is not asking for every change
    // to be blocked. What matters is that "approved because no policy applied"
    // is distinguishable from a change that slipped past one.
    const raised = await raise();
    const submitted = await request<Change>(`/api/v1/changes/${raised.body.number}/submit`, {
      method: 'POST',
      token: asAgent(),
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('approved');
    expect(submitted.body.approvalNote).toMatch(/no approval policy matched/);
  });

  it('is not a requester’s to raise', async () => {
    expect((await raise({}, asRequester())).status).toBe(403);
  });
});

describe('a blackout window', () => {
  let blackoutId: string;
  let number: string;

  beforeAll(async () => {
    const created = await request<{ id: string }>('/api/v1/change-windows', {
      method: 'POST',
      token: asAdmin(),
      body: {
        kind: 'blackout',
        name: 'Year-end close',
        reason: 'Finance cannot reconcile during a change.',
        timeZone: 'Europe/London',
        startsAt: '2025-12-24T00:00:00Z',
        endsAt: '2026-01-05T00:00:00Z',
      },
    });
    expect(created.status).toBe(201);
    blackoutId = created.body.id;

    const raised = await raise({ title: 'Blackout subject' });
    number = raised.body.number;
    await request(`/api/v1/changes/${number}/submit`, { method: 'POST', token: asAgent() });
  });

  it('refuses a change scheduled inside it, and names the reason', async () => {
    // Refused, not warned about. A warning is a thing people click through.
    const attempt = await request<{ detail: string }>(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2025-12-28T22:00:00Z', plannedEndAt: '2025-12-29T02:00:00Z' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/Year-end close/);
    expect(attempt.body.detail).toMatch(/reconcile/);
  });

  it('refuses a change that merely runs into it', async () => {
    // "It only overlaps by twenty minutes" is not an argument anybody wants to
    // be making during a freeze.
    const attempt = await request(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2025-12-23T20:00:00Z', plannedEndAt: '2025-12-24T02:00:00Z' },
    });
    expect(attempt.status).toBe(422);
  });

  it('lets a period outside it through', async () => {
    const scheduled = await request<Change>(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2025-11-15T22:00:00Z', plannedEndAt: '2025-11-16T02:00:00Z' },
    });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.status).toBe('scheduled');
  });

  it('stops refusing once it is retired', async () => {
    await request(`/api/v1/change-windows/${blackoutId}`, { method: 'DELETE', token: asAdmin() });
    const raised = await raise({ title: 'After the freeze lifted' });
    await request(`/api/v1/changes/${raised.body.number}/submit`, { method: 'POST', token: asAgent() });
    const scheduled = await request(`/api/v1/changes/${raised.body.number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2025-12-28T22:00:00Z', plannedEndAt: '2025-12-29T02:00:00Z' },
    });
    expect(scheduled.status).toBe(200);
  });

  it('is not an agent’s to declare', async () => {
    const attempt = await request('/api/v1/change-windows', {
      method: 'POST',
      token: asAgent(),
      body: { kind: 'blackout', name: 'By an agent', timeZone: 'Europe/London', startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-02-02T00:00:00Z' },
    });
    expect(attempt.status).toBe(403);
  });

  it('refuses a window that covers nothing at all', async () => {
    // The most dangerous row in the table: it looks like a control and is not.
    const attempt = await request('/api/v1/change-windows', {
      method: 'POST',
      token: asAdmin(),
      body: { kind: 'blackout', name: 'Covers nothing', timeZone: 'Europe/London' },
    });
    expect(attempt.status).toBe(422);
  });
});

describe('a standard change', () => {
  it('cannot be raised without a published template', async () => {
    const attempt = await raise({ kind: 'standard' });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/template/);
  });

  it('inherits its template’s approval, pinned to the version that was signed off', async () => {
    const created = await request('/api/v1/standard-changes', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key: 'restart-print-spooler',
        name: 'Restart the print spooler',
        risk: 'low',
        implementationPlan: 'Restart the service.',
        backoutPlan: 'It was already broken; nothing to undo.',
      },
    });
    expect(created.status).toBe(201);

    const published = await request<{ version: number }>('/api/v1/standard-changes/restart-print-spooler/publish', {
      method: 'POST',
      token: asAdmin(),
    });
    expect(published.status).toBe(200);

    const raised = await raise({
      kind: 'standard',
      templateKey: 'restart-print-spooler',
      title: 'Restart the spooler on PRINT01',
      backoutPlan: undefined,
    });
    expect(raised.status).toBe(201);
    // The plans came from the template, so the back-out check passes without
    // the person raising it retyping anything.
    expect(raised.body.hasBackoutPlan).toBe(true);

    const submitted = await request<Change>(`/api/v1/changes/${raised.body.number}/submit`, {
      method: 'POST',
      token: asAgent(),
    });
    expect(submitted.body.status).toBe('approved');
    expect(submitted.body.approvalNote).toMatch(/Pre-approved by standard change template/);
    expect(submitted.body.templateVersion).toBe(published.body.version);
  });

  it('will not publish a template with no back-out plan', async () => {
    // A standard change is the kind nobody looks at twice, so the moment
    // somebody needs the back-out plan is the moment nobody will write one.
    await request('/api/v1/standard-changes', {
      method: 'POST',
      token: asAdmin(),
      body: { key: 'no-backout', name: 'No way back', implementationPlan: 'Do the thing.' },
    });
    const attempt = await request<{ detail: string }>('/api/v1/standard-changes/no-backout/publish', {
      method: 'POST',
      token: asAdmin(),
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/back-out plan/);
  });

  it('refuses a draft template', async () => {
    const attempt = await raise({ kind: 'standard', templateKey: 'no-backout' });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/draft/);
  });
});

describe('an emergency change', () => {
  let number: string;

  it('is recorded first and scheduled immediately, with the debt written down', async () => {
    const raised = await raise({
      kind: 'emergency',
      title: 'Restart the payment gateway',
      backoutPlan: undefined,
    });
    expect(raised.status).toBe(201);
    number = raised.body.number;

    // No back-out plan demanded: it is already happening, and refusing to
    // record it is how emergency changes stop being recorded.
    const submitted = await request<Change>(`/api/v1/changes/${number}/submit`, {
      method: 'POST',
      token: asAgent(),
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('scheduled');
    expect(submitted.body.approvalNote).toMatch(/approval owed afterwards/);
    expect(submitted.body.retrospectiveApprovedAt).toBeNull();
  });

  it('appears on the list of approvals somebody still owes', async () => {
    const owed = await request<{ data: { number: string }[]; overdue: number }>(
      '/api/v1/changes/owed-retrospectives',
      { token: asLead() },
    );
    expect(owed.status).toBe(200);
    expect(owed.body.data.some((row) => row.number === number)).toBe(true);
  });

  it('is not approved by the person who made it', async () => {
    // The person who made the change at 3am is exactly the person who should
    // not be signing it off at 9am.
    const attempt = await request<{ detail: string }>(`/api/v1/changes/${number}/retrospective-approval`, {
      method: 'POST',
      token: asAgent(),
      body: { note: 'It was fine.' },
    });
    expect([403, 422]).toContain(attempt.status);
  });

  it('is signed off by somebody else, and leaves the owed list', async () => {
    const approved = await request<Change>(`/api/v1/changes/${number}/retrospective-approval`, {
      method: 'POST',
      token: asLead(),
      body: { note: 'Necessary; the gateway was down.' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.retrospectiveApprovedAt).not.toBeNull();

    const owed = await request<{ data: { number: string }[] }>('/api/v1/changes/owed-retrospectives', {
      token: asLead(),
    });
    expect(owed.body.data.some((row) => row.number === number)).toBe(false);
  });

  it('is approved once, not twice', async () => {
    const again = await request(`/api/v1/changes/${number}/retrospective-approval`, {
      method: 'POST',
      token: asAdmin(),
    });
    expect(again.status).toBe(422);
  });

  it('will not accept a retrospective approval for a normal change', async () => {
    const raised = await raise({ title: 'An ordinary change' });
    const attempt = await request(`/api/v1/changes/${raised.body.number}/retrospective-approval`, {
      method: 'POST',
      token: asLead(),
    });
    expect(attempt.status).toBe(422);
  });
});

describe('implementing and closing', () => {
  let number: string;

  beforeAll(async () => {
    const raised = await raise({ title: 'Closing subject' });
    number = raised.body.number;
    await request(`/api/v1/changes/${number}/submit`, { method: 'POST', token: asAgent() });
    await request(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2026-03-07T22:00:00Z', plannedEndAt: '2026-03-08T02:00:00Z' },
    });
  });

  const move = (to: string, body: Record<string, unknown> = {}) =>
    request<Change>(`/api/v1/changes/${number}/transition`, {
      method: 'POST',
      token: asAgent(),
      body: { to, ...body },
    });

  it('will not close a change with no outcome', async () => {
    await move('implementing');
    await move('review');
    const attempt = await request<{ detail: string }>(`/api/v1/changes/${number}/transition`, {
      method: 'POST',
      token: asAgent(),
      body: { to: 'closed' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/how it went/);
  });

  it('closes with a code, and reports whether it worked', async () => {
    const closed = await move('closed', { closeCode: 'backed_out', notes: 'The migration locked the table.' });
    expect(closed.status).toBe(200);
    expect(closed.body.closeCode).toBe('backed_out');

    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);
    const published = await withContext(ctx, () =>
      transaction(ctx, (tx) =>
        tx.outboxEvent.findMany({ where: { type: 'change.closed' }, orderBy: { createdAt: 'desc' }, take: 10 }),
      ),
    );
    const mine = published
      .map((row) => (row.envelope as { payload: Record<string, unknown> }).payload)
      .find((payload) => payload.number === number);
    expect(mine).toBeDefined();
    // Backing out is the process working, and still not the change having done
    // what it set out to do.
    expect(mine!.succeeded).toBe(false);
  });

  it('gives a change that has begun no way back', async () => {
    const raised = await raise({ title: 'No way back' });
    await request(`/api/v1/changes/${raised.body.number}/submit`, { method: 'POST', token: asAgent() });
    await request(`/api/v1/changes/${raised.body.number}/schedule`, {
      method: 'POST',
      token: asAgent(),
      body: { plannedStartAt: '2026-04-04T22:00:00Z', plannedEndAt: '2026-04-05T02:00:00Z' },
    });
    await request(`/api/v1/changes/${raised.body.number}/transition`, {
      method: 'POST',
      token: asAgent(),
      body: { to: 'implementing' },
    });
    const attempt = await request(`/api/v1/changes/${raised.body.number}/transition`, {
      method: 'POST',
      token: asAgent(),
      body: { to: 'cancelled' },
    });
    expect(attempt.status).toBe(422);
  });
});
