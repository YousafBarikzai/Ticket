import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { reportService } from '@itsm/module-analytics';
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
 * Metrics, dashboards and scheduled reports (MOD-12-E1b).
 *
 * The unit tests prove the SQL is built from the catalogue and the values are
 * parameters. This proves the things only a database and a running API can:
 * that a tenant-defined metric and the built-in it copies agree, that the
 * rollup and the scan agree, that a personal dashboard is invisible to anybody
 * else, and that a scheduled report actually reaches the person it was sent to.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('analytics-reporting');
  // Some facts to report on.
  for (const [title, priority] of [['Reporting: printer jam', 'P3'], ['Reporting: VPN down', 'P1'], ['Reporting: new starter laptop', 'P2']]) {
    const response = await request('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { type: 'incident', title, priority, groupId: tenant.teamId },
    });
    expect(response.status).toBe(201);
  }
  await drainEvents(tenant.id);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('analytics-reporting');
  await closeHarness();
});

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

interface QueryResponse {
  value?: number | null;
  series?: { at: string; value: number | null }[];
  groups?: { key: string | null; label: string | null; value: number | null }[];
  source: 'facts' | 'rollup';
  metric: { key: string; unit: string };
}

describe('metrics', () => {
  it('lists the built-ins with the catalogue a builder needs', async () => {
    const response = await request<{ data: { key: string; builtin: boolean }[]; facts: { fact: string; dimensions: string[] }[] }>(
      '/api/v1/analytics/metrics',
      { token: tenant.people.admin!.token },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.map((metric) => metric.key)).toContain('tickets.created');
    expect(response.body.facts.find((fact) => fact.fact === 'ticket')?.dimensions).toContain('teamId');
  });

  it('answers the headline count from the rollup', async () => {
    const response = await request<QueryResponse>('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'tickets.created', range: '7d' },
    });
    expect(response.status).toBe(200);
    expect(response.body.source).toBe('rollup');
    expect(response.body.value).toBeGreaterThanOrEqual(3);
  });

  it('lets a tenant define its own metric, and the scan agrees with the rollup', async () => {
    // The same question two ways: the built-in (rollup) and a tenant copy
    // (facts). If these ever disagree the rollup is lying to the dashboard.
    const created = await request('/api/v1/analytics/metrics', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'ours.raised', name: 'Raised (ours)', fact: 'ticket', aggregate: 'count', filters: [] },
    });
    expect(created.status).toBe(201);

    const ask = (metricKey: string) =>
      request<QueryResponse>('/api/v1/analytics/query', {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: { metricKey, range: '7d', series: true, bucket: 'day' },
      });

    const [builtin, ours] = await Promise.all([ask('tickets.created'), ask('ours.raised')]);
    expect(builtin.body.source).toBe('rollup');
    expect(ours.body.source).toBe('facts');
    expect(ours.body.series!.map((point) => point.value)).toEqual(builtin.body.series!.map((point) => point.value));
    expect(builtin.body.series!.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBeGreaterThanOrEqual(3);
  });

  it('breaks a count down by a labelled dimension', async () => {
    const response = await request<QueryResponse>('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'tickets.created', range: '7d', groupBy: 'teamId' },
    });
    expect(response.status).toBe(200);
    const ours = response.body.groups!.find((group) => group.key === tenant.teamId);
    expect(ours?.label).toBe('Service Desk');
    expect(ours?.value).toBeGreaterThanOrEqual(3);
  });

  it('refuses a filter on a field the fact does not have', async () => {
    const response = await request('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'tickets.created', filters: [{ field: 'password', op: 'eq', value: 'x' }] },
    });
    expect(response.status).toBe(422);
  });

  it('narrows a team-scoped reader to their own teams', async () => {
    // The lead is in the primary team; a filter on the other team, combined
    // with the scope filter, can match nothing.
    const response = await request<QueryResponse>('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { metricKey: 'tickets.created', range: '7d', filters: [{ field: 'teamId', op: 'eq', value: tenant.otherTeamId }] },
    });
    expect(response.status).toBe(200);
    expect(response.body.value ?? 0).toBe(0);
  });

  it('refuses a team-scoped reader a fact that has no team', async () => {
    const response = await request('/api/v1/analytics/query', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { metricKey: 'approvals.turnaround', range: '30d' },
    });
    expect(response.status).toBe(403);
  });

  it('draws a trend line through a series', async () => {
    const response = await request<{ trend: { slopePerDay: number; rSquared: number; projected: unknown[] } | null }>('/api/v1/analytics/forecast', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'tickets.created', range: '30d', horizonDays: 7 },
    });
    expect(response.status).toBe(200);
    // Thirty points, so there is a line; how good it is is the number's job.
    expect(response.body.trend?.projected).toHaveLength(7);
  });
});

describe('dashboards', () => {
  it('starts with the three seeded dashboards', async () => {
    // A lead reads analytics at team scope; an agent holds no analytics.read
    // at all, which the permission matrix pins separately.
    const response = await request<{ data: { key: string; personal: boolean; seeded: boolean }[] }>('/api/v1/analytics/dashboards', {
      token: tenant.people.lead!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.filter((row) => row.seeded).map((row) => row.key).sort()).toEqual(['service-desk', 'sla', 'teams']);
  });

  it('renders every widget, reporting on the ones that fail rather than failing', async () => {
    const list = await request<{ data: { id: string; key: string }[] }>('/api/v1/analytics/dashboards', { token: tenant.people.admin!.token });
    const overview = list.body.data.find((row) => row.key === 'service-desk')!;
    const response = await request<{ widgets: { title: string; result?: { source: string }; error?: string }[] }>(
      `/api/v1/analytics/dashboards/${overview.id}/render`,
      { token: tenant.people.admin!.token },
    );
    expect(response.status).toBe(200);
    expect(response.body.widgets.length).toBeGreaterThan(5);
    expect(response.body.widgets.every((widget) => widget.result || widget.error)).toBe(true);
    expect(response.body.widgets.filter((widget) => widget.error)).toEqual([]);
  });

  it('keeps a personal dashboard out of everybody else\'s list', async () => {
    const created = await request<{ id: string; personal: boolean }>('/api/v1/analytics/dashboards', {
      method: 'POST',
      token: tenant.people.lead!.token,
      body: { name: 'My week', personal: true, widgets: [{ title: 'Raised', type: 'number', metricKey: 'tickets.created' }] },
    });
    expect(created.status).toBe(201);
    expect(created.body.personal).toBe(true);

    const mine = await request<{ data: { id: string }[] }>('/api/v1/analytics/dashboards', { token: tenant.people.lead!.token });
    expect(mine.body.data.map((row) => row.id)).toContain(created.body.id);

    const theirs = await request<{ data: { id: string }[] }>('/api/v1/analytics/dashboards', { token: tenant.people.admin!.token });
    expect(theirs.body.data.map((row) => row.id)).not.toContain(created.body.id);

    // Not 403: the response must not reveal that it exists.
    const peek = await request(`/api/v1/analytics/dashboards/${created.body.id}`, { token: tenant.people.admin!.token });
    expect(peek.status).toBe(404);
  });

  it('lets only a manager change a shared dashboard', async () => {
    // The lead can read it and cannot change it: reading and managing are
    // different permissions, and a lead holds only the first.
    const list = await request<{ data: { id: string; key: string }[] }>('/api/v1/analytics/dashboards', { token: tenant.people.lead!.token });
    const shared = list.body.data.find((row) => row.key === 'sla')!;
    const refused = await request(`/api/v1/analytics/dashboards/${shared.id}`, {
      method: 'PATCH',
      token: tenant.people.lead!.token,
      body: { name: 'Renamed by a lead' },
    });
    expect(refused.status).toBe(403);

    const allowed = await request<{ name: string }>(`/api/v1/analytics/dashboards/${shared.id}`, {
      method: 'PATCH',
      token: tenant.people.admin!.token,
      body: { name: 'Service levels' },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.name).toBe('Service levels');
  });

  it('refuses a widget on a metric that does not exist', async () => {
    const response = await request('/api/v1/analytics/dashboards', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { name: 'Broken', widgets: [{ title: 'x', type: 'number', metricKey: 'no.such.metric' }] },
    });
    expect(response.status).toBe(404);
  });
});

describe('reports', () => {
  let reportId: string;

  it('defines a report and runs it now', async () => {
    const created = await request<{ id: string }>('/api/v1/analytics/reports', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'weekly-desk',
        name: 'Weekly service desk',
        sections: [
          { title: 'Tickets raised', metricKey: 'tickets.created' },
          { title: 'By priority', metricKey: 'tickets.created', groupBy: 'priority' },
          { title: 'SLA attainment', metricKey: 'sla.attainment' },
        ],
      },
    });
    expect(created.status).toBe(201);
    reportId = created.body.id;

    const run = await request<{ id: string; status: string; summary: string; sections: { title: string; rows: unknown[] }[] }>(
      `/api/v1/analytics/reports/${reportId}/run`,
      { method: 'POST', token: tenant.people.admin!.token, body: {} },
    );
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('done');
    expect(run.body.summary).toContain('Tickets raised: ');
    expect(run.body.sections[1]!.rows.length).toBeGreaterThan(0);
  });

  it('serves the run as a CSV that a spreadsheet will open safely', async () => {
    const runs = await request<{ data: { id: string }[] }>(`/api/v1/analytics/reports/${reportId}/runs`, { token: tenant.people.admin!.token });
    const runId = runs.body.data[0]!.id;
    const response = await request<string>(`/api/v1/analytics/report-runs/${runId}/csv`, { token: tenant.people.admin!.token });
    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/csv');
    expect(String(response.headers['content-disposition'])).toContain('weekly-desk-');
    expect(response.body.startsWith('Section,Metric,Label,Value,Unit\r\n')).toBe(true);
    expect(response.body).toContain('Tickets raised,tickets.created');
  });

  it('schedules the report and delivers it to the people named', async () => {
    const schedule = await request<{ id: string; nextRunAt: string }>(`/api/v1/analytics/reports/${reportId}/schedules`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        frequency: 'weekly',
        dayOfWeek: 1,
        hour: 8,
        minute: 0,
        timeZone: 'Europe/London',
        recipients: [{ kind: 'user', userId: tenant.people.lead!.id }],
      },
    });
    expect(schedule.status).toBe(201);
    const due = new Date(schedule.body.nextRunAt);
    expect(due.getTime()).toBeGreaterThan(Date.now());

    // The sweep, one minute after the schedule falls due.
    const context = ctx();
    const ran = await withContext(context, () => reportService.runDue(context, new Date(due.getTime() + 60_000)));
    expect(ran).toBe(1);

    await drainEvents(tenant.id);

    const notification = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.lead!.id, templateKey: 'report.generated' } }),
    );
    expect(notification).not.toBeNull();
    expect(notification!.subject).toContain('Weekly service desk');
    expect(notification!.body).toContain('/api/v1/analytics/report-runs/');

    // And nobody who was not named.
    const stray = await read((tx) =>
      tx.notification.findFirst({ where: { recipientId: tenant.people.agent!.id, templateKey: 'report.generated' } }),
    );
    expect(stray).toBeNull();

    // The schedule has moved on to the following week.
    const report = await request<{ schedules: { nextRunAt: string; lastRunAt: string | null }[] }>(`/api/v1/analytics/reports/${reportId}`, {
      token: tenant.people.admin!.token,
    });
    expect(new Date(report.body.schedules[0]!.nextRunAt).getTime()).toBeGreaterThan(due.getTime());
    expect(report.body.schedules[0]!.lastRunAt).not.toBeNull();
  });

  it('lets the recipient download what they were sent', async () => {
    const runs = await request<{ data: { id: string; scheduleId: string | null }[] }>(`/api/v1/analytics/reports/${reportId}/runs`, {
      token: tenant.people.admin!.token,
    });
    const scheduled = runs.body.data.find((run) => run.scheduleId !== null)!;
    const response = await request<string>(`/api/v1/analytics/report-runs/${scheduled.id}/csv`, { token: tenant.people.lead!.token });
    expect(response.status).toBe(200);
  });
});

describe('replaying the projection', () => {
  it('reproduces the same facts, counts included', async () => {
    const before = await read((tx) => tx.factTicket.findMany({ orderBy: { ticketId: 'asc' }, select: { ticketId: true, commentCount: true, status: true, teamId: true } }));
    expect(before.length).toBeGreaterThanOrEqual(3);

    const response = await request<{ replayed: number }>('/api/v1/analytics/replay', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {},
    });
    expect(response.status).toBe(200);
    expect(response.body.replayed).toBeGreaterThanOrEqual(3);

    // A projector that accumulated anything would show it here.
    const after = await read((tx) => tx.factTicket.findMany({ orderBy: { ticketId: 'asc' }, select: { ticketId: true, commentCount: true, status: true, teamId: true } }));
    expect(after).toEqual(before);
  });

  it('is an administrator\'s action', async () => {
    const response = await request('/api/v1/analytics/replay', { method: 'POST', token: tenant.people.lead!.token, body: {} });
    expect(response.status).toBe(403);
  });
});
