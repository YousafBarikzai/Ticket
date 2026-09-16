import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, createTestTenant, deleteTestTenant, request } from '../support/harness.js';

/**
 * Every endpoint the walking skeleton calls exists.
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
 * skeleton; it reads it, pulls out every path it calls, and asks the API
 * whether such a route is mounted. Unauthenticated, so nothing is created and
 * no handler runs: a mounted route answers 401 at the door, and a route that
 * does not exist answers "not found" — which is the difference being measured.
 *
 * What it cannot catch is a changed request body or response shape. That still
 * needs the live run, and doc 23 records it as the gap it is.
 */

const SKELETON = 'infra/scripts/walking-skeleton.ts';
const UUID = '00000000-0000-4000-8000-000000000000';

/** Every literal path the skeleton passes to `api()`, with variables filled in. */
function pathsIn(source: string): string[] {
  const found = new Set<string>();
  // Single-quoted and back-ticked first arguments beginning with a slash.
  for (const match of source.matchAll(/\bapi[^(]*\(\s*(['`])(\/[^'`]*)\1/g)) {
    const raw = match[2]!;
    // `${ticketId}` and friends become something shaped like what they hold, so
    // a parametric route matches and its parser does not reject the value.
    const filled = raw.replace(/\$\{[^}]*\}/g, (_whole) => UUID);
    found.add(filled);
  }
  return [...found].sort();
}

beforeAll(async () => {
  await createTestTenant('skeleton');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('skeleton');
  await closeHarness();
});

describe('the walking skeleton calls routes that exist', () => {
  const paths = pathsIn(readFileSync(SKELETON, 'utf8'));

  it('finds the paths it is supposed to check', () => {
    // A regex that quietly matched nothing would make every assertion below
    // pass while checking nothing at all — the failure mode of every test that
    // reads source code.
    expect(paths.length).toBeGreaterThan(25);
    expect(paths).toContain('/api/v1/me');
    expect(paths.some((path) => path.startsWith('/status/'))).toBe(true);
  });

  /**
   * Whether anything at all is mounted here.
   *
   * Every verb is tried rather than the one the skeleton happens to use,
   * because reading the method out of the source means parsing the options
   * object, and "is a route mounted at this path" is the question worth
   * asking. Unauthenticated throughout: a mounted route refuses at the door,
   * so no handler runs and nothing is written.
   */
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

  for (const path of pathsIn(readFileSync(SKELETON, 'utf8'))) {
    it(`mounts ${path}`, async () => {
      const result = await mounted(path);
      expect(result.ok, `${path} — ${result.detail}`).toBe(true);
    });
  }
});
