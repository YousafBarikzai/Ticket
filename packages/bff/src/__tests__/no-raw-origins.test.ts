import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * No app reads another area's origin itself (SPEC v3 §3.1; A2 §3.6).
 *
 * A link built from `process.env.WORKBENCH_ORIGIN` works for a real person
 * and is wrong in a demo: it skips the Service Desk's `/demo` page, so a
 * visitor arrives with no Service Desk session — or, worse, with whatever
 * session that browser last had there. `areasFor()` (`@itsm/bff/areas`) and
 * `appOrigins()` (`@itsm/contracts/areas`) are the only readers, and every
 * cross-area link goes through `crossAreaHref`. This guard keeps it that way.
 *
 * What counts as a read: `x.PORTAL_ORIGIN`, `x['PORTAL_ORIGIN']` and
 * `{ PORTAL_ORIGIN } = x` on any object — so an alias of `process.env` is
 * caught too — for the four names `(PORTAL|WORKBENCH|ADMIN|SITE)_ORIGIN`, in
 * every `.ts`/`.tsx` file under `apps/{portal,workbench,admin,site}/src/`
 * except tests and each app's `bff.ts` (whose `originEnvVar` is the BFF's
 * own identity). The source is parsed with TypeScript, as
 * `packages/ui/src/__tests__/guards.test.ts` does, so a name in a comment is
 * not a read. A name merely written as a string is not a read either: the
 * site's configuration keeps a table of variable names
 * (`apps/site/src/server/config.ts`) that applies `appOrigins()`'s rules and
 * is due to be swapped for it.
 *
 * **The migration allow-list.** The apps' frames and a few admin pages still
 * read origins today; wave 3 converts them. Each converting work package owns
 * one file in `raw-origins/` and empties it, so no two packages edit one list
 * (V1-M4): `portal.json` (WP-40), `workbench.json` (WP-41), `admin-frame.json`
 * (WP-42a) and `admin-pages.json` (WP-42b). A listed file that no longer reads
 * an origin fails too, so the line is removed by the change that converts it,
 * and all four are `[]` at the end of wave 3.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const APPS = ['portal', 'workbench', 'admin', 'site'] as const;
const ALLOW_LIST_DIR = join(import.meta.dirname, 'raw-origins');
const ALLOW_LIST_FILES = ['admin-frame.json', 'admin-pages.json', 'portal.json', 'workbench.json'];

const ORIGIN_NAME = /^(?:PORTAL|WORKBENCH|ADMIN|SITE)_ORIGIN$/;

const MESSAGE =
  'Read origins through `areasFor()` (`@itsm/bff/areas`) or `appOrigins()` (`@itsm/contracts/areas`), so demo sessions never link past `/demo` (A2 §3.6).';

/** The BFF's own identity: `originEnvVar` names the app's variable, and is the one sanctioned mention. */
const EXEMPT = new Set(['apps/portal/src/bff.ts', 'apps/workbench/src/bff.ts', 'apps/admin/src/bff.ts', 'apps/site/src/bff.ts']);

interface Read {
  readonly line: number;
  readonly name: string;
}

function nameOf(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Every read of an origin variable in one source file. */
function originReads(source: string, file = 'file.tsx'): Read[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const reads: Read[] = [];
  const hit = (node: ts.Node, name: string): void => {
    reads.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, name });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ORIGIN_NAME.test(node.name.text)) {
      hit(node, node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      const name = nameOf(node.argumentExpression);
      if (name && ORIGIN_NAME.test(name)) hit(node, name);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = nameOf(node.propertyName) ?? nameOf(node.name);
      if (name && ORIGIN_NAME.test(name)) hit(node, name);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return reads;
}

/** Every `.ts`/`.tsx` file under the four apps' `src/`, tests excluded, as repo-relative paths with `/`. */
function appSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        found.push(relative(ROOT, path).split(sep).join('/'));
      }
    }
  };
  for (const app of APPS) walk(join(ROOT, 'apps', app, 'src'));
  return found.sort();
}

/** The four allow-list files, each a JSON array of repo-relative paths. */
function allowList(): Map<string, string> {
  const owner = new Map<string, string>();
  for (const file of ALLOW_LIST_FILES) {
    const entries = JSON.parse(readFileSync(join(ALLOW_LIST_DIR, file), 'utf8')) as unknown;
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
      throw new Error(`raw-origins/${file} must be a JSON array of paths`);
    }
    for (const entry of entries as string[]) {
      if (owner.has(entry)) throw new Error(`${entry} is listed in both raw-origins/${owner.get(entry)} and raw-origins/${file}`);
      owner.set(entry, file);
    }
  }
  return owner;
}

/** Reads outside the allow-list, one line each. */
function offendersOf(reads: ReadonlyMap<string, readonly Read[]>, listed: ReadonlyMap<string, string>): string[] {
  return [...reads]
    .filter(([file]) => !listed.has(file))
    .flatMap(([file, found]) => found.map((read) => `${file}:${read.line} reads ${read.name}`));
}

/** Allow-listed files that no longer read an origin (or no longer exist), one line each. */
function staleEntriesOf(
  reads: ReadonlyMap<string, readonly Read[]>,
  listed: ReadonlyMap<string, string>,
  exists: (file: string) => boolean,
): string[] {
  return [...listed]
    .filter(([file]) => !reads.has(file))
    .map(([file, list]) =>
      exists(file)
        ? `${file} no longer reads an origin: remove it from raw-origins/${list}`
        : `${file} no longer exists: remove it from raw-origins/${list}`,
    );
}

describe('the scanner', () => {
  it('finds every way of reading an origin variable', () => {
    const source = [
      'const a = process.env.WORKBENCH_ORIGIN;',
      "const b = process.env['PORTAL_ORIGIN'];",
      'const c = process.env[`ADMIN_ORIGIN`];',
      'const { SITE_ORIGIN } = process.env;',
      'const { ADMIN_ORIGIN: admin = "" } = process.env;',
      'const env = process.env; const d = env.PORTAL_ORIGIN?.trim();',
      'function f({ WORKBENCH_ORIGIN }: Record<string, string>) { return WORKBENCH_ORIGIN; }',
    ].join('\n');
    expect(originReads(source, 'x.ts').map((read) => [read.line, read.name])).toEqual([
      [1, 'WORKBENCH_ORIGIN'],
      [2, 'PORTAL_ORIGIN'],
      [3, 'ADMIN_ORIGIN'],
      [4, 'SITE_ORIGIN'],
      [5, 'ADMIN_ORIGIN'],
      [6, 'PORTAL_ORIGIN'],
      [7, 'WORKBENCH_ORIGIN'],
    ]);
  });

  it('reads JSX files', () => {
    expect(originReads('export const A = () => <a href={process.env.PORTAL_ORIGIN}>Help</a>;', 'x.tsx')).toHaveLength(1);
  });

  it('ignores comments, other names and names that are only written down', () => {
    const source = [
      '// process.env.WORKBENCH_ORIGIN is read by areasFor()',
      '/** See `process.env.PORTAL_ORIGIN`. */',
      "const variable = 'PORTAL_ORIGIN';",
      "const table = { portal: { variable: 'PORTAL_ORIGIN' } };",
      'const e = process.env.API_ORIGIN; const f = process.env.MY_PORTAL_ORIGIN; const g = process.env.PORTAL_ORIGINS;',
      "const h = process.env['NODE_ENV'];",
      'const { NODE_ENV } = process.env;',
    ].join('\n');
    expect(originReads(source, 'x.ts')).toEqual([]);
  });
});

describe('app code', () => {
  const files = appSourceFiles();
  const reads = new Map(
    files
      .filter((file) => !EXEMPT.has(file))
      .map((file) => [file, originReads(readFileSync(join(ROOT, file), 'utf8'), file)] as const)
      .filter(([, found]) => found.length > 0),
  );

  it('scans all four apps', () => {
    for (const app of APPS) expect(files.some((file) => file.startsWith(`apps/${app}/src/`)), app).toBe(true);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.includes('/__tests__/'))).toBe(false);
  });

  it('keeps the allow-list as four files, one per converting work package', () => {
    expect(readdirSync(ALLOW_LIST_DIR).sort()).toEqual(ALLOW_LIST_FILES);
    expect(() => allowList()).not.toThrow();
  });

  it('reads origins only through areasFor() or appOrigins()', () => {
    expect(offendersOf(reads, allowList()), MESSAGE).toEqual([]);
  });

  it('lists only files that still read an origin, so each conversion removes its own line', () => {
    expect(staleEntriesOf(reads, allowList(), (file) => existsSync(join(ROOT, file)))).toEqual([]);
  });
});

describe('the allow-list rules', () => {
  const reads = new Map<string, readonly Read[]>([['apps/admin/src/a.tsx', [{ line: 3, name: 'WORKBENCH_ORIGIN' }]]]);

  it('fails a read that is not listed, naming the line', () => {
    expect(offendersOf(reads, new Map())).toEqual(['apps/admin/src/a.tsx:3 reads WORKBENCH_ORIGIN']);
    expect(offendersOf(reads, new Map([['apps/admin/src/a.tsx', 'admin-pages.json']]))).toEqual([]);
  });

  it('fails a listed file once it stops reading an origin, or is gone', () => {
    const listed = new Map([
      ['apps/admin/src/a.tsx', 'admin-pages.json'],
      ['apps/admin/src/converted.tsx', 'admin-pages.json'],
      ['apps/admin/src/deleted.tsx', 'admin-frame.json'],
    ]);
    expect(staleEntriesOf(reads, listed, (file) => !file.endsWith('deleted.tsx'))).toEqual([
      'apps/admin/src/converted.tsx no longer reads an origin: remove it from raw-origins/admin-pages.json',
      'apps/admin/src/deleted.tsx no longer exists: remove it from raw-origins/admin-frame.json',
    ]);
  });
});
