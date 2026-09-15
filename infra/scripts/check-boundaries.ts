import { readFileSync, readdirSync, statSync } from 'node:fs';
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
