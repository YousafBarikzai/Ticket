import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AREAS, PRODUCT_NAME } from '@itsm/contracts/areas';
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { themeInitScript } from '@itsm/ui/theme';
import { colour } from '@itsm/ui/tokens';
import { interExt, interLatin, jakartaExt, jakartaLatin } from './fonts.js';
import './globals.css';

/**
 * The document (SPEC §3.4, D2, D3).
 *
 * Three things happen before the first pixel, in this order, and each is why
 * a reload does not flash:
 *
 *   1. The pre-paint script reads the person's preferences from
 *      `localStorage['itsm-prefs']` and writes the theme, density, motion and
 *      sidebar attributes on `<html>` — inline and blocking, under 1 kB, so a
 *      person who chose dark never sees white.
 *   2. The design system's stylesheet is a render-blocking link to a
 *      same-origin file whose URL carries a hash of the sheet: fetched once
 *      per release and cached as immutable, rather than inlined into every
 *      HTML response as it used to be.
 *   3. Inter's latin face is preloaded by `next/font`, with a metrics-matched
 *      fallback, so the swap does not move text.
 *
 * No session and no provider here: the providers live in the `(desk)` group
 * layout, so `/offline`, `/sign-in`, `/signed-out` and `/demo` carry no
 * frame. `suppressHydrationWarning` is for the attributes the script adds,
 * which the server cannot know.
 *
 * Every title names the area, "Service Desk" (D1, v3 §3.1), from `AREAS`.
 */

const AREA = AREAS.workbench.name;

export const metadata: Metadata = {
  title: { default: AREA, template: `%s · ${AREA}` },
  description: 'Your tickets, your teams’ queues and the work in front of you.',
  applicationName: `${AREA} — ${PRODUCT_NAME}`,
  appleWebApp: { capable: true, title: AREA, statusBarStyle: 'default' },
  // The Service Desk is behind a session; nothing here belongs in an index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  // The canvas of each scheme, from the tokens, so the browser's own chrome matches the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: colour.apple.surface.canvas },
    { media: '(prefers-color-scheme: dark)', color: colour['apple-dark'].surface.canvas },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB" className={`${interLatin.variable} ${interExt.variable} ${jakartaLatin.variable} ${jakartaExt.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript({ app: 'workbench' }) }} />
        <link rel="stylesheet" href={`/itsm-ui.css?v=${uiStylesheetVersion}`} precedence="itsm" />
      </head>
      <body>{children}</body>
    </html>
  );
}
