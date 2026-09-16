import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { uiStylesheet } from '@itsm/ui';
import { Chrome } from '../components/Chrome.js';
import './globals.css';

/**
 * The document.
 *
 * The design system's stylesheet is emitted server-side rather than injected on
 * mount, for the same reason as the other two applications: an injected
 * stylesheet costs a flash of unstyled content on every first paint.
 */

export const metadata: Metadata = {
  title: { default: 'Administration', template: '%s · Administration' },
  description: 'Configure the desk: people, the shape of a ticket, and what is switched on.',
  // Behind a session, and a session that can change a tenant's configuration.
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
        <style id="itsm-ui-styles" dangerouslySetInnerHTML={{ __html: uiStylesheet() }} />
      </head>
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
