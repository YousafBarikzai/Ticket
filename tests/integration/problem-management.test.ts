import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * MOD-08-E2 problem management, end to end.
 *
 * The module's argument is that the workaround comes before the root cause, so
 * the tests that matter are the ones about the workaround: that publishing one
 * makes the problem a known error in the same breath, that it stops being
 * offered the moment it is obsolete, and that the ticket count — the only thing
 * that gets a problem prioritised against feature work — cannot be inflated.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('problem');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('problem');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Problem {
  number: string;
  title: string;
  status: string;
  rootCause: string | null;
  knownError: { symptom: string; status: string; live: boolean; retiredReason: string | null; articleKey: string | null } | null;
  tickets: { count: number; workaroundApplied: number; ids: string[] };
  detail?: string;
}

async function raise(body: Record<string, unknown> = {}, token = asAgent()) {
  return request<{ number: string; status: string; detail?: string }>('/api/v1/problems', {
    method: 'POST',
    token,
    body: { title: 'The export button does nothing', ...body },
  });
}

async function get(number: string, token = asAgent()) {
  const response = await request<Problem>(`/api/v1/problems/${number}`, { token });
  expect(response.status).toBe(200);
  return response.body;
}

async function publishedEvents(type: string): Promise<{ payload: Record<string, unknown> }[]> {
  const { transaction, withContext } = await import('@itsm/platform');
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const rows = await tx.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'desc' }, take: 20 });
      return rows.map((row) => ({ payload: (row.envelope as { payload: Record<string, unknown> }).payload }));
    }),
  );
}

describe('raising one', () => {
  it('starts as investigating with no workaround and no cause', async () => {
    const raised = await raise();
    expect(raised.status).toBe(201);
    expect(raised.body.number).toMatch(/^PRB-\d{4}$/);

    const problem = await get(raised.body.number);
    expect(problem.status).toBe('investigating');
    expect(problem.knownError).toBeNull();
    expect(problem.rootCause).toBeNull();

    const events = await publishedEvents('problem.created');
    expect(events.some((event) => event.payload.number === raised.body.number)).toBe(true);
  });

  it('records where it came from, which is how you tell whether the practice works', async () => {
    const raised = await raise({ title: 'Raised by hand', raisedFrom: 'manual' });
    const listed = await request<{ data: { number: string; raisedFrom: string }[] }>('/api/v1/problems?open=true', {
      token: asAgent(),
    });
    expect(listed.body.data.find((row) => row.number === raised.body.number)?.raisedFrom).toBe('manual');
  });

  it('does not let a requester raise one', async () => {
    expect((await raise({}, asRequester())).status).toBe(403);
  });
});

describe('the ticket count, which is what gets it fixed', () => {
  let number: string;

  beforeAll(async () => {
    number = (await raise({ title: 'Count subject' })).body.number;
  });

  it('counts each ticket once, however many agents notice it', async () => {
    // Two agents linking the same ticket is what happens. A duplicate would
    // inflate the only number anybody uses to argue for the fix.
    const first = await request<{ linked: number; total: number }>(`/api/v1/problems/${number}/tickets`, {
      method: 'POST',
      token: asAgent(),
      body: { ticketIds: [tenant.ticketIds[0], tenant.ticketIds[1]] },
    });
    expect(first.body).toEqual({ linked: 2, total: 2 });

    const again = await request<{ linked: number; total: number }>(`/api/v1/problems/${number}/tickets`, {
      method: 'POST',
      token: asLead(),
      body: { ticketIds: [tenant.ticketIds[0]] },
    });
    expect(again.body).toEqual({ linked: 0, total: 2 });
  });

  it('still records that the workaround was applied to one already linked', async () => {
    // Already linked, but "the workaround worked here" is new information, so
    // it is not simply skipped.
    await request(`/api/v1/problems/${number}/tickets`, {
      method: 'POST',
      token: asAgent(),
      body: { ticketIds: [tenant.ticketIds[0]], workaroundApplied: true },
    });
    const problem = await get(number);
    expect(problem.tickets).toMatchObject({ count: 2, workaroundApplied: 1 });
  });

  it('refuses to link a ticket that does not exist', async () => {
    const attempt = await request(`/api/v1/problems/${number}/tickets`, {
      method: 'POST',
      token: asAgent(),
      body: { ticketIds: ['00000000-0000-0000-0000-0000000000ff'] },
    });
    expect(attempt.status).toBe(404);
  });

  it('can be unlinked when it turns out to be something else', async () => {
    const removed = await request(`/api/v1/problems/${number}/tickets/${tenant.ticketIds[1]}`, {
      method: 'DELETE',
      token: asAgent(),
    });
    expect(removed.status).toBe(204);
    expect((await get(number)).tickets.count).toBe(1);
  });
});

describe('the workaround', () => {
  let number: string;

  beforeAll(async () => {
    number = (await raise({ title: 'Workaround subject' })).body.number;
  });

  it('makes the problem a known error in the same breath', async () => {
    // There is no useful moment at which a workaround exists and the problem is
    // not a known error, so publishing does both.
    const published = await request(`/api/v1/problems/${number}/known-error`, {
      method: 'PUT',
      token: asLead(),
      body: {
        symptom: 'The export button does nothing and no file downloads.',
        workaround: 'Use Reports → Export instead; it uses the old path.',
        articleKey: 'export-button-workaround',
      },
    });
    expect(published.status).toBe(200);

    const problem = await get(number);
    expect(problem.status).toBe('known_error');
    expect(problem.knownError).toMatchObject({ status: 'published', live: true });
    // Published without a root cause, which is the whole argument of the module.
    expect(problem.rootCause).toBeNull();

    const events = await publishedEvents('knownerror.published');
    expect(events.some((event) => event.payload.number === number)).toBe(true);
  });

  it('is what an agent finds when they search before starting work', async () => {
    const found = await request<{ data: { problemNumber: string; workaround: string }[] }>(
      '/api/v1/known-errors?q=export',
      { token: asAgent() },
    );
    expect(found.status).toBe(200);
    expect(found.body.data.some((row) => row.problemNumber === number)).toBe(true);
  });

  it('is not an agent’s to publish', async () => {
    // Publishing puts words in front of every agent.
    const attempt = await request(`/api/v1/problems/${number}/known-error`, {
      method: 'PUT',
      token: asAgent(),
      body: { symptom: 'Something', workaround: 'Something else' },
    });
    expect(attempt.status).toBe(403);
  });

  it('is retired automatically when the problem is fixed', async () => {
    // The trap: a problem is fixed, nobody remembers the known error, and
    // agents go on applying a workaround for a bug that no longer exists.
    const resolved = await request(`/api/v1/problems/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'resolved', rootCause: 'The export path was removed in release 4.2.' },
    });
    expect(resolved.status).toBe(200);

    const problem = await get(number);
    expect(problem.status).toBe('resolved');
    expect(problem.knownError).toMatchObject({ status: 'retired', live: false });
    expect(problem.knownError!.retiredReason).toMatch(/resolved/);

    // And it stops being offered to the next agent who searches.
    const found = await request<{ data: { problemNumber: string }[] }>('/api/v1/known-errors?q=export', {
      token: asAgent(),
    });
    expect(found.body.data.some((row) => row.problemNumber === number)).toBe(false);

    const retired = await publishedEvents('knownerror.retired');
    const mine = retired.find((event) => event.payload.number === number);
    expect(mine).toBeDefined();
    // The article carrying the same words is named, so it can be withdrawn too.
    expect(mine!.payload.articleKey).toBe('export-button-workaround');
  });

  it('cannot be published for something already fixed', async () => {
    const attempt = await request<{ detail: string }>(`/api/v1/problems/${number}/known-error`, {
      method: 'PUT',
      token: asLead(),
      body: { symptom: 'Still broken?', workaround: 'Try again' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/already fixed|resolved/);
  });

  it('reports how long the problem was open when it resolves', async () => {
    const events = await publishedEvents('problem.resolved');
    const mine = events.find((event) => event.payload.number === number);
    expect(mine).toBeDefined();
    expect(mine!.payload.rootCause).toMatch(/release 4.2/);
    expect(mine!.payload.openDays).toBeGreaterThanOrEqual(0);
  });
});

describe('calling something a known error without one', () => {
  it('is refused, because the workaround is the whole point of the state', async () => {
    const number = (await raise({ title: 'No workaround here' })).body.number;
    const attempt = await request<{ detail: string }>(`/api/v1/problems/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'known_error' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/workaround/);
  });

  it('and withdrawing one puts the problem back to investigating', async () => {
    // Without a workaround it is not a known error, and leaving the state would
    // show agents a list entry with nothing behind it.
    const number = (await raise({ title: 'Withdrawal subject' })).body.number;
    await request(`/api/v1/problems/${number}/known-error`, {
      method: 'PUT',
      token: asLead(),
      body: { symptom: 'A symptom', workaround: 'A workaround' },
    });
    expect((await get(number)).status).toBe('known_error');

    const withdrawn = await request(`/api/v1/problems/${number}/known-error`, {
      method: 'DELETE',
      token: asLead(),
      body: { reason: 'It stopped working after the patch.' },
    });
    expect(withdrawn.status).toBe(200);

    const problem = await get(number);
    expect(problem.status).toBe('investigating');
    expect(problem.knownError).toMatchObject({ status: 'retired' });
  });
});

describe('a severe major incident raises a problem by itself', () => {
  it('creates exactly one, whatever the review does afterwards', async () => {
    // The one place this module creates rather than suggests. It is safe
    // because it is bounded: one problem per major incident, and severe major
    // incidents are rare.
    const declared = await request<{ number: string }>('/api/v1/major-incidents', {
      method: 'POST',
      token: asLead(),
      body: {
        title: 'Payroll was unreachable',
        severity: 'SEV1',
        commanderId: tenant.people.lead!.id,
        ticketId: tenant.ticketIds[2],
      },
    });
    expect(declared.status).toBe(201);

    await request(`/api/v1/major-incidents/${declared.body.number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'resolved', note: 'Restored.' },
    });
    const action = await request<{ id: string }>(`/api/v1/major-incidents/${declared.body.number}/review/actions`, {
      method: 'POST',
      token: asLead(),
      body: { description: 'Find out why', ownerId: tenant.people.agent!.id },
    });
    expect(action.status).toBe(201);
    await request(`/api/v1/major-incidents/${declared.body.number}/review/publish`, {
      method: 'POST',
      token: asLead(),
    });

    const delivered = await drainEvents(tenant.id);
    expect(delivered).toBeGreaterThan(0);

    const problems = await request<{ data: { number: string; raisedFrom: string; ticketCount: number }[] }>(
      '/api/v1/problems?open=true',
      { token: asAdmin() },
    );
    const raised = problems.body.data.filter((row) => row.raisedFrom === 'major_incident');
    expect(raised).toHaveLength(1);
    // It brings the incident's ticket with it, so the count starts at one
    // rather than at nothing.
    expect(raised[0]!.ticketCount).toBe(1);

    // A replay must not make a second. `drainEvents` re-reads the outbox, so
    // running it again is the replay.
    await drainEvents(tenant.id);
    const after = await request<{ data: { raisedFrom: string }[] }>('/api/v1/problems?open=true', { token: asAdmin() });
    expect(after.body.data.filter((row) => row.raisedFrom === 'major_incident')).toHaveLength(1);
  });
});

describe('recurrence', () => {
  it('is suggested, never created', async () => {
    const { findRecurrences } = await import('@itsm/module-problem');
    const { withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);

    const before = await request<{ data: unknown[] }>('/api/v1/problems', { token: asAdmin() });
    const suggestions = await withContext(ctx, () => findRecurrences(ctx));
    const after = await request<{ data: unknown[] }>('/api/v1/problems', { token: asAdmin() });

    // Whatever it found, it wrote nothing: a wrong suggestion costs a glance,
    // a wrong problem is a permanent list entry nobody dares delete.
    expect(Array.isArray(suggestions)).toBe(true);
    expect(after.body.data.length).toBe(before.body.data.length);
  });
});
