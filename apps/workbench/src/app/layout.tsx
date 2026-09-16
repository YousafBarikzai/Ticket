import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { uiStylesheet } from '@itsm/ui';
import { Chrome } from '../components/Chrome.js';
import './globals.css';

/**
 * The document.
 *
 * The design system's stylesheet is emitted here, server-side, rather than
 * injected by `ThemeProvider` on mount. Injecting it costs a flash of unstyled
 * content on every first paint, which on a queue of two hundred rows is a
 * visible reflow — and the agent workbench is a screen people leave open all
 * day and glance at, where a jump at load is the difference between reading
 * the top row and losing your place.
 */

export const metadata: Metadata = {
  title: { default: 'Workbench', template: '%s · Workbench' },
  description: 'Queues, tickets and the work in front of you.',
  // The workbench is behind a session; nothing here belongs in an index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en-GB">
      <head>
        {/*
          The id matches the one `ThemeProvider` looks for, so the provider
          finds the stylesheet already present and does not add a second copy.
        */}
        <style id="itsm-ui-styles" dangerouslySetInnerHTML={{ __html: uiStylesheet() }} />
      </head>
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
