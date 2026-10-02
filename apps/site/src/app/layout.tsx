import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { colour } from '@itsm/ui/tokens';
import { siteConfig } from '../server/config.js';
import { interExt, interLatin } from './fonts.js';
import './site.css';

/**
 * The public site's document (SPEC v3 §6.1; A5 §3.10, §3.12, §3.13).
 *
 * What it deliberately does not have, because the site is not an application:
 * no provider, no session, no theme script (the token sheet follows the OS
 * scheme through its `:root:not([data-itsm-theme])` blocks), no service worker
 * and no cookie. Every visitor gets the same HTML for a given minute.
 *
 * What it does have:
 *
 *   1. The design system's stylesheet as a cached, versioned file
 *      (`/itsm-ui.css?v=…`), as the applications link it.
 *   2. Inter, self-hosted, latin preloaded (`fonts.ts`).
 *   3. A skip link as the first focusable element, to `main#main`.
 *   4. `data-demo` on `<html>`, which the post-deploy check reads to know
 *      whether the role buttons should be on the page (`siteLinkWarnings`).
 *
 * The metadata is per request for the same reason the links are: whether the
 * site may be indexed, and its canonical origin, are deployment facts that do
 * not exist when the image is built.
 */

const DESCRIPTION =
  'Give employees one place to ask for help, give your service desk a clear view of every ticket and its SLA, and run it all from one console.';

export function generateMetadata(): Metadata {
  const config = siteConfig();
  return {
    ...(config.origins.site ? { metadataBase: new URL(config.origins.site) } : {}),
    title: { default: 'IT Service Management', template: '%s · IT Service Management' },
    description: DESCRIPTION,
    // A Railway-generated host is never indexed (A5 §3.12); links are still
    // followed, so a page's outbound links are not hidden from a crawler.
    robots: { index: config.indexable, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  // The canvas of each scheme, so the browser's own chrome matches the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colour.apple.surface.canvas },
    { media: '(prefers-color-scheme: dark)', color: colour['apple-dark'].surface.canvas },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  const { demo } = siteConfig();
  return (
    <html lang="en-GB" className={`${interLatin.variable} ${interExt.variable}`} data-demo={demo ? 'on' : 'off'}>
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
      </body>
    </html>
  );
}
