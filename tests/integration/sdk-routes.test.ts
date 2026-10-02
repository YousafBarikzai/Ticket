import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { distinctCalls, METHODS, sdkCallsIn, UUID, type Method, type RouteCall, type RouteCallScan } from '../support/route-reader.js';

/**
 * Every endpoint `@itsm/sdk` calls exists, **with the method the SDK uses.**
 *
 * The same check as `walking-skeleton-routes.test.ts`, pointed at the other
 * thing in this repository that hard-codes the API's paths. It is worth having
 * for a reason the skeleton's version is not: the SDK is what the applications
 * are built on, so a path that rots here is a screen that 404s for a person
 * rather than a script that fails for a developer.
 *
 * It exists because the first version of the SDK was written from doc 08
 * rather than from `apps/api/src/routes`, and got three things wrong. Paths
 * were not among them — but only because nothing had checked.
 *
 * It used to try every verb over HTTP, unauthenticated, and pass on the first
 * answer that was not "route not found". That checked nothing at all, twice
 * over: authentication is a `preHandler` hook, and Fastify runs it for the
 * not-found handler too, so a path that does not exist answers 401 exactly as
 * one that does; and the not-found handler says "no route for GET /x", which
 * the pattern it was matched against never matched. Every path passed.
 *
 * So two things changed. The router is asked directly — `findRoute` is the
 * lookup a request goes through, without the hooks, the handler or a token —
 * and one calibration case proves that its answer is the answer HTTP gives.
 * And the method is read out of the source — the `method` beside each
 * `/api/v1` literal, `GET` when there is none — and only that method is
 * looked up: a `PATCH` sent where only `PUT` is mounted is a screen that 404s.
 * The redesign adds SDK calls for every new route, and this is the check that
 * each of them is spelled the way the API reads it.
 *
 * The source is read with the TypeScript parser (`tests/support/route-reader.ts`,
 * shared with the skeleton's check) rather than a regular expression, and a
 * literal in a shape the reader does not recognise fails the suite instead of
 * being skipped.
 *
 * Its limit is the same one, and worth restating: this asks whether a route is
 * mounted, not whether the request body or the response shape is right. Those
 * are covered by the unit tests in `packages/sdk` for the grammar, and by
 * nothing at all for the response shapes. Doc 23 records that gap.
 */

const RESOURCES = 'packages/sdk/src/resources';

function sdkCalls(): RouteCallScan {
  const files = readdirSync(RESOURCES).filter((name) => name.endsWith('.ts'));
  const calls: RouteCall[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const scan = sdkCallsIn(readFileSync(join(RESOURCES, file), 'utf8'), file);
    calls.push(...scan.calls);
    unreadable.push(...scan.unreadable);
  }
  return { calls: distinctCalls(calls), unreadable };
}

/**
 * Whether the router has a route for this method and concrete path. The same
 * lookup a request makes, so parametric segments match the UUIDs filled in
 * above; nothing is sent, so no hook or handler runs and nothing is written.
 */
async function mounted(method: Method, path: string): Promise<boolean> {
  const app = await getApp();
  return app.findRoute({ method, url: path }) !== null;
}

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('sdkroutes');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('sdkroutes');
  await closeHarness();
});

describe('reading the SDK', () => {
  it('reads the method beside a path, in both shapes the SDK writes', () => {
    const source = `
      const a = () => client.request('/api/v1/me');
      const b = (id) => client.request<X>(\`/api/v1/tickets/\${encodeURIComponent(id)}\`, { method: 'PATCH', body: {} });
      const c = (on) => client.request('/api/v1/flags', { method: on ? 'PUT' : 'DELETE' });
      const d = () => ({ path: '/api/v1/tickets', method: 'POST', body: {} });
      const e = () => client.request('/api/v1/users', { query: { q: 'method' } });
    `;
    expect(sdkCallsIn(source)).toEqual({
      calls: [
        { method: 'GET', path: '/api/v1/me', where: 'source.ts:2' },
        { method: 'PATCH', path: `/api/v1/tickets/${UUID}`, where: 'source.ts:3' },
        { method: 'PUT', path: '/api/v1/flags', where: 'source.ts:4' },
        { method: 'DELETE', path: '/api/v1/flags', where: 'source.ts:4' },
        { method: 'POST', path: '/api/v1/tickets', where: 'source.ts:5' },
        { method: 'GET', path: '/api/v1/users', where: 'source.ts:6' },
      ],
      unreadable: [],
    });
  });

  it('refuses to guess rather than defaulting to GET', () => {
    const source = `
      const a = (verb) => client.request('/api/v1/me', { method: verb });
      const b = (options) => client.request('/api/v1/me', options);
      const c = (rest) => client.request('/api/v1/me', { ...rest });
      const d = '/api/v1/me';
    `;
    expect(sdkCallsIn(source).unreadable).toEqual([
      'source.ts:2 /api/v1/me',
      'source.ts:3 /api/v1/me',
      'source.ts:4 /api/v1/me',
      'source.ts:5 /api/v1/me',
    ]);
  });
});

describe('the SDK calls routes that exist, with the method it uses', () => {
  const { calls, unreadable } = sdkCalls();

  it('finds the calls it is supposed to check', () => {
    // A reader that quietly matched nothing would make every assertion below
    // pass while checking nothing at all.
    expect(calls.length).toBeGreaterThan(100);
    expect(calls).toContainEqual(expect.objectContaining({ method: 'GET', path: '/api/v1/me' }));
    expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/v1/tickets' }));
    expect(calls).toContainEqual(expect.objectContaining({ method: 'GET', path: '/api/v1/tickets' }));
    // Every verb the SDK uses is represented, so none of them is being read wrong across the board.
    expect(new Set(calls.map((call) => call.method))).toEqual(new Set(METHODS));
  });

  it('can read the method of every call', () => {
    // A call whose method cannot be read would otherwise be checked as a GET.
    expect(unreadable).toEqual([]);
  });

  it('asks the router the same question a request does', async () => {
    // Calibration: the lookup must agree with what HTTP answers, or every
    // assertion below is measuring something else. Authenticated, because an
    // unauthenticated request is refused at the door whether or not a route
    // exists — which is exactly how the previous version of this test passed
    // for every path.
    const token = tenant.people.requester!.token;
    const found = await request<{ detail?: string }>('/api/v1/me', { token });
    expect(found.status).toBe(200);
    expect(await mounted('GET', '/api/v1/me')).toBe(true);

    const missing = await request<{ detail?: string }>('/api/v1/me', { method: 'DELETE', token });
    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe('no route for DELETE /api/v1/me');
    expect(await mounted('DELETE', '/api/v1/me')).toBe(false);
  });

  it('fails a call made with the wrong method', async () => {
    // The test of the test: a planted literal whose path is mounted under a
    // different verb must be caught, or the method is not being measured.
    const planted = sdkCallsIn(`client.request('/api/v1/me', { method: 'DELETE' });`).calls;
    expect(planted).toEqual([{ method: 'DELETE', path: '/api/v1/me', where: 'source.ts:1' }]);
    for (const call of planted) expect(await mounted(call.method, call.path)).toBe(false);
    // And one parametric path under the wrong verb, so the UUID filling is not what passes it.
    expect(await mounted('GET', `/api/v1/tickets/${UUID}/comments`)).toBe(false);
    expect(await mounted('POST', `/api/v1/tickets/${UUID}/comments`)).toBe(true);
  });

  it('mounts GET /api/platform/v1/deployment-warnings, which the reader above does not scan (D24)', async () => expect(await mounted('GET', '/api/platform/v1/deployment-warnings')).toBe(true));

  for (const call of calls) {
    it(`mounts ${call.method} ${call.path}`, async () => {
      expect(await mounted(call.method, call.path), `${call.method} ${call.path} (${call.where}) has no route`).toBe(true);
    });
  }
});
