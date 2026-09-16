import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Who may watch what.
 *
 * `GET /events/stream` carries only change notices — `{entity, id, version,
 * action}` — and clients refetch through the API, so no ticket content travels
 * over it. That is the argument the endpoint was built on, and it is not quite
 * enough: the *timing* of a change and the fact that an id exists are both
 * real information, and the route used to hand out any topic that was asked
 * for. Anybody signed in could watch `ticket:<any id in their tenant>` and
 * learn, live, whenever somebody else touched a ticket they could not open.
 *
 * So every requested topic is now authorised at subscription time, using the
 * module's own check rather than a second one written here. These tests are
 * about the refusals; that notices arrive at all is the workbench's jsdom
 * tests and the walking skeleton.
 *
 * Each request is made with `accept: text/event-stream` and asserted on its
 * status alone: a refusal answers before any stream is opened, which is the
 * whole point — an accepted request would hold the connection open and hang
 * the suite.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('eventstream');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('eventstream');
  await closeHarness();
});

const stream = (topics: string, token: string) =>
  request(`/api/v1/events/stream?topics=${encodeURIComponent(topics)}`, {
    token,
    headers: { accept: 'text/event-stream' },
  });

describe('a topic naming a ticket', () => {
  it('is refused when the person cannot read that ticket', async () => {
    // A requester may see their own tickets. The third seed ticket belongs to
    // the other requester and sits in the other team's queue.
    const response = await stream(`ticket:${tenant.ticketIds[2]}`, tenant.people.otherRequester!.token);
    // 404 rather than 403: `requireVisible` refuses to confirm the id exists,
    // which is the same answer this person gets from `GET /tickets/:id`.
    expect([403, 404]).toContain(response.status);
  });

  it('is refused when the ticket does not exist at all', async () => {
    const response = await stream('ticket:00000000-0000-4000-8000-000000000000', tenant.people.agent!.token);
    expect([403, 404]).toContain(response.status);
  });
});

describe('a topic naming a queue', () => {
  it('is refused when it is not one of your teams', async () => {
    // A requester is in no team, so no group topic is theirs.
    const response = await stream(`group:${tenant.teamId}`, tenant.people.requester!.token);
    expect(response.status).toBe(403);
  });
});

describe('a topic naming a person', () => {
  it('is refused when it is somebody else', async () => {
    // Refused rather than quietly swapped for your own, so a client with the
    // wrong id is told it had the wrong id.
    const response = await stream(`user:${tenant.people.agent!.id}`, tenant.people.requester!.token);
    expect(response.status).toBe(403);
  });
});

describe('a topic that is not a topic', () => {
  it('refuses a kind nothing can be watched by', async () => {
    const response = await stream('invoice:1', tenant.people.agent!.token);
    expect(response.status).toBe(422);
  });

  it('refuses something with no id', async () => {
    const response = await stream('ticket', tenant.people.agent!.token);
    expect(response.status).toBe(422);
  });

  it('refuses an unknown query parameter, like every other route', async () => {
    const response = await request('/api/v1/events/stream?topic=ticket:1', {
      token: tenant.people.agent!.token,
      headers: { accept: 'text/event-stream' },
    });
    expect(response.status).toBe(422);
  });
});
