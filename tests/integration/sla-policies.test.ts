import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * SLA policies and escalations (MOD-07-E1).
 *
 * Phase 1 proved the timer engine: that a clock starts, pauses on the right
 * states and breaches on time. What this covers is the layer a service owner
 * actually touches — targets, calendars, the priority matrix and what happens
 * when a target is missed — including the configurations that look reasonable
 * and quietly do nothing.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('sla-policies');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('sla-policies');
  await closeHarness();
});

describe('what a tenant starts with', () => {
  it('covers every priority across its seeded policies', async () => {
    // Two policies, not one: P1 sits on its own around-the-clock calendar,
    // because a critical outage does not wait for Monday. What matters is that
    // between them no priority is left without a target.
    const response = await request<{ data: { key: string; specificity: number; targets: { priority: string }[] }[] }>(
      '/api/v1/sla-policies',
      { token: tenant.people.admin!.token },
    );
    expect(response.status).toBe(200);
    const covered = new Set(response.body.data.flatMap((policy) => policy.targets.map((t) => t.priority)));
    expect(covered).toEqual(new Set(['P1', 'P2', 'P3', 'P4']));
    // Most specific first, so the matcher takes the P1 policy over the default.
    expect(response.body.data[0]!.specificity).toBeGreaterThanOrEqual(response.body.data.at(-1)!.specificity);
  });

  it('has the full impact and urgency matrix', async () => {
    const response = await request<{ data: unknown[] }>('/api/v1/priority-matrix', {
      token: tenant.people.admin!.token,
    });
    expect(response.body.data).toHaveLength(9);
  });
});

describe('retuning a policy', () => {
  it('replaces the targets and bumps the policy version', async () => {
    const before = await request<{ data: { key: string; version: number }[] }>('/api/v1/sla-policies', {
      token: tenant.people.admin!.token,
    });
    const key = 'default-p1';
    const versionBefore = before.body.data.find((policy) => policy.key === key)!.version;

    const updated = await request<{ data: { minutes: number }[] }>(`/api/v1/sla-policies/${key}/targets`, {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: {
        targets: [
          { priority: 'P1', targetType: 'response', minutes: 10, warningThresholds: [50, 90] },
          { priority: 'P1', targetType: 'resolution', minutes: 120, warningThresholds: [75] },
        ],
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toHaveLength(2);

    const after = await request<{ data: { key: string; version: number }[] }>('/api/v1/sla-policies', {
      token: tenant.people.admin!.token,
    });
    expect(after.body.data.find((policy) => policy.key === key)!.version).toBeGreaterThan(versionBefore);
  });
});

describe('escalations', () => {
  it('refuses one registered at a threshold no target warns at', async () => {
    // The commonest way to write an escalation that never runs: warn at 50 and
    // 90, escalate at 75. It looks right and fires never.
    const response = await request<{ detail: string }>('/api/v1/sla-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'orphaned-escalation',
        name: 'Escalates at a threshold nothing warns at',
        targets: [{ priority: 'P1', targetType: 'resolution', minutes: 60, warningThresholds: [50, 90] }],
        escalations: [{ on: 'warning:75', step: 1, action: { addTag: 'late' } }],
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/would never run/);
  });

  it('accepts one whose threshold a target actually warns at', async () => {
    const response = await request('/api/v1/sla-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'sound-escalation',
        name: 'Escalates on breach and at 90 per cent',
        specificity: 500,
        match: { eq: [{ var: 'ticket.priority' }, 'P1'] },
        targets: [{ priority: 'P1', targetType: 'resolution', minutes: 60, warningThresholds: [90] }],
        escalations: [
          { on: 'warning:90', step: 1, action: { addTag: 'nearly-late' } },
          { on: 'breach', step: 1, action: { raisePriorityTo: 'P1', addTag: 'breached' } },
        ],
      },
    });
    expect(response.status).toBe(201);
  });
});

describe('calendars', () => {
  it('refuses a calendar the timer engine could not compute against', async () => {
    // Validated with the same function the engine uses, so a calendar that
    // saves is one the engine can actually use.
    const response = await request('/api/v1/sla-calendars', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'nonsense',
        name: 'Nonsense hours',
        timeZone: 'Mars/Olympus_Mons',
        hours: { mon: [{ start: '09:00', end: '17:00' }] },
      },
    });
    expect(response.status).toBe(422);
  });

  it('accepts a sound one, with its exceptions', async () => {
    const response = await request('/api/v1/sla-calendars', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'scotland',
        name: 'Scottish office hours',
        timeZone: 'Europe/London',
        hours: { mon: [{ start: '09:00', end: '17:00' }], tue: [{ start: '09:00', end: '17:00' }] },
        exceptions: [{ date: '2027-01-02', type: 'holiday', name: 'New Year' }],
      },
    });
    expect(response.status).toBe(201);
  });
});

describe('the priority matrix', () => {
  it('refuses a matrix that does not cover every combination', async () => {
    // Eight of nine leaves a combination with no priority, and a ticket raised
    // with it gets no SLA at all.
    const response = await request('/api/v1/priority-matrix', {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: {
        rows: [
          { impact: 'high', urgency: 'high', priority: 'P1' },
          { impact: 'high', urgency: 'medium', priority: 'P2' },
        ],
      },
    });
    expect(response.status).toBe(422);
  });

  it('applies a changed matrix to the next ticket raised', async () => {
    const rows = [
      { impact: 'high', urgency: 'high', priority: 'P1' },
      { impact: 'high', urgency: 'medium', priority: 'P1' },
      { impact: 'high', urgency: 'low', priority: 'P2' },
      { impact: 'medium', urgency: 'high', priority: 'P2' },
      { impact: 'medium', urgency: 'medium', priority: 'P3' },
      { impact: 'medium', urgency: 'low', priority: 'P3' },
      { impact: 'low', urgency: 'high', priority: 'P3' },
      { impact: 'low', urgency: 'medium', priority: 'P4' },
      { impact: 'low', urgency: 'low', priority: 'P4' },
    ];
    const updated = await request('/api/v1/priority-matrix', {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: { rows },
    });
    expect(updated.status).toBe(200);

    // high/medium now means P1 where it meant P2 before.
    const ticket = await request<{ priority: string }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { type: 'incident', title: 'Matrix change check', impact: 'high', urgency: 'medium', sourceChannel: 'portal' },
    });
    expect(ticket.body.priority).toBe('P1');
  });
});

describe('permissions', () => {
  it('lets a lead read the policies but not change them', async () => {
    const read = await request('/api/v1/sla-policies', { token: tenant.people.lead!.token });
    expect(read.status).toBe(200);

    const write = await request('/api/v1/sla-calendars', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { key: 'nope', name: 'Nope', timeZone: 'Europe/London', hours: { mon: [{ start: '09:00', end: '17:00' }] } },
    });
    expect(write.status).toBe(403);
  });

  it('refuses a requester entirely', async () => {
    const response = await request('/api/v1/sla-policies', { token: tenant.people.requester!.token });
    expect(response.status).toBe(403);
  });
});
