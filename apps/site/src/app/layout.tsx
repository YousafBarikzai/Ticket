import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { nextResetAt } from '@itsm/contracts/demo';
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { colour } from '@itsm/ui/tokens';
import { HINT_LISTEN } from '../client/continue-hint.js';
import { META } from '../landing/content.js';
import { siteConfig } from '../server/config.js';
import { fontClassNames } from './fonts.js';
import './site.css';

/**
 * The public site's document (SPEC v3 §6.1, §6.2; A5 §3.9, §3.10, §3.12,
 * §3.13, §4.1).
 *
 * What it deliberately does not have, because the site is not an application:
 * no provider, no session, no theme script (the token sheet follows the OS
 * scheme through its `:root:not([data-itsm-theme])` blocks), no service worker
 * and no cookie. Every visitor gets the same HTML for a given minute.
 *
 * What it does have, on every page:
 *
 *   1. The design system's stylesheet as a cached, versioned file
 *      (`/itsm-ui.css?v=…`), as the applications link it.
 *   2. Inter and Plus Jakarta Sans, self-hosted, both Latin faces preloaded
 *      (`fonts.ts`): the landing's `h1` is Jakarta.
 *   3. A skip link as the first focusable element, to `main#main`.
 *   4. `data-demo` on `<html>`, which the post-deploy check reads to know
 *      whether the role links should be on the page (`siteLinkWarnings`), and
 *      `data-next-reset`, the next 00:00 UK in epoch milliseconds, which the
 *      continue hint stores as its expiry.
 *   5. `HINT_LISTEN`, the continue hint's writer, inline at the end of
 *      `<body>`: a role link pressed on any page is remembered for the
 *      chooser's "Continue the demo" card.
 *
 * The public demo strip is not drawn here but by each page that has one —
 * the landing above its header, the chooser in `SignInLayout`'s `systemBar`
 * slot — because a layout cannot tell which page it wraps, and a page that
 * places the strip itself can never get it twice.
 *
 * The metadata is per request for the same reason the links are: whether the
 * site may be indexed, and its canonical origin, are deployment facts that do
 * not exist when the image is built.
 */

export function generateMetadata(): Metadata {
  const config = siteConfig();
  return {
    ...(config.origins.site ? { metadataBase: new URL(config.origins.site) } : {}),
    title: { default: config.demo ? META.title : META.titleOff, template: META.template },
    description: config.demo ? META.description : META.descriptionOff,
    openGraph: { type: 'website', siteName: META.titleOff, title: config.demo ? META.title : META.titleOff, locale: 'en_GB' },
    // A Railway-generated host is never indexed (A5 §3.12); links are still
    // followed, so a page's outbound links are not hidden from a crawler.
    robots: { index: config.indexable, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  // The landing's header and strip are navy in both schemes (A5 §3.10).
  themeColor: colour.apple.hero.surfaceDeep,
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  const config = siteConfig();
  return (
    <html lang="en-GB" className={fontClassNames} data-demo={config.demo ? 'on' : 'off'} data-next-reset={nextResetAt(Date.now())}>
      <head>
        <link rel="stylesheet" href={`/itsm-ui.css?v=${uiStylesheetVersion}`} precedence="itsm" />
      </head>
      <body className="app-Site">
        <div className="itsm-SkipLinks">
          <a className="itsm-SkipLinks__link" href="#main">
            Skip to main content
          </a>
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: HINT_LISTEN }} />
      </body>
    </html>
  );
}
