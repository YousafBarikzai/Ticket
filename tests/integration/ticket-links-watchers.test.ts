import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /tickets/:id/links` and `GET /tickets/:id/watchers` (WA5).
 *
 * Both lists are about other people's things — other tickets, other people —
 * so the tests are mostly about what each reader is *not* shown.
 */

let tenant: TestTenant;
let a: string;
let b: string;

interface Link {
  linkType: string;
  createdAt: string;
  ticket: { id: string; number: string; type: string; title: string; status: string; statusCategory: string };
}
interface Watcher {
  userId: string;
  reason: string;
  createdAt: string;
}

const token = (persona: string) => tenant.people[persona]!.token;

async function raise(title: string): Promise<string> {
  const created = await request<{ number: string }>('/api/v1/tickets', {
    method: 'POST',
    token: token('agent'),
    body: { type: 'incident', title, sourceChannel: 'api', requesterId: tenant.people.requester!.id, groupId: tenant.teamId },
  });
  expect(created.status).toBe(201);
  return created.body.number;
}

async function link(from: string, target: string, linkType: string, by = 'agent'): Promise<void> {
  const response = await request(`/api/v1/tickets/${from}/links`, { method: 'POST', token: token(by), body: { target, linkType } });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function links(number: string, persona: string): Promise<Link[]> {
  const response = await request<{ data: Link[] }>(`/api/v1/tickets/${number}/links`, { token: token(persona) });
  expect(response.status).toBe(200);
  return response.body.data;
}

async function watchers(number: string, persona: string): Promise<Watcher[]> {
  const response = await request<{ data: Watcher[] }>(`/api/v1/tickets/${number}/watchers`, { token: token(persona) });
  expect(response.status).toBe(200);
  return response.body.data;
}

beforeAll(async () => {
  tenant = await createTestTenant('links-watchers');
  a = await raise('Email is slow');
  b = await raise('Mail server disk is full');
  await link(a, b, 'caused_by');
  // Ticket 2 is the other team's: the agent cannot see it, the administrator
  // can, and a link made by the administrator does not change that.
  await link(a, tenant.ticketNumbers[2]!, 'related_to', 'admin');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('links-watchers');
  await closeHarness();
});

describe('links', () => {
  it('lists each relationship once, in the words that suit this side', async () => {
    const fromA = await links(a, 'admin');
    expect(fromA.map((row) => [row.linkType, row.ticket.number])).toEqual([
      ['caused_by', b],
      ['related_to', tenant.ticketNumbers[2]],
    ]);
    expect(fromA[0]!.ticket).toMatchObject({ title: 'Mail server disk is full', status: 'new', statusCategory: 'open', type: 'incident' });

    const fromB = await links(b, 'admin');
    expect(fromB.map((row) => [row.linkType, row.ticket.number])).toEqual([['blocks', a]]);
  });

  it('leaves out a linked ticket the reader may not see', async () => {
    const fromA = await links(a, 'agent');
    expect(fromA.map((row) => row.ticket.number)).toEqual([b]);
    expect(JSON.stringify(fromA)).not.toContain('Switch port is down');
  });

  it('is the ticket\'s to disclose: nobody who cannot see it gets a list', async () => {
    const response = await request(`/api/v1/tickets/${a}/links`, { token: token('otherAgent') });
    expect(response.status).toBe(404);
  });

  it('gives a requester only the tickets that are theirs', async () => {
    // Both are the requester's own; ticket 2 is theirs as well, which is why
    // they may see it when the agent may not.
    const fromA = await links(a, 'requester');
    expect(fromA.map((row) => row.ticket.number).sort()).toEqual([b, tenant.ticketNumbers[2]].sort());
    const other = await request(`/api/v1/tickets/${a}/links`, { token: token('otherRequester') });
    expect(other.status).toBe(404);
  });

  it('answers an unlinked ticket with an empty list', async () => {
    expect(await links(await raise('Nothing to do with anything'), 'agent')).toEqual([]);
  });
});

describe('watchers', () => {
  beforeAll(async () => {
    const added = await request(`/api/v1/tickets/${a}/watchers`, {
      method: 'POST',
      token: token('agent'),
      body: { userId: tenant.people.lead!.id },
    });
    expect(added.status).toBe(201);
  });

  it('shows the desk everybody who is told about the ticket, and why', async () => {
    const rows = await watchers(a, 'agent');
    expect(rows.map((row) => [row.userId, row.reason])).toEqual([
      [tenant.people.requester!.id, 'requester'],
      [tenant.people.lead!.id, 'manual'],
    ]);
    expect(rows.every((row) => !Number.isNaN(Date.parse(row.createdAt)))).toBe(true);
  });

  it('shows a requester only themselves', async () => {
    expect((await watchers(a, 'requester')).map((row) => row.userId)).toEqual([tenant.people.requester!.id]);
  });

  it('refuses a reader who cannot see the ticket without saying it exists', async () => {
    expect((await request(`/api/v1/tickets/${a}/watchers`, { token: token('otherAgent') })).status).toBe(404);
    expect((await request(`/api/v1/tickets/${a}/watchers`, { token: token('otherRequester') })).status).toBe(404);
  });

  it('404s for a ticket that does not exist', async () => {
    expect((await request('/api/v1/tickets/INC-999999/watchers', { token: token('admin') })).status).toBe(404);
  });
});
