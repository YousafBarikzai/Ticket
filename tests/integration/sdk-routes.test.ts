import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request } from '../support/harness.js';

/**
 * Every endpoint `@itsm/sdk` calls exists.
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
 * Its limit is the same one, and worth restating: this asks whether a route is
 * mounted, not whether the request body or the response shape is right. Those
 * are covered by the unit tests in `packages/sdk` for the grammar, and by
 * nothing at all for the response shapes. Doc 23 records that gap.
 */

const RESOURCES = 'packages/sdk/src/resources';
const UUID = '00000000-0000-4000-8000-000000000000';

/** Every `/api/v1/...` literal in the SDK's resource files, with variables filled in. */
export function apiPathsIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/(['`])(\/api\/v1\/[^'`]*)\1/g)) {
    // `${encodeURIComponent(id)}` becomes something shaped like what it holds,
    // so a parametric route matches and its parser does not reject the value.
    found.add(match[2]!.replace(/\$\{[^}]*\}/g, () => UUID));
  }
  return [...found].sort();
}

function sdkPaths(): string[] {
  const files = readdirSync(RESOURCES).filter((name) => name.endsWith('.ts'));
  const all = new Set<string>();
  for (const file of files) {
    for (const path of apiPathsIn(readFileSync(join(RESOURCES, file), 'utf8'))) all.add(path);
  }
  return [...all].sort();
}

beforeAll(async () => {
  await createTestTenant('sdkroutes');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('sdkroutes');
  await closeHarness();
});

describe('the SDK calls routes that exist', () => {
  const paths = sdkPaths();

  it('finds the paths it is supposed to check', () => {
    // A regex that quietly matched nothing would make every assertion below
    // pass while checking nothing at all.
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContain('/api/v1/me');
    expect(paths).toContain('/api/v1/tickets');
  });

  /** Unauthenticated: a mounted route refuses at the door, so no handler runs. */
  async function mounted(path: string): Promise<{ ok: boolean; detail: string }> {
    const tried: string[] = [];
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await request<Record<string, unknown>>(path, { method });
      const body = JSON.stringify(response.body ?? {});
      if (!(response.status === 404 && /route .* not found/i.test(body))) {
        return { ok: true, detail: `${method} ${response.status}` };
      }
      tried.push(method);
    }
    return { ok: false, detail: `no route at all: ${tried.join(', ')} each answered route-not-found` };
  }

  for (const path of sdkPaths()) {
    it(`mounts ${path}`, async () => {
      const result = await mounted(path);
      expect(result.ok, `${path} — ${result.detail}`).toBe(true);
    });
  }
});
