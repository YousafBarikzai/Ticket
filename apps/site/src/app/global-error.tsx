'use client';

import type { ReactNode } from 'react';

/**
 * The last resort: the root layout itself failed, so this replaces the whole
 * document. Next requires it to be a client component, which makes it the one
 * piece of the site's own JavaScript in every route's first load — so it is
 * kept to markup and one handler, and imports nothing from the design system:
 * a component pulled in here would ride along on every page.
 *
 * It links the stylesheet unversioned (the versioned name is a hash only a
 * server module can compute) and draws with the design system's own status
 * screen and button classes, so it still looks like the product.
 * `data-itsm-error-boundary` is what a render check looks for.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  return (
    <html lang="en-GB">
      <head>
        <title>Something went wrong · IT Service Management</title>
        <link rel="stylesheet" href="/itsm-ui.css" precedence="itsm" />
      </head>
      <body>
        <main id="main" className="itsm-StatusScreen" data-itsm-error-boundary="">
          <div className="itsm-StatusScreen__card">
            <h1 className="itsm-StatusScreen__title">Something went wrong</h1>
            <div className="itsm-StatusScreen__body">
              <p>This page hit a problem it couldn’t recover from. Trying again usually works.</p>
              {error.digest ? <p>Error ID {error.digest}</p> : null}
            </div>
            <div className="itsm-StatusScreen__actions">
              <button type="button" className="itsm-Button itsm-Button--primary itsm-Button--lg" onClick={() => retry()}>
                <span className="itsm-Button__label">Try again</span>
              </button>
              {/* A plain link: a full load is the point after a crash. */}
              <a href="/" className="itsm-Button itsm-Button--secondary itsm-Button--lg">
                <span className="itsm-Button__label">Go to the home page</span>
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
