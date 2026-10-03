import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { uiStylesheet } from '@itsm/ui/styles';
import { structuralVariables, themeVariables } from '@itsm/ui/tokens';
import { dynamic, GET } from '../app/itsm-ui.css/route.js';

/**
 * Every custom property this app spends is one the design system emits.
 *
 * A `var(--itsm-thing-that-does-not-exist)` is silent: the declaration is
 * dropped and the element renders with the browser default, which usually
 * looks *almost* right. `@itsm/ui` already checks its own stylesheet this way;
 * an application's stylesheet had no such check, which is how this one came to
 * be a copy of another app's — every rule valid, not one of them matching a
 * class this app renders.
 *
 * It does not check that a class is used, only that a token exists. Catching
 * the other direction needs a renderer, and that belongs in a browser test.
 */
describe('the app stylesheet and the token pipeline agree', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

  it('references no variable the pipeline does not emit', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];

    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
  });
});

/**
 * `/itsm-ui.css`: the design system's sheet as a cacheable file.
 *
 * The URL carries a hash of the sheet, so the one thing that must never
 * happen is an immutable response whose body is not the sheet that hash was
 * taken of — every browser would keep it for a year.
 */
describe('the stylesheet route', () => {
  const request = (acceptEncoding?: string) =>
    new Request('http://admin.test/itsm-ui.css?v=1', acceptEncoding === undefined ? {} : { headers: { 'accept-encoding': acceptEncoding } });

  it('serves exactly the design system sheet, as CSS, cacheable for a year', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(uiStylesheet());
  });

  // Next's own compression skips a route handler's response, so the route
  // compresses the sheet itself; every encoding must still decode to the sheet.
  it.each([
    ['gzip, deflate, br, zstd', 'br', brotliDecompressSync],
    ['gzip, deflate', 'gzip', gunzipSync],
    ['br;q=0, gzip;q=0.8', 'gzip', gunzipSync],
    ['*', 'br', brotliDecompressSync],
  ] as const)('answers accept-encoding "%s" in %s, which decodes to the sheet', async (accept, encoding, decode) => {
    const response = await GET(request(accept));
    expect(response.headers.get('content-encoding')).toBe(encoding);
    expect(response.headers.get('vary')).toBe('accept-encoding');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBeLessThan(Buffer.byteLength(uiStylesheet()) / 5);
    expect(decode(body).toString('utf8')).toBe(uiStylesheet());
  });

  it.each(['identity', 'br;q=0, gzip;q=0', 'deflate'])('sends the plain sheet for accept-encoding "%s"', async (accept) => {
    const response = await GET(request(accept));
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(uiStylesheet());
  });

  it('reads the request, so it is rendered per request rather than once at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});

/**
 * `next/font/local` resolves its paths at build time, and a wrong one is a
 * build failure in CI at best. Checked here, from the source, because the
 * module itself only runs inside Next's compiler.
 */
describe('the font files', () => {
  const source = readFileSync(fileURLToPath(new URL('../app/fonts.ts', import.meta.url)), 'utf8');

  it('point at the self-hosted Inter and Plus Jakarta Sans files in packages/ui/fonts', () => {
    const paths = [...source.matchAll(/src: '([^']+)'/g)].map((match) => match[1]!);
    expect(paths).toEqual([
      '../../../../packages/ui/fonts/InterVariable-latin-opsz.woff2',
      '../../../../packages/ui/fonts/InterVariable-latin-ext-opsz.woff2',
      '../../../../packages/ui/fonts/PlusJakartaSans-latin-wght.woff2',
      '../../../../packages/ui/fonts/PlusJakartaSans-latin-ext-wght.woff2',
    ]);
    const here = new URL('../app/fonts.ts', import.meta.url);
    for (const path of paths) expect(existsSync(fileURLToPath(new URL(path, here))), path).toBe(true);
  });

  it('expose the custom properties the token font stacks read', () => {
    const sans = structuralVariables()['--itsm-font-family-sans']!;
    for (const variable of ['--font-inter', '--font-inter-ext']) {
      expect(source).toContain(`variable: '${variable}'`);
      expect(sans).toContain(`var(${variable}, "Inter")`);
    }
    const display = structuralVariables()['--itsm-font-family-display']!;
    for (const variable of ['--font-jakarta', '--font-jakarta-ext']) {
      expect(source).toContain(`variable: '${variable}'`);
      expect(display).toContain(`var(${variable}, "Plus Jakarta Sans")`);
    }
  });
});
