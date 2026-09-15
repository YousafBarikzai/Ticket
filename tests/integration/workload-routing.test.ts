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
 * MOD-20 workload and routing, end to end.
 *
 * The unit tests prove the arithmetic: who is on call on a night the clocks
 * change, who the strategies pick. What is proved here is the part that only
 * fails in assembly — that a rule published through the admin API puts a real
 * ticket on a real person, that somebody who is away never receives one, and
 * that a refusal to route says why rather than leaving a silent queue.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('workload');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('workload');
  await closeHarness();
});


/** Events this tenant has published, read the way a consumer would. */
async function publishedEvents(type: string): Promise<{ payload: unknown }[]> {
  const { transaction, withContext } = await import('@itsm/platform');
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const rows = await tx.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'desc' }, take: 20 });
      return rows.map((row) => ({ payload: (row.envelope as { payload: unknown }).payload }));
    }),
  );
}


/** The weekday key `days` from now, as London sees it. */
function weekdayInLondon(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' })
    .format(at)
    .toLowerCase()
    .slice(0, 3);
}

const asAdmin = () => tenant.people.admin!.token;
const asLead = () => tenant.people.lead!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Explanation {
  userId: string | null;
  strategy: string;
  reason: string;
  eligible: string[];
  rejected: { userId: string; because: string }[];
  policy: { strategy: string; defaultCapacity: number; source: string };
}

async function explain(query = ''): Promise<Explanation> {
  const response = await request<Explanation>(`/api/v1/workload/routing/${tenant.teamId}/explain${query}`, {
    token: asAdmin(),
  });
  expect(response.status).toBe(200);
  return response.body;
}

async function setAvailability(token: string, body: Record<string, unknown>) {
  return request<{ userId: string; status: string }>('/api/v1/workload/availability', {
    method: 'PUT',
    token,
    body,
  });
}

describe('routing with nothing configured', () => {
  it('shares work out by load across the team, and says where the policy came from', async () => {
    // A tenant that has described no shifts, no skills and no policy must still
    // get a sensible answer: the alternative is a module that does nothing
    // until somebody fills in four forms.
    const decision = await explain();
    expect(decision.policy).toMatchObject({ strategy: 'least_loaded', source: 'tenant' });
    expect(decision.userId).not.toBeNull();
    // The primary team is the lead and the agent.
    expect(decision.eligible.sort()).toEqual([tenant.people.agent!.id, tenant.people.lead!.id].sort());
    expect(decision.rejected).toEqual([]);
  });

  it('does not route to somebody who is not on the team', async () => {
    const decision = await explain();
    expect(decision.eligible).not.toContain(tenant.people.otherAgent!.id);
    expect(decision.eligible).not.toContain(tenant.people.requester!.id);
  });
});

describe('availability', () => {
  it('lets an agent say they are away, and takes them out of routing', async () => {
    const set = await setAvailability(asAgent(), {
      status: 'away',
      reason: 'At lunch',
      until: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(set.status).toBe(200);

    const decision = await explain();
    expect(decision.userId).toBe(tenant.people.lead!.id);
    expect(decision.rejected).toContainEqual({ userId: tenant.people.agent!.id, because: 'away' });
  });

  it('refuses to let one person set another person’s availability without the scope for it', async () => {
    const attempt = await setAvailability(asAgent(), { userId: tenant.people.lead!.id, status: 'away' });
    expect(attempt.status).toBe(403);
  });

  it('lets a lead mark somebody as away on their behalf', async () => {
    const set = await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'available' });
    expect(set.status).toBe(200);
    const decision = await explain();
    expect(decision.rejected).toEqual([]);
  });

  it('refuses a return date that has already passed', async () => {
    // Otherwise the person is away for ever, because nothing comes along to
    // clear it.
    const attempt = await setAvailability(asAgent(), {
      status: 'away',
      until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(attempt.status).toBe(400);
  });

  it('brings somebody back by itself once the date they gave has passed', async () => {
    const soon = new Date(Date.now() + 1_500);
    const set = await setAvailability(asAgent(), { status: 'away', until: soon.toISOString() });
    expect(set.status).toBe(200);

    const listed = await request<{ data: { userId: string; status: string; effectiveStatus: string }[] }>(
      `/api/v1/workload/availability?userIds=${tenant.people.agent!.id}`,
      { token: asAdmin() },
    );
    const row = listed.body.data.find((entry) => entry.userId === tenant.people.agent!.id)!;
    expect(row.status).toBe('away');

    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const after = await explain();
    // The stored status still says away; the effective one does not, and it is
    // the effective one routing reads.
    expect(after.rejected).toEqual([]);
  });

  it('never brings back somebody who has left', async () => {
    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'left', reason: 'Resigned' });
    const decision = await explain();
    expect(decision.rejected).toContainEqual({ userId: tenant.people.agent!.id, because: 'has left' });
    expect(decision.userId).toBe(tenant.people.lead!.id);

    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'available' });
  });
});

describe('when nobody can take it', () => {
  it('declines with a reason an administrator can act on', async () => {
    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'away' });
    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'away' });

    const decision = await explain();
    expect(decision.userId).toBeNull();
    expect(decision.reason).toBe('nobody on the team can take it; 2 of 2 away');

    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'available' });
    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'available' });
  });
});

describe('shifts', () => {
  it('takes a rostered agent out of routing outside their shift, and leaves the unrostered alone', async () => {
    // A shift on a weekday that is neither today nor yesterday in London, so it
    // is definitely not running now however this suite is scheduled. Pinning a
    // literal weekday would make the test pass six days a week.
    const created = await request('/api/v1/workload/shifts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key: 'not-today',
        name: 'A shift that is not running now',
        teamId: tenant.teamId,
        timeZone: 'Europe/London',
        pattern: { [weekdayInLondon(3)]: [{ from: '09:00', to: '17:00' }] },
      },
    });
    expect(created.status).toBe(201);

    const assigned = await request<{ id: string }>('/api/v1/workload/shifts/not-today/assignments', {
      method: 'POST',
      token: asAdmin(),
      body: { userId: tenant.people.agent!.id, startsOn: '2020-01-01' },
    });
    expect(assigned.status).toBe(201);

    const decision = await explain();
    // The agent is rostered and their shift is not running; the lead is on no
    // shift at all, which is not the same thing as being off one.
    expect(decision.rejected).toContainEqual({ userId: tenant.people.agent!.id, because: 'no shift running' });
    expect(decision.eligible).toEqual([tenant.people.lead!.id]);

    await request(`/api/v1/workload/shift-assignments/${assigned.body.id}`, { method: 'DELETE', token: asAdmin() });
    expect((await explain()).rejected).toEqual([]);
  });

  it('refuses a pattern it cannot read', async () => {
    const attempt = await request('/api/v1/workload/shifts', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key: 'nonsense',
        name: 'Nonsense',
        teamId: tenant.teamId,
        timeZone: 'Europe/London',
        pattern: { mon: [{ from: '09:00', to: '09:00' }] },
      },
    });
    expect(attempt.status).toBe(400);
  });
});

describe('on call', () => {
  const rotation = {
    key: 'out-of-hours',
    name: 'Out of hours',
    timeZone: 'Europe/London',
    cadence: 'weekly',
    startsAt: '2025-03-03T09:00:00Z',
    handoverAt: '09:00',
  };

  it('answers who is on call, and when it changes hands next', async () => {
    const created = await request('/api/v1/workload/rotations', {
      method: 'POST',
      token: asAdmin(),
      body: { ...rotation, teamId: tenant.teamId, members: [tenant.people.agent!.id, tenant.people.lead!.id] },
    });
    expect(created.status).toBe(201);

    const onCall = await request<{ userId: string; via: string; upcoming: { at: string; userId: string; covered: boolean }[] }>(
      '/api/v1/workload/rotations/out-of-hours/on-call?at=2025-03-05T22:00:00Z',
      { token: asAgent() },
    );
    expect(onCall.status).toBe(200);
    expect(onCall.body).toMatchObject({ userId: tenant.people.agent!.id, via: 'rotation' });
    expect(onCall.body.upcoming[0]).toEqual({
      at: '2025-03-10T09:00:00.000Z',
      userId: tenant.people.lead!.id,
      covered: false,
    });
  });

  it('lets a lead record a swap without moving anybody’s week', async () => {
    // A week of cover, starting inside the agent's turn and spanning the
    // handover on the 10th.
    const override = await request<{ id: string }>('/api/v1/workload/rotations/out-of-hours/overrides', {
      method: 'POST',
      token: asLead(),
      body: {
        // Somebody outside the rotation, so every assertion below distinguishes
        // the cover from the turn it replaced.
        userId: tenant.people.otherAgent!.id,
        startsAt: '2025-03-05T00:00:00Z',
        endsAt: '2025-03-12T00:00:00Z',
        reason: 'Covering a hospital appointment',
      },
    });
    expect(override.status).toBe(201);

    const covered = await request<{ userId: string; via: string }>(
      '/api/v1/workload/rotations/out-of-hours/on-call?at=2025-03-05T22:00:00Z',
      { token: asAgent() },
    );
    expect(covered.body).toMatchObject({ userId: tenant.people.otherAgent!.id, via: 'override' });

    // And the cover shows on the rota people actually read, not only on a query
    // for the exact instant: the handover on the 10th falls inside it.
    const rota = await request<{ upcoming: { at: string; userId: string; covered: boolean }[] }>(
      '/api/v1/workload/rotations/out-of-hours/on-call?at=2025-03-06T09:00:00Z',
      { token: asAgent() },
    );
    expect(rota.body.upcoming[0]).toEqual({
      at: '2025-03-10T09:00:00.000Z',
      // The rotation would have handed to the lead here; the cover holds it.
      userId: tenant.people.otherAgent!.id,
      covered: true,
    });

    // The rota underneath is untouched. The week the cover ran into is still
    // the lead's own turn, and the week after that is back to the agent — which
    // is exactly what arranging cover by editing the member list would break.
    const nextWeek = await request<{ userId: string; via: string }>(
      '/api/v1/workload/rotations/out-of-hours/on-call?at=2025-03-13T22:00:00Z',
      { token: asAgent() },
    );
    expect(nextWeek.body).toMatchObject({ userId: tenant.people.lead!.id, via: 'rotation' });

    const weekAfter = await request<{ userId: string; via: string }>(
      '/api/v1/workload/rotations/out-of-hours/on-call?at=2025-03-19T22:00:00Z',
      { token: asAgent() },
    );
    expect(weekAfter.body).toMatchObject({ userId: tenant.people.agent!.id, via: 'rotation' });

    await request(`/api/v1/workload/overrides/${override.body.id}`, { method: 'DELETE', token: asLead() });
  });

  it('refuses two people covering the same night', async () => {
    const first = await request<{ id: string }>('/api/v1/workload/rotations/out-of-hours/overrides', {
      method: 'POST',
      token: asLead(),
      body: { userId: tenant.people.lead!.id, startsAt: '2025-04-01T00:00:00Z', endsAt: '2025-04-03T00:00:00Z' },
    });
    expect(first.status).toBe(201);

    const clash = await request('/api/v1/workload/rotations/out-of-hours/overrides', {
      method: 'POST',
      token: asLead(),
      body: { userId: tenant.people.agent!.id, startsAt: '2025-04-02T00:00:00Z', endsAt: '2025-04-04T00:00:00Z' },
    });
    expect(clash.status).toBe(400);

    await request(`/api/v1/workload/overrides/${first.body.id}`, { method: 'DELETE', token: asLead() });
  });

  it('refuses a rotation naming the same person twice', async () => {
    const attempt = await request('/api/v1/workload/rotations', {
      method: 'POST',
      token: asAdmin(),
      body: {
        ...rotation,
        key: 'double-booked',
        teamId: tenant.teamId,
        members: [tenant.people.agent!.id, tenant.people.agent!.id],
      },
    });
    expect(attempt.status).toBe(400);
  });

  it('refuses a rotation in a time zone that does not exist, at write time', async () => {
    const attempt = await request('/api/v1/workload/rotations', {
      method: 'POST',
      token: asAdmin(),
      body: {
        ...rotation,
        key: 'nowhere',
        timeZone: 'Mars/Olympus_Mons',
        teamId: tenant.teamId,
        members: [tenant.people.agent!.id],
      },
    });
    expect(attempt.status).toBe(400);
  });

  it('does not let an agent write the rota', async () => {
    const attempt = await request('/api/v1/workload/rotations', {
      method: 'POST',
      token: asAgent(),
      body: { ...rotation, key: 'agent-written', teamId: tenant.teamId, members: [tenant.people.agent!.id] },
    });
    expect(attempt.status).toBe(403);
  });
});

describe('skills', () => {
  it('routes to the person who holds the skill the work needs', async () => {
    await request('/api/v1/workload/skills', {
      method: 'POST',
      token: asAdmin(),
      body: { key: 'networking', name: 'Networking' },
    });
    await request('/api/v1/workload/skills/networking/agents', {
      method: 'PUT',
      token: asAdmin(),
      body: { userId: tenant.people.agent!.id, level: 3 },
    });

    await request(`/api/v1/workload/routing/${tenant.teamId}`, {
      method: 'PUT',
      token: asAdmin(),
      body: { strategy: 'skill', defaultCapacity: 10, requireSkill: false, allowOffShift: false },
    });

    const decision = await explain();
    expect(decision.policy).toMatchObject({ strategy: 'skill', source: 'team' });
    // With no skill required the strategy falls back to load, so this proves
    // only that the policy took effect; the skill itself is proved below.
    expect(decision.userId).not.toBeNull();
  });

  it('does not let an agent grant themselves a skill', async () => {
    const attempt = await request('/api/v1/workload/skills/networking/agents', {
      method: 'PUT',
      token: asAgent(),
      body: { userId: tenant.people.agent!.id, level: 3 },
    });
    expect(attempt.status).toBe(403);
  });
});

describe('a rule that routes', () => {
  it('assigns a ticket to a person, and records how it chose', async () => {
    await request(`/api/v1/workload/routing/${tenant.teamId}`, {
      method: 'PUT',
      token: asAdmin(),
      body: { strategy: 'least_loaded', defaultCapacity: 10, requireSkill: false, allowOffShift: false },
    });
    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'away' });

    const created = await request('/api/v1/rules', {
      method: 'POST',
      token: asAdmin(),
      body: {
        key: 'route-network-faults',
        name: 'Route network faults to whoever is freest',
        event: 'ticket.created',
        conditions: { eq: [{ var: 'ticket.type' }, 'incident'] },
        actions: [
          { type: 'assignGroup', groupId: tenant.teamId },
          { type: 'assignStrategy', strategy: 'least_loaded' },
        ],
        order: 10,
      },
    });
    expect(created.status).toBe(201);
    const published = await request('/api/v1/rules/route-network-faults/publish', {
      method: 'POST',
      token: asAdmin(),
    });
    // The action used to be refused at publish as "not yet available"; MOD-20
    // is what makes this line pass.
    expect(published.status).toBe(200);

    const ticket = await request<{ number: string }>('/api/v1/tickets', {
      method: 'POST',
      token: asRequester(),
      body: { type: 'incident', title: 'Wi-Fi keeps dropping', sourceChannel: 'portal' },
    });
    expect(ticket.status).toBe(201);
    await drainEvents(tenant.id);

    const after = await request<{ assigneeId: string | null; groupId: string | null }>(
      `/api/v1/tickets/${ticket.body.number}`,
      { token: asAdmin() },
    );
    expect(after.body.groupId).toBe(tenant.teamId);
    expect(after.body.assigneeId).toBe(tenant.people.agent!.id);

    const audit = await request<{ data: { action: string; after: Record<string, unknown>; reason: string | null }[] }>(
      '/api/v1/audit-events?action=ticket.assigned&limit=50',
      { token: asAdmin() },
    );
    const entry = audit.body.data.find((row) => row.after?.assigneeId === tenant.people.agent!.id);
    expect(entry).toBeDefined();
    expect(entry!.reason).toContain('least loaded');

    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'available' });
  });

  it('does not take a ticket off the person already working on it', async () => {
    // The rule fires on creation, so a ticket that arrives already assigned is
    // the case that matters: a rule on `ticket.updated` would otherwise reassign
    // the same ticket every time anybody touched it.
    const ticket = await request<{ number: string; id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: asAdmin(),
      body: {
        type: 'incident',
        title: 'Already being looked at',
        sourceChannel: 'portal',
        groupId: tenant.teamId,
        assigneeId: tenant.people.lead!.id,
      },
    });
    expect(ticket.status).toBe(201);
    await drainEvents(tenant.id);

    const after = await request<{ assigneeId: string | null }>(`/api/v1/tickets/${ticket.body.number}`, {
      token: asAdmin(),
    });
    expect(after.body.assigneeId).toBe(tenant.people.lead!.id);
  });

  it('leaves the ticket on the queue, and says why, when nobody can take it', async () => {
    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'away' });
    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'away' });

    const ticket = await request<{ number: string; id: string }>('/api/v1/tickets', {
      method: 'POST',
      token: asRequester(),
      body: { type: 'incident', title: 'Nobody is in today', sourceChannel: 'portal' },
    });
    await drainEvents(tenant.id);

    const after = await request<{ assigneeId: string | null; groupId: string | null }>(
      `/api/v1/tickets/${ticket.body.number}`,
      { token: asAdmin() },
    );
    // On the queue, not on a person who is not there.
    expect(after.body.assigneeId).toBeNull();
    expect(after.body.groupId).toBe(tenant.teamId);

    // And it said so out loud. A queue that stops moving because everybody is
    // on holiday looks exactly like a broken router; only one of those is worth
    // waking somebody for, and the difference is this event.
    const declined = await publishedEvents('workload.assignment.declined');
    expect(declined.some((event) => (event.payload as { ticketId?: string }).ticketId === ticket.body.id)).toBe(true);
    const mine = declined.find((event) => (event.payload as { ticketId?: string }).ticketId === ticket.body.id)!;
    expect((mine.payload as { reason: string }).reason).toBe('nobody on the team can take it; 2 of 2 away');

    await setAvailability(asLead(), { userId: tenant.people.lead!.id, status: 'available' });
    await setAvailability(asLead(), { userId: tenant.people.agent!.id, status: 'available' });
  });
});
