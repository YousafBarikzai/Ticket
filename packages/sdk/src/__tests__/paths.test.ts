import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every API path in the resource files is one the route test can read.
 *
 * `tests/integration/sdk-routes.test.ts` finds the paths this package calls by
 * scanning for `/api/v1/…` string literals and asks the real API whether each
 * is mounted. A path it cannot read is a path nobody checks: a query string
 * built into the template, or a nested template or quote inside `${…}`, and
 * the literal silently drops out of the scan — which is how a family of
 * builder paths went unchecked for as long as they were built by a helper.
 * This keeps every path plain enough to be seen.
 */

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const files = readdirSync(RESOURCES).filter((name) => name.endsWith('.ts'));

describe('the paths the SDK calls', () => {
  it('finds the resource files', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'admin.ts',
        'portal.ts',
        'workbench.ts',
        'operations.ts',
        'builders.ts',
        'insights.ts',
        'service-management.ts',
        'demo.ts',
      ]),
    );
  });

  for (const file of files) {
    it(`are all readable literals in ${file}`, () => {
      const source = readFileSync(join(RESOURCES, file), 'utf8');
      const starts = source.match(/['`]\/api\/v1\//g) ?? [];
      const literals = [...source.matchAll(/(['`])(\/api\/v1\/[^'`]*)\1/g)].map((match) => match[2]!);

      // Every place a path starts is a whole literal the scan picks up.
      expect(literals).toHaveLength(starts.length);
      for (const literal of literals) {
        const filled = literal.replace(/\$\{[^}]*\}/g, 'x');
        // No expression the scan would have to understand, and no query
        // string: parameters go in `query`, where empty and false values are
        // dropped and everything is escaped.
        expect(filled, literal).not.toMatch(/[${}?]/);
      }
    });
  }
});
