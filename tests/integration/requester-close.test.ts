import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * A requester confirming a resolution (PA1, "Yes, it's fixed").
 *
 * `resolved → closed` is now a requester move, as `resolved → reopened`
 * already was. What must not come with it: closing a ticket nobody has
 * resolved, closing somebody else's ticket, or closing over a change the
 * requester has not seen.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('requester-close');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('requester-close');
  await closeHarness();
});

const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Ticket {
  number: string;
  status: string;
  statusCategory: string;
  closedAt: string | null;
  version: number;
}

/** A ticket raised for `requester`, walked by the agent to the given state. */
async function ticketIn(state: 'in_progress' | 'resolved', requester = tenant.people.requester!): Promise<Ticket> {
  const created = await request<Ticket>('/api/v1/tickets', {
    method: 'POST',
    token: asAgent(),
    body: { type: 'incident', title: 'Monitor flickers', sourceChannel: 'api', requesterId: requester.id, groupId: tenant.teamId },
  });
  expect(created.status).toBe(201);
  let ticket = created.body;
  for (const to of state === 'resolved' ? ['in_progress', 'resolved'] : ['in_progress']) {
    const moved = await request<Ticket>(`/api/v1/tickets/${ticket.number}/transitions`, { method: 'POST', token: asAgent(), body: { to } });
    expect(moved.status).toBe(200);
    ticket = moved.body;
  }
  return ticket;
}

function close(ticket: Ticket, token = asRequester(), version = ticket.version) {
  return request<Ticket & { detail?: string }>(`/api/v1/tickets/${ticket.number}/transitions`, {
    method: 'POST',
    token,
    headers: { 'if-match': `"${version}"` },
    body: { to: 'closed' },
  });
}

describe('a requester confirming a resolution', () => {
  it('closes their resolved ticket', async () => {
    const ticket = await ticketIn('resolved');
    const closed = await close(ticket);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'closed', statusCategory: 'closed', version: ticket.version + 1 });
    expect(closed.body.closedAt).not.toBeNull();

    // Recorded as theirs, like any other transition.
    const history = await request<{ entries: { kind: string; type?: string; actorId?: string; payload?: { to?: string } }[] }>(
      `/api/v1/tickets/${ticket.number}/timeline`,
      { token: asAgent() },
    );
    const change = history.body.entries.find((entry) => entry.type === 'status.changed' && entry.payload?.to === 'closed');
    expect(change?.actorId).toBe(tenant.people.requester!.id);
  });

  it('works for the affected user too, who is also the ticket\'s own', async () => {
    const created = await request<Ticket>('/api/v1/tickets', {
      method: 'POST',
      token: asAgent(),
      body: {
        type: 'incident',
        title: 'Raised on my behalf',
        sourceChannel: 'api',
        requesterId: tenant.people.otherRequester!.id,
        affectedUserId: tenant.people.requester!.id,
        groupId: tenant.teamId,
      },
    });
    expect(created.status).toBe(201);
    let ticket = created.body;
    for (const to of ['in_progress', 'resolved']) {
      ticket = (await request<Ticket>(`/api/v1/tickets/${ticket.number}/transitions`, { method: 'POST', token: asAgent(), body: { to } })).body;
    }
    expect((await close(ticket)).status).toBe(200);
  });
});

describe('what it does not allow', () => {
  it('refuses to close a ticket nobody has resolved', async () => {
    const ticket = await ticketIn('in_progress');
    const attempt = await close(ticket);
    expect(attempt.status).toBe(403);
    expect(attempt.body.detail).toContain('in_progress to closed');
  });

  it('refuses a ticket that is not theirs without saying it exists', async () => {
    const ticket = await ticketIn('resolved', tenant.people.otherRequester!);
    expect((await close(ticket)).status).toBe(404);
  });

  it('refuses a stale version, so a reopened-and-resolved-again ticket is not closed blind', async () => {
    const ticket = await ticketIn('resolved');
    const stale = await close(ticket, asRequester(), ticket.version - 1);
    expect(stale.status).toBe(409);
  });

  it('refuses a second close: closed is final', async () => {
    const ticket = await ticketIn('resolved');
    const first = await close(ticket);
    expect(first.status).toBe(200);
    expect((await close(first.body)).status).toBe(403);
  });

  it('leaves reopening as the other answer to a resolution', async () => {
    const ticket = await ticketIn('resolved');
    const reopened = await request<Ticket>(`/api/v1/tickets/${ticket.number}/transitions`, {
      method: 'POST',
      token: asRequester(),
      body: { to: 'reopened' },
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe('reopened');
  });
});
