import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uiStylesheet } from '@itsm/ui/styles';
import { ROOT_MEMBERS } from '../../next.config.js';

/**
 * What the public site may not become (SPEC v3 §6.1; A5 §3.1, §3.10, §13.1).
 *
 * The site is the one origin anybody can open without signing in, and it is
 * inert by design: no session, no Redis, no API client, no service worker.
 * Each of those would arrive as a single import, so the imports are what is
 * checked — outside the tests, where `@itsm/bff` is allowed for the one
 * cookies-page test that lists the apps' real cookie names.
 *
 * `next/link` is refused too: every link here goes to another origin, and
 * `next/link` would add client code and could prefetch `/api/session/login`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sources = filesUnder(SRC).filter((path) => /\.(ts|tsx)$/.test(path) && !relative(SRC, path).startsWith('__tests__'));

/** Every module specifier a file imports or re-exports, statically or dynamically. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

const FORBIDDEN = [/^@itsm\/bff(\/|$)/, /^@itsm\/sdk(\/|$)/, /^@itsm\/pwa(\/|$)/, /^ioredis$/, /^next\/link$/];

describe('imports', () => {
  it('finds the files it is meant to check', () => {
    // A guard that matched nothing would pass for the wrong reason.
    expect(sources.map((path) => relative(SRC, path))).toEqual(expect.arrayContaining(['app/layout.tsx', 'app/page.tsx', 'server/links.ts']));
  });

  it('has no session, Redis, API client, service worker or client-side router outside the tests', () => {
    const offenders = sources.flatMap((path) =>
      specifiers(readFileSync(path, 'utf8'))
        .filter((specifier) => FORBIDDEN.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${relative(SRC, path)} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('reads the origins through the configuration module only', () => {
    // One place parses them (`server/config.ts`); a page that read
    // `process.env.PORTAL_ORIGIN` itself would skip the http(s) check and the
    // development defaults.
    const offenders = sources
      .filter((path) => /process\.env\.(PORTAL|WORKBENCH|ADMIN|SITE)_ORIGIN/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});

describe('the client code', () => {
  it('has one client component, the global error page Next requires', () => {
    const client = sources.filter((path) => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8'))).map((path) => relative(SRC, path));
    expect(client).toEqual(['app/global-error.tsx']);
  });

  it('imports from the design system’s root only names the build maps to their own modules (next.config.ts ROOT_MEMBERS)', () => {
    // A name missing from the map would bring the whole root entry, and every
    // client component it re-exports, into every route's first load.
    const mapped = new Set(Object.values(ROOT_MEMBERS).flat());
    const imported = sources.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@itsm\/ui['"]/g)].flatMap((match) =>
        match[1]!
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith('type '))
          .map((name) => ({ name: name.split(/\s+as\s+/)[0]!, file: relative(SRC, path) })),
      ),
    );
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter(({ name }) => !mapped.has(name))).toEqual([]);
  });

  it('maps each name to a module of that name in that folder', () => {
    const ui = join(SRC, '..', '..', '..', 'packages', 'ui', 'src');
    for (const [folder, names] of Object.entries(ROOT_MEMBERS)) {
      for (const name of names) expect(statSync(join(ui, folder, `${name}.tsx`)).isFile(), `${folder}/${name}`).toBe(true);
    }
  });
});

describe('site.css', () => {
  const css = readFileSync(join(SRC, 'app', 'site.css'), 'utf8')
    // Comments may mention a colour; only declarations are paint.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('paints only with design-system tokens: no hex and no rgb() colour', () => {
    // A1: the site copies no colour value, so dark mode, Increase contrast and
    // a token change reach it without an edit. The one exception is the `#000`
    // stop of the two grid masks (A5 §4.3, §4.7): a mask says where a layer
    // is opaque and is never painted.
    const masks = css.match(/mask-image:[^;]*;/g) ?? [];
    expect(masks).toHaveLength(2);
    for (const mask of masks) expect(mask.match(/#[0-9a-f]{3,8}\b/gi)).toEqual(['#000']);
    expect(css.replace(/mask-image:[^;]*;/g, '').match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(css.match(/\brgba?\(/gi) ?? []).toEqual([]);
    expect(css.match(/\bhsla?\(/gi) ?? []).toEqual([]);
  });

  it('reads only custom properties the design system defines', () => {
    // A renamed token would otherwise leave a declaration that silently
    // computes to nothing — a card with no background, text with no colour.
    const sheet = uiStylesheet();
    const used = [...new Set([...css.matchAll(/var\((--itsm-[\w-]+)/g)].map((match) => match[1]!))];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !sheet.includes(`${name}:`))).toEqual([]);
  });

  it('keeps to the app- prefix: every rule starts at an app- class, and a design-system class appears only inside one', () => {
    // Selectors: everything before a `{` that is not an at-rule or a keyframe step.
    const selectors = [...css.matchAll(/([^{};]+)\{/g)]
      .map((match) => match[1]!.trim())
      .filter((selector) => selector && !selector.startsWith('@') && !/^(from|to|[\d%,\s]+)$/.test(selector))
      .flatMap((selector) => selector.split(',').map((part) => part.trim()));
    expect(selectors.length).toBeGreaterThan(50);
    const offenders = selectors.filter((selector) => {
      const first = /\.([A-Za-z][\w-]*)/.exec(selector)?.[1];
      return first === undefined || !first.startsWith('app-') || /\.(?!app-|itsm-)[A-Za-z]/.test(selector);
    });
    expect(offenders).toEqual([]);
  });

  it('uppercases nothing: the role words use the design system’s kicker style', () => {
    expect(css).not.toMatch(/text-transform\s*:\s*uppercase/i);
  });
});
