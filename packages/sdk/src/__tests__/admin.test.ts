import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { admin } from '../resources/admin.js';

/**
 * The console's half of the API's grammar: `tenant.*`, `configure.*` and
 * `observe.*`.
 *
 * Most of the console's writes go to routes whose bodies are strict, so a
 * wrong field name is a 422 rather than a silent default — which is how the
 * feature-flag switch spent its whole life answering 422 to `{ enabled }`.
 * These pin the bodies and the booleans, where the mistakes have actually been.
 */

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function recording(responseBody: unknown = {}, status = 200): { calls: Recorded[]; api: ReturnType<typeof admin> } {
  const calls: Recorded[] = [];
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(status === 204 ? null : JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, api: admin(createClient({ baseUrl: 'http://api.test', fetch: doFetch as unknown as typeof fetch, token: 'tok' })) };
}

describe('feature flags', () => {
  it('sets a flag with `value`, which the strict body takes, and nothing else', async () => {
    const { calls, api } = recording({ key: 'x', value: true, scopeType: 'tenant' });
    await api.tenant.setFlag('ticket.customFields', false);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/feature-flags/ticket.customFields');
    expect(calls[0]!.body).toEqual({ value: false });
  });

  it('carries a reason and a scope when there is one', async () => {
    const { calls, api } = recording({});
    await api.tenant.setFlag('ai.triage', true, { reason: 'Pilot for the service desk' });
    expect(calls[0]!.body).toEqual({ value: true, reason: 'Pilot for the service desk' });
  });

  it('answers the tenant’s value under the old name too, so an old page shows the truth', async () => {
    const row = { key: 'k', module: 'm', default: false, owner: 'o', expires: 'permanent', description: null, tenantValue: true, value: true };
    const { api } = recording({ data: [row] });
    const [flag] = await api.tenant.flags();
    expect(flag).toMatchObject({ value: true, tenantValue: true, enabled: true });
  });
});

describe('settings', () => {
  it('publishes a value with its reason', async () => {
    const { calls, api } = recording({ settingId: 's', version: 2 });
    await api.tenant.setSetting('sla.pauseOnPending', false, { reason: 'Agreed with the service owner' });
    expect(calls[0]!.method).toBe('PUT');
    // `false` is a value here, in a body, and must survive: only query
    // strings leave booleans out.
    expect(calls[0]!.body).toEqual({ value: false, reason: 'Agreed with the service owner' });
  });

  it('rolls back to a version', async () => {
    const { calls, api } = recording({ version: 4, restoredFrom: 2 });
    await api.tenant.rollbackSetting('sla.pauseOnPending', 2);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/settings/sla.pauseOnPending/rollback');
    expect(calls[0]!.body).toEqual({ toVersion: 2 });
  });
});

describe('people', () => {
  it('still takes a search string', async () => {
    const { calls, api } = recording({ data: [] });
    await api.tenant.users('Ali & Co');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/users?q=Ali%20%26%20Co');
  });

  it('takes a page size and a status as well', async () => {
    const { calls, api } = recording({ data: [] });
    await api.tenant.users({ limit: 200, status: 'active' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/users?limit=200&status=active');
  });

  it('asks for everybody when given nothing', async () => {
    const { calls, api } = recording({ data: [] });
    await api.tenant.users();
    expect(calls[0]!.url).toBe('http://api.test/api/v1/users');
  });

  it('reactivates with POST and an optional reason', async () => {
    const { calls, api } = recording({ id: 'u-1', status: 'active' });
    await api.tenant.reactivateUser('u-1');
    await api.tenant.reactivateUser('u-1', 'Back from leave');
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['POST', 'http://api.test/api/v1/users/u-1/reactivate', {}],
      ['POST', 'http://api.test/api/v1/users/u-1/reactivate', { reason: 'Back from leave' }],
    ]);
  });
});

describe('modules, usage and fields', () => {
  it('turns a module on and off with the verb in the path', async () => {
    const { calls, api } = recording({});
    await api.tenant.setModuleEnabled('MOD-19', true);
    await api.tenant.setModuleEnabled('MOD-19', false);
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/modules/MOD-19/enable',
      'http://api.test/api/v1/modules/MOD-19/disable',
    ]);
  });

  it('removes a soft limit with null rather than leaving the field out', async () => {
    const { calls, api } = recording({});
    await api.tenant.setSoftLimit('tickets', null);
    expect(calls[0]!.body).toEqual({ soft: null });
  });

  it('asks for inactive fields only when told to', async () => {
    const { calls, api } = recording({ data: [] });
    await api.tenant.fields();
    await api.tenant.fields(true);
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/field-definitions',
      'http://api.test/api/v1/field-definitions?includeInactive=true',
    ]);
  });
});

describe('configure', () => {
  it('dry-runs an unsaved rule under `definition`', async () => {
    const { calls, api } = recording({ sampled: 0, wouldChange: [], errors: [] });
    const definition = { event: 'ticket.created', conditions: { op: 'true' }, actions: [{ type: 'addTag', tag: 'vip' }] };
    await api.configure.rules.dryRun(definition, 50);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/rules/dry-run');
    expect(calls[0]!.body).toEqual({ definition, sampleSize: 50 });
  });

  it('rolls a rule back to a version', async () => {
    const { calls, api } = recording({});
    await api.configure.rules.rollback('vip-tagging', 3);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/rules/vip-tagging/rollback');
    expect(calls[0]!.body).toEqual({ toVersion: 3 });
  });

  it('escapes a key in a path', async () => {
    const { calls, api } = recording({});
    await api.configure.catalogue.publishForm('a/b');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/forms/a%2Fb/publish');
  });

  it('filters lists through the query rather than a hand-built string', async () => {
    const { calls, api } = recording({ data: [] });
    await api.configure.rules.list({ status: 'draft' });
    await api.configure.catalogue.forms();
    await api.configure.workflows.runs({ status: 'failed', limit: 20 });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/rules?status=draft',
      'http://api.test/api/v1/forms',
      'http://api.test/api/v1/workflow-runs?status=failed&limit=20',
    ]);
  });
});

describe('observe', () => {
  it('asks for open major incidents in words, and for closed ones too', async () => {
    const { calls, api } = recording({ data: [] });
    await api.observe.majorIncidents({ open: true });
    await api.observe.majorIncidents({ open: false });
    await api.observe.majorIncidents();
    // `open=false` is "closed ones", not "no filter", so it is sent.
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/major-incidents?open=true',
      'http://api.test/api/v1/major-incidents?open=false',
      'http://api.test/api/v1/major-incidents',
    ]);
  });

  it('leaves retired items out by not asking for them', async () => {
    const { calls, api } = recording({ data: [] });
    await api.observe.estate.cis({ includeRetired: false, search: 'db' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/cis?search=db');
  });

  it('sends traversal edge types as one comma list', async () => {
    const { calls, api } = recording({});
    await api.observe.estate.impact('c-1', { depth: 2, types: ['depends_on', 'runs_on'] });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/cis/c-1/impact?depth=2&types=depends_on%2Cruns_on');
  });

  it('removes a relationship by naming it in the body of a DELETE', async () => {
    const { calls, api } = recording(null, 204);
    await api.observe.estate.unrelate({ fromCi: 'a', toCi: 'b', type: 'runs_on' });
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.body).toEqual({ fromCi: 'a', toCi: 'b', type: 'runs_on' });
  });

  it('asks a metric question with POST, because filters do not fit a URL', async () => {
    const { calls, api } = recording({});
    await api.observe.insights.query({ metricKey: 'tickets.open', range: '90d', series: true });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/analytics/query');
    expect(calls[0]!.body).toEqual({ metricKey: 'tickets.open', range: '90d', series: true });
  });

  it('renders a dashboard by id', async () => {
    const { calls, api } = recording({ widgets: [] });
    await api.observe.insights.render('d-1');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/analytics/dashboards/d-1/render');
  });

  it('grants a skill with PUT and leaves the level to the API unless given', async () => {
    const { calls, api } = recording({});
    await api.observe.queues.grantSkill('networking', 'u-1');
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.body).toEqual({ userId: 'u-1' });
  });

  it('dismisses an error-queue item with its reason', async () => {
    const { calls, api } = recording({ status: 'dismissed' });
    await api.observe.integrations.dismiss('e-1', 'Supplier retired');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/error-queue/e-1/dismiss');
    expect(calls[0]!.body).toEqual({ reason: 'Supplier retired' });
  });
});

describe('observe, Phase 1 reads', () => {
  it('counts tickets with the list grammar and no paging, as the workbench does', async () => {
    const { calls, api } = recording({ count: 4, capped: false, applied: ['sla'] });
    const answer = await api.observe.ticketCount({ sla: 'breached', limit: 200, sort: 'dueAt' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/count?filter%5Bsla%5D=breached');
    expect(answer).toEqual({ count: 4, capped: false, applied: ['sla'] });
  });

  it('breaks the desk down on the grouped route', async () => {
    const { calls, api } = recording({ groupBy: 'group', groups: [{ key: null, count: 6 }], total: 6, applied: ['statusCategory'] });
    const answer = await api.observe.ticketCounts('group', { statusCategory: 'open,paused' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/tickets/counts');
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'filter[statusCategory]': 'open,paused', groupBy: 'group' });
    expect(answer.groups[0]).toEqual({ key: null, count: 6 });
  });

  it('reads one major incident by number for the frame’s chip', async () => {
    const { calls, api } = recording({ number: 'MI-0004', ticketId: 't-1' });
    await api.observe.majorIncident('MI-0004');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/major-incidents/MI-0004');
  });

  it('asks for approvals waiting on the reader, and decided ones only when told to', async () => {
    const { calls, api } = recording({ data: [{ id: 'a-1' }] });
    const waiting = await api.observe.approvals();
    await api.observe.approvals({ includeDecided: false });
    await api.observe.approvals({ includeDecided: true, ticketId: 't-1' });
    expect(waiting).toEqual([{ id: 'a-1' }]);
    // `includeDecided=false` once read as true and listed every decision ever
    // made, so `false` is left out rather than sent.
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/approvals',
      'http://api.test/api/v1/approvals',
      'http://api.test/api/v1/approvals?includeDecided=true&ticketId=t-1',
    ]);
  });

  it('reads one approval with its steps', async () => {
    const { calls, api } = recording({ id: 'a-1', steps: [], answers: null });
    const approval = await api.observe.approval('a-1');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/approvals/a-1');
    expect(approval.steps).toEqual([]);
  });

  it('asks a batch of metric questions in one POST (R4)', async () => {
    const { calls, api } = recording({ results: [{ id: 'open', ok: true, result: { value: 41 } }] });
    const answers = await api.observe.insights.queryBatch([{ id: 'open', metricKey: 'tickets.open' }]);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/analytics/query/batch');
    expect(calls[0]!.body).toEqual({ queries: [{ id: 'open', metricKey: 'tickets.open' }] });
    expect(answers).toEqual([{ id: 'open', ok: true, result: { value: 41 } }]);
  });

  it('keeps the whole insights group, dashboards and reports included', () => {
    const { api } = recording({});
    expect(Object.keys(api.observe.insights).sort()).toEqual([
      'createDashboard',
      'dashboard',
      'dashboards',
      'deleteDashboard',
      'forecast',
      'metrics',
      'query',
      'queryBatch',
      'render',
      'reportRuns',
      'reports',
      'runReport',
      'updateDashboard',
    ]);
  });

  it('reads rotations and who is on call through the shared calls, on the same paths', async () => {
    const { calls, api } = recording({ data: [] });
    await api.observe.queues.rotations('team-1');
    await api.observe.queues.onCall('network', '2026-10-03T09:00:00.000Z');
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/workload/rotations?teamId=team-1',
      'http://api.test/api/v1/workload/rotations/network/on-call?at=2026-10-03T09%3A00%3A00.000Z',
    ]);
  });
});

describe('the platform surface', () => {
  const id = '01a0ee8e-2e36-7705-b28e-80a403f83962';

  it('reads one tenant’s usage under the platform prefix', async () => {
    const { calls, api } = recording({ planKey: 'none', meters: [] });
    await api.platform.tenantUsage(id);
    expect(calls[0]).toMatchObject({ method: 'GET', url: `http://api.test/api/platform/v1/tenants/${id}/usage` });
  });

  it('suspends with a reason when there is one, and resumes with an empty body', async () => {
    const { calls, api } = recording({ id, status: 'suspended' });
    await api.platform.suspendTenant(id, 'Unpaid since June');
    await api.platform.suspendTenant(id);
    await api.platform.resumeTenant(id);
    expect(calls.map((call) => [call.method, call.url.replace('http://api.test', ''), call.body])).toEqual([
      ['POST', `/api/platform/v1/tenants/${id}/suspend`, { reason: 'Unpaid since June' }],
      ['POST', `/api/platform/v1/tenants/${id}/suspend`, {}],
      ['POST', `/api/platform/v1/tenants/${id}/resume`, {}],
    ]);
  });

  it('moves a tenant between plans with the strict body the route takes', async () => {
    const { calls, api } = recording({ id, planKey: 'growth' });
    await api.platform.assignPlan(id, 'growth');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: `http://api.test/api/platform/v1/tenants/${id}/plan`, body: { planKey: 'growth' } });
  });

  it('reads the deployment warnings under the platform prefix and hands back the list (D24)', async () => {
    const rows = [
      { service: 'itsm-api', codes: ['dev_token_secret_default'], at: '2026-10-02T09:00:00.000Z' },
      {
        service: 'itsm-worker-data',
        codes: ['demo_build_failing'],
        at: '2026-10-01T00:05:00.000Z',
        failure: { step: 'checks', check: 'V3 attainment bands', failures: 3 },
      },
    ];
    const { calls, api } = recording({ data: rows });
    expect(await api.platform.deploymentWarnings()).toEqual(rows);
    expect(calls).toEqual([{ method: 'GET', url: 'http://api.test/api/platform/v1/deployment-warnings', body: undefined }]);
  });
});
