import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { ticketQuery, workbench } from '../resources/workbench.js';

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

function recording(status = 200, responseBody: unknown = {}): { calls: Recorded[]; fetch: typeof fetch } {
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
