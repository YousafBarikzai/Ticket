import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * TanStack Table and TanStack Virtual belong to `@itsm/ui/data` alone (D5,
 * D10): the admin console's tables pay for them, and nothing the portal or
 * the root entry loads may reach them. The catalogue test proves the root's
 * import graph is clean; this proves no other folder imports them at all, so a
 * convenient import elsewhere cannot quietly move the weight.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(relative(SRC, path).split('\\').join('/'));
    }
  }
  return out;
}

const TANSTACK = /(?:from\s+|import\s*\(\s*)['"]@tanstack\/[^'"]+['"]/;

describe('where TanStack may be imported', () => {
  it('finds the import form it looks for (a test of the test)', () => {
    expect(TANSTACK.test(`import { useTable } from '@tanstack/react-table';`)).toBe(true);
    expect(TANSTACK.test(`const lazy = import('@tanstack/react-virtual');`)).toBe(true);
    expect(TANSTACK.test(`// see @tanstack/react-table docs`)).toBe(false);
  });

  it('is imported only under data/', () => {
    const importers = sourceFiles(SRC).filter((file) => TANSTACK.test(readFileSync(join(SRC, file), 'utf8')));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((file) => !file.startsWith('data/'))).toEqual([]);
  });

  it('keeps the virtualiser out of the table’s own chunk: only the lazily loaded window imports it', () => {
    const importers = sourceFiles(SRC).filter((file) => /['"]@tanstack\/react-virtual['"]/.test(readFileSync(join(SRC, file), 'utf8')));
    expect(importers).toEqual(['data/VirtualRows.tsx']);
    expect(readFileSync(join(SRC, 'data/DataTable.tsx'), 'utf8')).toMatch(/lazy\(\(\) => import\('\.\/VirtualRows\.js'\)\)/);
  });
});

describe('the URL helpers a server page reads', () => {
  it('are server-safe: no client directive, no hooks, nothing that needs a browser at import', () => {
    const source = readFileSync(join(SRC, 'data/model.ts'), 'utf8');
    expect(source).not.toMatch(/^['"]use client['"]/m);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toMatch(/from ['"]react['"]/);
    expect(source).not.toMatch(/\b(?:window|document)\./);
  });
});
