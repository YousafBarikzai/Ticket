import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * The public site (SPEC v3 §6.1; A5 §3.4; ADR-0062).
 *
 * The same build shape as the three applications — standalone output traced
 * from the workspace root, webpack for its `.js` → `.ts` alias, the workspace
 * packages transpiled from source — and a stricter set of headers, because
 * this is the one origin anybody can open without signing in.
 *
 * What the headers buy, line by line:
 *
 * - `connect-src 'self'`: the browser here talks to nothing else. The demo's
 *   status is read by the site's own server (`src/server/demo-status.ts`),
 *   never by the page, so no API origin appears in this policy.
 * - `form-action 'self'`: the site has no form. Every way into the product is
 *   a link, and a cross-origin form post would be blocked by this line, which
 *   is the guard that keeps it that way.
 * - `object-src 'none'` and `cross-origin-opener-policy: same-origin`: nothing
 *   here embeds a plug-in or needs a window it opened to keep a handle on it.
 * - `referrer-policy: strict-origin-when-cross-origin` is **required**, not
 *   hygiene: an app's `/demo` page auto-submits only when the Referer names an
 *   allowed origin (D22). `no-referrer` here would turn every role button into
 *   a second click.
 * - HSTS is `max-age` only (Y-m12). `includeSubDomains` would bind every host
 *   under the owner's domain to HTTPS from a marketing page, and `preload`
 *   is a list a domain cannot leave quickly; neither is this page's to decide.
 */
const csp = [
  "default-src 'self'",
  // Next's bootstrap and the site's inline hint scripts; a nonce policy needs
  // middleware, and the site has none on purpose (no per-visitor state).
  // `unsafe-eval` in development only, for webpack's eval source maps.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const securityHeaders: readonly { readonly key: string; readonly value: string }[] = [
  { key: 'content-security-policy', value: csp },
  { key: 'x-content-type-options', value: 'nosniff' },
  { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
  { key: 'permissions-policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'strict-transport-security', value: 'max-age=63072000' },
  { key: 'cross-origin-opener-policy', value: 'same-origin' },
  { key: 'x-frame-options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * A self-contained server directory for an image with no package manager.
   * `outputFileTracingRoot` at the workspace root, as in the applications:
   * traced from here, the workspace packages reached through symlinks would be
   * missing at run time rather than at build time.
   */
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@itsm/ui', '@itsm/contracts', '@itsm/expr'],
  poweredByHeader: false,
  // Pictures arrive pre-encoded (AVIF and WebP, the final wave); with no
  // optimiser there is no `sharp` in the image for a scanner to find.
  images: { unoptimized: true },
  experimental: {
    // Server components import the design system from its root entry; this
    // makes Next rewrite each import to the defining module, so a route ships
    // the client components it renders and none of the others.
    optimizePackageImports: ['@itsm/ui'],
  },
  /**
   * Every module in this repository imports its neighbours with an explicit
   * `.js` extension; webpack has to be told that means the `.ts` beside it,
   * and that rule is why the site builds with webpack rather than Turbopack.
   */
  webpack(config) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: [...securityHeaders] }];
  },
};

export default nextConfig;
