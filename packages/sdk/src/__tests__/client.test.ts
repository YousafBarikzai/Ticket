import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from '../client.js';

/**
 * The four conventions the API has that a hand-rolled `fetch` gets wrong.
 *
 * Each of these is a bug that does not look like one: a second ticket from a
 * double click, an overwrite that loses somebody's edit, an error message that
 * reads `[object Object]`, and a list that shows a row twice. They are cheap to
 * assert here and expensive to notice in production.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function recorder(response: { status?: number; body?: unknown; text?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const text = response.text ?? (response.body === undefined ? '' : JSON.stringify(response.body));
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      text: async () => text,
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('talking to the API', () => {
  it('sends a bearer token, from a string or from a function', async () => {
    const fixed = recorder({ body: { ok: true } });
    await createClient({ baseUrl: 'https://api.test', token: 'abc', fetch: fixed.fetchImpl }).request('/api/v1/me');
    expect(fixed.calls[0]!.headers.authorization).toBe('Bearer abc');

    const rotating = recorder({ body: { ok: true } });
    await createClient({
      baseUrl: 'https://api.test',
      // A session that refreshes underneath the app: resolved per request
      // rather than captured once, or every call after the first is stale.
      token: async () => 'fresh',
      fetch: rotating.fetchImpl,
    }).request('/api/v1/me');
    expect(rotating.calls[0]!.headers.authorization).toBe('Bearer fresh');
  });

  it('puts an idempotency key on anything that creates, and nothing else', async () => {
    const { calls, fetchImpl } = recorder({ body: {} });
    const client = createClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    await client.request('/api/v1/tickets', { method: 'POST', body: { title: 'x' } });
    await client.request('/api/v1/tickets/1', { method: 'PATCH', body: { title: 'y' } });
    await client.request('/api/v1/tickets');

    expect(calls[0]!.headers['idempotency-key']).toMatch(/^sdk-/);
    // A PATCH is not a create: giving it a key would make a retry of a
    // different edit look like the same one.
    expect(calls[1]!.headers['idempotency-key']).toBeUndefined();
    expect(calls[2]!.headers['idempotency-key']).toBeUndefined();
  });

  it('reuses the key it was given, which is what makes a retry a retry', async () => {
    const { calls, fetchImpl } = recorder({ body: {} });
    const client = createClient({ baseUrl: 'https://api.test', fetch: fetchImpl });
    await client.request('/api/v1/tickets', { method: 'POST', body: {}, idempotencyKey: 'the-same-intent' });
    await client.request('/api/v1/tickets', { method: 'POST', body: {}, idempotencyKey: 'the-same-intent' });
    expect(calls[0]!.headers['idempotency-key']).toBe('the-same-intent');
    expect(calls[1]!.headers['idempotency-key']).toBe('the-same-intent');
  });

  it('quotes the version in If-Match, because an ETag is a quoted string', async () => {
    const { calls, fetchImpl } = recorder({ body: {} });
    await createClient({ baseUrl: 'https://api.test', fetch: fetchImpl }).request('/api/v1/tickets/1', {
      method: 'POST',
      ifMatch: 7,
      body: {},
    });
    expect(calls[0]!.headers['if-match']).toBe('"7"');
  });

  it('drops empty query values rather than sending them', async () => {
    const { calls, fetchImpl } = recorder({ body: {} });
    await createClient({ baseUrl: 'https://api.test', fetch: fetchImpl }).request('/api/v1/tickets', {
      query: { status: 'open', assignee: undefined, group: null, q: '', limit: 25 },
    });
    // `status=&q=` would filter on the empty string, which matches nothing.
    expect(calls[0]!.url).toBe('https://api.test/api/v1/tickets?status=open&limit=25');
  });

  it('escapes what goes into a query', async () => {
    const { calls, fetchImpl } = recorder({ body: {} });
    await createClient({ baseUrl: 'https://api.test', fetch: fetchImpl }).request('/api/v1/tickets', {
      query: { q: 'printer & scanner' },
    });
    expect(calls[0]!.url).toContain('q=printer%20%26%20scanner');
  });

  it('reads an empty body as nothing rather than failing to parse it', async () => {
    const { fetchImpl } = recorder({ status: 204, text: '' });
    const result = await createClient({ baseUrl: 'https://api.test', fetch: fetchImpl }).request('/api/v1/x', {
      method: 'DELETE',
    });
    expect(result).toBeUndefined();
  });
});

describe('when it goes wrong', () => {
  it('turns problem details into something a form can use', async () => {
    const { fetchImpl } = recorder({
      status: 422,
      body: {
        type: 'about:blank',
        title: 'validation_failed',
        status: 422,
        detail: 'some answers need attention',
        correlationId: 'c-1',
        errors: [{ field: 'title', code: 'too_short', message: 'give it a title' }],
      },
    });
    const client = createClient({ baseUrl: 'https://api.test', fetch: fetchImpl });

    await expect(client.request('/api/v1/tickets', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    const error = (await client.request('/api/v1/tickets', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(422);
    expect(error.message).toBe('some answers need attention');
    // The whole point: a message next to the input rather than a banner.
    expect(error.fieldErrors).toEqual({ title: 'give it a title' });
  });

  it('still throws something readable when the body is not problem details', async () => {
    const { fetchImpl } = recorder({ status: 502, text: '<html>Bad Gateway</html>' });
    const error = (await createClient({ baseUrl: 'https://api.test', fetch: fetchImpl })
      .request('/api/v1/me')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.problem).toBeNull();
    expect(error.message).toBe('the request failed with 502');
  });

  it('says which failures are worth retrying', async () => {
    const retryable = new ApiError(503, null, 'x');
    const rateLimited = new ApiError(429, null, 'x');
    const refused = new ApiError(403, null, 'x');
    expect([retryable.retryable, rateLimited.retryable, refused.retryable]).toEqual([true, true, false]);
  });
});
