'use client';

import { useEffect, type ReactNode } from 'react';
import { ProblemState } from '@itsm/ui';
import '../../home/states.css';

/**
 * A page inside the portal failed (SPEC §4.10): the frame stays — the top
 * bar, search, the tab bar — and the content column says what happened, with
 * Try again, a way home, and the error's id for whoever reads the logs.
 * `data-itsm-error-boundary` is what the render pass looks for.
 *
 * v3 (§7.0.7, A6 §3.7) draws it inside a page-level dashed placeholder, the
 * look of `EmptyState frame="dashed"`; `ProblemState` stays the content
 * because it keeps the error's `h1` (portal pages always show one), Try
 * again and the error id. The way home is the area's home, `/` (a client
 * boundary in every route's first load, so it does not import the area
 * model for one path).
 *
 * A server component's error reaches here without its message (Next strips
 * it in production), so this does not pretend to know the cause.
 */
export default function PortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-Page app-StatePage">
      <div className="app-StatePage__frame">
        <ProblemState
          size="lg"
          headingLevel={1}
          errorBoundary
          problem={{ status: 500, ...(error.digest ? { digest: error.digest } : {}) }}
          onRetry={retry}
          secondaryAction={{ id: 'home', label: 'Go to Home', href: '/' }}
        />
      </div>
    </div>
  );
}
