'use client';

import type { ReactNode } from 'react';
import { ProblemState } from '@itsm/ui';

/**
 * A page failed to render: inside the frame, so the sidebar, search and the
 * way back stay where they were (SPEC §4.10 "Error (route)").
 *
 * Server errors reach the browser without their message (only a digest, to
 * match the server's log), so the page says what it can honestly say —
 * something went wrong, here is the error ID to quote, try again — rather than
 * guessing. *Try again* re-fetches and re-renders the page (`retry`), which is
 * what fixes a passing failure. `data-itsm-error-boundary` is what the render
 * pass looks for.
 *
 * The frame's own failures (session ended, workspace suspended, API
 * unreachable) never reach here: the layout above renders a screen for each.
 */
export default function ConsoleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  return (
    <div className="app-Page app-Page--centred">
      <ProblemState
        size="lg"
        headingLevel={1}
        errorBoundary
        problem={{ status: 500, ...(error.digest ? { digest: error.digest } : {}) }}
        onRetry={retry}
        secondaryAction={{ id: 'home', label: 'Go to Command centre', href: '/', variant: 'secondary' }}
      />
    </div>
  );
}
