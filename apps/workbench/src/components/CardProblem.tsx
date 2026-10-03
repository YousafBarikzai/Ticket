import type { ReactNode } from 'react';
import { describeProblem, EmptyState, InlineAlert, type Problem, type ProblemDescription } from '@itsm/ui';

/**
 * A card whose read failed (A6 §3.2 rule 1, §3.7; SPEC §7.0.2, §7.0.7).
 *
 * A dashboard is a set of cards that each wait on their own read, so one
 * failure is drawn where it happened and the rest of the page stands: this
 * says what went wrong — `describeProblem()`'s title, the same words a toast
 * or the error page would use, "The demo is paused or being prepared" for a
 * paused demo — and offers "Try again".
 *
 * A server component, so it costs the page no JavaScript. "Try again" is a
 * plain link to the same URL rather than a button that refetches: the page is
 * rendered on the server, a full load renders it again, and a link works
 * before hydration and without it. Through the app's `Link` it would be a
 * client navigation to the URL already showing, which may change nothing.
 * It is offered only where trying again can help — a missing permission, a
 * record that is gone or a demo limit get the sentence alone.
 *
 * `compact` is the one-line form for a narrow place: a board column, a row
 * of the inspector.
 */

export interface CardProblemProps {
  readonly problem: Problem;
  /** What failed to load, as a card would title it: "Your queue" reads "Couldn't load your queue". */
  readonly context?: string;
  /**
   * Where "Try again" goes: this page's path and query. Empty by default — a
   * link to "" is the page's own address, query and all.
   */
  readonly retryHref?: string;
  /** `sm` (default) fills the card's body; `compact` is one line. */
  readonly size?: 'sm' | 'compact';
  /** 3 inside a card whose title is the 2 (default); 4 under a section's 3. */
  readonly headingLevel?: 3 | 4;
  readonly className?: string;
}

/** The empty state's look for a problem: red only for an outage, neutral for what is nobody's fault. */
function stateTone(description: ProblemDescription): 'error' | 'forbidden' | 'search' | 'offline' {
  if (description.tone !== 'neutral') return 'error';
  if (description.kind === 'notFound') return 'search';
  if (description.kind === 'demoUnavailable') return 'offline';
  return 'forbidden';
}

export function CardProblem({ problem, context, retryHref = '', size = 'sm', headingLevel = 3, className }: CardProblemProps): ReactNode {
  const description = describeProblem(problem, context ? { context } : {});
  const retryLabel = description.remedyLabel ?? 'Try again';
  const canRetry = description.remedy !== 'none';
  const classes = className ? `app-CardProblem ${className}` : 'app-CardProblem';

  if (size === 'compact') {
    return (
      <InlineAlert
        tone={description.tone === 'neutral' ? 'neutral' : 'danger'}
        icon={description.icon}
        className={classes}
        data-kind={description.kind}
        data-status={problem.status}
      >
        {description.title}
        {canRetry ? (
          <>
            {' · '}
            <a href={retryHref}>{retryLabel}</a>
          </>
        ) : null}
      </InlineAlert>
    );
  }

  return (
    <EmptyState
      size="sm"
      tone={stateTone(description)}
      icon={description.icon}
      title={description.title}
      headingLevel={headingLevel}
      className={classes}
      data-kind={description.kind}
      data-status={problem.status}
      action={
        canRetry ? (
          // The design system's button look on a plain anchor, as `ProblemState`'s sign-in link: a full load, never prefetched.
          <a href={retryHref} className="itsm-Button itsm-Button--secondary itsm-Button--sm">
            <span className="itsm-Button__label">{retryLabel}</span>
          </a>
        ) : undefined
      }
    />
  );
}
