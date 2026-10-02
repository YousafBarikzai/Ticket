import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  it('serves the design system\'s sheet, built once and cached as immutable', async () => {
    expect(stylesheet.dynamic).toBe('force-static');
    const response = stylesheet.GET();
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe(uiStylesheet());
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
