/**
 * The client-safe contracts stay client-safe (Y-B2).
 *
 * `demo.ts`, `links.ts`, `health.ts` — and `areas.ts` and `marketing.ts` once
 * they exist — plus the form contract under `forms/` are imported by pages
 * that ship to browsers. None of them may reach zod: the contracts root
 * carries every API schema, and zod in a first-load chunk is what put 60 kB
 * on a portal page that wanted a persona's name.
 *
 * This walks the module graph the way a bundler does with `sideEffects:
 * false` packages: a module that only re-exports is passed through, and only
 * the modules that declare an imported name are loaded, with all of their own
 * imports. That is why `forms/logic.ts` may import `evaluate` from
 * `@itsm/expr`, whose entry re-exports a zod schema it never loads. Type-only
 * imports cost nothing at run time and are ignored. Any third-party package
 * other than zod fails the walk too, because the walk cannot see inside it.
 *
 * The bundle check (`infra/scripts/check-bundles.ts`) proves the same thing
 * on real chunks after a build; this proves it in a second, on every commit.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const contractsSrc = join(repoRoot, 'packages', 'contracts', 'src');

/* ------------------------------------------------------------------ Parsing */

type Names = ReadonlySet<string> | '*';

interface ModuleFacts {
  /** Value imports, with the names each one takes ('*' = the whole module). */
  readonly imports: readonly { readonly specifier: string; readonly names: Names }[];
  /** `export … from`: exported name → imported name ('*' = a namespace). */
  readonly reExports: readonly {
    readonly specifier: string;
    readonly star: boolean;
    readonly names: ReadonlyMap<string, string>;
  }[];
  /** Value names the module declares itself. */
  readonly declared: ReadonlySet<string>;
}

const factsCache = new Map<string, ModuleFacts>();

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, into);
  }
}

function facts(file: string): ModuleFacts {
  const cached = factsCache.get(file);
  if (cached) return cached;
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

  const imports: { specifier: string; names: Names }[] = [];
  const reExports: { specifier: string; star: boolean; names: Map<string, string> }[] = [];
  const declared = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) {
        imports.push({ specifier, names: '*' }); // a side-effect import loads the whole module
        continue;
      }
      if (clause.isTypeOnly) continue;
      const names = new Set<string>();
      let whole = false;
      if (clause.name) names.add('default');
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) whole = true;
      else if (bindings) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) names.add((element.propertyName ?? element.name).text);
        }
      }
      if (whole) imports.push({ specifier, names: '*' });
      else if (names.size > 0) imports.push({ specifier, names });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
        // `export { a, b }` of the module's own (or imported) bindings.
        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) if (!element.isTypeOnly) declared.add(element.name.text);
        }
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (!clause) {
        reExports.push({ specifier, star: true, names: new Map() });
      } else if (ts.isNamespaceExport(clause)) {
        reExports.push({ specifier, star: false, names: new Map([[clause.name.text, '*']]) });
      } else {
        const names = new Map<string, string>();
        for (const element of clause.elements) {
          if (!element.isTypeOnly) names.set(element.name.text, (element.propertyName ?? element.name).text);
        }
        if (names.size > 0) reExports.push({ specifier, star: false, names });
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      declared.add('default');
      continue;
    }

    if (!hasExportModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, declared);
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (hasDefaultModifier(statement)) declared.add('default');
      else if (statement.name) declared.add(statement.name.text);
    } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      declared.add(statement.name.text);
    }
    // Interfaces and type aliases have no run-time value.
  }

  // `import('…')` anywhere loads the whole module when it runs.
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, names: '*' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const result: ModuleFacts = { imports, reExports, declared };
  factsCache.set(file, result);
  return result;
}

/* ------------------------------------------------------------------ Resolution */

interface WorkspacePackage {
  readonly dir: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly sideEffectFree: boolean;
}

let workspace: ReadonlyMap<string, WorkspacePackage> | undefined;

function workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
  if (workspace) return workspace;
  const found = new Map<string, WorkspacePackage>();
  for (const area of ['packages', 'modules', 'apps']) {
    const areaDir = join(repoRoot, area);
    if (!existsSync(areaDir)) continue;
    for (const entry of readdirSync(areaDir)) {
      const manifest = join(areaDir, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
        main?: string;
        exports?: Record<string, unknown> | string;
        sideEffects?: boolean;
      };
      if (!json.name) continue;
      const exports =
        typeof json.exports === 'string' ? { '.': json.exports } : (json.exports ?? (json.main ? { '.': json.main } : {}));
      found.set(json.name, { dir: join(areaDir, entry), exports, sideEffectFree: json.sideEffects === false });
    }
  }
  workspace = found;
  return found;
}

function packageOfFile(file: string): WorkspacePackage | null {
  for (const pkg of workspacePackages().values()) {
    if (file.startsWith(`${pkg.dir}/`)) return pkg;
  }
  return null;
}

function exportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const conditions = value as Record<string, unknown>;
    for (const condition of ['browser', 'import', 'default']) {
      const target = exportTarget(conditions[condition]);
      if (target) return target;
    }
  }
  return null;
}

function asSourceFile(base: string): string | null {
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.jsx$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

type Resolution =
  | { readonly kind: 'file'; readonly file: string }
  | { readonly kind: 'zod' }
  | { readonly kind: 'external'; readonly name: string }
  | { readonly kind: 'missing' };

const BUILTINS = new Set(builtinModules);

function resolveImport(from: string, specifier: string): Resolution {
  if (specifier.startsWith('.')) {
    const file = asSourceFile(resolve(dirname(from), specifier));
    return file ? { kind: 'file', file } : { kind: 'missing' };
  }
  if (specifier === 'zod' || specifier.startsWith('zod/')) return { kind: 'zod' };
  if (specifier.startsWith('node:') || BUILTINS.has(specifier)) return { kind: 'external', name: specifier };
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
  const pkg = workspacePackages().get(name);
  if (!pkg) return { kind: 'external', name };
  const subpath = specifier === name ? '.' : `./${specifier.slice(name.length + 1)}`;
  const target = exportTarget(pkg.exports[subpath]);
  if (!target) return { kind: 'missing' };
  const file = asSourceFile(join(pkg.dir, target));
  return file ? { kind: 'file', file } : { kind: 'missing' };
}

/* ------------------------------------------------------------------ The walk */

interface Step {
  readonly file: string;
  readonly names: Names;
  readonly via: Step | null;
}

function describeChain(step: Step | null): string {
  const files: string[] = [];
  for (let at = step; at; at = at.via) files.push(relative(repoRoot, at.file));
  return files.reverse().join(' → ');
}

/**
 * Every problem reachable from `entry` when a consumer imports `names` from
 * it: zod, a third-party or built-in module, or an import that resolves to
 * nothing.
 */
function clientProblems(entry: string, names: Names = '*'): string[] {
  const problems: string[] = [];
  const loaded = new Set<string>();
  const asked = new Map<string, Set<string> | '*'>();
  const queue: Step[] = [{ file: entry, names, via: null }];

  const follow = (from: Step, specifier: string, wanted: Names): void => {
    const target = resolveImport(from.file, specifier);
    if (target.kind === 'zod') problems.push(`${describeChain(from)} imports zod`);
    else if (target.kind === 'external') problems.push(`${describeChain(from)} imports "${target.name}", which this check cannot see into`);
    else if (target.kind === 'missing') problems.push(`${describeChain(from)} imports "${specifier}", which does not resolve`);
    else queue.push({ file: target.file, names: wanted, via: from });
  };

  const load = (step: Step): void => {
    if (loaded.has(step.file)) return;
    loaded.add(step.file);
    for (const { specifier, names: imported } of facts(step.file).imports) follow(step, specifier, imported);
  };

  while (queue.length > 0) {
    const step = queue.shift()!;
    // Skip names this module has already been asked for.
    const before = asked.get(step.file);
    if (before === '*') continue;
    let fresh: Names;
    if (step.names === '*') {
      fresh = '*';
      asked.set(step.file, '*');
    } else {
      const known = before ?? new Set<string>();
      const novel = new Set([...step.names].filter((name) => !known.has(name)));
      if (novel.size === 0) continue;
      for (const name of novel) known.add(name);
      asked.set(step.file, known);
      fresh = novel;
    }

    const moduleFacts = facts(step.file);
    const sideEffectFree = packageOfFile(step.file)?.sideEffectFree ?? false;
    if (fresh === '*' || !sideEffectFree) {
      // The whole module runs, and so does everything it re-exports.
      load(step);
      for (const reExport of moduleFacts.reExports) follow(step, reExport.specifier, '*');
      continue;
    }
    for (const name of fresh) {
      if (moduleFacts.declared.has(name)) {
        load(step);
        continue;
      }
      const named = moduleFacts.reExports.find((reExport) => reExport.names.has(name));
      if (named) {
        const imported = named.names.get(name)!;
        follow(step, named.specifier, imported === '*' ? '*' : new Set([imported]));
        continue;
      }
      if (name === 'default') continue; // `export *` never re-exports a default
      for (const reExport of moduleFacts.reExports) {
        if (reExport.star) follow(step, reExport.specifier, new Set([name]));
      }
    }
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) files.push(path);
  }
  return files.sort();
}

/* ------------------------------------------------------------------ The checks */

/** The client-safe contracts: these three now; `areas.ts` (WP-13) and `marketing.ts` (WP-28) when they land. */
const REQUIRED = ['demo.ts', 'links.ts', 'health.ts'];
const LATER = ['areas.ts', 'marketing.ts'];
const clientSafeFiles = [
  ...REQUIRED.map((name) => join(contractsSrc, name)),
  ...LATER.map((name) => join(contractsSrc, name)).filter((file) => existsSync(file)),
  ...sourceFiles(join(contractsSrc, 'forms')),
];

/** The `@itsm/contracts` subpaths a browser may import values from. */
const CLIENT_SAFE_SUBPATHS = new Set(['areas', 'demo', 'forms', 'health', 'links', 'marketing']);

describe('the walk itself', () => {
  it('finds zod where it is', () => {
    // Without these the check below could pass by seeing nothing.
    expect(clientProblems(join(contractsSrc, 'models', 'common.ts')).join('\n')).toContain('imports zod');
    expect(clientProblems(join(contractsSrc, 'demo-schemas.ts')).join('\n')).toContain('imports zod');
    expect(clientProblems(join(contractsSrc, 'links-schemas.ts')).join('\n')).toContain('imports zod');
    expect(clientProblems(join(contractsSrc, 'index.ts')).join('\n')).toContain('imports zod');
  });

  it('loads a re-exported module only when its names are wanted', () => {
    const expr = join(repoRoot, 'packages', 'expr', 'src', 'index.ts');
    expect(clientProblems(expr, new Set(['evaluate']))).toEqual([]);
    expect(clientProblems(expr, new Set(['exprSchema'])).join('\n')).toContain('imports zod');
    expect(clientProblems(expr, '*').join('\n')).toContain('imports zod');
  });
});

describe('client-safe contracts', () => {
  it('has the three required files', () => {
    for (const name of REQUIRED) expect(existsSync(join(contractsSrc, name)), name).toBe(true);
  });

  for (const file of clientSafeFiles) {
    it(`${relative(contractsSrc, file)} reaches no zod and no third-party code`, () => {
      expect(clientProblems(file)).toEqual([]);
    });
  }

  it('publishes each client-safe subpath at the checked file, and the schemas beside them', () => {
    const manifest = JSON.parse(readFileSync(join(contractsSrc, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    const checked = new Set(clientSafeFiles.map((file) => relative(join(contractsSrc, '..'), file)));
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const name = subpath.replace(/^\.\/?/, '');
      if (CLIENT_SAFE_SUBPATHS.has(name)) expect(checked.has(target.replace(/^\.\//, '')), subpath).toBe(true);
    }
    expect(manifest.exports).toMatchObject({
      './demo': './src/demo.ts',
      './demo/schemas': './src/demo-schemas.ts',
      './health': './src/health.ts',
      './links': './src/links.ts',
      './links/schemas': './src/links-schemas.ts',
    });
  });
});

describe('the design system', () => {
  it('imports values from @itsm/contracts only through the client-safe subpaths', () => {
    const uiSrc = join(repoRoot, 'packages', 'ui', 'src');
    const offenders: string[] = [];
    for (const file of sourceFiles(uiSrc)) {
      const { imports, reExports } = facts(file);
      const specifiers = [...imports.map((i) => i.specifier), ...reExports.map((r) => r.specifier)];
      for (const specifier of specifiers) {
        if (specifier !== '@itsm/contracts' && !specifier.startsWith('@itsm/contracts/')) continue;
        const subpath = specifier.slice('@itsm/contracts/'.length);
        if (specifier === '@itsm/contracts' || !CLIENT_SAFE_SUBPATHS.has(subpath)) {
          offenders.push(`${relative(repoRoot, file)} imports a value from "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
