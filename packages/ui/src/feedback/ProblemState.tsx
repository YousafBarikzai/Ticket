'use client';

import type { ReactNode } from 'react';
import type { Problem } from '../types.js';
import { cx } from '../web/cx.js';

export interface ProblemStateProps {
  readonly problem: Problem;
  /** Client only. Shows Retry (disabled until `retryAfterSeconds` has passed, for a 429). */
  readonly onRetry?: () => void;
  /** Where "Sign in again" goes after a 401. */
  readonly signInHref?: string;
  /** What failed to load, e.g. "Failed deliveries". */
  readonly context?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  /** The missing permission in words, e.g. "Read rules", for a 403. */
  readonly permissionLabel?: string;
  readonly className?: string;
}

/**
 * An API error, explained in terms of what the person can do next: sign in
 * again (401), ask for access (403), reload (409), wait (429), retry (502/503).
 * Shows "Error ID" with Copy when there is a digest. The in-shell `error.tsx`
 * renders it with `data-itsm-error-boundary`.
 *
 * Stub (SPEC §4.5): renders the problem's title; the feedback package
 * implements the per-status mapping and actions.
 */
export function ProblemState({ problem, size = 'md', className }: ProblemStateProps): ReactNode {
  return (
    <div className={cx('itsm-ProblemState', className)} data-status={problem.status} data-size={size}>
      <p className="itsm-ProblemState__title">{problem.title ?? 'Something went wrong'}</p>
      {problem.detail ? <p>{problem.detail}</p> : null}
    </div>
  );
}
