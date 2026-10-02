import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  APPS,
  evaluate,
  manifestChunks,
  markdown,
  measureApp,
  pageRoutes,
  readBudgets,
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

describe('the budgets file', () => {
  const file = readBudgets();

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
