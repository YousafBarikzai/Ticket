import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Notification preferences (MOD-11-E1).
 *
 * Preferences belong to the person. The case that matters for safety is the
 * other direction: silencing somebody else's alerts is a way to hide activity
 * from them, so it is an administrative act and it is audited.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('notif-prefs');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('notif-prefs');
  await closeHarness();
});

describe('a person\'s own preferences', () => {
  it('starts empty and accepts a change', async () => {
    const before = await request<{ data: unknown[] }>('/api/v1/me/notification-preferences', {
      token: tenant.people.agent!.token,
    });
    expect(before.status).toBe(200);

    const saved = await request<{ channel: string; digestMode: string }>('/api/v1/me/notification-preferences', {
      method: 'PUT',
      token: tenant.people.agent!.token,
      body: { channel: 'email', enabled: true, digestMode: 'daily', quietHours: { start: '22:00', end: '07:00' } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.digestMode).toBe('daily');

    const after = await request<{ data: { channel: string; digestMode: string }[] }>(
      '/api/v1/me/notification-preferences',
      { token: tenant.people.agent!.token },
    );
    expect(after.body.data.find((p) => p.channel === 'email')?.digestMode).toBe('daily');
  });

  it('updates in place rather than piling up rows', async () => {
    await request('/api/v1/me/notification-preferences', {
      method: 'PUT',
      token: tenant.people.agent!.token,
      body: { channel: 'email', enabled: false, digestMode: 'immediate' },
    });
    const after = await request<{ data: { channel: string }[] }>('/api/v1/me/notification-preferences', {
      token: tenant.people.agent!.token,
    });
    expect(after.body.data.filter((p) => p.channel === 'email')).toHaveLength(1);
  });

  it('refuses a quiet-hours window that is not a time', async () => {
    const response = await request('/api/v1/me/notification-preferences', {
      method: 'PUT',
      token: tenant.people.agent!.token,
      body: { channel: 'email', quietHours: { start: '25:00', end: '07:00' } },
    });
    expect(response.status).toBe(422);
  });
});

describe('somebody else\'s preferences', () => {
  it('lets an administrator set them', async () => {
    const response = await request('/api/v1/users/' + tenant.people.agent!.id + '/notification-preferences', {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: { channel: 'push', enabled: false, digestMode: 'immediate' },
    });
    expect(response.status).toBe(200);
  });

  it('refuses a peer', async () => {
    // Turning off another agent's alerts is a way to hide activity from them.
    const response = await request('/api/v1/users/' + tenant.people.lead!.id + '/notification-preferences', {
      method: 'PUT',
      token: tenant.people.agent!.token,
      body: { channel: 'email', enabled: false },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a requester reading an agent\'s', async () => {
    const response = await request('/api/v1/users/' + tenant.people.agent!.id + '/notification-preferences', {
      token: tenant.people.requester!.token,
    });
    expect(response.status).toBe(403);
  });

  it('records every change in the audit trail', async () => {
    const audit = await request<{ data: { action: string }[] }>('/api/v1/audit-events?limit=200', {
      token: tenant.people.admin!.token,
    });
    expect(audit.body.data.map((row) => row.action)).toContain('notification.preference.changed');
  });
});
