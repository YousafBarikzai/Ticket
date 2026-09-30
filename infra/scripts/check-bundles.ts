/**
 * First-load JavaScript per route, against the budgets in `infra/bundle-budgets.json`
 * (SPEC §3.7).
 *
 * The portal is opened on phones, often on a train, and the redesign adds a
 * shell, a provider and icons to it; the workbench adds a query cache, a
 * virtual list and overlays. Neither is noticed growing until somebody opens
 * it on a slow connection, and by then the growth is twenty small additions
 * nobody can attribute. So every build is measured, and CI fails when a portal
 * or workbench route goes over its budget, or grows by more than the tolerance
 * over the baseline recorded in the budgets file — unless the same change
 * records a new baseline, which makes the growth a decision a reviewer sees
 * rather than a drift nobody did.
 *
 * **What is measured.** For each page route: the root main files every route
 * loads (webpack runtime, framework, `main-app`), plus every JavaScript chunk
 * the route's client reference manifest can ask the browser for, gzipped at
 * level 9. The manifest lists every client component the route's server
 * components can render, with the chunks the browser loads to render each, so
 * the sum is an upper bound: a route that renders fewer client components
 * loads less, never more. Polyfills are left out — they are served `nomodule`
 * and a modern browser does not fetch them — and so are CSS and chunks loaded
 * later through `next/dynamic` or `import()`, which are not first load.
 *
 * Next's own build output stopped printing first-load sizes in version 16,
 * which is why this reads the manifests itself. It needs `next build
 * --webpack`: the manifests it reads are webpack's.
 *
 * Usage:
 *   pnpm tsx infra/scripts/check-bundles.ts             measure all three apps and check
 *   pnpm tsx infra/scripts/check-bundles.ts --app portal
 *   pnpm tsx infra/scripts/check-bundles.ts --update    record the current sizes as baselines
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

export const APPS = ['portal', 'workbench', 'admin'] as const;
export type App = (typeof APPS)[number];

const ROOT = resolve(import.meta.dirname, '..', '..');
export const BUDGETS_FILE = join(ROOT, 'infra', 'bundle-budgets.json');

export interface AppBudget {
  /** Bytes of gzipped first-load JS a route may not exceed, or null to report only. */
  readonly budget: number | null;
  /** Whether a route growing past its baseline by more than the tolerance fails the check. */
  readonly enforceGrowth: boolean;
  /** Route → bytes, as last recorded. */
  readonly baselines: Readonly<Record<string, number>>;
}

export interface Budgets {
  readonly $comment?: string | readonly string[];
  /** Bytes a route may grow over its baseline before the check fails. */
  readonly growthTolerance: number;
  readonly apps: Readonly<Record<App, AppBudget>>;
}

export interface RouteSize {
  readonly route: string;
  readonly bytes: number;
  readonly files: readonly string[];
}

export interface AppMeasurement {
  readonly app: App;
  /** The root main files every route loads, and their gzipped size. */
  readonly shared: { readonly bytes: number; readonly files: readonly string[] };
  readonly routes: readonly RouteSize[];
}

/** One gzipped size per file, since the root files are shared by every route. */
export function gzippedSize(cache: Map<string, number>, path: string): number {
  let size = cache.get(path);
  if (size === undefined) {
    size = gzipSync(readFileSync(path), { level: 9 }).length;
    cache.set(path, size);
  }
  return size;
}

/**
 * The page routes of an app, from `app-path-routes-manifest.json`:
 * `{ '/(portal)/tickets/[id]/page': '/tickets/[id]' }`. Route handlers
 * (`…/route`) serve no document and load no JavaScript.
 */
export function pageRoutes(appPathRoutes: Readonly<Record<string, string>>): { page: string; route: string }[] {
  return Object.entries(appPathRoutes)
    .filter(([page]) => page.endsWith('/page'))
    .map(([page, route]) => ({ page, route }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Every JavaScript chunk a client reference manifest can ask for.
 *
 * The manifest is a script that assigns to `globalThis.__RSC_MANIFEST`, so it
 * is run in an empty context of its own rather than `require`d into this
 * process. Chunk lists interleave ids and files (`['323', 'static/chunks/…']`)
 * and the files are URL-encoded (`%5Bkey%5D` for `[key]`); only the files are
 * kept, decoded to the names on disk.
 */
export function manifestChunks(source: string): string[] {
  const context: { __RSC_MANIFEST?: Record<string, { clientModules?: Record<string, { chunks?: unknown[] }> }> } = {};
  runInNewContext(source, context, { timeout: 5_000 });
  const chunks = new Set<string>();
  for (const manifest of Object.values(context.__RSC_MANIFEST ?? {})) {
    for (const reference of Object.values(manifest.clientModules ?? {})) {
      for (const chunk of reference.chunks ?? []) {
        if (typeof chunk === 'string' && chunk.startsWith('static/') && chunk.endsWith('.js')) chunks.add(decodeURIComponent(chunk));
      }
    }
  }
  return [...chunks].sort();
}

/** Measures one app's build in `<appDir>/.next`. */
export function measureApp(app: App, appDir: string, cache = new Map<string, number>()): AppMeasurement {
  const next = join(appDir, '.next');
  const buildManifest = join(next, 'build-manifest.json');
  if (!existsSync(buildManifest)) {
    throw new Error(`no build of ${app} at ${next}: run \`pnpm --filter @itsm/${app} build\` first`);
  }
  const { rootMainFiles = [] } = JSON.parse(readFileSync(buildManifest, 'utf8')) as { rootMainFiles?: string[] };
  if (rootMainFiles.length === 0) {
    // A build-manifest with no root files is a Turbopack build or a Next that
    // changed shape; either way the numbers below would be wrong, not small.
    throw new Error(`${app}: build-manifest.json lists no rootMainFiles; build with \`next build --webpack\``);
  }
  const size = (file: string): number => gzippedSize(cache, join(next, file));
  const sum = (files: Iterable<string>): number => [...files].reduce((total, file) => total + size(file), 0);

  const routesManifest = join(next, 'app-path-routes-manifest.json');
  const appPathRoutes = JSON.parse(readFileSync(routesManifest, 'utf8')) as Record<string, string>;

  const routes = pageRoutes(appPathRoutes).map(({ page, route }): RouteSize => {
    const manifest = join(next, 'server', 'app', `${page}_client-reference-manifest.js`);
    if (!existsSync(manifest)) throw new Error(`${app}: ${route} has no client reference manifest at ${manifest}`);
    const files = new Set([...rootMainFiles, ...manifestChunks(readFileSync(manifest, 'utf8'))]);
    return { route, bytes: sum(files), files: [...files].sort() };
  });

  return { app, shared: { bytes: sum(rootMainFiles), files: [...rootMainFiles] }, routes };
}

export type Verdict = 'ok' | 'over-budget' | 'grew' | 'new' | 'shrank';

export interface Row {
  readonly app: App;
  readonly route: string;
  readonly bytes: number;
  readonly budget: number | null;
  readonly baseline: number | null;
  readonly verdict: Verdict;
}

export interface Report {
  readonly rows: readonly Row[];
  /** Messages that fail the check. */
  readonly failures: readonly string[];
  /** Messages worth reading that do not fail it. */
  readonly notes: readonly string[];
}

export const kB = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * Compares measurements with the budgets file.
 *
 * Fails a route over its app's budget, and a route in an app that enforces
 * growth when it is more than `growthTolerance` over its baseline. A route
 * with no baseline is new and is only held to the budget; a baseline with no
 * route is stale. Both are noted, so a rename does not fail the build while
 * still showing up in the log of the change that made it.
 */
export function evaluate(measurements: readonly AppMeasurement[], budgets: Budgets): Report {
  const rows: Row[] = [];
  const failures: string[] = [];
  const notes: string[] = [];

  for (const { app, routes } of measurements) {
    const config = budgets.apps[app];
    for (const { route, bytes } of routes) {
      const baseline = config.baselines[route] ?? null;
      let verdict: Verdict = 'ok';
      if (config.budget !== null && bytes > config.budget) {
        verdict = 'over-budget';
        failures.push(`${app} ${route} loads ${kB(bytes)} of JavaScript first, over the ${kB(config.budget)} budget`);
      } else if (baseline === null) {
        verdict = 'new';
        notes.push(`${app} ${route} has no baseline yet (${kB(bytes)}); record one with --update`);
      } else if (bytes - baseline > budgets.growthTolerance) {
        verdict = 'grew';
        const message = `${app} ${route} grew ${kB(bytes - baseline)} over its baseline of ${kB(baseline)}, more than the ${kB(budgets.growthTolerance)} allowed`;
        if (config.enforceGrowth) {
          failures.push(`${message}. If that is intended, record it in the same change: pnpm tsx infra/scripts/check-bundles.ts --update`);
        } else {
          notes.push(message);
        }
      } else if (baseline - bytes > budgets.growthTolerance) {
        verdict = 'shrank';
        notes.push(`${app} ${route} is ${kB(baseline - bytes)} under its baseline; --update locks the saving in`);
      }
      rows.push({ app, route, bytes, budget: config.budget, baseline, verdict });
    }
    const measured = new Set(routes.map((one) => one.route));
    for (const route of Object.keys(config.baselines)) {
      if (!measured.has(route)) notes.push(`${app} ${route} has a baseline but no longer exists; --update removes it`);
    }
  }
  return { rows, failures, notes };
}

/** The budgets file with the measured apps' baselines replaced by what was measured. */
export function withBaselines(budgets: Budgets, measurements: readonly AppMeasurement[]): Budgets {
  const apps = { ...budgets.apps };
  for (const { app, routes } of measurements) {
    apps[app] = { ...apps[app], baselines: Object.fromEntries(routes.map(({ route, bytes }) => [route, bytes])) };
  }
  return { ...budgets, apps };
}

const LABEL: Record<Verdict, string> = {
  ok: 'ok',
  'over-budget': 'OVER BUDGET',
  grew: 'GREW',
  new: 'new',
  shrank: 'shrank',
};

/** A plain-text table, one row per route, for the log. */
export function table(report: Report, measurements: readonly AppMeasurement[]): string {
  const lines: string[] = [];
  for (const { app, shared } of measurements) {
    lines.push(`${app} — shared by every route: ${kB(shared.bytes)} (${shared.files.length} files)`);
    lines.push(`  ${'route'.padEnd(34)} ${'first load'.padStart(10)} ${'baseline'.padStart(10)} ${'change'.padStart(9)} ${'budget'.padStart(9)}  verdict`);
    for (const row of report.rows.filter((one) => one.app === app)) {
      const change = row.baseline === null ? '' : `${row.bytes >= row.baseline ? '+' : '−'}${kB(Math.abs(row.bytes - row.baseline))}`;
      lines.push(
        `  ${row.route.padEnd(34)} ${kB(row.bytes).padStart(10)} ${(row.baseline === null ? '—' : kB(row.baseline)).padStart(10)} ${change.padStart(9)} ${(row.budget === null ? 'report' : kB(row.budget)).padStart(9)}  ${LABEL[row.verdict]}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The same table as Markdown, for a GitHub job summary. */
export function markdown(report: Report): string {
  const lines = ['### First-load JavaScript per route (gzip -9)', '', '| App | Route | First load | Baseline | Budget | Verdict |', '|---|---|---:|---:|---:|---|'];
  for (const row of report.rows) {
    lines.push(
      `| ${row.app} | \`${row.route}\` | ${kB(row.bytes)} | ${row.baseline === null ? '—' : kB(row.baseline)} | ${row.budget === null ? 'report only' : kB(row.budget)} | ${LABEL[row.verdict]} |`,
    );
  }
  if (report.failures.length > 0) lines.push('', ...report.failures.map((failure) => `- **${failure}**`));
  return `${lines.join('\n')}\n`;
}

export function readBudgets(path = BUDGETS_FILE): Budgets {
  return JSON.parse(readFileSync(path, 'utf8')) as Budgets;
}

function parseArguments(argv: readonly string[]): { apps: App[]; update: boolean } {
  const index = argv.indexOf('--app');
  const named = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && !(APPS as readonly string[]).includes(named ?? '')) {
    throw new Error(`--app takes one of ${APPS.join(', ')}`);
  }
  return { apps: named ? [named as App] : [...APPS], update: argv.includes('--update') };
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const budgets = readBudgets();
  const cache = new Map<string, number>();
  const measurements = options.apps.map((app) => measureApp(app, join(ROOT, 'apps', app), cache));

  if (options.update) {
    writeFileSync(BUDGETS_FILE, `${JSON.stringify(withBaselines(budgets, measurements), null, 2)}\n`, 'utf8');
    console.log(`baselines recorded for ${options.apps.join(', ')} in ${BUDGETS_FILE}`);
  }

  const report = evaluate(measurements, options.update ? readBudgets() : budgets);
  console.log(table(report, measurements));
  for (const note of report.notes) console.log(`note: ${note}`);
  for (const failure of report.failures) console.error(`FAIL: ${failure}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, markdown(report), 'utf8');

  if (report.failures.length > 0) process.exitCode = 1;
}

// Only when run, so the functions above can be imported by a test.
if (process.argv[1]?.endsWith('check-bundles.ts')) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
