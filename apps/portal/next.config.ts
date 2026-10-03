import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * The requester portal (docs/architecture/03 §1, 14 §1).
 *
 * Two settings carry weight here.
 *
 * `transpilePackages` is what lets the workspace packages ship TypeScript
 * source rather than a build step. Every workspace package in this repository
 * points `main` at `src/index.ts`; Next will not compile a dependency unless it
 * is named here, and the failure — a syntax error inside `node_modules` — reads
 * as though the package were broken.
 *
 * The headers are the browser half of the security posture in doc 09 §4. The
 * API sets its own; a browser applies whichever the *document* was served with,
 * so the app has to repeat them. `frame-ancestors 'none'` matters most: the
 * portal holds a live session, and the session cookie is `SameSite=Lax`,
 * which is not on its own an answer to being framed.
 */
const csp = [
  "default-src 'self'",
  // Next's runtime injects inline bootstrap scripts; `strict-dynamic` with a
  // nonce is the better answer and needs middleware, which is a change worth
  // making on its own rather than buried in the first app.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Same-origin only: the browser never talks to the API directly, it talks to
  // the BFF (doc 14 §3). A wider value here would quietly undo that.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * A self-contained server directory, so the app can be run from an image
   * that carries no `node_modules` and no pnpm store. `outputFileTracingRoot`
   * has to point at the workspace root: without it Next traces from this
   * directory, finds the workspace packages through symlinks that leave it,
   * and produces a bundle that is missing `@itsm/ui` at run time rather than
   * at build time.
   */
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@itsm/ui', '@itsm/sdk', '@itsm/bff', '@itsm/pwa', '@itsm/contracts', '@itsm/expr'],
  poweredByHeader: false,
  /**
   * Server components import the design system from its root entry
   * (`import { Badge } from '@itsm/ui'`), and Next's client-reference pass
   * then takes every `'use client'` module that entry re-exports — the form
   * renderer and, through it, zod among them — into every route's first load,
   * used or not. `sideEffects: false` does not help there, because the pass
   * reads the import graph before anything is shaken out. Naming the package
   * here makes Next rewrite each such import to the module that defines the
   * name, so a route ships the client components it renders and no others
   * (SPEC §3.7; 24–30 kB off every route of all three applications when this
   * was added).
   *
   * The rewrite matches the import's specifier exactly, so a subpath is its
   * own entry. `@itsm/ui/theme` is here for the root layout, which imports
   * only the pre-paint script from it: unoptimised, the theme barrel's
   * `ThemeProvider` became a client reference of the root layout and shipped
   * a second time on every route (the providers already carry it).
   * `@itsm/ui/charts` (SPEC v3 §4.6.1) keeps the portal's few charts — the
   * summary strips' `StatCard`s — from bringing the kit's client islands
   * with them, and `@itsm/ui/shell` does the same for the frame: every route
   * imports a handful of its parts, never the whole barrel.
   */
  experimental: { optimizePackageImports: ['@itsm/ui', '@itsm/ui/theme', '@itsm/ui/charts', '@itsm/ui/shell'] },
  /**
   * Every module in this repository imports its neighbours with an explicit
   * `.js` extension, which is what ECMAScript modules require and what `tsx`,
   * `tsc` and Vitest all resolve back to the `.ts` file on disk. A bundler has
   * to be told the same rule or it looks for a `.js` that was never written.
   *
   * This is why the app builds with webpack rather than Turbopack: webpack has
   * `resolve.extensionAlias` for exactly this, and Turbopack has no equivalent
   * today. The alternative was to drop the extensions in `@itsm/ui` and
   * `@itsm/sdk` — around a hundred files — and with them the ability to run any
   * of this under Node's own resolver. A slower build is the cheaper price.
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
    return [
      {
        /*
         * The worker itself is never cached. A browser that held a stale
         * `sw.js` would keep serving the caching rules of a build that has been
         * replaced — which is the one bug a service worker can have that
         * nobody can clear by refreshing.
         */
        source: '/sw.js',
        headers: [
          { key: 'cache-control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'service-worker-allowed', value: '/' },
        ],
      },
      {
        /*
         * The demo's entry (SPEC v3 §4.6.1). Not in any index, whatever a
         * crawler makes of `robots.txt`; and never stored by a cache or the
         * browser's back-forward copy, because what it shows — "Opening the
         * Help Portal…", a confirm, a reason — is decided per request from this
         * browser's session and the demo's state, and a form that submits
         * itself must never be replayed from a cache.
         */
        source: '/demo',
        headers: [
          { key: 'x-robots-tag', value: 'noindex, nofollow' },
          { key: 'cache-control', value: 'no-store' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'content-security-policy', value: csp },
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'permissions-policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'strict-transport-security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
