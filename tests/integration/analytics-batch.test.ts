import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cache, resetConfig } from '@itsm/platform';
import {
  closeHarness,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * R4 and R4c: `POST /api/v1/analytics/query/batch` and the metric answer
 * cache (A8 §10.6, §10.7).
 *
 * A dashboard asks its questions in one request instead of twenty. What must
 * hold: the answers come back in the order asked, each exactly what the
 * single route would have said; one question that cannot be answered is that
 * entry's problem and nobody else's; a reader with no analytics gets one 403
 * for the whole call (D9).
 *
 * The cache is on for this file only (`ANALYTICS_QUERY_CACHE_SECONDS`, as the
 * deploy sets it for the API), so the second half proves what only a real
 * projection can: a cached answer is served, a projected ticket changes the
 * next one, the S1 target is read after the cache, and forecasts and
 * dashboard renders never touch it.
 */

let tenant: TestTenant;
const previousSeconds = process.env.ANALYTICS_QUERY_CACHE_SECONDS;

interface Answer {
  metric: { key: string };
  period: { from: string; to: string };
  value?: number | null;
  series?: { at: string; value: number | null }[];
  groups?: { key: string | null; label: string | null; value: number | null }[];
  source: 'facts' | 'rollup';
  target?: { value: number; unit: string; source: string };
}

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  correlationId: string;
  errors?: { field: string; code: string; message: string }[];
}

type Entry = { id?: string; ok: true; result: Answer } | { id?: string; ok: false; problem: Problem };

beforeAll(async () => {
  process.env.ANALYTICS_QUERY_CACHE_SECONDS = '120';
  resetConfig();
  tenant = await createTestTenant('analytics-batch');
  await drainEvents(tenant.id);
}, 120_000);

afterAll(async () => {
  await forgetCache();
  await deleteTestTenant('analytics-batch');
  await closeHarness();
  if (previousSeconds === undefined) delete process.env.ANALYTICS_QUERY_CACHE_SECONDS;
  else process.env.ANALYTICS_QUERY_CACHE_SECONDS = previousSeconds;
  resetConfig();
});

function batch(token: string, body: unknown) {
  return request<{ results: Entry[] }>('/api/v1/analytics/query/batch', { method: 'POST', token, body });
}

function single(token: string, body: unknown) {
  return request<Answer>('/api/v1/analytics/query', { method: 'POST', token, body });
}

async function keys(pattern: string): Promise<string[]> {
  const redis = cache();
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, page] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...page);
  } while (cursor !== '0');
  return found.sort();
}

/** Every cached answer of this tenant (not the version or settle keys). */
async function entries(): Promise<string[]> {
  return (await keys(`t:${tenant.id}:aq:*`)).filter((key) => /:aq:\d+:[0-9a-f]{32}$/.test(key));
}

/**
 * As if the settle window after the last bump had passed. Every projected
 * event opens one, and while it is open nothing is kept; waiting three
 * seconds before each cache assertion would prove nothing more.
 */
async function settled(): Promise<void> {
  await cache().del(`t:${tenant.id}:aq:settling`);
}

async function forgetCache(): Promise<void> {
  const found = await keys(`t:${tenant.id}:aq:*`);
  if (found.length > 0) await cache().del(...found);
}

describe('a batch of questions', () => {
  it('answers in the order asked, echoing the ids, each as the single route would', async () => {
    const queries = [
      { id: 'raised', metricKey: 'tickets.created', range: '7d' },
      { id: 'by-priority', metricKey: 'tickets.created', range: '7d', groupBy: 'priority' },
      { id: 'per-day', metricKey: 'tickets.created', range: '7d', series: true, bucket: 'day' },
      { id: 'open', metricKey: 'tickets.open', range: '30d' },
    ];
    const response = await batch(tenant.people.admin!.token, { queries });
    expect(response.status).toBe(200);
    expect(response.body.results.map((entry) => entry.id)).toEqual(['raised', 'by-priority', 'per-day', 'open']);
    expect(response.body.results.every((entry) => entry.ok)).toBe(true);

    for (const [index, { id: _id, ...query }] of queries.entries()) {
      const one = await single(tenant.people.admin!.token, query);
      expect(one.status).toBe(200);
      const entry = response.body.results[index]!;
      expect(entry.ok && entry.result, query.metricKey).toEqual(one.body);
    }
    const raised = response.body.results[0]!;
    expect(raised.ok && raised.result.value).toBeGreaterThanOrEqual(3);
  });

  it('keeps the order of thirty, the most it takes, with ids optional', async () => {
    const queries = Array.from({ length: 30 }, (_, index) =>
      index % 3 === 0 ? { metricKey: 'tickets.created', range: '7d' } : { id: `q${index}`, metricKey: index % 2 ? 'tickets.resolved' : 'tickets.open' },
    );
    const response = await batch(tenant.people.admin!.token, { queries });
    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(30);
    response.body.results.forEach((entry, index) => {
      if (index % 3 === 0) expect('id' in entry, String(index)).toBe(false);
      else expect(entry.id).toBe(`q${index}`);
      expect(entry.ok && entry.result.metric.key, String(index)).toBe(queries[index]!.metricKey);
    });
  });

  it('answers the others when one names a metric that does not exist', async () => {
    const response = await batch(tenant.people.admin!.token, {
      queries: [
        { id: 'a', metricKey: 'tickets.created' },
        { id: 'b', metricKey: 'no.such.metric' },
        { id: 'c', metricKey: 'tickets.resolved' },
      ],
    });
    expect(response.status).toBe(200);
    const [a, b, c] = response.body.results;
    expect(a!.ok).toBe(true);
    expect(c!.ok).toBe(true);
    expect(b).toMatchObject({ id: 'b', ok: false, problem: { status: 404, title: 'not found' } });
    expect(b!.ok === false && b!.problem.correlationId).toBeTruthy();
  });

  it('makes a malformed question its own 422, with the field it got wrong', async () => {
    const response = await batch(tenant.people.admin!.token, {
      queries: [
        { metricKey: 'tickets.created', filters: [{ field: 'password', op: 'eq', value: 'x' }] },
        { metricKey: 42 },
        { metricKey: 'tickets.created', groupBy: 'priority', series: true },
        { metricKey: 'tickets.created' },
      ],
    });
    expect(response.status).toBe(200);
    const [unknownField, notAKey, both, fine] = response.body.results;
    expect(unknownField).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(notAKey).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(notAKey!.ok === false && notAKey!.problem.errors?.map((error) => error.field)).toEqual(['metricKey']);
    expect(both).toMatchObject({ ok: false, problem: { status: 422 } });
    expect(fine!.ok).toBe(true);
  });

  it('gives a lead their team\'s ticket figures and a 403 entry for a fact with no team', async () => {
    const response = await batch(tenant.people.lead!.token, {
      queries: [
        { id: 'raised', metricKey: 'tickets.created', range: '7d' },
        { id: 'approvals', metricKey: 'approvals.turnaround' },
        { id: 'attainment', metricKey: 'sla.attainment' },
      ],
    });
    expect(response.status).toBe(200);
    const [raised, approvals, attainment] = response.body.results;
    expect(approvals).toMatchObject({ id: 'approvals', ok: false, problem: { status: 403 } });
    expect(attainment!.ok).toBe(true);
    // The harness raises two of its three tickets in the lead's team.
    expect(raised!.ok && raised!.result.value).toBe(2);

    const admin = await single(tenant.people.admin!.token, { metricKey: 'tickets.created', range: '7d' });
    expect(admin.body.value).toBe(3);
  });

  it('refuses a reader with no analytics once, for the whole call', async () => {
    for (const persona of ['agent', 'otherAgent', 'requester'] as const) {
      const response = await request<Problem>('/api/v1/analytics/query/batch', {
        method: 'POST',
        token: tenant.people[persona]!.token,
        body: { queries: [{ metricKey: 'tickets.created' }, { metricKey: 'sla.attainment' }] },
      });
      expect(response.status, persona).toBe(403);
      expect(response.body.status).toBe(403);
      expect('results' in (response.body as object)).toBe(false);
    }
  });

  it('refuses an envelope it cannot read as a whole: none, thirty-one, a repeated id, an extra key', async () => {
    const token = tenant.people.admin!.token;
    const question = { metricKey: 'tickets.created' };
    for (const [why, body] of [
      ['none', { queries: [] }],
      ['thirty-one', { queries: Array.from({ length: 31 }, () => question) }],
      ['a repeated id', { queries: [{ ...question, id: 'x' }, { ...question, id: 'x' }] }],
      ['an extra key', { queries: [question], range: '7d' }],
      ['not a list', { queries: question }],
      ['no body', undefined],
    ] as const) {
      const response = await request<Problem>('/api/v1/analytics/query/batch', { method: 'POST', token, ...(body === undefined ? {} : { body }) });
      expect(response.status, why).toBe(422);
    }
    const repeated = await batch(token, { queries: [{ ...question, id: 'x' }, { ...question, id: 'x' }] });
    expect((repeated.body as unknown as Problem).errors?.map((error) => error.field)).toEqual(['queries.1.id']);
  });

  it('carries the SLA target on attainment answers and on nothing else', async () => {
    const response = await batch(tenant.people.admin!.token, {
      queries: [{ metricKey: 'sla.attainment' }, { metricKey: 'tickets.created' }, { metricKey: 'sla.breaches' }, { metricKey: 'sla.attainment', range: '90d' }],
    });
    const [attainment, created, breaches, quarter] = response.body.results;
    expect(attainment!.ok && attainment!.result.target).toEqual({ value: 90, unit: 'percent', source: 'default' });
    expect(quarter!.ok && quarter!.result.target).toEqual({ value: 90, unit: 'percent', source: 'default' });
    expect(created!.ok && 'target' in created!.result).toBe(false);
    expect(breaches!.ok && 'target' in breaches!.result).toBe(false);
  });

  it('spends a twentieth of the request budget per batch, 30 a minute at the default', async () => {
    const batched = await batch(tenant.people.admin!.token, { queries: [{ metricKey: 'tickets.created' }] });
    expect(batched.headers['x-ratelimit-limit']).toBe('30');
    const one = await single(tenant.people.admin!.token, { metricKey: 'tickets.created' });
    expect(one.headers['x-ratelimit-limit']).toBe('600');
  });
});

describe('the metric answer cache (R4c)', () => {
  const raised = { metricKey: 'tickets.created', range: '7d' };

  it('keeps an answer under the tenant\'s version, and serves it to the next caller', async () => {
    await forgetCache();
    await settled();
    const first = await single(tenant.people.admin!.token, raised);
    expect(first.status).toBe(200);

    const kept = await entries();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(new RegExp(`^t:${tenant.id}:aq:\\d+:[0-9a-f]{32}$`));
    const ttl = await cache().ttl(kept[0]!);
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);

    // Proof that the second answer is the kept one: change what is kept.
    const stored = JSON.parse((await cache().get(kept[0]!))!) as Answer;
    expect(stored).toEqual(first.body);
    await cache().set(kept[0]!, JSON.stringify({ ...stored, value: 4242 }), 'EX', 120);
    const second = await single(tenant.people.admin!.token, raised);
    expect(second.body.value).toBe(4242);

    // The batch reads through the same cache.
    const batched = await batch(tenant.people.admin!.token, { queries: [raised] });
    expect(batched.body.results[0]!.ok && batched.body.results[0]!.result.value).toBe(4242);
  });

  it('gives a projected ticket\'s change to the very next answer', async () => {
    const before = await single(tenant.people.admin!.token, raised);
    expect(before.body.value).toBe(4242); // still the doctored entry from above

    const created = await request('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { type: 'incident', title: 'Batch: one more', priority: 'P2', groupId: tenant.teamId },
    });
    expect(created.status).toBe(201);
    await drainEvents(tenant.id);

    const after = await single(tenant.people.admin!.token, raised);
    expect(after.body.value).toBe(4);
    const version = Number(await cache().get(`t:${tenant.id}:aq:v`));
    expect(version).toBeGreaterThan(0);
    const versionTtl = await cache().ttl(`t:${tenant.id}:aq:v`);
    expect(versionTtl).toBeGreaterThan(604_000);
    expect(versionTtl).toBeLessThanOrEqual(604_800);
  });

  it('keeps nothing while a bump may not have committed, and keeps it once it has', async () => {
    // A projection handler bumps a moment before its transaction commits and
    // opens the settle window; the window is set by hand here, for a minute,
    // so the assertion does not depend on how long a drain takes under load.
    await forgetCache();
    await cache().set(`t:${tenant.id}:aq:settling`, '1', 'PX', 60_000);
    const unsettled = await single(tenant.people.admin!.token, raised);
    expect(unsettled.status).toBe(200);
    expect(await entries()).toEqual([]);

    await settled();
    const answered = await single(tenant.people.admin!.token, raised);
    expect(answered.body).toEqual(unsettled.body);
    expect(await entries()).toHaveLength(1);
  });

  it('never hands a lead an administrator\'s answer', async () => {
    await forgetCache();
    await settled();
    const admin = await single(tenant.people.admin!.token, raised);
    const lead = await single(tenant.people.lead!.token, raised);
    expect(await entries()).toHaveLength(2);
    expect(lead.body.value).toBeLessThan(admin.body.value!);
  });

  it('reads the SLA target after the cache, so a changed target shows at once', async () => {
    await forgetCache();
    await settled();
    const first = await single(tenant.people.lead!.token, { metricKey: 'sla.attainment' });
    expect(first.body.target).toEqual({ value: 90, unit: 'percent', source: 'default' });

    const [kept] = await entries();
    const stored = JSON.parse((await cache().get(kept!))!) as Answer;
    expect('target' in stored).toBe(false);
    await cache().set(kept!, JSON.stringify({ ...stored, value: 87.5 }), 'EX', 120);

    const written = await request(`/api/v1/settings/sla.attainment.target`, {
      method: 'PUT',
      token: tenant.people.admin!.token,
      body: { value: 95 },
    });
    expect(written.status).toBe(200);

    const second = await single(tenant.people.lead!.token, { metricKey: 'sla.attainment' });
    expect(second.body.value).toBe(87.5); // the kept answer…
    expect(second.body.target).toEqual({ value: 95, unit: 'percent', source: 'setting' }); // …with today's target
  });

  it('never caches a forecast or a dashboard render', async () => {
    await forgetCache();
    await settled();
    const forecast = await request('/api/v1/analytics/forecast', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { metricKey: 'tickets.created', range: '30d', horizonDays: 7 },
    });
    expect(forecast.status).toBe(200);

    const list = await request<{ data: { id: string; key: string }[] }>('/api/v1/analytics/dashboards', { token: tenant.people.admin!.token });
    const overview = list.body.data.find((row) => row.key === 'service-desk')!;
    const render = await request<{ widgets: { metricKey: string; result?: Answer }[] }>(`/api/v1/analytics/dashboards/${overview.id}/render`, {
      token: tenant.people.admin!.token,
    });
    expect(render.status).toBe(200);
    expect(await entries()).toEqual([]);

    // The render carries the target as every attainment answer does (S1).
    const attainment = render.body.widgets.find((widget) => widget.metricKey === 'sla.attainment');
    expect(attainment?.result?.target).toEqual({ value: 95, unit: 'percent', source: 'setting' });
  });

  it('moves the version on when a metric definition changes', async () => {
    await settled();
    const before = Number((await cache().get(`t:${tenant.id}:aq:v`)) ?? '0');
    const created = await request('/api/v1/analytics/metrics', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'batch.raised', name: 'Raised (batch)', fact: 'ticket', aggregate: 'count', filters: [] },
    });
    expect(created.status).toBe(201);
    const updated = await request('/api/v1/analytics/metrics/batch.raised', {
      method: 'PATCH',
      token: tenant.people.admin!.token,
      body: { filters: [{ field: 'priority', op: 'eq', value: 'P1' }] },
    });
    expect(updated.status).toBe(200);
    const removed = await request('/api/v1/analytics/metrics/batch.raised', { method: 'DELETE', token: tenant.people.admin!.token });
    expect(removed.status).toBe(204);
    expect(Number(await cache().get(`t:${tenant.id}:aq:v`))).toBe(before + 3);
  });

  it('answers a deleted metric with a 404, not a kept answer', async () => {
    await settled();
    const created = await request('/api/v1/analytics/metrics', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'batch.gone', name: 'Gone (batch)', fact: 'ticket', aggregate: 'count', filters: [] },
    });
    expect(created.status).toBe(201);
    await settled();
    expect((await single(tenant.people.admin!.token, { metricKey: 'batch.gone' })).status).toBe(200);
    expect((await single(tenant.people.admin!.token, { metricKey: 'batch.gone' })).status).toBe(200);

    const removed = await request('/api/v1/analytics/metrics/batch.gone', { method: 'DELETE', token: tenant.people.admin!.token });
    expect(removed.status).toBe(204);
    expect((await single(tenant.people.admin!.token, { metricKey: 'batch.gone' })).status).toBe(404);
  });

  it('moves the version on after a rebuild and after a replay', async () => {
    const version = async () => Number((await cache().get(`t:${tenant.id}:aq:v`)) ?? '0');
    const start = await version();
    const today = new Date();
    const rebuilt = await request('/api/v1/analytics/rebuild', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { from: new Date(today.getTime() - 86_400_000).toISOString(), to: today.toISOString() },
    });
    expect(rebuilt.status).toBe(200);
    const afterRebuild = await version();
    expect(afterRebuild).toBeGreaterThan(start);

    const replayed = await request<{ replayed: number }>('/api/v1/analytics/replay', { method: 'POST', token: tenant.people.admin!.token, body: {} });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBeGreaterThan(0);
    expect(await version()).toBeGreaterThan(afterRebuild);
  });
});
