import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  APPS,
  BANNED_ENGINES,
  LEAN_APPS,
  ZOD_MARKER,
  asyncTable,
  bannedPackages,
  checkAsync,
  chunkFiles,
  chunkKind,
  engineDependencies,
  evaluate,
  explainRoute,
  explainTable,
  gzippedSize,
  manifestChunks,
  markdown,
  measureApp,
  pageRoutes,
  parseArguments,
  readBudgets,
  scanFirstLoad,
  table,
  withBaselines,
  type AppMeasurement,
  type Budgets,
} from '../check-bundles.js';

/**
 * The bundle check, tested against a build it can reason about.
 *
 * A check that reads build output is only as good as its reading of it, and
 * the failure worth fearing is the quiet one: a manifest shape it no longer
 * understands, read as "no chunks", reported as a route that is suddenly
 * tiny. So the reading is tested against a miniature `.next` directory laid
 * out the way `next build --webpack` lays it out, with files whose gzipped
 * sizes are known.
 */

const scratch = mkdtempSync(join(tmpdir(), 'check-bundles-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Content that gzips to a stable, distinguishable size. */
function chunk(seed: number, length: number): Buffer {
  let state = seed;
  return Buffer.from(Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return 97 + (state % 26);
  }));
}

const gz = (content: Buffer): number => gzipSync(content, { level: 9 }).length;

/** What Next writes for one page: a script assigning the manifest to a global. */
function clientReferenceManifest(page: string, modules: Record<string, readonly string[]>): string {
  const clientModules = Object.fromEntries(
    Object.entries(modules).map(([path, chunks], index) => [path, { id: index, name: '*', chunks, async: false }]),
  );
  return `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(page)}]=${JSON.stringify({
    moduleLoading: { prefix: '/_next/' },
    clientModules,
    entryCSSFiles: {},
  })};`;
}

const files = {
  webpack: chunk(1, 4_000),
  framework: chunk(2, 20_000),
  mainApp: chunk(3, 2_000),
  polyfills: chunk(4, 30_000),
  shared: chunk(5, 6_000),
  layout: chunk(6, 1_500),
  home: chunk(7, 3_000),
  ticket: chunk(8, 5_000),
};

function fakeBuild(app: string): string {
  const appDir = join(scratch, app);
  const next = join(appDir, '.next');
  write(join(next, 'build-manifest.json'), JSON.stringify({
    polyfillFiles: ['static/chunks/polyfills-1.js'],
    rootMainFiles: ['static/chunks/webpack-1.js', 'static/chunks/framework-1.js', 'static/chunks/main-app-1.js'],
    pages: { '/_app': [] },
  }));
  write(join(next, 'app-path-routes-manifest.json'), JSON.stringify({
    '/(portal)/page': '/',
    '/(portal)/tickets/[id]/page': '/tickets/[id]',
    '/api/health/route': '/api/health',
  }));
  write(join(next, 'static/chunks/webpack-1.js'), files.webpack);
  write(join(next, 'static/chunks/framework-1.js'), files.framework);
  write(join(next, 'static/chunks/main-app-1.js'), files.mainApp);
  write(join(next, 'static/chunks/polyfills-1.js'), files.polyfills);
  write(join(next, 'static/chunks/323-a.js'), files.shared);
  write(join(next, 'static/chunks/app/layout-a.js'), files.layout);
  write(join(next, 'static/chunks/app/(portal)/page-a.js'), files.home);
  write(join(next, 'static/chunks/app/(portal)/tickets/[id]/page-a.js'), files.ticket);

  write(join(next, 'server/app/(portal)/page_client-reference-manifest.js'), clientReferenceManifest('/(portal)/page', {
    '/src/Chrome.tsx': ['323', 'static/chunks/323-a.js', '177', 'static/chunks/app/layout-a.js'],
    '/src/Home.tsx': ['323', 'static/chunks/323-a.js', '154', 'static/chunks/app/(portal)/page-a.js'],
    '/next/dist/client/components/client-page.js': [],
    '/src/globals.css': ['177', 'static/chunks/app/layout-a.js', 'static/css/a.css'],
  }));
  write(join(next, 'server/app/(portal)/tickets/[id]/page_client-reference-manifest.js'), clientReferenceManifest('/(portal)/tickets/[id]/page', {
    '/src/Chrome.tsx': ['323', 'static/chunks/323-a.js', '177', 'static/chunks/app/layout-a.js'],
    // Next URL-encodes the brackets of a dynamic segment in the manifest.
    '/src/Ticket.tsx': ['323', 'static/chunks/323-a.js', '9', 'static/chunks/app/(portal)/tickets/%5Bid%5D/page-a.js'],
  }));
  return appDir;
}

const appDir = fakeBuild('portal');
const shared = gz(files.webpack) + gz(files.framework) + gz(files.mainApp);

function budgets(overrides: Partial<Budgets['apps']['portal']> = {}): Budgets {
  return {
    growthTolerance: 10_000,
    apps: {
      portal: { budget: 250_000, enforceGrowth: true, baselines: {}, ...overrides },
      workbench: { budget: 500_000, enforceGrowth: true, baselines: {} },
      admin: { budget: null, enforceGrowth: false, baselines: {} },
      site: { budget: 150_000, enforceGrowth: true, baselines: {} },
    },
  };
}

function measurement(routes: Record<string, number>, app: AppMeasurement['app'] = 'portal'): AppMeasurement {
  return { app, shared: { bytes: 0, files: [] }, routes: Object.entries(routes).map(([route, bytes]) => ({ route, bytes, files: [] })) };
}

describe('reading a build', () => {
  it('lists page routes and leaves route handlers out', () => {
    expect(pageRoutes({ '/(portal)/page': '/', '/api/health/route': '/api/health', '/offline/page': '/offline' })).toEqual([
      { page: '/(portal)/page', route: '/' },
      { page: '/offline/page', route: '/offline' },
    ]);
  });

  it('reads chunk files out of a manifest, decoded, without ids, CSS or globals leaking', () => {
    const source = clientReferenceManifest('/x/page', {
      a: ['1', 'static/chunks/app/x/%5Bkey%5D/page-a.js', '2', 'static/chunks/2-b.js'],
      b: ['2', 'static/chunks/2-b.js', 'static/css/c.css'],
    });
    expect(manifestChunks(source)).toEqual(['static/chunks/2-b.js', 'static/chunks/app/x/[key]/page-a.js']);
    expect((globalThis as { __RSC_MANIFEST?: unknown }).__RSC_MANIFEST).toBeUndefined();
  });

  it('counts the root files and every chunk the route can ask for, and not the polyfills', () => {
    const measured = measureApp('portal', appDir);
    expect(measured.shared.bytes).toBe(shared);
    expect(measured.routes.map((route) => route.route)).toEqual(['/', '/tickets/[id]']);

    const home = measured.routes.find((route) => route.route === '/')!;
    expect(home.bytes).toBe(shared + gz(files.shared) + gz(files.layout) + gz(files.home));
    expect(home.files).not.toContain('static/chunks/polyfills-1.js');

    const ticket = measured.routes.find((route) => route.route === '/tickets/[id]')!;
    expect(ticket.bytes).toBe(shared + gz(files.shared) + gz(files.layout) + gz(files.ticket));
    expect(ticket.files).toContain('static/chunks/app/(portal)/tickets/[id]/page-a.js');
  });

  it('refuses to measure an app that has not been built', () => {
    expect(() => measureApp('workbench', join(scratch, 'nothing-here'))).toThrow(/pnpm --filter @itsm\/workbench build/);
  });

  it('refuses a build it cannot read rather than reporting it as tiny', () => {
    const turbopack = join(scratch, 'turbopack');
    write(join(turbopack, '.next/build-manifest.json'), JSON.stringify({ rootMainFiles: [], pages: {} }));
    expect(() => measureApp('portal', turbopack)).toThrow(/--webpack/);
  });
});

describe('judging the sizes', () => {
  it('fails a route over its budget', () => {
    const report = evaluate([measurement({ '/': 251_000 })], budgets({ baselines: { '/': 250_500 } }));
    expect(report.rows[0]!.verdict).toBe('over-budget');
    expect(report.failures).toEqual(['portal / loads 251.0 kB of JavaScript first, over the 250.0 kB budget']);
  });

  it('fails growth past the tolerance, and says how to record it on purpose', () => {
    const report = evaluate([measurement({ '/': 196_000 })], budgets({ baselines: { '/': 185_000 } }));
    expect(report.rows[0]!.verdict).toBe('grew');
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatch(/grew 11\.0 kB over its baseline of 185\.0 kB/);
    expect(report.failures[0]).toMatch(/--update/);
  });

  it('allows growth within the tolerance', () => {
    const report = evaluate([measurement({ '/': 195_000 })], budgets({ baselines: { '/': 185_000 } }));
    expect(report.rows[0]!.verdict).toBe('ok');
    expect(report.failures).toEqual([]);
  });

  it('only reports growth in an app that does not enforce it, and never fails a report-only budget', () => {
    const report = evaluate(
      [measurement({ '/': 900_000, '/rules': 400_000 }, 'admin')],
      { ...budgets(), apps: { ...budgets().apps, admin: { budget: null, enforceGrowth: false, baselines: { '/': 100_000, '/rules': 400_000 } } } },
    );
    expect(report.failures).toEqual([]);
    expect(report.rows.map((row) => row.verdict)).toEqual(['grew', 'ok']);
    expect(report.notes.join('\n')).toMatch(/admin \/ grew/);
  });

  it('holds a new route to the budget only, and notes a stale baseline without failing', () => {
    const report = evaluate([measurement({ '/inbox/[view]': 200_000 })], budgets({ baselines: { '/queue': 190_000 } }));
    expect(report.rows[0]!.verdict).toBe('new');
    expect(report.failures).toEqual([]);
    expect(report.notes).toEqual([
      'portal /inbox/[view] has no baseline yet (200.0 kB); record one with --update',
      'portal /queue has a baseline but no longer exists; --update removes it',
    ]);
  });

  it('notes a saving worth locking in', () => {
    const report = evaluate([measurement({ '/': 170_000 })], budgets({ baselines: { '/': 185_000 } }));
    expect(report.rows[0]!.verdict).toBe('shrank');
    expect(report.failures).toEqual([]);
  });

  it('records baselines for the measured apps and leaves the others alone', () => {
    const before = budgets({ baselines: { '/queue': 1 } });
    const after = withBaselines(before, [measurement({ '/': 170_000, '/tickets': 171_000 })]);
    expect(after.apps.portal.baselines).toEqual({ '/': 170_000, '/tickets': 171_000 });
    expect(after.apps.portal.budget).toBe(250_000);
    expect(after.apps.workbench).toBe(before.apps.workbench);
    expect(evaluate([measurement({ '/': 170_000, '/tickets': 171_000 })], after).notes).toEqual([]);
  });

  it('holds the public site to its own budget, enforced like the portal', () => {
    const report = evaluate([measurement({ '/': 151_000, '/sign-in': 134_700 }, 'site')], budgets());
    expect(report.rows.map((row) => row.verdict)).toEqual(['over-budget', 'new']);
    expect(report.failures).toEqual(['site / loads 151.0 kB of JavaScript first, over the 150.0 kB budget']);
  });

  it('fails an app the budgets file does not name, by name, rather than throwing', () => {
    // The site's entry is a line someone has to add; until they do, the check
    // says which line instead of dying on `undefined.baselines`.
    const { site: _site, ...apps } = budgets().apps;
    const partial = { ...budgets(), apps } as unknown as Budgets;
    const report = evaluate([measurement({ '/': 131_500 }, 'site')], partial);
    expect(report.rows).toEqual([]);
    expect(report.failures).toEqual([
      'site has no entry in infra/bundle-budgets.json; add "site": { "budget": …, "enforceGrowth": …, "baselines": {} } to "apps"',
    ]);
    // Recording baselines does not invent the missing budget either.
    expect(withBaselines(partial, [measurement({ '/': 131_500 }, 'site')]).apps).toEqual(apps);
  });

  it('prints a table and a summary that name every route', () => {
    const measured = [measureApp('portal', appDir)];
    const report = evaluate(measured, budgets());
    expect(table(report, measured)).toMatch(/portal — shared by every route/);
    expect(table(report, measured)).toMatch(/\/tickets\/\[id\]/);
    expect(markdown(report)).toMatch(/\| portal \| `\/` \|/);
  });
});

describe('explaining a route (--explain)', () => {
  const measured = measureApp('portal', appDir);
  const sizeOf = (file: string): number => gzippedSize(new Map(), join(appDir, '.next', file));
  const rootFiles = new Set(measured.shared.files);

  it('tells a shared chunk from a layout chunk and a page chunk, by the names Next gives them', () => {
    expect(chunkKind('static/chunks/webpack-1.js', rootFiles)).toBe('shared');
    expect(chunkKind('static/chunks/323-a.js', rootFiles)).toBe('shared');
    expect(chunkKind('static/chunks/96b4b349-8f83bfd3bc81683c.js', rootFiles)).toBe('shared');
    expect(chunkKind('static/chunks/app/layout-a.js', rootFiles)).toBe('layout');
    expect(chunkKind('static/chunks/app/(portal)/layout-56351938aae0f0d0.js', rootFiles)).toBe('layout');
    expect(chunkKind('static/chunks/app/(portal)/profile/loading-5fcab03f79c8bd6f.js', rootFiles)).toBe('layout');
    expect(chunkKind('static/chunks/app/(portal)/error-0001a454306d4c35.js', rootFiles)).toBe('layout');
    expect(chunkKind('static/chunks/app/global-error-2ece7df146aea99c.js', rootFiles)).toBe('layout');
    expect(chunkKind('static/chunks/app/(portal)/tickets/[id]/page-a.js', rootFiles)).toBe('page');
    expect(chunkKind('static/chunks/app/(portal)/knowledge/(list)/page-f368304f554c5351.js', rootFiles)).toBe('page');
    expect(chunkKind('static/chunks/app/_global-error/page-b0b6d0202cfc2f2c.js', rootFiles)).toBe('page');
    // A directory named like a segment file does not make its chunks one.
    expect(chunkKind('static/chunks/app/page-tools/thing-a.js', rootFiles)).toBe('shared');
  });

  it('lists every file the route loads first, sized, with how many routes share it', () => {
    const explanation = explainRoute(measured, '/tickets/[id]', sizeOf);
    expect(explanation.app).toBe('portal');
    expect(explanation.routeCount).toBe(2);
    expect(explanation.files.map((one) => [one.kind, one.routes, one.file])).toEqual([
      ['shared', 2, 'static/chunks/framework-1.js'],
      ['shared', 2, 'static/chunks/323-a.js'],
      ['shared', 2, 'static/chunks/webpack-1.js'],
      ['shared', 2, 'static/chunks/main-app-1.js'],
      ['layout', 2, 'static/chunks/app/layout-a.js'],
      ['page', 1, 'static/chunks/app/(portal)/tickets/[id]/page-a.js'],
    ]);
    expect(explanation.files.find((one) => one.kind === 'page')!.bytes).toBe(gz(files.ticket));
  });

  it('adds up to the size the check judges the route by', () => {
    for (const route of ['/', '/tickets/[id]']) {
      const explanation = explainRoute(measured, route, sizeOf);
      expect(explanation.bytes, route).toBe(measured.routes.find((one) => one.route === route)!.bytes);
      const kinds = explanation.byKind;
      expect(kinds.shared.bytes + kinds.layout.bytes + kinds.page.bytes, route).toBe(explanation.bytes);
    }
    const home = explainRoute(measured, '/', sizeOf).byKind;
    expect(home).toEqual({
      shared: { bytes: shared + gz(files.shared), files: 4 },
      layout: { bytes: gz(files.layout), files: 1 },
      page: { bytes: gz(files.home), files: 1 },
    });
  });

  it('accepts a trailing slash, and names the routes there are when the route is not one', () => {
    expect(explainRoute(measured, '/tickets/[id]/', sizeOf).route).toBe('/tickets/[id]');
    expect(() => explainRoute(measured, '/catalogue/[key]', sizeOf)).toThrow('portal has no page route "/catalogue/[key]"; its routes are: /, /tickets/[id]');
    // A route handler serves no document, so it is not a route to explain.
    expect(() => explainRoute(measured, '/api/health', sizeOf)).toThrow(/no page route/);
  });

  it('prints a table to paste into a change’s description', () => {
    const text = explainTable(explainRoute(measured, '/tickets/[id]', sizeOf));
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^portal \/tickets\/\[id\] — [\d.]+ kB first load in 6 files \(gzip -9\)$/);
    expect(lines[1]).toMatch(/kind\s+loaded by\s+size\s+file/);
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}page\s+1\/2\s+[\d.]+ kB {2}static\/chunks\/app\/\(portal\)\/tickets\/\[id\]\/page-a\.js$/));
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}layout\s+2\/2\s+[\d.]+ kB {2}static\/chunks\/app\/layout-a\.js$/));
    expect(lines.at(-1)).toMatch(/^ {2}shared [\d.]+ kB \(4 files\) · layout [\d.]+ kB \(1 file\) · page [\d.]+ kB \(1 file\)$/);
  });

  it('reads --explain from the command line, once per route, for one named app', () => {
    expect(parseArguments(['--app', 'portal', '--explain', '/catalogue/[key]', '--explain', '/tickets/[id]'])).toEqual({
      apps: ['portal'],
      update: false,
      async: false,
      explain: ['/catalogue/[key]', '/tickets/[id]'],
    });
    expect(parseArguments([])).toEqual({ apps: [...APPS], update: false, async: false, explain: [] });
    expect(parseArguments(['--update', '--app', 'site'])).toEqual({ apps: ['site'], update: true, async: false, explain: [] });
    expect(parseArguments(['--app', 'admin', '--async'])).toEqual({ apps: ['admin'], update: false, async: true, explain: [] });
  });

  it('refuses an --explain it cannot honour', () => {
    expect(() => parseArguments(['--explain', '/'])).toThrow('--explain needs --app');
    expect(() => parseArguments(['--app', 'portal', '--explain'])).toThrow('--explain takes a route');
    expect(() => parseArguments(['--app', 'portal', '--explain', '--update'])).toThrow('--explain takes a route');
    expect(() => parseArguments(['--app', 'portal', '--explain', '/', '--update'])).toThrow('--explain only reads a build');
    expect(() => parseArguments(['--app', 'nope'])).toThrow('--app takes one of portal, workbench, admin, site');
  });
});

/** A fake build with extra files written into its `.next`, for the scans below. */
function buildWith(name: string, extra: Record<string, string | Buffer> = {}): string {
  const dir = fakeBuild(name);
  for (const [file, content] of Object.entries(extra)) write(join(dir, '.next', file), content);
  return dir;
}

/** Deterministic text that barely compresses (base64 of a hash chain), so a chunk's gzipped size is under the test's control. */
function noise(length: number): string {
  let text = '';
  let block = createHash('sha256').update('check-bundles').digest();
  while (text.length < length) {
    block = createHash('sha256').update(block).digest();
    text += block.toString('base64url');
  }
  return text.slice(0, length);
}

/** A webpack async chunk holding the reader core: its marker, then `padding` characters of code that barely compresses. */
const readerCore = (padding: number): string =>
  `"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[8098],{8098:(e,t,r)=>{const m="itsm-reader-core";const x="${noise(padding)}";}}]);`;

const withAsync = (budget = 3000, required: Budgets['asyncRequired'] = ['admin', 'workbench']): Budgets => ({
  ...budgets(),
  async: { 'itsm-reader-core': budget },
  asyncRequired: required,
});

describe('lazy chunks (--async)', () => {
  it('finds every chunk the build emitted, in nested folders too', () => {
    const dir = buildWith('async-files', { 'static/chunks/8098.abc.js': readerCore(100) });
    expect(chunkFiles(dir)).toEqual([
      'static/chunks/323-a.js',
      'static/chunks/8098.abc.js',
      'static/chunks/app/(portal)/page-a.js',
      'static/chunks/app/(portal)/tickets/[id]/page-a.js',
      'static/chunks/app/layout-a.js',
      'static/chunks/framework-1.js',
      'static/chunks/main-app-1.js',
      'static/chunks/polyfills-1.js',
      'static/chunks/webpack-1.js',
    ]);
    expect(chunkFiles(join(scratch, 'no-build-here'))).toEqual([]);
  });

  it('measures the chunk carrying the marker, and passes it lazy and within its budget', () => {
    const content = readerCore(1_500);
    const dir = buildWith('async-ok', { 'static/chunks/8098.abc.js': content });
    const report = checkAsync(measureApp('admin', dir), dir, withAsync());
    expect(report.failures).toEqual([]);
    expect(report.chunks).toEqual([
      { app: 'admin', marker: 'itsm-reader-core', file: 'static/chunks/8098.abc.js', bytes: gz(Buffer.from(content)), budget: 3000, firstLoad: [] },
    ]);
  });

  it('fails a chunk over its async budget', () => {
    const content = readerCore(5_000);
    const dir = buildWith('async-heavy', { 'static/chunks/8098.abc.js': content });
    const report = checkAsync(measureApp('workbench', dir), dir, withAsync());
    expect(gz(Buffer.from(content))).toBeGreaterThan(3000);
    expect(report.failures).toEqual([
      `workbench: static/chunks/8098.abc.js carries "itsm-reader-core" and weighs ${(gz(Buffer.from(content)) / 1000).toFixed(1)} kB gzipped, over its 3.0 kB async budget`,
    ]);
  });

  it('fails the marker in a file a route loads first: the core must wait for intent', () => {
    const dir = buildWith('async-leaked', { 'static/chunks/323-a.js': readerCore(200) });
    const report = checkAsync(measureApp('admin', dir), dir, withAsync());
    expect(report.chunks[0]!.firstLoad).toEqual(['/', '/tickets/[id]']);
    expect(report.failures).toEqual(['admin: static/chunks/323-a.js carries "itsm-reader-core" but /, /tickets/[id] load it first; it must load only on intent']);
    // A root file is first load for every route.
    const root = buildWith('async-root', { 'static/chunks/main-app-1.js': readerCore(200) });
    expect(checkAsync(measureApp('admin', root), root, withAsync()).failures).toEqual([
      'admin: static/chunks/main-app-1.js carries "itsm-reader-core" but /, /tickets/[id] load it first; it must load only on intent',
    ]);
  });

  it('fails an app with interactive charts that has no chunk for the marker, and no other app', () => {
    const dir = buildWith('async-missing');
    expect(checkAsync(measureApp('workbench', dir), dir, withAsync()).failures).toEqual([
      'workbench: no chunk carries "itsm-reader-core"; it must be its own async chunk in an app with interactive charts (asyncRequired)',
    ]);
    expect(checkAsync(measureApp('portal', dir), dir, withAsync()).failures).toEqual([]);
    expect(checkAsync(measureApp('workbench', dir), dir, withAsync(3000, [])).failures).toEqual([]);
  });

  it('says so when the budgets file names no async budgets, and judges nothing', () => {
    const dir = buildWith('async-unbudgeted', { 'static/chunks/8098.abc.js': readerCore(4_000) });
    expect(checkAsync(measureApp('admin', dir), dir, budgets())).toEqual({
      chunks: [],
      failures: [],
      notes: ['admin: --async found no "async" budgets in infra/bundle-budgets.json'],
    });
  });

  it('prints the lazy chunks, flagging one that is first load or over budget', () => {
    const text = asyncTable([
      { app: 'admin', marker: 'itsm-reader-core', file: 'static/chunks/8098.abc.js', bytes: 1552, budget: 3000, firstLoad: [] },
      { app: 'workbench', marker: 'itsm-reader-core', file: 'static/chunks/1.js', bytes: 3200, budget: 3000, firstLoad: [] },
      { app: 'workbench', marker: 'itsm-reader-core', file: 'static/chunks/2.js', bytes: 900, budget: 3000, firstLoad: ['/'] },
    ]);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe('async chunks (gzip -9, loaded on intent)');
    expect(lines[2]).toMatch(/^ {2}admin\s+itsm-reader-core\s+1\.6 kB\s+3\.0 kB {2}static\/chunks\/8098\.abc\.js$/);
    expect(lines[3]).toMatch(/static\/chunks\/1\.js {2}OVER BUDGET$/);
    expect(lines[4]).toMatch(/static\/chunks\/2\.js {2}FIRST LOAD$/);
    expect(asyncTable([])).toBe('');
  });
});

describe('what never reaches a lean first load', () => {
  it('holds the portal, the Service Desk and the site to it, and not Administration', () => {
    expect([...LEAN_APPS]).toEqual(['portal', 'workbench', 'site']);
    expect([...BANNED_ENGINES]).toEqual(['echarts', 'zrender', 'recharts', 'chart.js']);
    expect(ZOD_MARKER).toBe('invalid_enum_value');
  });

  it('fails zod in a first-load chunk, naming the routes, and not in a lazy chunk or in Administration', () => {
    const zod = `var a={invalid_type:"invalid_type",${ZOD_MARKER}:"${ZOD_MARKER}"};`;
    const leaked = buildWith('zod-leaked', { 'static/chunks/app/layout-a.js': zod });
    expect(scanFirstLoad(measureApp('portal', leaked), leaked)).toEqual([
      'portal: static/chunks/app/layout-a.js carries zod ("invalid_enum_value") into the first load of /, /tickets/[id]; import schemas only on the server (`…/schemas` subpaths)',
    ]);
    expect(scanFirstLoad(measureApp('admin', leaked), leaked)).toEqual([]);
    const lazy = buildWith('zod-lazy', { 'static/chunks/9725.abc.js': zod });
    expect(scanFirstLoad(measureApp('site', lazy), lazy)).toEqual([]);
  });

  it('fails a chart engine’s module path in a first-load chunk', () => {
    const dir = buildWith('engine-leaked', { 'static/chunks/323-a.js': '/*! node_modules/echarts/lib/echarts.js */var e=1;' });
    expect(scanFirstLoad(measureApp('workbench', dir), dir)).toEqual([
      'workbench: static/chunks/323-a.js carries the chart engine echarts into the first load of /, /tickets/[id]; charts are server-rendered SVG (D8)',
    ]);
    // Our own names are not an engine's: only `node_modules/<engine>/` counts.
    const ours = buildWith('engine-ours', { 'static/chunks/323-a.js': 'var n="chart.js",r="./echarts-free.js";' });
    expect(scanFirstLoad(measureApp('workbench', ours), ours)).toEqual([]);
  });

  it('asks pnpm for the dependency graph once per lean app, and passes when it finds nothing', () => {
    const run = vi.fn((_command: string, _args: readonly string[]) => '[]\n');
    expect(engineDependencies('site', run)).toEqual([]);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('pnpm', ['--filter', '@itsm/site', 'why', 'echarts', 'zrender', 'recharts', 'chart.js', '--json']);
    expect(engineDependencies('portal', () => '')).toEqual([]);
  });

  it('fails every banned engine the graph holds, in either shape pnpm prints', () => {
    // pnpm 10: the packages found, each with the packages that depend on it.
    const found = JSON.stringify([{ name: 'zrender', version: '5.6.1', dependents: [{ name: 'echarts', version: '5.6.0', dependents: [{ name: '@itsm/workbench', version: '0.1.0' }] }] }]);
    expect(engineDependencies('workbench', () => found)).toEqual([
      'workbench depends on echarts; chart engines are banned from the portal, the Service Desk and the site (D8). See: pnpm --filter @itsm/workbench why echarts',
      'workbench depends on zrender; chart engines are banned from the portal, the Service Desk and the site (D8). See: pnpm --filter @itsm/workbench why zrender',
    ]);
    // Older pnpm: the importer, its dependencies keyed by name.
    const importers = JSON.stringify([{ name: '@itsm/portal', version: '0.1.0', dependencies: { 'react-chartjs-2': { version: '5.0.0', dependencies: { 'chart.js': { version: '4.4.0' } } } } }]);
    expect(bannedPackages(importers)).toEqual(['chart.js']);
    expect(bannedPackages(JSON.stringify([{ name: 'react', version: '19.3.0', dependents: [{ name: '@itsm/site' }] }]))).toEqual([]);
  });

  it('fails a graph it cannot read rather than passing it', () => {
    expect(
      engineDependencies('portal', () => {
        throw new Error('spawn pnpm ENOENT\nmore detail');
      }),
    ).toEqual(['portal: could not read its dependency graph (`pnpm --filter @itsm/portal why echarts zrender recharts chart.js --json`): spawn pnpm ENOENT']);
    expect(engineDependencies('site', () => 'ERR_PNPM_SOMETHING')[0]).toMatch(/^site: could not read its dependency graph/);
  });

  it('leaves Administration’s graph alone', () => {
    const run = vi.fn(() => '[]');
    expect(engineDependencies('admin', run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the budgets file', () => {
  const file = readBudgets();

  it('budgets the reader core as a lazy chunk and requires it where charts are interactive (SPEC v3 §8.6, §10.1)', () => {
    expect(file.async).toEqual({ 'itsm-reader-core': 3000 });
    expect(file.asyncRequired).toEqual(['admin', 'workbench']);
  });

  it('measures the four Next applications, the public site among them', () => {
    expect([...APPS]).toEqual(['portal', 'workbench', 'admin', 'site']);
  });

  it('holds every app to the budgets the SPEC sets', () => {
    // SPEC v3 §10.1: the portal under 250 kB, the workbench under 500 kB, the
    // admin console reported but not budgeted, the public site under 150 kB.
    expect(Object.keys(file.apps).sort()).toEqual([...APPS].sort());
    expect(file.apps.portal.budget).toBe(250_000);
    expect(file.apps.workbench.budget).toBe(500_000);
    expect(file.apps.admin.budget).toBeNull();
    expect(file.apps.site.budget).toBe(150_000);
    expect(file.apps.portal.enforceGrowth).toBe(true);
    expect(file.apps.workbench.enforceGrowth).toBe(true);
    expect(file.apps.site.enforceGrowth).toBe(true);
    expect(file.growthTolerance).toBe(10_000);
  });

  it('records baselines that are already inside their budgets', () => {
    for (const app of APPS) {
      const { budget, baselines } = file.apps[app];
      for (const [route, bytes] of Object.entries(baselines)) {
        expect(Number.isInteger(bytes) && bytes > 0, `${app} ${route}`).toBe(true);
        if (budget !== null) expect(bytes, `${app} ${route}`).toBeLessThanOrEqual(budget);
      }
    }
  });
});
