import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uiStylesheet } from '@itsm/ui/styles';

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

describe('site.css', () => {
  const css = readFileSync(join(SRC, 'app', 'site.css'), 'utf8')
    // Comments may mention a colour; only declarations are paint.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('paints only with design-system tokens: no hex and no rgb() colour', () => {
    // A1: the site copies no colour value, so dark mode, Increase contrast and
    // a token change reach it without an edit. (The landing page's grid masks
    // will add documented exceptions for mask stops, which are not paint.)
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
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

  it('keeps to the app- prefix, leaving itsm- to the design system', () => {
    const classes = [...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]!);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((name) => !name.startsWith('app-'))).toEqual([]);
  });
});
