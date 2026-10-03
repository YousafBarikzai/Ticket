import { computeDemoStatus } from '@itsm/contracts/demo';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from '../client.js';
import { demo } from '../resources/demo.js';

/**
 * The demo's status, read on a server.
 *
 * The one demo route that answers without a session lives outside `/api/v1`
 * on purpose, and a deployment without the demo answers 404 there: neither
 * may turn into an error on a page that only wanted to know whether to show
 * the demo's strip.
 */

function recording(status: number, body: unknown) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const doFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, api: demo(createClient({ baseUrl: 'http://api.test', fetch: doFetch as unknown as typeof fetch })) };
}

describe('the demo status read', () => {
  it('reads the public route under /api/demo/v1, without a token', async () => {
    const status = computeDemoStatus({ live: null, build: null, cooldown: null, paused: false, backoff: null }, Date.UTC(2026, 9, 3, 9));
    const { calls, api } = recording(200, status);
    expect(await api.status()).toEqual(status);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://api.test/api/demo/v1/status');
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it('answers null where the deployment runs no demo', async () => {
    const { api } = recording(404, { type: 'https://docs.itsm.example/problems/not_found', title: 'not found', status: 404, correlationId: 'c' });
    expect(await api.status()).toBeNull();
  });

  it('still fails loudly when the demo is there but broken', async () => {
    const { api } = recording(503, {
      type: 'https://docs.itsm.example/problems/demo_unavailable',
      title: 'demo unavailable',
      status: 503,
      correlationId: 'c',
      demo: true,
      reason: 'misconfigured',
    });
    const error = (await api.status().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('demo_unavailable');
    expect(error.problem?.reason).toBe('misconfigured');
  });
});
