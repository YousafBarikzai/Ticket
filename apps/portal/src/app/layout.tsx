import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { themeInitScript } from '@itsm/ui/theme';
import { interExt, interLatin } from './fonts.js';
import './globals.css';

/**
 * The document (SPEC §3.4, D2, D3).
 *
 * The portal is what somebody opens when something has already gone wrong,
 * often on a phone, often on a bad connection — a page that flashes white or
 * jumps as it loads is a page they lose their place in at the moment they
 * are least patient. So three things happen before the first pixel, in this
 * order:
 *
 *   1. The pre-paint script reads the person's preferences from
 *      `localStorage['itsm-prefs']` and writes the theme, contrast, motion and
 *      transparency attributes on `<html>` — inline and blocking, under 1 kB,
 *      so a person who chose dark never sees white.
 *   2. The design system's stylesheet is a render-blocking link to a
 *      same-origin file whose URL carries a hash of the sheet: fetched once
 *      per release and cached as immutable (and by the service worker),
 *      rather than inlined into every HTML response as it used to be.
 *   3. Inter's latin face is preloaded by `next/font`, with a metrics-matched
 *      fallback, so the swap does not move text.
 *
 * No session and no provider here: the providers live in the `(portal)` group
 * layout, so `/offline`, `/sign-in` and `/signed-out` stay static and light
 * (D11). `suppressHydrationWarning` is for the attributes the script adds,
 * which the server cannot know.
 */

export const metadata: Metadata = {
  title: { default: 'Help', template: '%s · Help' },
  description: 'Report something, ask for something, and see where it got to.',
  applicationName: 'Help',
  appleWebApp: { capable: true, title: 'Help', statusBarStyle: 'default' },
  // Behind a session; nothing here belongs in an index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Edge to edge on phones: the tab bar pads itself for the home indicator.
  viewportFit: 'cover',
  colorScheme: 'light dark',
  // The canvas colour of each scheme, so the browser's own chrome matches the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F5F7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB" className={`${interLatin.variable} ${interExt.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript({ app: 'portal' }) }} />
        <link rel="stylesheet" href={`/itsm-ui.css?v=${uiStylesheetVersion}`} precedence="itsm" />
      </head>
      <body>{children}</body>
    </html>
  );
}
