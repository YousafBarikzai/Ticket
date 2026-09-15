import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { portal } from '../resources/portal.js';

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
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
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
    await client.myTickets({ statusCategory: 'new,open,pending' });
    expect(calls[0]!.url).toContain('filter%5BstatusCategory%5D=new%2Copen%2Cpending');
  });
});

describe('replying and reopening', () => {
  it('sends a requester’s message as public, always', async () => {
    const { calls, client } = recording({ id: 'c-1' });
    await client.comment('INC-1', 'still broken');
    expect(calls[0]!.body).toEqual({ body: 'still broken', visibility: 'public' });
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
    const { calls, client } = recording({ data: [] });
    await client.approvals();
    expect(calls[0]!.url).not.toContain('includeDecided=true');

    const second = recording({ data: [] });
    await second.client.approvals(true);
    expect(second.calls[0]!.url).toContain('includeDecided=true');
  });

  it('sends a decision in the API’s vocabulary', async () => {
    const { calls, client } = recording({});
    await client.decide('a-1', 'rejected', 'No budget until April.');
    expect(calls[0]!.body).toEqual({ decision: 'rejected', comment: 'No budget until April.' });
  });

  it('searches articles rather than everything', async () => {
    const { calls, client } = recording({ data: [], meta: { facets: {}, engine: 'meilisearch' } });
    await client.search('vpn', { types: 'article' });
    expect(calls[0]!.url).toContain('q=vpn');
    expect(calls[0]!.url).toContain('types=article');
  });

  it('rates an article with a boolean the API will accept', async () => {
    const { calls, client } = recording({});
    await client.rateArticle('kb-12', false, 'It is out of date.');
    expect(calls[0]!.body).toEqual({ helpful: false, comment: 'It is out of date.' });
  });
});
