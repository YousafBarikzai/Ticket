'use client';

import { useEffect, type ReactNode } from 'react';
import { ProblemState } from '@itsm/ui';

/**
 * A page inside the desk failed (SPEC §4.10): the frame stays — sidebar,
 * search, the bell — and the content column says what happened, with Try
 * again, a way back to the inbox, and the error's id for whoever reads the
 * logs. `data-itsm-error-boundary` is what the render pass looks for.
 *
 * A server component's error reaches here without its message (Next strips
 * it in production), so this does not pretend to know the cause.
 */
export default function DeskError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }): ReactNode {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ProblemState
      size="lg"
      headingLevel={1}
      errorBoundary
      problem={{ status: 500, ...(error.digest ? { digest: error.digest } : {}) }}
      onRetry={retry}
      secondaryAction={{ id: 'inbox', label: 'Back to inbox', href: '/inbox' }}
    />
  );
}
