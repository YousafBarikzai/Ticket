'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, StatusScreen } from '@itsm/ui';

/**
 * The last resort: the root layout itself failed, so this draws its own
 * document (SPEC §4.10). Deliberately plain — a branded card, Try again, the
 * error's id — and marked with `data-itsm-error-boundary` for the render pass.
 *
 * The stylesheet link is the one the page already loaded, read back from the
 * document: its URL carries the sheet's hash, and importing the sheet here to
 * compute it would put the whole design system's CSS into this bundle for a
 * page that almost never shows. Should there be none, the bare URL still
 * serves the current sheet.
 */
function currentStylesheet(): string {
  if (typeof document === 'undefined') return '/itsm-ui.css';
  return document.querySelector('link[rel="stylesheet"][href^="/itsm-ui.css"]')?.getAttribute('href') ?? '/itsm-ui.css';
}

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  const [stylesheet] = useState(currentStylesheet);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-GB">
      <head>
        {/* The area's name as the root layout's title template spells it (`AREAS.portal.name`), written out: this boundary loads nothing it can avoid. */}
        <title>Something went wrong · Help Portal</title>
        <link rel="stylesheet" href={stylesheet} precedence="itsm" />
      </head>
      <body>
        <StatusScreen
          brand="portal"
          illustration="error"
          errorBoundary
          title="Something went wrong"
          body={
            <>
              <p>It’s not you — something went wrong on our side. Try again in a moment.</p>
              {error.digest ? <p className="app-Status__digest">Error ID {error.digest}</p> : null}
            </>
          }
        >
          <Button variant="primary" size="lg" fullWidth onClick={retry}>
            Try again
          </Button>
        </StatusScreen>
      </body>
    </html>
  );
}
