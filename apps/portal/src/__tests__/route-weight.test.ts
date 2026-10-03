import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The two heaviest Help Portal routes stay where the budget put them
 * (SPEC v3 §7.2 guards, §10.3, A6 §8.1; V-m12).
 *
 * `/catalogue/[key]` (guard 243,500 B) and `/tickets/[id]` (budget 250,000 B,
 * ≈ 8 kB left) gain their v3 look from server markup and CSS, never from new
 * browser code. A bundle measurement says so after a build; this says it on
 * every test run, from the source: it follows each page's static imports
 * (dynamic `import()` is a later chunk, not first load; `import type` is
 * erased), notes every `'use client'` module the page reaches, and holds that
 * set to the list below. A `'use server'` module is a reference in the
 * browser (an id and a dispatcher), not its code, so it is listed apart and
 * not followed.
 *
 * A change that has to add a client module to one of these routes changes
 * the list here, in the same commit, with its `--explain` table (§10.1).
 *
 * Two more rules ride along: no module either route reaches imports the chart
 * kit (`@itsm/ui/charts`: its islands are the Service Desk's, and RV2 makes
 * `StatCard` server-safe precisely so the portal needs none of them), and no
 * portal source names `PriorityChip` (priority is never shown to requesters).
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Static import and re-export specifiers, without type-only ones. */
export function staticImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  for (const match of code.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (match[2]) continue;
    found.push(match[4]!);
  }
  for (const match of code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) found.push(match[1]!);
  return found;
}

/** The directive a module opens with, if any. */
export function directiveOf(source: string): 'use client' | 'use server' | null {
  const first = source.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  const match = /^['"](use client|use server)['"]/.exec(first);
  return (match?.[1] as 'use client' | 'use server' | undefined) ?? null;
}

/** A relative specifier as a file in this app (`.js` written, `.ts`/`.tsx` on disk). */
function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  const stem = base.replace(/\.(js|jsx|ts|tsx)$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export interface RouteGraph {
  /** `'use client'` modules in this app the route reaches, relative to `src`. */
  readonly client: string[];
  /** `'use server'` modules the route's client code calls. */
  readonly serverReferences: string[];
  /** Every package specifier imported by a module the route reaches, with who imports it. */
  readonly packages: { readonly specifier: string; readonly from: string }[];
}

export function routeGraph(page: string): RouteGraph {
  const client = new Set<string>();
  const serverReferences = new Set<string>();
  const packages: { specifier: string; from: string }[] = [];
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (/\.css$/.test(file)) return;
    const source = readFileSync(file, 'utf8');
    const directive = directiveOf(source);
    const name = relative(SRC, file);
    if (directive === 'use client') client.add(name);
    for (const specifier of staticImports(source)) {
      const local = resolveLocal(file, specifier);
      if (!local) {
        if (!specifier.startsWith('.')) packages.push({ specifier, from: name });
        continue;
      }
      if (directiveOf(readFileSync(local, 'utf8')) === 'use server') {
        serverReferences.add(relative(SRC, local));
        continue;
      }
      visit(local);
    }
  };
  visit(page);
  return { client: [...client].sort(), serverReferences: [...serverReferences].sort(), packages };
}

const CATALOGUE_ITEM = join(SRC, 'app', '(portal)', 'catalogue', '[key]', 'page.tsx');
const REQUEST_DETAIL = join(SRC, 'app', '(portal)', 'tickets', '[id]', 'page.tsx');

/**
 * The client modules each route reaches (wave 3). `/catalogue/[key]`: the
 * request flow, its action hook and the problem card it already had; v3
 * added none (WP-49 draws the success panel on the server and the step
 * cards with CSS). `/tickets/[id]`: the request page's own islands as wave 3
 * has them; its Phase 2 rail (WP-73) is to be server-rendered.
 */
const PINNED: Readonly<Record<string, readonly string[]>> = {
  '/catalogue/[key]': ['catalogue/RequestFlow.tsx', 'client/useAction.ts', 'home/SectionProblem.tsx'],
  '/tickets/[id]': [
    'client/live.ts',
    'client/useAction.ts',
    'components/PortalNotifications.tsx',
    'components/PortalShell.tsx',
    'requests/Conversation.tsx',
    'requests/MarkSeen.tsx',
    'requests/RequestDetails.tsx',
    'requests/RequestHero.tsx',
    'requests/RetryBanner.tsx',
    'requests/hooks.ts',
    'requests/useConfirmFixed.ts',
  ],
};

describe('the heavy Help Portal routes (route weight)', () => {
  it.each([
    ['/catalogue/[key]', CATALOGUE_ITEM],
    ['/tickets/[id]', REQUEST_DETAIL],
  ])('%s reaches no client module beyond its pinned list', (route, page) => {
    expect(routeGraph(page).client).toEqual(PINNED[route]);
  });

  it.each([
    ['/catalogue/[key]', CATALOGUE_ITEM],
    ['/tickets/[id]', REQUEST_DETAIL],
  ])('%s imports nothing from the chart kit', (_route, page) => {
    expect(routeGraph(page).packages.filter((entry) => entry.specifier.startsWith('@itsm/ui/charts'))).toEqual([]);
  });

  it('calls the server for the success panel rather than shipping it', () => {
    expect(routeGraph(CATALOGUE_ITEM).serverReferences).toEqual(['help/actions.ts']);
  });

  it('never names PriorityChip anywhere in the portal’s sources', () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== '__tests__') walk(path);
        } else if (/\.(ts|tsx)$/.test(entry) && /\bPriorityChip\b/.test(readFileSync(path, 'utf8'))) {
          offenders.push(relative(SRC, path));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe('the graph reader', () => {
  it('reads static imports and re-exports, and leaves type-only and dynamic ones out', () => {
    const source = [
      "'use client';",
      "import { a } from './a.js';",
      "import type { B } from './b.js';",
      "export { c } from './c.js';",
      "export type { D } from './d.js';",
      "import './e.css';",
      "const lazy = () => import('./f.js');",
      '// import { g } from "./g.js";',
      "import {\n  h,\n  type H,\n} from '@itsm/ui';",
    ].join('\n');
    expect(staticImports(source)).toEqual(['./a.js', './c.js', '@itsm/ui', './e.css']);
    expect(directiveOf(source)).toBe('use client');
    expect(directiveOf("/** doc */\n'use server';\nexport async function x() {}")).toBe('use server');
    expect(directiveOf("import 'server-only';")).toBeNull();
  });
});
