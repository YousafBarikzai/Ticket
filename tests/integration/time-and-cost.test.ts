import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { budgetService, entryService } from '@itsm/module-time';
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
 * Time and cost (MOD-19).
 *
 * The unit tests prove the arithmetic. This proves the things that need a
 * running platform: an entry is priced at the rate that applied when it was
 * logged and stays priced that way after the rate changes; a timer stops into
 * an entry; elapsed time in a working state is recorded as its own kind and
 * costs nothing; a budget notices its lines being crossed exactly once; and
 * the numbers reach MOD-12 with the kinds kept apart.
 */

let tenant: TestTenant;
let ticketId: string;

beforeAll(async () => {
  tenant = await createTestTenant('time-cost');
  const created = await request<{ id: string }>('/api/v1/tickets', {
    method: 'POST',
    token: tenant.people.admin!.token,
    body: { type: 'incident', title: 'Time: the shared drive is slow', priority: 'P3', groupId: tenant.teamId },
  });
  expect(created.status).toBe(201);
  ticketId = created.body.id;
  await drainEvents(tenant.id);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('time-cost');
  await closeHarness();
});

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

describe('rates', () => {
  it('starts with the default activity types at a rate of nothing', async () => {
    const response = await request<{ data: { key: string; ratePerHour: number; isSystem: boolean }[] }>('/api/v1/activity-types', {
      token: tenant.people.agent!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.key)).toEqual(expect.arrayContaining(['work', 'investigation', 'elapsed']));
    expect(response.body.data.every((row) => row.ratePerHour === 0)).toBe(true);
    expect(response.body.data.find((row) => row.key === 'elapsed')?.isSystem).toBe(true);
  });

  it('lets the owner set a rate, and a team override it', async () => {
    const base = await request('/api/v1/activity-types/work', { method: 'PATCH', token: tenant.people.admin!.token, body: { ratePerHour: 60, currency: 'GBP' } });
    expect(base.status).toBe(200);
    const override = await request('/api/v1/activity-types/work/rates', {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: { teamId: tenant.teamId, ratePerHour: 90, currency: 'GBP' },
    });
    expect(override.status).toBe(200);
  });

  it('refuses an agent the rate table', async () => {
    const response = await request('/api/v1/activity-types/work', { method: 'PATCH', token: tenant.people.agent!.token, body: { ratePerHour: 1 } });
    expect(response.status).toBe(403);
  });
});

describe('logging time', () => {
  let entryId: string;

  it('prices an entry at the team rate that applies when it is logged', async () => {
    const response = await request<{ id: string; cost: number; ratePerHour: number; kind: string }>('/api/v1/time-entries', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'work', minutes: 30, note: 'Traced it to the backup job.' },
    });
    expect(response.status).toBe(201);
    // Thirty minutes at the team's £90, not the default £60.
    expect(response.body.ratePerHour).toBe(90);
    expect(response.body.cost).toBe(45);
    expect(response.body.kind).toBe('manual');
    entryId = response.body.id;
  });

  it('keeps the price after the rate changes', async () => {
    await request('/api/v1/activity-types/work/rates', {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: { teamId: tenant.teamId, ratePerHour: 120, currency: 'GBP' },
    });
    const list = await request<{ data: { id: string; cost: number }[] }>(`/api/v1/tickets/${ticketId}/time`, { token: tenant.people.admin!.token });
    expect(list.body.data.find((row) => row.id === entryId)?.cost).toBe(45);
  });

  it('refuses the system activity by hand', async () => {
    const response = await request('/api/v1/time-entries', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'elapsed', minutes: 10 },
    });
    expect(response.status).toBe(422);
  });

  it('lets an agent log only their own time, and a lead log for the team', async () => {
    const asSomeoneElse = await request('/api/v1/time-entries', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'work', minutes: 10, userId: tenant.people.lead!.id },
    });
    expect(asSomeoneElse.status).toBe(403);

    const byLead = await request<{ userId: string }>('/api/v1/time-entries', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { ticketId, activityKey: 'work', minutes: 10, userId: tenant.people.agent!.id },
    });
    expect(byLead.status).toBe(201);
    expect(byLead.body.userId).toBe(tenant.people.agent!.id);
  });

  it('shows an agent only their own entries on the ticket, and the whole ticket to the lead', async () => {
    const mine = await request<{ data: { userId: string }[] }>(`/api/v1/tickets/${ticketId}/time`, { token: tenant.people.otherAgent!.token });
    // The other agent cannot see this ticket at all.
    expect(mine.status).toBe(404);

    const lead = await request<{ data: unknown[]; summary: { loggedMinutes: number; cost: number } }>(`/api/v1/tickets/${ticketId}/time`, { token: tenant.people.lead!.token });
    expect(lead.status).toBe(200);
    expect(lead.body.summary.loggedMinutes).toBe(40);
    // 30 min at £90 plus 10 min at £120.
    expect(lead.body.summary.cost).toBe(65);
  });
});

describe('the timer', () => {
  it('runs one at a time and stops into an entry', async () => {
    const started = await request('/api/v1/time/timer/start', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'investigation' },
    });
    expect(started.status).toBe(201);

    const again = await request('/api/v1/time/timer/start', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'work' },
    });
    expect(again.status).toBe(409);

    const stopped = await request<{ kind: string; minutes: number }>('/api/v1/time/timer/stop', { method: 'POST', token: tenant.people.agent!.token });
    expect(stopped.status).toBe(201);
    expect(stopped.body.kind).toBe('timer');
    // Seconds of running is a minute, not nothing.
    expect(stopped.body.minutes).toBeGreaterThanOrEqual(1);

    const none = await request<{ running: unknown }>('/api/v1/time/timer', { token: tenant.people.agent!.token });
    expect(none.body.running).toBeNull();
  });
});

describe('elapsed time', () => {
  it('records how long the ticket sat in a working state, as its own kind, costing nothing', async () => {
    const assigned = await request(`/api/v1/tickets/${ticketId}/assign`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { assigneeId: tenant.people.agent!.id },
    });
    expect(assigned.status).toBe(200);
    for (const to of ['in_progress', 'pending', 'in_progress', 'resolved']) {
      const moved = await request(`/api/v1/tickets/${ticketId}/transitions`, {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: { to, reason: 'elapsed test' },
      });
      expect([200, 201]).toContain(moved.status);
      await drainEvents(tenant.id);
    }

    const rows = await read((tx) => tx.timeEntry.findMany({ where: { ticketId, kind: 'automatic', deletedAt: null } }));
    // Two stints in progress: before pending and after it.
    expect(rows.length).toBe(2);
    expect(rows.every((row) => Number(row.cost) === 0 && row.billable === false && row.userId === tenant.people.agent!.id)).toBe(true);

    const summary = await request<{ summary: { loggedMinutes: number; elapsedMinutes: number } }>(`/api/v1/tickets/${ticketId}/time`, { token: tenant.people.admin!.token });
    // Elapsed time is reported beside effort, never added to it.
    expect(summary.body.summary.elapsedMinutes).toBeGreaterThanOrEqual(2);
    expect(summary.body.summary.loggedMinutes).toBeLessThan(60);
  });
});

describe('budgets', () => {
  it('notices its lines being crossed, once each, and tells the owner', async () => {
    const created = await request<{ key: string }>('/api/v1/budgets', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'desk-month', name: 'Service desk, monthly', scopeType: 'team', scopeId: tenant.teamId, periodKind: 'month', amount: 100, currency: 'GBP', warnAt: 80, ownerId: tenant.people.lead!.id },
    });
    expect(created.status).toBe(201);

    // £65 is already spent this period; another 20 min at £120 is £40 → £105.
    const context = ctx();
    await withContext(context, () => budgetService.recomputeAll(context));
    const before = await request<{ spent: number; percent: number }>('/api/v1/budgets/desk-month/status', { token: tenant.people.admin!.token });
    expect(before.body.spent).toBe(65);

    const push = await request('/api/v1/time-entries', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { ticketId, activityKey: 'work', minutes: 20 },
    });
    expect(push.status).toBe(201);
    await drainEvents(tenant.id);

    const after = await request<{ spent: number; warnedAt: string | null; reachedAt: string | null }>('/api/v1/budgets/desk-month/status', { token: tenant.people.admin!.token });
    expect(after.body.spent).toBe(105);
    expect(after.body.warnedAt).not.toBeNull();
    expect(after.body.reachedAt).not.toBeNull();

    const events = await read((tx) => tx.outboxEvent.findMany({ where: { type: 'budget.threshold.reached' } }));
    expect(events.map((event) => (event.envelope as { payload: { threshold: number } }).payload.threshold).sort()).toEqual([80, 100]);

    const notification = await read((tx) => tx.notification.findFirst({ where: { recipientId: tenant.people.lead!.id, templateKey: 'budget.threshold.reached' } }));
    expect(notification).not.toBeNull();
  });

  it('does not report a line twice when the total is recomputed', async () => {
    const context = ctx();
    await withContext(context, () => budgetService.recomputeAll(context));
    const events = await read((tx) => tx.outboxEvent.count({ where: { type: 'budget.threshold.reached' } }));
    expect(events).toBe(2);
  });

  it('withdraws spend when an entry is deleted', async () => {
    const list = await request<{ data: { id: string; minutes: number; kind: string }[] }>(`/api/v1/tickets/${ticketId}/time`, { token: tenant.people.admin!.token });
    const twenty = list.body.data.find((row) => row.minutes === 20 && row.kind === 'manual')!;
    const deleted = await request(`/api/v1/time-entries/${twenty.id}`, { method: 'DELETE', token: tenant.people.agent!.token });
    expect(deleted.status).toBe(204);
    const status = await request<{ spent: number }>('/api/v1/budgets/desk-month/status', { token: tenant.people.admin!.token });
    expect(status.body.spent).toBe(65);
  });
});

describe('what reaches reporting', () => {
  it('projects every entry with its kind, and a deletion removes it', async () => {
    await drainEvents(tenant.id);
    const facts = await read((tx) => tx.factTimeEntry.findMany({ where: { ticketId } }));
    const kinds = new Set(facts.map((fact) => fact.kind));
    expect(kinds.has('manual')).toBe(true);
    expect(kinds.has('timer')).toBe(true);
    expect(kinds.has('automatic')).toBe(true);
    // The deleted twenty-minute entry is gone from the facts too.
    expect(facts.some((fact) => fact.kind === 'manual' && fact.minutes === 20)).toBe(false);
  });

  it('keeps effort and elapsed time apart in the metrics', async () => {
    const logged = await request<{ value: number | null }>('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'time.logged', range: '7d' },
    });
    const cost = await request<{ value: number | null; metric: { unit: string } }>('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'time.cost', range: '7d' },
    });
    expect(logged.status).toBe(200);
    // 30 + 10 manual, plus the timer's minute or so.
    expect(logged.body.value).toBeGreaterThanOrEqual(41);
    expect(cost.body.metric.unit).toBe('money');
    expect(cost.body.value).toBe(65);
  });
});
