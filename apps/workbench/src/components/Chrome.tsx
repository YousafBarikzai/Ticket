'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@itsm/ui';

/**
 * The client boundary.
 *
 * `ThemeProvider` holds state and installs the live-region announcer, so it
 * cannot be a server component; keeping it in a file of its own means the
 * root layout stays a server component and the page shell is still rendered
 * on the server.
 *
 * `injectStyles` is off because the layout has already emitted the stylesheet.
 */
export function Chrome({ children }: { children: ReactNode }): ReactNode {
  return <ThemeProvider injectStyles={false} storageKey="itsm-theme">{children}</ThemeProvider>;
}
