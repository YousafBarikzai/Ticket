'use client';

import type { ReactNode } from 'react';
import { Button, StatusScreen } from '@itsm/ui';
import { themeInitScript } from '@itsm/ui/theme';

/**
 * The last resort: the root layout itself failed, so this replaces the whole
 * document (SPEC §4.10 "Error (route)").
 *
 * The console's own failures — the API down, a session ended, a suspended
 * workspace — are caught by `(console)/layout.tsx` and `(console)/error.tsx`
 * inside the frame, so this renders only when something below them could not
 * even produce a document.
 *
 * It carries its own `<html>`, the pre-paint theme script (so a dark-mode
 * reader is not flashed white at the worst moment) and the design system's
 * stylesheet. The link is unversioned here because the versioned name is a
 * hash of the sheet that only a server module can compute, and pulling the
 * sheet into this client file would put it into every page's JavaScript; when
 * the error happens after the page loaded, the versioned sheet is still in the
 * document anyway. `data-itsm-error-boundary` is what the render pass looks for.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <title>Something went wrong · Administration</title>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript({ app: 'admin' }) }} />
        <link rel="stylesheet" href="/itsm-ui.css" precedence="itsm" />
      </head>
      <body>
        <StatusScreen
          brand="admin"
          illustration="error"
          errorBoundary
          title="Something went wrong"
          body={
            <>
              <p>The console hit a problem it couldn’t recover from. Trying again usually works.</p>
              {error.digest ? <p>Error ID {error.digest}</p> : null}
            </>
          }
        >
          <Button variant="primary" size="lg" onClick={() => retry()}>
            Try again
          </Button>
          {/* A plain link, as StatusScreen draws its own: a full load is the point after a crash. */}
          <a href="/" className="itsm-Button itsm-Button--secondary itsm-Button--lg">
            <span className="itsm-Button__label">Go to Command centre</span>
          </a>
        </StatusScreen>
      </body>
    </html>
  );
}
