import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { themeInitScript } from '@itsm/ui/theme';
import { interExt, interLatin } from './fonts.js';
import './globals.css';

/**
 * The document (SPEC §3.4). No session, no provider: the sign-in pages and
 * the 404 render under it too, and they stay static and light (D11). The
 * console's frame — session, providers, shell — is `(console)/layout.tsx`.
 *
 * Three things in `<head>`, in this order, and each is there for first paint:
 *
 *   1. The pre-paint script. A theme, density or collapsed sidebar chosen in
 *      the account menu is written onto `<html>` before anything is drawn, so
 *      a person who chose dark never sees a white flash on load (D2). It reads
 *      `localStorage` only; no cookie, so the HTML stays the same for everyone.
 *      `suppressHydrationWarning` on `<html>` is for exactly those attributes.
 *   2. The design system's stylesheet as a cached file (`/itsm-ui.css`),
 *      versioned by a hash of its content — fetched once per release rather
 *      than inlined into every response (D3). `precedence` lets React hoist
 *      and order it before the app's own `globals.css`.
 *   3. Inter, self-hosted (D4): the two font classes expose the custom
 *      properties the token font stack reads; latin is preloaded.
 */

export const metadata: Metadata = {
  title: { default: 'Administration', template: '%s · Administration' },
  description: 'Configure the desk: people, services, automation and what is switched on.',
  // Behind a session, and a session that can change a tenant's configuration.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  // The canvas colours of the two schemes, so the browser's own chrome matches.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F5F7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB" className={`${interLatin.variable} ${interExt.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript({ app: 'admin' }) }} />
        <link rel="stylesheet" href={`/itsm-ui.css?v=${uiStylesheetVersion}`} precedence="itsm" />
      </head>
      <body>{children}</body>
    </html>
  );
}
