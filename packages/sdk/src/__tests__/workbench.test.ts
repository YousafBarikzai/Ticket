import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { ticketCountQuery, ticketCountsQuery, ticketQuery, workbench } from '../resources/workbench.js';

/**
 * These tests are about the API's grammar, not about the client's internals.
 *
 * The first version of this resource file was written from doc 08 rather than
 * from `apps/api/src/routes`, and three of its calls were wrong in the way
 * that is hardest to notice: the API ignores a query parameter it does not
 * recognise and defaults a field it is not sent. A filtered queue silently
 * returned everything, and an internal note would have been delivered to the
 * requester. Both now fail here instead.
 */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function recording(
  status = 200,
  responseBody: unknown | ((url: string) => unknown) = {},
): { calls: Recorded[]; fetch: typeof fetch } {
  const calls: Recorded[] = [];
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const answer = typeof responseBody === 'function' ? (responseBody as (url: string) => unknown)(url) : responseBody;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetch: doFetch as unknown as typeof fetch };
}

function client(doFetch: typeof fetch) {
  return workbench(createClient({ baseUrl: 'http://api.test', fetch: doFetch, token: 'tok' }));
}

describe('the list grammar', () => {
  it('brackets every filter, because a bare one is silently ignored', () => {
    expect(ticketQuery({ status: 'new,in_progress', assignee: 'me', group: 'g-1' })).toEqual({
      limit: 50,
      'filter[status]': 'new,in_progress',
      'filter[assignee]': 'me',
      'filter[group]': 'g-1',
    });
  });

  it('leaves out what was not asked for', () => {
    expect(ticketQuery({})).toEqual({ limit: 50 });
    expect(ticketQuery({ status: '' })).toEqual({ limit: 50 });
  });

  it('passes the paging and sorting parameters unbracketed, as the API takes them', () => {
    expect(ticketQuery({ limit: 10, cursor: 'c', sort: 'dueAt', q: 'vpn' })).toEqual({
      limit: 10,
      cursor: 'c',
      sort: 'dueAt',
      q: 'vpn',
    });
  });

  it('reaches the API as a URL the API will actually filter on', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [], nextCursor: null });
    await client(doFetch).tickets({ assignee: 'me', statusCategory: 'open' });
    expect(calls[0]!.url).toContain('filter%5Bassignee%5D=me');
    expect(calls[0]!.url).toContain('filter%5BstatusCategory%5D=open');
  });
});

describe('writing to a ticket', () => {
  it('sends the visibility the API understands, not a boolean it would ignore', async () => {
    const { calls, fetch: doFetch } = recording(201, { id: 'c-1' });
    await client(doFetch).comment('INC-1', 'for my colleagues', true);
    expect(calls[0]!.body).toEqual({ body: 'for my colleagues', visibility: 'internal' });
  });

  it('defaults to a public reply, which is what the API defaults to as well', async () => {
    const { calls, fetch: doFetch } = recording(201, { id: 'c-2' });
    await client(doFetch).comment('INC-1', 'hello');
    expect(calls[0]!.body).toEqual({ body: 'hello', visibility: 'public' });
  });

  it('carries the version as a quoted If-Match on a transition', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).transition('INC-1', 'resolved', 7, 'fixed');
    expect(calls[0]!.headers['if-match']).toBe('"7"');
    expect(calls[0]!.body).toEqual({ to: 'resolved', reason: 'fixed' });
  });

  it('sends no If-Match on an assignment when the caller has no version', async () => {
    // Optional, unlike a transition: a queue screen claims from a list it read
    // a minute ago, and the route answers without one rather than making every
    // claim re-read the row first.
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).assign('INC-1', 'u-1');
    expect(calls[0]!.headers['if-match']).toBeUndefined();
    expect(calls[0]!.body).toEqual({ assigneeId: 'u-1', method: 'manual' });
  });

  it('sends it when the caller does have one, so a second claim is refused', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).assign('INC-1', 'u-1', null, 4);
    expect(calls[0]!.headers['if-match']).toBe('"4"');
    expect(calls[0]!.body).toEqual({ assigneeId: 'u-1', groupId: null, method: 'manual' });
  });

  it('passes a null assignee through rather than dropping it', async () => {
    // Giving a ticket back to the queue is `assigneeId: null`; a client that
    // omitted the field would be asking for no change at all.
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).assign('INC-1', null);
    expect(calls[0]!.body).toEqual({ assigneeId: null, method: 'manual' });
  });
});

describe('transitions', () => {
  it('still takes a bare reason in the fourth place', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).transition('INC-1', 'pending_requester', 3, 'Asked for the laptop model');
    expect(calls[0]!.body).toEqual({ to: 'pending_requester', reason: 'Asked for the laptop model' });
  });

  it('carries a resolution code, which the route takes and the old signature could not send', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).transition('INC-1', 'resolved', 3, { reason: 'Replaced the cable', resolutionCode: 'fixed' });
    expect(calls[0]!.headers['if-match']).toBe('"3"');
    expect(calls[0]!.body).toEqual({ to: 'resolved', reason: 'Replaced the cable', resolutionCode: 'fixed' });
  });

  it('sends nothing it was not given', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).transition('INC-1', 'in_progress', 3, {});
    expect(calls[0]!.body).toEqual({ to: 'in_progress' });
  });
});

describe('raising and editing', () => {
  it('raises with an idempotency key, and reuses one it is given', async () => {
    const { calls, fetch: doFetch } = recording(201, { number: 'INC-9' });
    await client(doFetch).createTicket({ title: 'Printer on fire' });
    await client(doFetch).createTicket({ title: 'Printer on fire' }, { idempotencyKey: 'sheet-1' });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^sdk-/);
    expect(calls[1]!.headers['idempotency-key']).toBe('sheet-1');
  });

  it('edits with PATCH and the version it read', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).updateTicket('INC-1', { priority: 'P2', categoryId: null }, 5);
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/INC-1');
    expect(calls[0]!.headers['if-match']).toBe('"5"');
    expect(calls[0]!.body).toEqual({ priority: 'P2', categoryId: null });
  });
});

describe('counting a view', () => {
  it('uses the list grammar without paging or sorting', () => {
    expect(ticketCountQuery({ statusCategory: 'open,paused', assignee: 'none', limit: 25, cursor: 'c', sort: 'dueAt' })).toEqual({
      'filter[statusCategory]': 'open,paused',
      'filter[assignee]': 'none',
    });
  });

  it('asks the count route, not the list', async () => {
    const { calls, fetch: doFetch } = recording(200, { count: 12, capped: false });
    const answer = await client(doFetch).ticketCount({ assignee: 'me' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/count?filter%5Bassignee%5D=me');
    expect(answer).toEqual({ count: 12, capped: false });
  });
});

describe('looking people up', () => {
  it('asks for ids in one comma list, without repeats', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [] });
    await client(doFetch).users({ ids: ['u-1', 'u-2', 'u-1'] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/users?ids=u-1%2Cu-2');
  });

  it('splits more than two hundred ids across calls and answers in one list', async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `u-${index}`);
    const { calls, fetch: doFetch } = recording(200, (url: string) => {
      const asked = decodeURIComponent(new URL(url).searchParams.get('ids') ?? '').split(',');
      return { data: asked.map((id) => ({ id })) };
    });
    const people = await client(doFetch).users({ ids });
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => decodeURIComponent(new URL(call.url).searchParams.get('ids')!).split(',').length)).toEqual([200, 200, 50]);
    expect(people.map((person) => person.id)).toEqual(ids);
  });

  it('asks nothing for no ids, because an empty list is a 422 and not everybody', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [] });
    expect(await client(doFetch).users({ ids: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('around a ticket', () => {
  it('reads links and watchers from the ticket, and unwraps them', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [{ userId: 'u-1', reason: 'manual', createdAt: 'x' }] });
    const watchers = await client(doFetch).ticketWatchers('INC-1');
    await client(doFetch).ticketLinks('INC-1');
    expect(watchers).toHaveLength(1);
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/tickets/INC-1/watchers',
      'http://api.test/api/v1/tickets/INC-1/links',
    ]);
  });

  it('links in the API’s vocabulary', async () => {
    const { calls, fetch: doFetch } = recording(201, {});
    await client(doFetch).link('INC-1', 'INC-2', 'duplicate_of');
    expect(calls[0]!.body).toEqual({ target: 'INC-2', linkType: 'duplicate_of' });
  });

  it('asks for active categories without saying so', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [] });
    await client(doFetch).categories();
    await client(doFetch).categories({ includeInactive: true });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/categories',
      'http://api.test/api/v1/categories?includeInactive=true',
    ]);
  });
});

describe('me', () => {
  it('asks the bell for unread ones only when told to', async () => {
    const { calls, fetch: doFetch } = recording(200, { unread: 0, data: [] });
    await client(doFetch).notifications();
    await client(doFetch).notifications({ unread: true, limit: 10 });
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/notifications',
      'http://api.test/api/v1/notifications?unread=true&limit=10',
    ]);
  });

  it('marks everything read with the word the route takes', async () => {
    const { calls, fetch: doFetch } = recording(200, { marked: 4 });
    await client(doFetch).markNotificationRead('all');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/notifications/all/read');
  });

  it('answers the running timer, or null', async () => {
    const { fetch: doFetch } = recording(200, { running: null });
    expect(await client(doFetch).timer()).toBeNull();
  });

  it('sets availability with PUT', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).setAvailability({ status: 'away', reason: 'Lunch' });
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.body).toEqual({ status: 'away', reason: 'Lunch' });
  });
});

describe('search', () => {
  it('spells filters and facets the way /search reads them', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [], meta: { facets: {}, engine: 'postgres' } });
    await client(doFetch).search('vpn', {
      types: ['ticket'],
      filter: { status: ['open', 'in_progress'], priority: 'P1' },
      facets: ['status'],
      limit: 5,
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('types')).toBe('ticket');
    expect(url.searchParams.get('filter')).toBe('status:open,status:in_progress,priority:P1');
    expect(url.searchParams.get('facets')).toBe('status');
    expect(url.searchParams.get('limit')).toBe('5');
  });
});

describe('the R2 time and SLA filters', () => {
  it('brackets every window and the SLA word, like every other filter', () => {
    expect(
      ticketQuery({
        statusCategory: 'open',
        createdAfter: '2026-09-01T00:00:00Z',
        createdBefore: '2026-10-01T00:00:00Z',
        dueAfter: '2026-10-02T23:00:00.000Z',
        dueBefore: '2026-10-03T23:00:00.000Z',
        resolvedAfter: '2026-09-02T00:00:00+01:00',
        resolvedBefore: '2026-09-03T00:00:00+01:00',
        sla: 'breached',
      }),
    ).toEqual({
      limit: 50,
      'filter[statusCategory]': 'open',
      'filter[createdAfter]': '2026-09-01T00:00:00Z',
      'filter[createdBefore]': '2026-10-01T00:00:00Z',
      'filter[dueAfter]': '2026-10-02T23:00:00.000Z',
      'filter[dueBefore]': '2026-10-03T23:00:00.000Z',
      'filter[resolvedAfter]': '2026-09-02T00:00:00+01:00',
      'filter[resolvedBefore]': '2026-09-03T00:00:00+01:00',
      'filter[sla]': 'breached',
    });
  });

  it('sends a Date as an ISO instant, never as the local string `String(date)` makes', () => {
    // "Due today" is the reader's local midnight, which a loader holds as a
    // Date; the API refuses anything but an ISO instant with a zone.
    const midnight = new Date(Date.UTC(2026, 9, 2, 23, 0, 0));
    expect(ticketQuery({ dueBefore: midnight })).toEqual({ limit: 50, 'filter[dueBefore]': '2026-10-02T23:00:00.000Z' });
  });

  it('asks nothing for an invalid Date rather than throwing inside a loader', () => {
    expect(ticketQuery({ dueBefore: new Date('not a date'), sla: 'due_soon' })).toEqual({ limit: 50, 'filter[sla]': 'due_soon' });
  });

  it('escapes an offset’s plus sign, which would otherwise arrive as a space', async () => {
    const { calls, fetch: doFetch } = recording(200, { count: 0, capped: false, applied: ['dueAfter'] });
    await client(doFetch).ticketCount({ dueAfter: '2026-10-02T09:00:00+01:00' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/count?filter%5BdueAfter%5D=2026-10-02T09%3A00%3A00%2B01%3A00');
    expect(new URL(calls[0]!.url).searchParams.get('filter[dueAfter]')).toBe('2026-10-02T09:00:00+01:00');
  });

  it('keeps the windows on a count, which drops only paging and sorting', () => {
    expect(ticketCountQuery({ sla: 'breached', createdAfter: '2026-09-01T00:00:00Z', limit: 10, sort: 'dueAt' })).toEqual({
      'filter[sla]': 'breached',
      'filter[createdAfter]': '2026-09-01T00:00:00Z',
    });
  });
});

describe('grouped counts (R2g)', () => {
  it('asks the grouped route with `groupBy` and the count grammar', async () => {
    const answer = { groupBy: 'priority', groups: [{ key: 'P1', count: 2 }], total: 2, applied: ['statusCategory'] };
    const { calls, fetch: doFetch } = recording(200, answer);
    const counts = await client(doFetch).ticketCounts('priority', { statusCategory: 'open,paused', limit: 5, cursor: 'c' });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/tickets/counts');
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'filter[statusCategory]': 'open,paused', groupBy: 'priority' });
    expect(counts).toEqual(answer);
  });

  it('builds the same query a page can reuse for the console', () => {
    expect(ticketCountsQuery('sla', { group: 'g-1' })).toEqual({ 'filter[group]': 'g-1', groupBy: 'sla' });
  });

  it('needs no filter for the dimensions that imply open work', async () => {
    const { calls, fetch: doFetch } = recording(200, { groupBy: 'age', groups: [], total: 0, applied: [] });
    await client(doFetch).ticketCounts('age');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/counts?groupBy=age');
  });
});

describe('the Overview’s other reads', () => {
  it('asks for open major incidents in words, and sends `false` when it means closed ones', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [] });
    await client(doFetch).majorIncidents({ open: true });
    await client(doFetch).majorIncidents({ open: false });
    await client(doFetch).majorIncidents();
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/major-incidents?open=true',
      'http://api.test/api/v1/major-incidents?open=false',
      'http://api.test/api/v1/major-incidents',
    ]);
  });

  it('reads one incident by number, with the audience only when asked', async () => {
    const { calls, fetch: doFetch } = recording(200, { number: 'MI-0004', ticketId: 't-1' });
    const incident = await client(doFetch).majorIncident('MI-0004');
    await client(doFetch).majorIncident('MI-0004', 'public');
    expect(incident.ticketId).toBe('t-1');
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/major-incidents/MI-0004',
      'http://api.test/api/v1/major-incidents/MI-0004?audience=public',
    ]);
  });

  it('reads the rotations, then who is on call for one of them', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [] });
    await client(doFetch).rotations();
    await client(doFetch).rotations('team-1');
    await client(doFetch).onCall('network out-of-hours');
    await client(doFetch).onCall('network', '2026-10-03T09:00:00.000Z');
    expect(calls.map((call) => call.url)).toEqual([
      'http://api.test/api/v1/workload/rotations',
      'http://api.test/api/v1/workload/rotations?teamId=team-1',
      'http://api.test/api/v1/workload/rotations/network%20out-of-hours/on-call',
      'http://api.test/api/v1/workload/rotations/network/on-call?at=2026-10-03T09%3A00%3A00.000Z',
    ]);
  });

  it('reads the configuration items a ticket touched, and unwraps them', async () => {
    const row = { role: 'affected', linkedAt: '2026-10-01T09:00:00.000Z', ci: null };
    const { calls, fetch: doFetch } = recording(200, { data: [row] });
    expect(await client(doFetch).recordCis('ticket', 't-1')).toEqual([row]);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/records/ticket/t-1/cis');
  });

  it('reads the services and unwraps them', async () => {
    const { calls, fetch: doFetch } = recording(200, { data: [{ id: 's-1', key: 'email', name: 'Email' }] });
    expect(await client(doFetch).services()).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/services');
  });
});

describe('metric questions (R4)', () => {
  it('sends a batch as one POST and answers in the order it asked', async () => {
    const results = [
      { id: 'raised', ok: true, result: { value: 398 } },
      { id: 'approvals', ok: false, problem: { type: 'https://docs.itsm.example/problems/forbidden', title: 'forbidden', status: 403, correlationId: 'c' } },
    ];
    const { calls, fetch: doFetch } = recording(200, { results });
    const queries = [
      { id: 'raised', metricKey: 'tickets.created', range: '30d' as const },
      { id: 'approvals', metricKey: 'approvals.turnaround' },
    ];
    const answers = await client(doFetch).insights.queryBatch(queries);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/analytics/query/batch');
    expect(calls[0]!.body).toEqual({ queries });
    expect(answers).toEqual(results);
    // A batch writes nothing, but it is a POST: the client gives every POST a key.
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^sdk-/);
  });

  it('asks nothing for no questions, because the API’s minimum is one', async () => {
    const { calls, fetch: doFetch } = recording(200, { results: [] });
    expect(await client(doFetch).insights.queryBatch([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('asks a single question and a forecast the way the console does', async () => {
    const { calls, fetch: doFetch } = recording(200, {});
    await client(doFetch).insights.query({ metricKey: 'sla.attainment', range: '30d' });
    await client(doFetch).insights.forecast({ metricKey: 'tickets.created', horizonDays: 7 });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'http://api.test/api/v1/analytics/query'],
      ['POST', 'http://api.test/api/v1/analytics/forecast'],
    ]);
    expect(calls[1]!.body).toEqual({ metricKey: 'tickets.created', horizonDays: 7 });
  });

  it('carries only the metric questions, not the console’s dashboards and reports', () => {
    const { fetch: doFetch } = recording(200, {});
    expect(Object.keys(client(doFetch).insights).sort()).toEqual(['forecast', 'query', 'queryBatch']);
  });
});
