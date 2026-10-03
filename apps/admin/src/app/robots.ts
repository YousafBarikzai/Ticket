import type { MetadataRoute } from 'next';

/**
 * `robots.txt` (SPEC v3 §4.6.1, Y-m13).
 *
 * The console is behind sign-in and every page says `noindex` already; the
 * two prefixes named here are the ones a crawler can reach without a session.
 * `/demo` opens a shared demo session for whoever submits its form, so no
 * crawler should be sent to it, and the BFF's `/api/` routes are never pages.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: ['/demo', '/api/'] } };
}
