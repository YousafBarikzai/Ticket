import type { MetadataRoute } from 'next';
import { siteConfig } from '../server/config.js';

/**
 * `/robots.txt` (SPEC v3 §6.1; A5 §3.12).
 *
 * `/demo` and `/api/` are disallowed: neither is a page anybody should land on
 * from a search result, and the apps' `/demo` mints a session. `/try/` is
 * **not** disallowed, on purpose: Teams, Slack and LinkedIn honour this file
 * when they build a link preview, and a shared role link has to unfurl. Those
 * pages say `noindex` in their own metadata instead.
 *
 * Per request, because the sitemap line needs `SITE_ORIGIN`, which does not
 * exist when the image is built; without it the line is left out rather than
 * pointing at a relative or invented host.
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const { origins } = siteConfig();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/demo', '/api/'] },
    ...(origins.site ? { sitemap: `${origins.site}/sitemap.xml` } : {}),
  };
}
