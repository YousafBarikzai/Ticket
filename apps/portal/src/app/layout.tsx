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
 * content on every first paint — and the portal is what somebody opens when
 * something has already gone wrong, often on a phone, often on a bad
 * connection. A page that jumps as it loads is a page they lose their place
 * in at the moment they are least patient.
 */

export const metadata: Metadata = {
  title: { default: 'Help', template: '%s · Help' },
  description: 'Report something, ask for something, and see where it got to.',
  // Behind a session; nothing here belongs in an index.
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
