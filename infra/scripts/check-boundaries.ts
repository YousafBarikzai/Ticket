import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Enforces the module contract (docs/architecture/04 §3).
 *
 * These rules are what make the modular monolith extractable rather than merely
 * tidy, so they are checked mechanically rather than left to review:
 *
 *   1. A module may import another module only through its public entry point.
 *   2. Only `repo/` folders, and the platform package, may touch Prisma.
 *   3. Nothing may reach into another package's internals by relative path.
 *   4. A module may not import an application.
 *   5. Prisma writes stay with the module that owns the table.
 *   6. Outbound calls go through the integration gateway (ADR-0023).
 *   7. Every module package is declared at the root, so tests can import it.
 *
 * Written as a script rather than an ESLint rule because it needs no plugin
 * resolution, runs in under a second, and gives an error a reviewer can act on.
 */

const root = resolve(import.meta.dirname, '..', '..');

interface Violation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

const violations: Violation[] = [];

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__tests__']);

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) yield path;
  }
}

const IMPORT_PATTERN = /^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|^\s*(?:const|let|var)?[^\n]*\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

function importsIn(source: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    found.push({ specifier, line: source.slice(0, match.index).split('\n').length });
  }
  return found;
}

function moduleOf(file: string): string | null {
  const parts = relative(root, file).split('/');
  return parts[0] === 'modules' ? (parts[1] ?? null) : null;
}

function packageOf(file: string): string | null {
  const parts = relative(root, file).split('/');
  return parts[0] === 'packages' ? (parts[1] ?? null) : null;
}

for (const area of ['modules', 'packages', 'apps']) {
  const directory = join(root, area);
  for (const file of walk(directory)) {
    const relativePath = relative(root, file);
    const source = readFileSync(file, 'utf8');
    const owningModule = moduleOf(file);
    const owningPackage = packageOf(file);
    const isRepoLayer = /\/repo\//.test(relativePath);
    const isPlatformPackage = owningPackage === 'platform';

    for (const { specifier, line } of importsIn(source)) {
      // 1. Prisma belongs to the repository layer and to the platform package.
      if (specifier === '@prisma/client' && !isRepoLayer && !isPlatformPackage) {
        violations.push({
          file: relativePath,
          line,
          rule: 'prisma-in-repo-layer-only',
          detail: 'import @prisma/client only from a repo/ folder or packages/platform; services take a Tx',
        });
      }

      // 2. Reaching into another module by relative path bypasses its contract.
      if (specifier.startsWith('.')) {
        const target = resolve(join(file, '..'), specifier);
        const targetModule = moduleOf(target);
        if (owningModule && targetModule && targetModule !== owningModule) {
          violations.push({
            file: relativePath,
            line,
            rule: 'no-cross-module-relative-import',
            detail: `reaches into modules/${targetModule}; import '@itsm/module-${targetModule}' instead`,
          });
        }
        const targetPackage = packageOf(target);
        if (owningPackage && targetPackage && targetPackage !== owningPackage) {
          violations.push({
            file: relativePath,
            line,
            rule: 'no-cross-package-relative-import',
            detail: `reaches into packages/${targetPackage}; import its package name instead`,
          });
        }
        continue;
      }

      // 3. A module package must be imported at its root, never at a deep path.
      const deepModuleImport = /^@itsm\/module-([a-z-]+)\/(.+)$/.exec(specifier);
      if (deepModuleImport) {
        violations.push({
          file: relativePath,
          line,
          rule: 'no-deep-module-import',
          detail: `import '@itsm/module-${deepModuleImport[1]}' itself; its index is its contract`,
        });
      }

      // 4. Modules sit beneath applications, never the other way round.
      if (owningModule && /^@itsm\/(api|worker)$/.test(specifier)) {
        violations.push({
          file: relativePath,
          line,
          rule: 'no-module-depends-on-app',
          detail: `modules/${owningModule} imports ${specifier}; dependencies point the other way`,
        });
      }

      // 5. The platform package underpins modules and must not depend on one.
      if (isPlatformPackage && specifier.startsWith('@itsm/module-')) {
        violations.push({
          file: relativePath,
          line,
          rule: 'no-platform-depends-on-module',
          detail: `packages/platform imports ${specifier}; the dependency is inverted`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. The integration gateway is the only way out (ADR-0023).
//
// Checked mechanically because the failure is silent: a module that calls an
// external host directly gets no destination check, no credential handling, no
// circuit breaker and no redacted log — and works perfectly until somebody
// points it at an address it should not reach. A convention would drift; this
// does not.
//
// Only outbound `fetch` to a host is a violation. Tests stub it, the gateway
// itself must call it, and the adapters the gateway has not yet absorbed are
// listed rather than exempted by pattern, so adding one is a deliberate edit.
// ---------------------------------------------------------------------------
const EGRESS_ALLOWED = [
  'modules/integrations/src/gateway/',
  // Talks to Meilisearch, which is infrastructure this deployment runs rather
  // than a tenant-configured destination. Worth moving behind the gateway when
  // the gateway grows a non-HTTP transport; not worth a special case in it now.
  'modules/search/src/backend/meilisearch.ts',
  // The email providers. Their destinations are fixed by the adapter rather
  // than configured by a tenant, but they should move behind the gateway in
  // PH-4 so their calls are logged and their breakers shared.
  'modules/channels/src/service/postmark.ts',
  'modules/channels/src/service/microsoft-graph.ts',
  // OIDC discovery and the JWKS, from the issuer this deployment is configured
  // with — an operator's URL, not a tenant's, fetched before any tenant context
  // exists. The gateway needs one to log against, so this is a genuine
  // exception rather than an unconverted caller.
  'apps/api/src/auth/verify.ts',
  // The backend-for-frontend. Its whole job is to make one request per incoming
  // request — to this deployment's own API, or to the identity provider it is
  // configured with — on behalf of a browser that has no token (doc 08 §9).
  // Routing that through the integration gateway would put the
  // tenant-configured egress policy in front of a call that has no tenant yet,
  // and give every page load a circuit breaker it shares with a supplier's
  // webhook.
  'packages/bff/',
  // The browser-side SDK client in each application. Its base URL is
  // `/api/proxy` — a relative path on the app's own origin — so this is not
  // egress at all: the request goes to the BFF, which is the entry above.
  // Listed per application rather than matched by pattern, so a third app
  // reaching for `fetch` somewhere else is still a deliberate edit.
  'apps/workbench/src/client/',
  'apps/portal/src/client/',
  // The AI model provider (ADR-0042). The destination is fixed by the adapter
  // and configured by an operator, like Meilisearch and the OIDC issuer — but
  // the deciding reason is the body: the gateway records request and response
  // bodies to `integration_log` after redacting credentials, and a prompt
  // carries ticket content. Putting one through the gateway would copy
  // somebody's name, their machine and what they told the service desk into a
  // second table with a different retention policy. The gateway's other
  // services — a hard timeout, a bounded read, errors classified into
  // retryable and not — are reproduced in the adapter instead.
  'modules/ai/src/providers/anthropic.ts',
];

const FETCH_PATTERN = /(?:^|[^.\w])fetch\s*\(/;

for (const file of [...walk(join(root, 'modules')), ...walk(join(root, 'packages')), ...walk(join(root, 'apps'))]) {
  const relativePath = relative(root, file);
  if (EGRESS_ALLOWED.some((allowed) => relativePath.startsWith(allowed))) continue;
  if (relativePath.includes('__tests__') || relativePath.includes('/web/') || relativePath.endsWith('.tsx')) continue;

  const source = readFileSync(file, 'utf8');
  source.split('\n').forEach((text, index) => {
    if (!FETCH_PATTERN.test(text)) return;
    // A type reference, not a call.
    if (/typeof fetch|fetchImpl\??:/.test(text)) return;
    violations.push({
      file: relativePath,
      line: index + 1,
      rule: 'egress-through-gateway-only',
      detail: 'calls fetch directly; outbound calls go through modules/integrations gateway (ADR-0023)',
    });
  });
}

// ---------------------------------------------------------------------------
// 7. Every module is reachable from the test workspace.
//
// The integration suites live at the repository root, so a module package they
// import has to be declared there. It is not enough for the module to exist and
// to build: pnpm resolves only declared dependencies, and the failure arrives as
// "Cannot find package" from a test that was passing in every other respect —
// long after the module was written, on whichever suite first reaches for it.
//
// MOD-08-E1 hit this; MOD-20 had the same gap and had simply not reached for its
// own package yet, which is exactly why a rule is worth more than a fix.
// ---------------------------------------------------------------------------
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const declared = new Set([
  ...Object.keys(rootManifest.dependencies ?? {}),
  ...Object.keys(rootManifest.devDependencies ?? {}),
]);

for (const entry of readdirSync(join(root, 'modules'))) {
  const manifestPath = join(root, 'modules', entry, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const { name } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string };
  if (declared.has(name)) continue;
  violations.push({
    file: 'package.json',
    line: 1,
    rule: 'module-reachable-from-tests',
    detail: `${name} is not a root dependency, so an integration test importing it fails to resolve`,
  });
}

// ---------------------------------------------------------------------------
// 8. JSON values are not compared by stringifying them.
//
// `JSON.stringify(a) === JSON.stringify(b)` compares writing order, not value,
// and writing order does not survive `jsonb`: PostgreSQL stores an object's
// keys in its own order, so a value read back can differ as a string while
// being identical as a value.
//
// It never crashes. It answers "different" for ever, and what that costs
// depends on the question: MOD-10-E2 stopped recognising proposals a person had
// already rejected, and MOD-04 recorded a change — audit row, version bump,
// `ticket.updated`, every rule waiting on it — each time a ticket's custom
// fields were re-sent unchanged. Neither was visible to a unit test, because in
// JavaScript the object never round-trips.
//
// `canonicalJson`/`jsonEquals` in `@itsm/platform` are the comparison. The one
// deliberate exception is the audit hash chain, which predates them and whose
// ordering cannot change without invalidating every hash already written.
// ---------------------------------------------------------------------------
const STRINGIFY_COMPARISON = /JSON\.stringify\([^)]*\)\s*(===|!==|==|!=)\s*JSON\.stringify\(/;
const CANONICAL_EXEMPT = ['packages/platform/src/audit.ts', 'packages/platform/src/json.ts'];

for (const file of [...walk(join(root, 'modules')), ...walk(join(root, 'packages')), ...walk(join(root, 'apps'))]) {
  const relativePath = relative(root, file);
  if (CANONICAL_EXEMPT.includes(relativePath)) continue;
  if (relativePath.includes('__tests__') || relativePath.startsWith('tests/')) continue;

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      if (!STRINGIFY_COMPARISON.test(text)) return;
      violations.push({
        file: relativePath,
        line: index + 1,
        rule: 'json-compared-by-value',
        detail: 'compares JSON by stringifying it; use jsonEquals from @itsm/platform, which survives a jsonb round trip',
      });
    });
}

if (violations.length > 0) {
  console.error(`\nModule contract violations (${violations.length}):\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.rule}: ${violation.detail}\n`);
  }
  console.error('See docs/architecture/04-module-architecture.md §3.\n');
  process.exit(1);
}

console.log('module contract: no violations');
