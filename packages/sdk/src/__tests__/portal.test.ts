import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { portal, queueable } from '../resources/portal.js';

/**
 * The portal's half of the API's grammar.
 *
 * Same purpose as `workbench.test.ts`: the API ignores a query parameter it
 * does not recognise and defaults a field it is not sent, so the failures this
 * guards against are silent ones — a "my tickets" page that shows everybody's,
 * a reply that arrives with the wrong visibility, a report that shows up in
 * the numbers as having come from the API rather than from a person.
 */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function recording(responseBody: unknown = {}, status = 200): { calls: Recorded[]; client: ReturnType<typeof portal> } {
  const calls: Recorded[] = [];
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    // A 204 has no body, and a Response refuses to be built with one.
    return new Response(status === 204 ? null : JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  });
  return {
    calls,
    client: portal(createClient({ baseUrl: 'http://api.test', fetch: doFetch as unknown as typeof fetch, token: 'tok' })),
  };
}

describe('raising something', () => {
  it('says the ticket came from the portal', async () => {
    // Every rule, report and calendar can distinguish a ticket a person typed
    // from one an inbox produced. A client that left this at the API's default
    // would make the portal invisible in its own numbers.
    const { calls, client } = recording({ number: 'INC-1' });
    await client.reportIssue({ title: 'VPN will not connect' });
    expect(calls[0]!.body).toMatchObject({ type: 'incident', sourceChannel: 'portal', title: 'VPN will not connect' });
  });

  it('sends urgency and never impact', async () => {
    const { calls, client } = recording({ number: 'INC-1' });
    await client.reportIssue({ title: 'x', urgency: 'high' });
    expect(calls[0]!.body).toMatchObject({ urgency: 'high' });
    expect(calls[0]!.body).not.toHaveProperty('impact');
    expect(calls[0]!.body).not.toHaveProperty('priority');
  });

  it('carries an idempotency key, so a double-tap raises one ticket', async () => {
    const { calls, client } = recording({ number: 'INC-1' });
    await client.reportIssue({ title: 'x' });
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^sdk-/);
  });

  it('submits catalogue answers under `answers`, as the API reads them', async () => {
    const { calls, client } = recording({ ticketNumber: 'REQ-1' });
    await client.submitRequest('new-laptop', { model: 'standard' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/catalogue/new-laptop/submit');
    expect(calls[0]!.body).toEqual({ answers: { model: 'standard' } });
  });

  it('sends the caller’s idempotency key for a catalogue request, so a retry of the same answers is one request', async () => {
    const { calls, client } = recording({ ticketNumber: 'REQ-1' });
    await client.submitRequest('new-laptop', { model: 'standard' }, { idempotencyKey: 'request-abc' });
    await client.submitRequest('new-laptop', { model: 'standard' });
    expect(calls[0]!.headers['idempotency-key']).toBe('request-abc');
    expect(calls[1]!.headers['idempotency-key']).toMatch(/^sdk-/);
  });

  it('escapes a key that is not URL-safe', async () => {
    const { calls, client } = recording({});
    await client.catalogueItem('access/finance share');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/catalogue/access%2Ffinance%20share');
  });
});

describe('my tickets', () => {
  it('always filters to the reader, resolved server-side', async () => {
    const { calls, client } = recording({ data: [], nextCursor: null });
    await client.myTickets();
    expect(calls[0]!.url).toContain('filter%5Brequester%5D=me');
  });

  it('cannot be talked out of that filter', async () => {
    // `Omit<TicketFilter, 'requester'>` stops it at compile time; this is the
    // runtime half, because a caller in plain JavaScript has no types.
    const { calls, client } = recording({ data: [], nextCursor: null });
    await client.myTickets({ requester: 'somebody-else' } as never);
    expect(calls[0]!.url).toContain('filter%5Brequester%5D=me');
    expect(calls[0]!.url).not.toContain('somebody-else');
  });

  it('brackets the status category alongside it', async () => {
    const { calls, client } = recording({ data: [], nextCursor: null });
    await client.myTickets({ statusCategory: 'open,paused,resolved' });
    expect(calls[0]!.url).toContain('filter%5BstatusCategory%5D=open%2Cpaused%2Cresolved');
  });
});

describe('counting my tickets', () => {
  it('counts on the count route, filtered to the reader', async () => {
    const { calls, client } = recording({ count: 3, capped: false, applied: ['requester', 'statusCategory'] });
    const answer = await client.myTicketCount({ statusCategory: 'open,paused', limit: 10 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/tickets/count');
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'filter[statusCategory]': 'open,paused', 'filter[requester]': 'me' });
    expect(answer).toEqual({ count: 3, capped: false, applied: ['requester', 'statusCategory'] });
  });

  it('forces `requester=me` even when a caller passes somebody else', async () => {
    // A tile that counted another person's tickets would show a number about
    // somebody the reader has no business knowing about.
    const { calls, client } = recording({ count: 0, capped: false });
    await client.myTicketCount({ requester: 'somebody-else', statusCategory: 'resolved' } as never);
    expect(new URL(calls[0]!.url).searchParams.get('filter[requester]')).toBe('me');
    expect(calls[0]!.url).not.toContain('somebody-else');
  });

  it('carries the R2 windows, so "Resolved · 30 days" is one call', async () => {
    const { calls, client } = recording({ count: 0, capped: false });
    await client.myTicketCount({ resolvedAfter: new Date(Date.UTC(2026, 8, 3)) });
    expect(new URL(calls[0]!.url).searchParams.get('filter[resolvedAfter]')).toBe('2026-09-03T00:00:00.000Z');
  });

  it('breaks my tickets down on the grouped route, still filtered to me', async () => {
    const { calls, client } = recording({ groupBy: 'statusCategory', groups: [], total: 0, applied: ['requester'] });
    await client.myTicketCounts('statusCategory', { requester: 'somebody-else', createdAfter: '2026-01-01T00:00:00Z' } as never);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/tickets/counts');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'filter[requester]': 'me',
      'filter[createdAfter]': '2026-01-01T00:00:00Z',
      groupBy: 'statusCategory',
    });
  });
});

describe('replying and reopening', () => {
  it('sends a requester’s message as public, always, and says it came from the portal', async () => {
    const { calls, client } = recording({ id: 'c-1' });
    await client.comment('INC-1', 'still broken');
    expect(calls[0]!.body).toEqual({ body: 'still broken', visibility: 'public', channel: 'portal' });
  });

  it('queues the same body it sends online', () => {
    expect(queueable.comment('INC-1', 'still broken').body).toEqual({ body: 'still broken', visibility: 'public', channel: 'portal' });
  });

  it('reopens with the version as If-Match and a reason', async () => {
    const { calls, client } = recording({});
    await client.reopen('INC-1', 4, 'It came back this morning.');
    expect(calls[0]!.headers['if-match']).toBe('"4"');
    expect(calls[0]!.body).toEqual({ to: 'reopened', reason: 'It came back this morning.' });
  });
});

describe('approvals and knowledge', () => {
  it('asks only for what is open unless told otherwise', async () => {
    // Not even `includeDecided=false`: the route used to coerce it, and
    // `Boolean('false')` listed every decision the person had ever made.
    const { calls, client } = recording({ data: [] });
    await client.approvals();
    expect(calls[0]!.url).toBe('http://api.test/api/v1/approvals');

    const second = recording({ data: [] });
    await second.client.approvals(true);
    expect(second.calls[0]!.url).toBe('http://api.test/api/v1/approvals?includeDecided=true');

    const third = recording({ data: [] });
    await third.client.approvals({ includeDecided: false });
    expect(third.calls[0]!.url).toBe('http://api.test/api/v1/approvals');
  });

  it('asks how far the approvals on one of my tickets have got', async () => {
    const { calls, client } = recording({ data: [] });
    await client.approvals({ ticketId: 't-1' });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/approvals?ticketId=t-1');
  });

  it('sends a decision in the API’s vocabulary', async () => {
    const { calls, client } = recording({});
    await client.decide('a-1', 'rejected', 'No budget until April.');
    expect(calls[0]!.body).toEqual({ decision: 'rejected', comment: 'No budget until April.' });
  });

  it('searches articles rather than everything, under the name the index uses', async () => {
    const { calls, client } = recording({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
    await client.search('vpn', { types: 'knowledge' });
    expect(calls[0]!.url).toContain('q=vpn');
    expect(calls[0]!.url).toContain('types=knowledge');
  });

  it('sends the old spelling as the index’s name, because `article` matches nothing', async () => {
    const { calls, client } = recording({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
    await client.search('vpn', { types: 'article' });
    expect(calls[0]!.url).toContain('types=knowledge');
    expect(calls[0]!.url).not.toContain('article');
  });

  it('rates an article with a boolean the API will accept', async () => {
    const { calls, client } = recording({});
    await client.rateArticle('kb-12', false, 'It is out of date.');
    expect(calls[0]!.body).toEqual({ helpful: false, comment: 'It is out of date.' });
  });
});

describe('the public status page', () => {
  it('reads it from the API root as JSON, not from /api/v1', async () => {
    const { calls, client } = recording({ overall: 'operational', components: [] });
    await client.publicStatus('acme corp');
    expect(calls[0]!.url).toBe('http://api.test/status/acme%20corp');
    expect(calls[0]!.method).toBe('GET');
    // The same URL is an HTML page to a browser.
    expect(calls[0]!.headers.accept).toBe('application/json');
  });

  it('answers null where there is no page', async () => {
    const { client } = recording({ error: 'not_found' }, 404);
    expect(await client.publicStatus('nobody')).toBeNull();
  });

  it('still fails loudly when the API does', async () => {
    const { client } = recording({ title: 'internal', status: 500 }, 500);
    await expect(client.publicStatus('acme')).rejects.toMatchObject({ status: 500 });
  });
});

describe('closing and the rest', () => {
  it('closes a resolved ticket with the version it read', async () => {
    const { calls, client } = recording({});
    await client.transition('INC-1', 'closed', 6);
    expect(calls[0]!.url).toBe('http://api.test/api/v1/tickets/INC-1/transitions');
    expect(calls[0]!.headers['if-match']).toBe('"6"');
    expect(calls[0]!.body).toEqual({ to: 'closed' });
  });

  it('ends a session with DELETE', async () => {
    const { calls, client } = recording(null, 204);
    await client.endSession('s-1');
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('http://api.test/api/v1/me/sessions/s-1');
  });

  it('lists published articles with the filter the route reads', async () => {
    const { calls, client } = recording({ data: [] });
    await client.knowledge({ status: 'published', limit: 200 });
    expect(calls[0]!.url).toBe('http://api.test/api/v1/knowledge?status=published&limit=200');
  });
});

describe('what may be queued offline', () => {
  it('names its method, which is always POST', () => {
    for (const request of [
      queueable.reportIssue({ title: 'x' }),
      queueable.comment('INC-1', 'hello'),
      queueable.decide('a-1', 'approved'),
    ]) {
      expect(request.method).toBe('POST');
    }
  });
});
