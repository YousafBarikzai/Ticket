/**
 * First-load JavaScript per route, against the budgets in `infra/bundle-budgets.json`
 * (SPEC §3.7).
 *
 * The portal is opened on phones, often on a train, and the redesign adds a
 * shell, a provider and icons to it; the workbench adds a query cache, a
 * virtual list and overlays. Neither is noticed growing until somebody opens
 * it on a slow connection, and by then the growth is twenty small additions
 * nobody can attribute. So every build is measured, and CI fails when a portal,
 * workbench or public-site route goes over its budget, or grows by more than the tolerance
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
 * **Where the bytes are.** `--explain <route>` lists the files one route
 * loads first, each with its gzipped size, its kind (a `shared` chunk, the
 * `layout` chunk of a segment the route sits in, or the route's own `page`
 * chunk) and how many of the app's routes load it. Growth on every route
 * that sits in one `shared` or `layout` file is the frame's; growth in a
 * `page` file, or in a chunk only this route loads, is the page's. It answers
 * "which change put 4 kB on `/catalogue/[key]`?" without a scratch script
 * (A2 §13.3), and every portal change pastes it for `/catalogue/[key]` and
 * `/tickets/[id]` (SPEC v3 §10.1).
 *
 * **What must never be first load** (SPEC v3 §8.6). The Help Portal, the
 * Service Desk and the public site are opened by people who did not choose
 * to wait, so two things are kept out of their first load whatever the
 * sizes say: a chart engine (D8 draws every chart as server SVG; echarts,
 * zrender, recharts and chart.js are banned) and zod (Y-B2: schemas stay on
 * the server). The engines are checked in the dependency graph, with `pnpm
 * why`, because minified chunks rarely carry module paths; the chunks are
 * scanned for `node_modules/<engine>/` as well, and for `invalid_enum_value`,
 * a string only zod's runtime carries.
 *
 * **Lazy code that must stay lazy** (`--async`, A8 §8.2). The chart reader's
 * core is loaded on the first pointer or key over a chart, never first:
 * `infra/bundle-budgets.json` gives its marker string a gzipped budget
 * (`"async": { "itsm-reader-core": 3000 }`), and `--async` finds the chunks
 * that carry the marker, fails one over budget, fails the marker in any file
 * a route loads first (the core leaked into first load), and fails an app
 * that renders interactive charts (`"asyncRequired"`) with no such chunk
 * at all (a refactor inlined it, or dropped it).
 *
 * Usage:
 *   pnpm tsx infra/scripts/check-bundles.ts             measure all four apps and check
 *   pnpm tsx infra/scripts/check-bundles.ts --app portal
 *   pnpm tsx infra/scripts/check-bundles.ts --app admin --async   also check the lazy chunks
 *   pnpm tsx infra/scripts/check-bundles.ts --update    record the current sizes as baselines
 *   pnpm tsx infra/scripts/check-bundles.ts --app portal --explain /catalogue/[key] [--explain /tickets/[id]]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

/**
 * The four Next applications, the public site among them (SPEC v3 §10.1). The
 * site is budgeted like the portal — enforced, growth held to the tolerance —
 * because a marketing page that ships more than the framework is a defect.
 */
export const APPS = ['portal', 'workbench', 'admin', 'site'] as const;
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
  /** Marker string → gzipped bytes the lazy chunk carrying it may weigh (`--async`). */
  readonly async?: Readonly<Record<string, number>>;
  /** Apps that must emit a chunk for every async marker: they render interactive charts. */
  readonly asyncRequired?: readonly App[];
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
    const config = budgets.apps[app] as AppBudget | undefined;
    if (!config) {
      // An app the script measures and the budgets file does not name. Failed
      // by name rather than left to throw on `config.baselines`: the fix is a
      // line in the file, and the message should say which.
      failures.push(`${app} has no entry in infra/bundle-budgets.json; add "${app}": { "budget": …, "enforceGrowth": …, "baselines": {} } to "apps"`);
      continue;
    }
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
    const existing = apps[app] as AppBudget | undefined;
    // Recording baselines never invents a budget: an app the file does not
    // name still fails `evaluate` until someone decides what it may weigh.
    if (!existing) continue;
    apps[app] = { ...existing, baselines: Object.fromEntries(routes.map(({ route, bytes }) => [route, bytes])) };
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

/* ------------------------------------------------------------------ What must never be first load */

/**
 * The apps whose first load may carry neither a chart engine nor zod (SPEC v3
 * §8.1, §8.6): the Help Portal, the Service Desk and the public site.
 * Administration is report-only here as it is for its sizes.
 */
export const LEAN_APPS: readonly App[] = ['portal', 'workbench', 'site'];

/** The chart engines D8 rejects in favour of server-rendered SVG. */
export const BANNED_ENGINES = ['echarts', 'zrender', 'recharts', 'chart.js'] as const;

/**
 * A string only zod's runtime carries — the v3 issue code — so a chunk that
 * holds it holds zod (Y-B2). Schemas live in `…/schemas` subpaths that only
 * servers import; this proves no client import pulled one in.
 */
export const ZOD_MARKER = 'invalid_enum_value';

/** A banned engine's own module path, as webpack keeps it in a module id or licence banner. */
const ENGINE_PATH = /node_modules[\\/]+(echarts|zrender|recharts|chart\.js)[\\/]/;

/** Each first-load file of a measurement, with the routes that load it. */
function firstLoadRoutes(measurement: AppMeasurement): Map<string, string[]> {
  const routes = new Map<string, string[]>();
  for (const { route, files } of measurement.routes) {
    for (const file of files) routes.set(file, [...(routes.get(file) ?? []), route]);
  }
  for (const file of measurement.shared.files) if (!routes.has(file)) routes.set(file, []);
  return routes;
}

/** "/, /tickets and 3 more": the routes a file reaches, briefly. */
function someRoutes(routes: readonly string[]): string {
  if (routes.length === 0) return 'every route';
  const named = routes.slice(0, 3).join(', ');
  return routes.length > 3 ? `${named} and ${routes.length - 3} more` : named;
}

/**
 * Scans the files a lean app loads first for zod and for a chart engine's
 * module path. Every route's files are read once, whichever routes share
 * them. Returns failure messages; none for an app that is not lean.
 */
export function scanFirstLoad(measurement: AppMeasurement, appDir: string): string[] {
  if (!LEAN_APPS.includes(measurement.app)) return [];
  const failures: string[] = [];
  for (const [file, routes] of firstLoadRoutes(measurement)) {
    const path = join(appDir, '.next', file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    if (source.includes(ZOD_MARKER)) {
      failures.push(`${measurement.app}: ${file} carries zod ("${ZOD_MARKER}") into the first load of ${someRoutes(routes)}; import schemas only on the server (\`…/schemas\` subpaths)`);
    }
    const engine = ENGINE_PATH.exec(source)?.[1];
    if (engine) {
      failures.push(`${measurement.app}: ${file} carries the chart engine ${engine} into the first load of ${someRoutes(routes)}; charts are server-rendered SVG (D8)`);
    }
  }
  return failures;
}

/** Runs a command and returns its standard output; throws when it fails. */
export type Runner = (command: string, args: readonly string[]) => string;

const runInRoot: Runner = (command, args) =>
  execFileSync(command, [...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });

/**
 * Every banned engine named in `pnpm why --json` output, in either shape pnpm
 * has printed: a list of the packages found (each `name` a package; pnpm 10)
 * or a list of importers whose dependency maps are keyed by package name.
 */
export function bannedPackages(output: string): string[] {
  const text = output.trim();
  if (text === '') return [];
  const banned = new Set<string>(BANNED_ENGINES);
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (banned.has(key)) found.add(key);
      if (key === 'name' && typeof inner === 'string' && banned.has(inner)) found.add(inner);
      walk(inner);
    }
  };
  walk(JSON.parse(text) as unknown);
  return [...found].sort();
}

/**
 * The engine ban in the dependency graph (Y-m14): `pnpm why echarts zrender
 * recharts chart.js --filter @itsm/<app>` must find nothing for a lean app.
 * Stronger than any chunk scan, which minification defeats: a package that
 * is not in the graph cannot be in a chunk. A `why` that cannot be run or
 * read fails the check rather than passing it.
 */
export function engineDependencies(app: App, run: Runner = runInRoot): string[] {
  if (!LEAN_APPS.includes(app)) return [];
  const command = `pnpm --filter @itsm/${app} why ${BANNED_ENGINES.join(' ')} --json`;
  let found: string[];
  try {
    found = bannedPackages(run('pnpm', ['--filter', `@itsm/${app}`, 'why', ...BANNED_ENGINES, '--json']));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return [`${app}: could not read its dependency graph (\`${command}\`): ${reason}`];
  }
  return found.map((name) => `${app} depends on ${name}; chart engines are banned from the portal, the Service Desk and the site (D8). See: pnpm --filter @itsm/${app} why ${name}`);
}

/* ------------------------------------------------------------------ --async */

/** Every JavaScript file under `.next/static/chunks`, as `static/chunks/…`, sorted. */
export function chunkFiles(appDir: string): string[] {
  const base = join(appDir, '.next');
  const out: string[] = [];
  const walk = (relative: string): void => {
    const directory = join(base, relative);
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.js')) out.push(path);
    }
  };
  walk('static/chunks');
  return out.sort();
}

export interface AsyncChunk {
  readonly app: App;
  readonly marker: string;
  readonly file: string;
  /** Gzipped at level 9. */
  readonly bytes: number;
  readonly budget: number;
  /** Routes that load the chunk first; empty when it is lazy, as it must be. */
  readonly firstLoad: readonly string[];
}

export interface AsyncReport {
  readonly chunks: readonly AsyncChunk[];
  readonly failures: readonly string[];
  readonly notes: readonly string[];
}

/**
 * `--async` (A8 §8.2): finds each async marker of the budgets file in the
 * app's chunks and judges what it finds. A chunk carrying a marker fails
 * over the marker's budget; the marker in a file any route loads first
 * fails, because the code was meant to wait for intent; and an app in
 * `asyncRequired` with no chunk carrying the marker fails, because its
 * interactive charts would then be reading nothing, or reading from first
 * load.
 */
export function checkAsync(measurement: AppMeasurement, appDir: string, budgets: Budgets, cache = new Map<string, number>()): AsyncReport {
  const markers = Object.entries(budgets.async ?? {});
  const { app } = measurement;
  if (markers.length === 0) return { chunks: [], failures: [], notes: [`${app}: --async found no "async" budgets in infra/bundle-budgets.json`] };
  const required = (budgets.asyncRequired ?? []).includes(app);
  const firstLoad = firstLoadRoutes(measurement);
  const sources = chunkFiles(appDir).map((file) => ({ file, source: readFileSync(join(appDir, '.next', file), 'utf8') }));
  const chunks: AsyncChunk[] = [];
  const failures: string[] = [];
  for (const [marker, budget] of markers) {
    const carriers = sources.filter(({ source }) => source.includes(marker));
    if (carriers.length === 0 && required) {
      failures.push(`${app}: no chunk carries "${marker}"; it must be its own async chunk in an app with interactive charts (asyncRequired)`);
    }
    for (const { file } of carriers) {
      const bytes = gzippedSize(cache, join(appDir, '.next', file));
      const routes = firstLoad.get(file) ?? null;
      chunks.push({ app, marker, file, bytes, budget, firstLoad: routes ?? [] });
      if (bytes > budget) failures.push(`${app}: ${file} carries "${marker}" and weighs ${kB(bytes)} gzipped, over its ${kB(budget)} async budget`);
      if (routes !== null) failures.push(`${app}: ${file} carries "${marker}" but ${someRoutes(routes)} load it first; it must load only on intent`);
    }
  }
  return { chunks, failures, notes: [] };
}

/** The async chunks as a plain-text table, for the log. */
export function asyncTable(chunks: readonly AsyncChunk[]): string {
  if (chunks.length === 0) return '';
  const lines = ['async chunks (gzip -9, loaded on intent)'];
  lines.push(`  ${'app'.padEnd(10)} ${'marker'.padEnd(18)} ${'size'.padStart(9)} ${'budget'.padStart(9)}  file`);
  for (const chunk of chunks) {
    const verdict = chunk.firstLoad.length > 0 ? '  FIRST LOAD' : chunk.bytes > chunk.budget ? '  OVER BUDGET' : '';
    lines.push(`  ${chunk.app.padEnd(10)} ${chunk.marker.padEnd(18)} ${kB(chunk.bytes).padStart(9)} ${kB(chunk.budget).padStart(9)}  ${chunk.file}${verdict}`);
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ --explain */

/**
 * What a first-load file is to a route.
 *
 * `shared`: the root main files every route loads and webpack's split chunks
 * (named by number), which any number of routes may share. `layout`: a
 * segment file other than the page — a `layout`, `template`, `loading`,
 * `error` or `not-found` boundary — which every route under that segment
 * loads. `page`: the route's own `page` chunk. Read from the file names Next
 * gives webpack chunks under `static/chunks/app/`.
 */
export type ChunkKind = 'shared' | 'layout' | 'page';

const SEGMENT_FILE =
  /^static\/chunks\/app\/(?:.*\/)?(page|layout|template|loading|error|not-found|global-error|forbidden|unauthorized|default)-[^/]+\.js$/;

export function chunkKind(file: string, rootMainFiles: ReadonlySet<string>): ChunkKind {
  if (rootMainFiles.has(file)) return 'shared';
  const segment = SEGMENT_FILE.exec(file)?.[1];
  if (!segment) return 'shared';
  return segment === 'page' ? 'page' : 'layout';
}

export interface ExplainedFile {
  readonly file: string;
  /** Gzipped at level 9, as the route total counts it. */
  readonly bytes: number;
  readonly kind: ChunkKind;
  /** How many of the app's page routes load this file first. */
  readonly routes: number;
}

export interface Explanation {
  readonly app: App;
  readonly route: string;
  /** The route's first-load total: the sum of `files`. */
  readonly bytes: number;
  /** How many page routes the app has, for reading `ExplainedFile.routes`. */
  readonly routeCount: number;
  /** Shared first, then layout, then page; the largest first within each. */
  readonly files: readonly ExplainedFile[];
  readonly byKind: Readonly<Record<ChunkKind, { readonly bytes: number; readonly files: number }>>;
}

const KIND_ORDER: readonly ChunkKind[] = ['shared', 'layout', 'page'];

/** `/tickets/[id]/` and `/tickets/[id]` are one route; `/` stays `/`. */
function routeName(route: string): string {
  const trimmed = route.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
}

/**
 * One route's first-load files, sized and classified. `sizeOf` returns a
 * file's gzipped size (`gzippedSize` against the app's `.next`); `measureApp`
 * has already filled its cache, so nothing is compressed twice.
 */
export function explainRoute(measurement: AppMeasurement, route: string, sizeOf: (file: string) => number): Explanation {
  const wanted = routeName(route);
  const target = measurement.routes.find((one) => one.route === wanted);
  if (!target) {
    const known = measurement.routes.map((one) => one.route).join(', ');
    throw new Error(`${measurement.app} has no page route "${wanted}"; its routes are: ${known}`);
  }
  const roots = new Set(measurement.shared.files);
  const loadedBy = new Map<string, number>();
  for (const { files } of measurement.routes) {
    for (const file of files) loadedBy.set(file, (loadedBy.get(file) ?? 0) + 1);
  }
  const files = target.files
    .map((file): ExplainedFile => ({ file, bytes: sizeOf(file), kind: chunkKind(file, roots), routes: loadedBy.get(file) ?? 1 }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.bytes - a.bytes || a.file.localeCompare(b.file));
  const byKind = Object.fromEntries(
    KIND_ORDER.map((kind) => {
      const ofKind = files.filter((one) => one.kind === kind);
      return [kind, { bytes: ofKind.reduce((total, one) => total + one.bytes, 0), files: ofKind.length }];
    }),
  ) as Record<ChunkKind, { bytes: number; files: number }>;
  return {
    app: measurement.app,
    route: target.route,
    bytes: files.reduce((total, one) => total + one.bytes, 0),
    routeCount: measurement.routes.length,
    files,
    byKind,
  };
}

/** The explanation as a plain-text table, for the log and for a change's description. */
export function explainTable(explanation: Explanation): string {
  const { app, route, bytes, routeCount, files, byKind } = explanation;
  const lines = [`${app} ${route} — ${kB(bytes)} first load in ${files.length} files (gzip -9)`];
  lines.push(`  ${'kind'.padEnd(7)} ${'loaded by'.padStart(9)} ${'size'.padStart(9)}  file`);
  for (const one of files) {
    lines.push(`  ${one.kind.padEnd(7)} ${`${one.routes}/${routeCount}`.padStart(9)} ${kB(one.bytes).padStart(9)}  ${one.file}`);
  }
  lines.push(
    `  ${KIND_ORDER.map((kind) => `${kind} ${kB(byKind[kind].bytes)} (${byKind[kind].files} ${byKind[kind].files === 1 ? 'file' : 'files'})`).join(' · ')}`,
  );
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ The command line */

export interface Options {
  readonly apps: App[];
  readonly update: boolean;
  /** Also check the lazy chunks the budgets file names (`--async`). */
  readonly async: boolean;
  /** Routes to explain; explaining measures one app and judges nothing. */
  readonly explain: string[];
}

export function parseArguments(argv: readonly string[]): Options {
  const index = argv.indexOf('--app');
  const named = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && !(APPS as readonly string[]).includes(named ?? '')) {
    throw new Error(`--app takes one of ${APPS.join(', ')}`);
  }
  const explain: string[] = [];
  argv.forEach((argument, position) => {
    if (argument !== '--explain') return;
    const route = argv[position + 1];
    if (!route || route.startsWith('--')) throw new Error('--explain takes a route, e.g. --explain /catalogue/[key]');
    explain.push(route);
  });
  if (explain.length > 0 && !named) throw new Error('--explain needs --app: name the app the route belongs to');
  if (explain.length > 0 && argv.includes('--update')) throw new Error('--explain only reads a build; run --update on its own');
  return { apps: named ? [named as App] : [...APPS], update: argv.includes('--update'), async: argv.includes('--async'), explain };
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const cache = new Map<string, number>();

  if (options.explain.length > 0) {
    const app = options.apps[0]!;
    const appDir = join(ROOT, 'apps', app);
    const measurement = measureApp(app, appDir, cache);
    for (const route of options.explain) {
      console.log(explainTable(explainRoute(measurement, route, (file) => gzippedSize(cache, join(appDir, '.next', file)))));
    }
    return;
  }

  const budgets = readBudgets();
  const measurements = options.apps.map((app) => measureApp(app, join(ROOT, 'apps', app), cache));

  if (options.update) {
    writeFileSync(BUDGETS_FILE, `${JSON.stringify(withBaselines(budgets, measurements), null, 2)}\n`, 'utf8');
    console.log(`baselines recorded for ${options.apps.join(', ')} in ${BUDGETS_FILE}`);
  }

  const judged = evaluate(measurements, options.update ? readBudgets() : budgets);
  const failures = [...judged.failures];
  const notes = [...judged.notes];
  const lazy: AsyncChunk[] = [];
  for (const measurement of measurements) {
    const appDir = join(ROOT, 'apps', measurement.app);
    failures.push(...scanFirstLoad(measurement, appDir), ...engineDependencies(measurement.app));
    if (options.async) {
      const checked = checkAsync(measurement, appDir, budgets, cache);
      lazy.push(...checked.chunks);
      failures.push(...checked.failures);
      notes.push(...checked.notes);
    }
  }
  const report: Report = { rows: judged.rows, failures, notes };
  console.log(table(report, measurements));
  if (lazy.length > 0) console.log(asyncTable(lazy));
  for (const note of report.notes) console.log(`note: ${note}`);
  for (const failure of report.failures) console.error(`FAIL: ${failure}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown(report)}${lazy.length > 0 ? `\n\`\`\`\n${asyncTable(lazy)}\`\`\`\n` : ''}`, 'utf8');

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
