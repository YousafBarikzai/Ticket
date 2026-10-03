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

/**
 * Every name the site imports from `@itsm/ui`'s root entry, by the folder of
 * its defining module, so the build imports each from that module.
 *
 * Why not Next's barrel optimisation for the root, as the applications do:
 * the root re-exports the display primitives through a second barrel
 * (`display/index.ts`), and the optimisation rewrites an import of the root
 * to that barrel but not through it. `import { IconTile } from '@itsm/ui'`
 * therefore reached every module `display/index.ts` names, and each client
 * component among them — the activity feed, the attention-row actions, the
 * hero card's "Why?" — was added to every route's client references with the
 * provider and message tables they read: 19.5 kB gzip of the 31 kB the site
 * had grown by, on a site whose own pages ship no client code. A member map
 * removes them, with no change to any import in the source (TypeScript still
 * checks each one against the package's types).
 *
 * A name not listed falls through to the whole root entry, so
 * `guards.test.ts` fails when the site imports one that is not here; each
 * listed name must be the file name of its module in that folder.
 */
export const ROOT_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  display: ['DeltaPill', 'IconTile', 'StatusPill'],
  feedback: ['InlineAlert', 'StatusScreen'],
  icons: ['BrandMark', 'Icon'],
  web: ['Avatar', 'VisuallyHidden'],
};

/** A build-only specifier for the design system's sources, used by the rewrite above and nowhere in the code. */
const UI_SOURCE_ALIAS = '@itsm/ui-source';

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
    // The subpath barrels the site imports from (`/shell` for the demo strip,
    // `/charts` for the hero's preview, `/icons`): Next rewrites each import to
    // the defining module, so a route ships the client components it renders
    // and none of the others — without it, importing `DemoBar` from `/shell`
    // would carry every client component the shell barrel re-exports. The
    // root entry is handled by `modularizeImports` below (`ROOT_MEMBERS`).
    optimizePackageImports: ['@itsm/ui/shell', '@itsm/ui/charts', '@itsm/ui/icons'],
  },
  /** Each root-entry name from its defining module (`ROOT_MEMBERS`); anything else keeps `@itsm/ui`. */
  modularizeImports: {
    '@itsm/ui': {
      transform: Object.fromEntries([
        ...Object.entries(ROOT_MEMBERS).map(([folder, names]) => [`^(${names.join('|')})$`, `${UI_SOURCE_ALIAS}/${folder}/{{member}}.js`]),
        ['.*', '@itsm/ui'],
      ]),
      skipDefaultConversion: true,
    },
  },
  /**
   * Every module in this repository imports its neighbours with an explicit
   * `.js` extension; webpack has to be told that means the `.ts` beside it,
   * and that rule is why the site builds with webpack rather than Turbopack.
   * `UI_SOURCE_ALIAS` points the member map's targets at the design system's
   * sources, which the package's `exports` would not otherwise let a build
   * reach by path.
   */
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), [UI_SOURCE_ALIAS]: join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src') };
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
