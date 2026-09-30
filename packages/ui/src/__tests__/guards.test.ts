import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Two rules about where this package's code may run, checked mechanically
 * because breaking either compiles, type-checks and passes every render test.
 *
 * **No `next`.** The design system is shared by three Next applications and
 * owns none of them. Routing, links and search params reach it through
 * `ItsmProvider` (the app passes its `Link`, router methods and hook
 * references in); a component that imported `next/navigation` itself would
 * tie the package to one framework version, break every test that renders it
 * outside Next, and — with `useSearchParams` — opt whole routes out of static
 * rendering without anyone deciding to (SPEC §3.6 rule 1).
 *
 * **Server-safe means server-safe.** A `.tsx` file without `'use client'` can
 * be rendered by a server component, and several are rendered that way on
 * purpose: `Icon`, `Table`, the skeletons, `StatusPill` and the rest of SPEC
 * §3.6 rule 2. A hook, a context or an event handler added to one of them
 * crashes that route in production — "useState only works in Client
 * Components", "Event handlers cannot be passed to Client Component props" —
 * and only when a server component renders it, which no unit test here does.
 * So a directive-free component may not call or import a `use…` hook, create a
 * context, or declare or pass an `on…` prop, unless it is listed below with
 * the reason it is safe.
 *
 * The source is read with the TypeScript parser rather than a regular
 * expression, so a hook named in a comment or a string is not a hook.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(SRC, '..');

/** Every `.ts`/`.tsx` file under `src/`, as a path relative to it with `/` separators. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) found.push(relative(SRC, path).split(sep).join('/'));
    }
  };
  walk(SRC);
  return found.sort();
}

function parse(source: string, file: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

/** Whether the file's directive prologue says `'use client'`. */
export function isClientModule(source: string, file = 'file.tsx'): boolean {
  for (const statement of parse(source, file).statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

function isNext(specifier: string): boolean {
  return specifier === 'next' || specifier.startsWith('next/');
}

/**
 * Every module specifier naming `next` or `next/*`: static imports (type-only
 * too — the package does not depend on `next` and its types must not either),
 * re-exports, dynamic `import()` and `require()`.
 */
export function nextImportsIn(source: string, file = 'file.tsx'): string[] {
  const tree = parse(source, file);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (isNext(node.moduleSpecifier.text)) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((dynamic || required) && first && ts.isStringLiteralLike(first) && isNext(first.text)) found.push(first.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      if (isNext(node.argument.literal.text)) found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

const HOOK = /^use[A-Z]/;
const HANDLER = /^on[A-Z]/;

/**
 * What in a directive-free component would crash when a server component
 * renders it: hooks imported or called, `createContext`, and `on…` props
 * declared in a type or passed in JSX. Names in `allowedHandlers` are the
 * handler props the file is known to accept safely.
 */
export function serverHazardsIn(source: string, file = 'file.tsx', allowedHandlers: readonly string[] = []): string[] {
  const tree = parse(source, file);
  const found: string[] = [];
  const line = (node: ts.Node): number => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (element.isTypeOnly) continue;
          if (HOOK.test(imported)) found.push(`${file}:${line(element)} imports the hook ${imported}`);
          if (imported === 'createContext') found.push(`${file}:${line(element)} imports createContext`);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : null;
      if (callee && HOOK.test(callee)) found.push(`${file}:${line(node)} calls the hook ${callee}`);
      if (callee === 'createContext') found.push(`${file}:${line(node)} calls createContext`);
    }

    // A declared `on…` prop is a promise the component will wire it up, and a
    // server component cannot keep that promise.
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && ts.isIdentifier(node.name) && HANDLER.test(node.name.text)) {
      if (!allowedHandlers.includes(node.name.text)) found.push(`${file}:${line(node)} declares the handler prop ${node.name.text}`);
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && HANDLER.test(node.name.text)) {
      if (!allowedHandlers.includes(node.name.text)) found.push(`${file}:${line(node)} passes the handler ${node.name.text}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * Handler props a directive-free file may carry, and why each is safe. Adding
 * to this list is a design decision, so it wants a reason a reviewer can check.
 */
const ALLOWED_HANDLERS: Readonly<Record<string, { readonly names: readonly string[]; readonly why: string }>> = {
  'web/Table.tsx': {
    names: ['onFocus', 'onKeyDown', 'onClick'],
    why: 'the row handles only `InteractiveTable` (a client component) can supply; a server component has nothing to put in them',
  },
  'display/FileChip.tsx': {
    names: ['onRemove'],
    why: 'client only (SPEC §4.6): a server component renders the chip without it, and no remove button is drawn',
  },
};

/**
 * The files SPEC §3.6 rule 2 names as server-safe that are server-safe today.
 * Each must stay directive-free — a `'use client'` would still render, but it
 * ships the module to the browser and turns every server caller's props into
 * a serialisation boundary.
 *
 * The display group's are here too: `Badge` and `Avatar` joined when they
 * moved to `data-tone` (§3.3 rule 6), and the rest of §4.6's S column with
 * them.
 */
const SERVER_SAFE = [
  'icons/Icon.tsx',
  'icons/BrandMark.tsx',
  'icons/registry.ts',
  'format/format.ts',
  'web/Table.tsx',
  'feedback/Skeletons.tsx',
  'feedback/Spinner.tsx',
  'feedback/ProgressBar.tsx',
  'feedback/Meter.tsx',
  'feedback/InlineAlert.tsx',
  'feedback/StatusScreen.tsx',
  'display/StatusPill.tsx',
  'display/DescriptionList.tsx',
  'display/Stepper.tsx',
  'display/Surface.tsx',
  'display/AvatarStack.tsx',
  'display/Disclosure.tsx',
  'display/Prose.tsx',
  'display/FileChip.tsx',
  'web/Badge.tsx',
  'web/Avatar.tsx',
  'web/RichText.tsx',
  // The rest of the catalogue's S column, pinned once their packages landed:
  // the foundations' key caps and hidden text, the feedback group's bones and
  // drawings, the frame's skip links, and the static charts (their hover
  // layer, `ChartReader`, and link leaf, `ChartLink`, are the client parts).
  'web/Kbd.tsx',
  'web/VisuallyHidden.tsx',
  'web/Skeleton.tsx',
  'web/IconSlot.tsx',
  'feedback/Illustration.tsx',
  'shell/SkipLinks.tsx',
  'charts/ChartFigure.tsx',
  'charts/LineChart.tsx',
  'charts/AreaChart.tsx',
  'charts/BarChart.tsx',
  'charts/DonutChart.tsx',
  'charts/ProgressRing.tsx',
  'charts/Sparkline.tsx',
  'charts/StatGrid.tsx',
  'charts/xy.tsx',
  'charts/parts.tsx',
  'charts/texture.tsx',
  'charts/scale.ts',
  'theme/theme-script.ts',
  // Not the `theme` barrel: it re-exports `ThemeProvider`, a client module.
  // The script and the preference rules are what a server layout imports.
  'theme/prefs.ts',
  'styles/index.ts',
] as const;

const files = sourceFiles();
const read = (file: string): string => readFileSync(join(SRC, file), 'utf8');

describe('the guards themselves', () => {
  // Tests of the tests: each checker must fire on the thing it exists to catch,
  // or a green run below means nothing.
  it('finds every way of reaching next', () => {
    const source = `
      import Link from 'next/link';
      import type { Metadata } from 'next';
      export { useRouter } from 'next/navigation';
      const lazy = () => import('next/dynamic');
      const old = require('next/image');
      type T = import('next/headers').ReadonlyHeaders;
      import { nextThing } from 'next-intl';
      // import { redirect } from 'next/navigation';
    `;
    expect(nextImportsIn(source)).toEqual(['next/link', 'next', 'next/navigation', 'next/dynamic', 'next/image', 'next/headers']);
  });

  it('reads the directive prologue, not the first mention', () => {
    expect(isClientModule(`'use client';\nexport const a = 1;`)).toBe(true);
    expect(isClientModule(`"use strict";\n'use client';\nexport const a = 1;`)).toBe(true);
    expect(isClientModule(`// 'use client'\nexport const a = 1;`)).toBe(false);
    expect(isClientModule(`import x from 'y';\n'use client';`)).toBe(false);
  });

  it('flags a hook, a context and a handler in a directive-free component', () => {
    const source = `
      import { useState, type ReactNode } from 'react';
      import * as React from 'react';
      import { createContext } from 'react';
      export interface Props { readonly onSelect?: () => void; readonly label: string }
      export function Thing({ label }: Props): ReactNode {
        const [open] = useState(false);
        const id = React.useId();
        return <button onClick={() => undefined}>{label}{String(open)}{id}</button>;
      }
    `;
    expect(serverHazardsIn(source, 'Thing.tsx')).toEqual([
      'Thing.tsx:2 imports the hook useState',
      'Thing.tsx:4 imports createContext',
      'Thing.tsx:5 declares the handler prop onSelect',
      'Thing.tsx:7 calls the hook useState',
      'Thing.tsx:8 calls the hook useId',
      'Thing.tsx:9 passes the handler onClick',
    ]);
  });

  it('lets an allowed handler through and ignores names in comments, strings and types', () => {
    const source = `
      import type { useState } from 'react';
      // useState would be wrong here; onClick too.
      export interface Props { readonly onRemove?: () => void; readonly note?: 'useEffect' }
      export function Chip(): string { return 'onClick'; }
    `;
    expect(serverHazardsIn(source, 'Chip.tsx', ['onRemove'])).toEqual([]);
  });
});

describe('@itsm/ui never imports next', () => {
  it('finds the source it is supposed to check', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('index.ts');
    expect(files).toContain('web/Button.tsx');
  });

  it('has no next import anywhere under src', () => {
    const offenders = files.flatMap((file) => nextImportsIn(read(file), file).map((specifier) => `${file} → ${specifier}`));
    expect(offenders).toEqual([]);
  });

  it('does not depend on next in its manifest', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain('next');
    }
  });
});

describe('server-safe components stay server-safe', () => {
  const components = files.filter((file) => file.endsWith('.tsx') && !file.includes('__tests__/'));
  const serverSafe = components.filter((file) => !isClientModule(read(file), file));

  it('finds the directive-free components it is supposed to check', () => {
    expect(serverSafe).toEqual(expect.arrayContaining(['web/Table.tsx', 'icons/Icon.tsx']));
  });

  it('keeps hooks, contexts and handlers out of every directive-free component', () => {
    const hazards = serverSafe.flatMap((file) => serverHazardsIn(read(file), file, ALLOWED_HANDLERS[file]?.names ?? []));
    expect(hazards).toEqual([]);
  });

  it('keeps the allow-list honest', () => {
    // An entry for a file that is gone, became a client module, or no longer
    // declares the handler is an exemption nobody needs — and the next person
    // to add one would copy it.
    for (const [file, { names, why }] of Object.entries(ALLOWED_HANDLERS)) {
      expect(files, file).toContain(file);
      expect(isClientModule(read(file), file), `${file} is a client module and needs no exemption`).toBe(false);
      expect(why.length, file).toBeGreaterThan(20);
      const without = serverHazardsIn(read(file), file);
      for (const name of names) expect(without.join('\n'), `${file} no longer uses ${name}`).toContain(name);
    }
  });

  it('keeps the files the SPEC names as server-safe free of the directive', () => {
    for (const file of SERVER_SAFE) {
      expect(files, file).toContain(file);
      const source = read(file);
      expect(isClientModule(source, file), `${file} must stay server-safe`).toBe(false);
      // `.ts` modules have no JSX, so only the hook and context checks apply.
      const hazards = serverHazardsIn(source, file, ALLOWED_HANDLERS[file]?.names ?? []);
      expect(hazards, file).toEqual([]);
    }
  });
});
