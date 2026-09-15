import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * The administration console (docs/architecture/03 §1, 14 §1, 16 §2).
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
  transpilePackages: ['@itsm/ui', '@itsm/sdk', '@itsm/bff', '@itsm/contracts', '@itsm/expr'],
  poweredByHeader: false,
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
