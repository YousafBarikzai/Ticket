import type { MetadataRoute } from 'next';

/**
 * `robots.txt` (Y-m13): the Service Desk is behind a session and every page
 * says `noindex` already; this keeps crawlers off the two kinds of URL that
 * answer without one — the demo's entry page, which signs a visitor in, and
 * the BFF's routes. Outside the proxy's matcher, so a crawler without a
 * session reads it rather than a redirect to sign in.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: ['/demo', '/api/'] } };
}
