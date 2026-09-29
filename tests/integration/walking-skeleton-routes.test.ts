import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { distinctCalls, helperCallsIn, UUID, type Method } from '../support/route-reader.js';

/**
 * Every endpoint the walking skeleton calls exists, **with the method it uses.**
 *
 * The skeleton is the one thing in the repository that proves the modules work
 * *together*, and it is also the one thing CI does not run: it drives a real
 * API and a real worker over HTTP, which the integration project does not
 * start. So it is extended by hand and verified by somebody running
 * `pnpm skeleton` against a live stack — and between those runs it can rot
 * silently, because a renamed route is a runtime 404 and nothing here would
 * notice.
 *
 * This closes the cheapest and likeliest half of that gap. It does not run the
 * skeleton; it reads it, pulls out every `api(path, { method })` call, and asks
 * the router whether that method is mounted at that path.
 *
 * It used to send every verb over HTTP, unauthenticated, and pass on the first
 * answer that was not "route not found" — which checked nothing: the
 * authentication hook runs for the not-found handler too, so a path that does
 * not exist answers 401 exactly as one that does, and the not-found body says
 * "no route for GET /x", which the pattern never matched. It now asks the
 * router directly (`findRoute`, the lookup a request makes, with no hook or
 * handler run and nothing written), reads the method beside each path with the
 * parser `sdk-routes.test.ts` uses, and proves both halves with a calibration
 * case and a planted call that must fail.
 *
 * What it cannot catch is a changed request body or response shape. That still
 * needs the live run, and doc 23 records it as the gap it is.
 */

const SKELETON = 'infra/scripts/walking-skeleton.ts';

/** Whether the router has a route for this method and concrete path (a query string is ignored). */
async function mounted(method: Method, path: string): Promise<boolean> {
  const app = await getApp();
  return app.findRoute({ method, url: path }) !== null;
}

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('skeleton');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('skeleton');
  await closeHarness();
});

describe('reading the skeleton', () => {
  it('reads each call to api() with its method, and refuses to guess', () => {
    const source = `
      const a = await api<{ id: string }>('/api/v1/me', { token: agent });
      const b = await api(\`/api/v1/tickets/\${number}/comments\`, { method: 'POST', token });
      const c = await api('/status/acme');
      const d = await api('/api/v1/audit-events?limit=1', { token });
      const e = await api(path, { token });
      const f = await api('/api/v1/me', options);
      const g = await api('/api/v1/me', { method: verb });
      const h = other('/api/v1/elsewhere');
    `;
    expect(helperCallsIn(source, 'api')).toEqual({
      calls: [
        { method: 'GET', path: '/api/v1/me', where: 'source.ts:2' },
        { method: 'POST', path: `/api/v1/tickets/${UUID}/comments`, where: 'source.ts:3' },
        { method: 'GET', path: '/status/acme', where: 'source.ts:4' },
        { method: 'GET', path: '/api/v1/audit-events?limit=1', where: 'source.ts:5' },
      ],
      unreadable: ['source.ts:6 path', 'source.ts:7 /api/v1/me', 'source.ts:8 /api/v1/me'],
    });
  });
});

describe('the walking skeleton calls routes that exist, with the method it uses', () => {
  const scan = helperCallsIn(readFileSync(SKELETON, 'utf8'), 'api', SKELETON);
  const calls = distinctCalls(scan.calls);

  it('finds the calls it is supposed to check', () => {
    // A reader that quietly matched nothing would make every assertion below
    // pass while checking nothing at all — the failure mode of every test that
    // reads source code.
    expect(calls.length).toBeGreaterThan(25);
    expect(calls).toContainEqual(expect.objectContaining({ method: 'GET', path: '/api/v1/me' }));
    expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/v1/tickets' }));
    expect(calls.some((call) => call.path.startsWith('/status/'))).toBe(true);
    // Not only GET, or the method is not being read at all.
    expect(new Set(calls.map((call) => call.method)).size).toBeGreaterThan(2);
  });

  it('can read every call', () => {
    // A call whose path or method cannot be read would otherwise go unchecked
    // or be checked as a GET.
    expect(scan.unreadable).toEqual([]);
  });

  it('asks the router the same question a request does', async () => {
    // Calibration: the lookup must agree with what HTTP answers, or every
    // assertion below is measuring something else. Authenticated, because an
    // unauthenticated request is refused at the door whether or not a route
    // exists — which is how the previous version of this test passed for
    // every path.
    const token = tenant.people.requester!.token;
    expect((await request('/api/v1/me', { token })).status).toBe(200);
    expect(await mounted('GET', '/api/v1/me')).toBe(true);

    const missing = await request<{ detail?: string }>('/api/v1/me', { method: 'DELETE', token });
    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe('no route for DELETE /api/v1/me');
    expect(await mounted('DELETE', '/api/v1/me')).toBe(false);

    // The skeleton's paths carry query strings, which the router ignores.
    expect(await mounted('GET', '/api/v1/audit-events?limit=1')).toBe(true);
  });

  it('fails a call to a path or with a method that is not mounted', async () => {
    // The test of the test: planted calls that must be caught.
    const planted = helperCallsIn(
      `await api('/api/v1/no-such-thing', { token }); await api('/api/v1/me', { method: 'DELETE', token }); await api('/status/acme', { method: 'POST' });`,
      'api',
    ).calls;
    expect(planted.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/v1/no-such-thing',
      'DELETE /api/v1/me',
      'POST /status/acme',
    ]);
    for (const call of planted) expect(await mounted(call.method, call.path), `${call.method} ${call.path}`).toBe(false);
  });

  for (const call of calls) {
    it(`mounts ${call.method} ${call.path}`, async () => {
      expect(await mounted(call.method, call.path), `${call.method} ${call.path} (${call.where}) has no route`).toBe(true);
    });
  }
});
