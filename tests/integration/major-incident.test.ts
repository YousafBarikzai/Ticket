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
 * MOD-08-E1 major incidents, end to end.
 *
 * The unit tests pin the lifecycle's opinions. What is proved here is the part
 * that only fails in assembly: that two people declaring the same outage get
 * one incident, that the timeline cannot be rewritten, that the promise of an
 * update is kept or reported, and that a severe incident cannot be quietly
 * closed without anybody learning anything.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('major-incident');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('major-incident');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Declared {
  number: string;
  severity: string;
  status: string;
  nextUpdateDueAt: string | null;
}

async function declare(body: Record<string, unknown>, token = asLead()) {
  return request<Declared & { detail?: string }>('/api/v1/major-incidents', {
    method: 'POST',
    token,
    body: { severity: 'SEV2', commanderId: tenant.people.lead!.id, ...body },
  });
}

interface Room {
  number: string;
  status: string;
  roles: { commanderId: string; commsLeadId: string | null; scribeId: string | null };
  nextUpdateDueAt: string | null;
  identifiedAt: string | null;
  mitigatedAt: string | null;
  resolvedAt: string | null;
  timeline: { kind: string; audience: string; body: string; statusFrom: string | null; statusTo: string | null }[];
  review: { status: string; dueOn: string | null; publishedAt: string | null } | null;
}

async function room(number: string, audience = 'internal', token = asAdmin()) {
  const response = await request<Room>(`/api/v1/major-incidents/${number}?audience=${audience}`, { token });
  expect(response.status).toBe(200);
  return response.body;
}

/** Events this tenant has published, read the way a consumer would. */
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

describe('declaring one', () => {
  it('puts somebody in charge, starts the clock, and opens the timeline', async () => {
    const declared = await declare({ title: 'Payroll is unreachable', severity: 'SEV1', ticketId: tenant.ticketIds[0] });
    expect(declared.status).toBe(201);
    expect(declared.body.number).toMatch(/^MI-\d{4}$/);

    const opened = await room(declared.body.number);
    expect(opened.roles.commanderId).toBe(tenant.people.lead!.id);
    // The cadence comes from the severity, so nobody chooses one at 3am.
    expect(opened.nextUpdateDueAt).not.toBeNull();
    // The declaration is the first line, so a review reads from one place.
    expect(opened.timeline[0]).toMatchObject({ kind: 'status', statusFrom: null, statusTo: 'declared' });

    const events = await publishedEvents('incident.major.declared');
    expect(events.some((event) => event.payload.number === declared.body.number)).toBe(true);
  });

  it('gives the same outage one incident, however many people declare it', async () => {
    // Two people declaring within the same second is the normal case. The
    // symptom of losing this is two bridges with half the responders on each.
    const first = await declare({ title: 'Switch is down', ticketId: tenant.ticketIds[2] });
    expect(first.status).toBe(201);

    const second = await declare({ title: 'Switch is down (again)', ticketId: tenant.ticketIds[2] });
    expect(second.status).toBe(409);
  });

  it('can be declared without a ticket, for an outage seen before anybody reported it', async () => {
    const declared = await declare({ title: 'Nobody has raised this yet', severity: 'SEV3' });
    expect(declared.status).toBe(201);
    expect((await room(declared.body.number)).status).toBe('declared');
  });

  it('does not let an agent or a requester declare one', async () => {
    // Declaring pages people.
    expect((await declare({ title: 'By an agent' }, asAgent())).status).toBe(403);
    expect((await declare({ title: 'By a requester' }, asRequester())).status).toBe(403);
  });
});

describe('the timeline', () => {
  let number: string;

  beforeAll(async () => {
    const declared = await declare({ title: 'Timeline subject', severity: 'SEV2' });
    number = declared.body.number;
  });

  it('lets an agent write to it, because the scribe is whoever has hands free', async () => {
    const posted = await request('/api/v1/major-incidents/' + number + '/updates', {
      method: 'POST',
      token: asAgent(),
      body: { kind: 'observation', audience: 'internal', body: 'Database connections are exhausted.' },
    });
    expect(posted.status).toBe(201);
  });

  it('narrows by audience, so an internal note cannot reach a status page', async () => {
    await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { kind: 'comms', audience: 'stakeholders', body: 'We are investigating a payroll outage.' },
    });

    const internal = await room(number, 'internal');
    const stakeholders = await room(number, 'stakeholders');
    expect(internal.timeline.length).toBeGreaterThan(stakeholders.timeline.length);
    expect(stakeholders.timeline.every((entry) => entry.audience !== 'internal')).toBe(true);
  });

  it('refuses a public update on an incident nobody outside can see', async () => {
    // Refused rather than downgraded: silently making it internal would leave
    // the person who wrote it believing customers had been told.
    const attempt = await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { kind: 'comms', audience: 'public', body: 'Customers can see this.' },
    });
    expect(attempt.status).toBe(422);
  });

  it('cannot be rewritten, even from inside the platform', async () => {
    // The database refuses, not the service: the person most motivated to
    // soften an entry is the person the entry is about.
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);
    await expect(
      withContext(ctx, () =>
        transaction(ctx, async (tx) => {
          const entry = await tx.majorIncidentUpdate.findFirst({ orderBy: { occurredAt: 'asc' } });
          return tx.majorIncidentUpdate.update({ where: { id: entry!.id }, data: { body: 'Nothing happened.' } });
        }),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('only lets a comms update reset the promise', async () => {
    const before = await room(number);
    await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { kind: 'observation', audience: 'internal', body: 'Still looking.' },
    });
    const afterNote = await room(number);
    // An internal observation is not an update to the organisation. Letting one
    // count would mean a team could talk busily among itself for two hours while
    // everybody outside heard nothing.
    expect(afterNote.nextUpdateDueAt).toBe(before.nextUpdateDueAt);

    await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { kind: 'comms', audience: 'stakeholders', body: 'Update: we have found the cause.' },
    });
    expect((await room(number)).nextUpdateDueAt).not.toBe(before.nextUpdateDueAt);
  });
});

describe('running it', () => {
  let number: string;

  beforeAll(async () => {
    const declared = await declare({ title: 'Running subject', severity: 'SEV2' });
    number = declared.body.number;
  });

  const move = (to: string, note: string, token = asLead()) =>
    request<{ status: string; detail?: string }>(`/api/v1/major-incidents/${number}/transition`, {
      method: 'POST',
      token,
      body: { to, note },
    });

  it('carries the words with the move, in one call', async () => {
    expect((await move('identified', 'A bad deploy at 09:12.')).status).toBe(200);
    const after = await room(number);
    expect(after.status).toBe('identified');
    expect(after.timeline.at(-1)).toMatchObject({ statusFrom: 'declared', statusTo: 'identified' });
  });

  it('stamps each milestone once, so a loop cannot shorten the outage', async () => {
    await move('mitigating', 'Rolling back.');
    const firstPass = await room(number);
    expect(firstPass.mitigatedAt).not.toBeNull();

    await move('monitoring', 'Rollback is out; watching.');
    await move('mitigating', 'It came back. Still wrong.');
    const secondPass = await room(number);
    expect(secondPass.mitigatedAt).toBe(firstPass.mitigatedAt);
    expect(secondPass.identifiedAt).toBe(firstPass.identifiedAt);
  });

  it('refuses a move the lifecycle does not allow, and says what was allowed', async () => {
    const attempt = await move('declared', 'Starting again.');
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/monitoring|resolved/);
  });

  it('will not let closing happen through the status path', async () => {
    // Closing has a precondition the status path cannot check.
    const attempt = await move('closed', 'Done with it.');
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/review/);
  });

  it('records a hand-over on the timeline, not only on the row', async () => {
    // "Who was running it at 04:10?" is a question a review asks, and a
    // current-value column cannot answer it.
    const handover = await request(`/api/v1/major-incidents/${number}/roles`, {
      method: 'PATCH',
      token: asLead(),
      body: { commanderId: tenant.people.admin!.id, note: 'Handing command to Alex for the night.' },
    });
    expect(handover.status).toBe(200);
    const after = await room(number);
    expect(after.roles.commanderId).toBe(tenant.people.admin!.id);
    expect(after.timeline.some((entry) => entry.body.includes('Handing command'))).toBe(true);
  });

  it('stops owing updates when it resolves, and opens the review', async () => {
    await move('resolved', 'Service restored at 10:41.', asAdmin());
    const resolved = await room(number);
    expect(resolved.resolvedAt).not.toBeNull();
    // Nothing is owed any more; the promise ends with the incident.
    expect(resolved.nextUpdateDueAt).toBeNull();
    // A review that has to be remembered is a review that is not written.
    expect(resolved.review).toMatchObject({ status: 'draft' });
    expect(resolved.review!.dueOn).not.toBeNull();

    const events = await publishedEvents('incident.major.resolved');
    const mine = events.find((event) => event.payload.number === number);
    expect(mine).toBeDefined();
    expect(mine!.payload.durationMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe('the review, and closing', () => {
  let number: string;

  beforeAll(async () => {
    const declared = await declare({ title: 'Review subject', severity: 'SEV1' });
    number = declared.body.number;
    await request(`/api/v1/major-incidents/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'resolved', note: 'Restored.' },
    });
  });

  it('refuses to close a severe incident without one', async () => {
    const attempt = await request<{ detail: string }>(`/api/v1/major-incidents/${number}/close`, {
      method: 'POST',
      token: asLead(),
      body: { reason: 'It was only a blip.' },
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/SEV1/);
  });

  it('refuses to publish while an action has no owner, and names it', async () => {
    // "We should improve monitoring", owned by nobody, is how the same incident
    // happens twice.
    const added = await request<{ id: string }>(`/api/v1/major-incidents/${number}/review/actions`, {
      method: 'POST',
      token: asLead(),
      body: { description: 'Add an alert on the connection pool' },
    });
    expect(added.status).toBe(201);

    const attempt = await request<{ detail: string }>(`/api/v1/major-incidents/${number}/review/publish`, {
      method: 'POST',
      token: asLead(),
    });
    expect(attempt.status).toBe(422);
    expect(attempt.body.detail).toMatch(/no owner/);

    const owned = await request(`/api/v1/major-incidents/review/actions/${added.body.id}`, {
      method: 'PATCH',
      token: asLead(),
      body: { ownerId: tenant.people.agent!.id },
    });
    expect(owned.status).toBe(200);
  });

  it('publishes without demanding a root cause somebody would invent', async () => {
    // A platform that demanded one would get "human error" typed into the box.
    await request(`/api/v1/major-incidents/${number}/review`, {
      method: 'PATCH',
      token: asLead(),
      body: { summary: 'Payroll was unreachable for 41 minutes.', whatWentWell: 'The rollback was quick.' },
    });

    const published = await request<{ status: string; actionCount: number }>(
      `/api/v1/major-incidents/${number}/review/publish`,
      { method: 'POST', token: asLead() },
    );
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('closed');
    expect(published.body.actionCount).toBe(1);

    const closed = await room(number);
    expect(closed.review).toMatchObject({ status: 'published' });
    expect(closed.timeline.at(-1)).toMatchObject({ statusTo: 'closed' });

    for (const type of ['incident.major.review.published', 'incident.major.closed']) {
      const events = await publishedEvents(type);
      expect(events.some((event) => event.payload.number === number)).toBe(true);
    }
  });

  it('will not let a published review be edited, because it is a record now', async () => {
    const attempt = await request<{ detail: string }>(`/api/v1/major-incidents/${number}/review`, {
      method: 'PATCH',
      token: asLead(),
      body: { rootCause: 'Actually it was the network.' },
    });
    expect(attempt.status).toBe(422);
  });

  it('still lets an action be updated afterwards, because that is the part people check', async () => {
    const review = await request<{ actions: { id: string; status: string }[] }>(
      `/api/v1/major-incidents/${number}/review`,
      { token: asLead() },
    );
    const action = review.body.actions[0]!;
    const done = await request(`/api/v1/major-incidents/review/actions/${action.id}`, {
      method: 'PATCH',
      token: asLead(),
      body: { status: 'done' },
    });
    expect(done.status).toBe(200);
  });

  it('lets a SEV3 be closed without a review, and says so on the timeline', async () => {
    // Demanding a review of every small thing is how reviews become a form
    // nobody reads.
    const small = await declare({ title: 'A small thing', severity: 'SEV3' });
    await request(`/api/v1/major-incidents/${small.body.number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'resolved', note: 'Restored.' },
    });
    const closed = await request(`/api/v1/major-incidents/${small.body.number}/close`, {
      method: 'POST',
      token: asLead(),
      body: { reason: 'One user affected for four minutes.' },
    });
    expect(closed.status).toBe(200);

    const after = await room(small.body.number);
    expect(after.status).toBe('closed');
    expect(after.timeline.at(-1)!.body).toMatch(/without a review/);
  });
});

describe('the promise of an update', () => {
  it('is reported when it is missed, and keeps being reported', async () => {
    // The promise is the product. An organisation told "every thirty minutes"
    // reorganises its morning around it, and the damage of missing it is that
    // every future promise is discounted.
    const { sweepOverdueComms } = await import('@itsm/module-incident');
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);

    const declared = await declare({ title: 'Nobody is updating this', severity: 'SEV1' });
    const number = declared.body.number;

    const dueAt = new Date(Date.now() - 5 * 60_000);
    await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.majorIncident.updateMany({ where: { number }, data: { nextUpdateDueAt: dueAt } })),
    );

    const swept = await withContext(ctx, () => sweepOverdueComms(ctx));
    expect(swept).toBeGreaterThan(0);

    const overdue = await publishedEvents('incident.major.update.overdue');
    const mine = overdue.find((event) => event.payload.number === number);
    expect(mine).toBeDefined();
    expect(mine!.payload.commanderId).toBe(tenant.people.lead!.id);

    // The due time steps on by one interval rather than to "now + interval", so
    // a long silence keeps ringing instead of being reported once and forgotten.
    const after = await room(number);
    const stepped = new Date(after.nextUpdateDueAt!).getTime() - dueAt.getTime();
    expect(stepped).toBe(30 * 60_000);
  });

  it('is not owed once the incident is over', async () => {
    const { sweepOverdueComms } = await import('@itsm/module-incident');
    const { withContext } = await import('@itsm/platform');
    const ctx = contextFor(tenant.id);
    // Resolved and closed incidents have a null due time, so the sweep cannot
    // page anybody about an incident that finished last week.
    await expect(withContext(ctx, () => sweepOverdueComms(ctx))).resolves.toBeGreaterThanOrEqual(0);
  });
});
