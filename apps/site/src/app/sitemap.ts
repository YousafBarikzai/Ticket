import type { MetadataRoute } from 'next';
import { siteConfig } from '../server/config.js';

/**
 * `/sitemap.xml` (A5 §3.12): the pages worth finding from a search engine —
 * the landing page and the three legal pages — and only on a deployment that
 * may be indexed. On a Railway-generated host it is empty, so nothing points a
 * crawler at an address the site will leave when it moves to its own domain.
 *
 * Not the chooser or the role pages: both are `noindex` (they are ways in, not
 * content), and listing a page the page itself refuses is a contradiction a
 * search console reports.
 */
export const dynamic = 'force-dynamic';

const SITEMAP_PATHS = ['/', '/privacy', '/cookies', '/terms'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const { origins, indexable } = siteConfig();
  if (!indexable || !origins.site) return [];
  const origin = origins.site;
  return SITEMAP_PATHS.map((path) => ({ url: `${origin}${path}` }));
}
