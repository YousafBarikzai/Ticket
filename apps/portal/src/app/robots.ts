import type { MetadataRoute } from 'next';

/**
 * `robots.txt` (SPEC v3 §4.6.1, Y-m13). The Help Portal is behind a session
 * and every page already says `noindex`; what a crawler can still reach
 * without one is the demo's entry and the API routes, and neither belongs in
 * an index — `/demo` would put a one-click way into the shared demo in search
 * results, outside the public site that explains it.
 *
 * The proxy's matcher leaves this file out, so a crawler with no session gets
 * the rules rather than a redirect to sign in.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: ['/demo', '/api/'] } };
}
