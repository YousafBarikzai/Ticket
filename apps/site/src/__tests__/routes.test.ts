import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { brandMarkSvg } from '@itsm/ui/icons';
import { uiStylesheet } from '@itsm/ui/styles';
import * as health from '../app/api/health/route.js';
import * as stylesheet from '../app/itsm-ui.css/route.js';

/**
 * The site's three non-page answers (SPEC v3 §6.1 route table).
 */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

describe('/api/health', () => {
  it('answers liveness for the site, per request, touching nothing', async () => {
    // The path Railway's health check and the post-deploy probe both call.
    expect(health.dynamic).toBe('force-dynamic');
    const response = health.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', app: 'site' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('/itsm-ui.css', () => {
  const request = (acceptEncoding?: string) =>
    new Request('https://www.example.test/itsm-ui.css?v=1', acceptEncoding === undefined ? {} : { headers: { 'accept-encoding': acceptEncoding } });

  it('serves the design system\'s sheet, cached as immutable', async () => {
    const response = await stylesheet.GET(request());
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(uiStylesheet());
  });

  // Next's own compression skips a route handler's response, so the route
  // compresses the sheet itself and has to read the request to choose how.
  it('answers in Brotli, else gzip, else plain, and every answer decodes to the sheet', async () => {
    expect(stylesheet.dynamic).toBe('force-dynamic');
    for (const [accept, encoding, decode] of [
      ['gzip, deflate, br, zstd', 'br', brotliDecompressSync],
      ['br;q=0, gzip', 'gzip', gunzipSync],
    ] as const) {
      const response = await stylesheet.GET(request(accept));
      expect(response.headers.get('content-encoding')).toBe(encoding);
      expect(response.headers.get('vary')).toBe('accept-encoding');
      expect(decode(Buffer.from(await response.arrayBuffer())).toString('utf8')).toBe(uiStylesheet());
    }
    const plain = await stylesheet.GET(request('identity'));
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(uiStylesheet());
  });
});

describe('/icon.svg', () => {
  it('is the product mark, drawn by the same function as every other copy of it', () => {
    // Generated rather than drawn by hand, so the favicon cannot drift from
    // the mark the pages render. Regenerate with brandMarkSvg if this fails.
    const file = readFileSync(join(APP, 'icon.svg'), 'utf8').trim();
    expect(file).toBe(brandMarkSvg({ size: 64, title: 'IT Service Management' }));
  });
});
