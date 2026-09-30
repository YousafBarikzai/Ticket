'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { announce } from '../a11y/announcer.js';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages, type UiMessages } from '../provider/messages.js';
import { useTheme } from '../theme/ThemeProvider.js';
import type { ActionSpec, Problem } from '../types.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import { FeedbackAction } from './actions.js';
import { StateIllustration } from './Illustration.js';
import { describeProblem, isRetryableStatus, permissionKeyFrom, waitSentence } from './problem.js';

export interface ProblemStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title' | 'role'> {
  readonly problem: Problem;
  /** Client only. Shows Retry (disabled until `retryAfterSeconds` has passed, for a 429); "Reload" for a 409. */
  readonly onRetry?: () => void;
  /** Where "Sign in again" goes after a 401: `/api/session/login?redirectTo=<current>`. Without it the page reloads, and the server sends the person to sign in. */
  readonly signInHref?: string;
  /** What failed to load, e.g. "Failed deliveries". */
  readonly context?: string;
  /** `sm` inside a card, `md` (default) for a section, `lg` for a route's error page. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** The missing permission in words, e.g. "Read rules", for a 403. */
  readonly permissionLabel?: string;
  /** The permission's technical key, shown with Copy to people who turned on *Show technical keys*. Read from the API's detail when not given. */
  readonly permissionKey?: string;
  /** The heading's level: 2 by default (3 at `sm`); 1 on an error page that has no page header of its own. */
  readonly headingLevel?: 1 | 2 | 3 | 4;
  /** A way out beside the remedy: "Go to Command centre", "Back to inbox". */
  readonly secondaryAction?: ActionSpec | ReactNode;
  /** Client only. Receives the `id` of a `secondaryAction` spec that has no `href`. */
  readonly onAction?: (id: string) => void;
  /** Marks the root with `data-itsm-error-boundary`, for an `error.tsx` (the render pass looks for it). */
  readonly errorBoundary?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * Seconds still to wait before a retry, counting down once a second from
 * `seconds`. The first render — on the server and while hydrating — shows the
 * full wait, so the markup matches; the clock starts in the browser. A new
 * problem (another 429) starts a new countdown.
 */
function useCountdown(seconds: number, problem: Problem): number {
  const [remaining, setRemaining] = useState(seconds);
  // By value: a parent that rebuilds the same problem object on every render
  // must not restart the clock each time.
  const identity = JSON.stringify(problem);
  useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds, identity]);
  return remaining;
}

/** A value with a Copy button: the error ID, a permission key. */
function CopyableValue({ label, value, messages }: { readonly label: string; readonly value: string; readonly messages: UiMessages }): ReactNode {
  const [copied, setCopied] = useState(false);
  const labelId = useStableId('itsm-problem-copy');
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      announce(messages.copied);
    } catch {
      // No clipboard (an insecure origin, a refused permission): the value is
      // on screen and selectable, which is the fallback.
    }
  };

  return (
    <p className="itsm-ProblemState__meta">
      <span id={labelId}>{label}</span> <code className="itsm-ProblemState__code">{value}</code>
      <button
        type="button"
        className="itsm-ProblemState__copy"
        aria-describedby={labelId}
        data-copied={copied ? '' : undefined}
        onClick={() => void copy()}
      >
        <Icon name={copied ? 'check' : 'copy'} size="xs" />
        {copied ? messages.copied : messages.copy}
      </button>
    </p>
  );
}

/**
 * An API error, explained in terms of what the person can do next (SPEC
 * §4.5): sign in again (401), wait for the plan (402), ask for access (403 —
 * or the suspended-workspace screen), look elsewhere (404), reload (409),
 * check their answers (422), wait (429 — Retry stays disabled, with the time
 * left beside it, until `retryAfterSeconds` has passed), or retry (502/503).
 * The copy is the product's, never the API's error code; the technical
 * detail and permission key are there for people who turned on *Show
 * technical keys*, and the "Error ID" (Next's digest) is always there, with
 * Copy, for quoting to support.
 *
 * `sm` sits inside a card and fails only that card; `md` fills a section;
 * `lg` is a route's error page, with the line illustration. The heading and
 * sentence are an alert region; the countdown is outside it, so a screen
 * reader hears the problem once and is told when retrying is possible,
 * rather than every second.
 *
 * `errorBoundary` marks the root with `data-itsm-error-boundary`, which is
 * how the render pass tells our error pages from a healthy route. Only an
 * `error.tsx` should set it: a card that failed on an otherwise working page
 * is not an error page.
 */
export function ProblemState({
  problem,
  onRetry,
  signInHref,
  context,
  size = 'md',
  permissionLabel,
  permissionKey,
  headingLevel,
  secondaryAction,
  onAction,
  errorBoundary = false,
  className,
  ref,
  ...rest
}: ProblemStateProps): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const { prefs } = useTheme();
  const waitId = useStableId('itsm-problem-wait');
  const description = describeProblem(problem, { context, ...(permissionLabel ? { permissionLabel } : {}) });
  const rateLimited = description.kind === 'rateLimited';
  const remaining = useCountdown(rateLimited ? Math.max(0, problem.retryAfterSeconds ?? 0) : 0, problem);
  const waiting = rateLimited && remaining > 0;

  // Tell a screen reader once, when the wait is over; the ticking itself is not news.
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting) announce(waitSentence(0));
    wasWaiting.current = waiting;
  }, [waiting]);

  // A disabled button cannot hold focus. If Retry had it when a fresh 429
  // disabled it, focus goes to the sentence saying how long to wait, rather
  // than falling back to the top of the page.
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const retryFocused = useRef(false);
  const waitRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (!waiting || !retryFocused.current) return;
    const active = document.activeElement;
    if (active === null || active === document.body || active === retryRef.current) waitRef.current?.focus();
    retryFocused.current = false;
  }, [waiting]);

  const Heading = `h${headingLevel ?? (size === 'sm' ? 3 : 2)}` as 'h1' | 'h2' | 'h3' | 'h4';
  const buttonSize = size === 'sm' ? 'sm' : 'md';
  const key = permissionKey ?? permissionKeyFrom(problem);
  const retryAllowed = problem.retryable ?? isRetryableStatus(problem.status);

  let remedy: ReactNode = null;
  if (description.remedy === 'signIn') {
    remedy = signInHref ? (
      // A plain link, not the app's `Link`: signing in is a full navigation
      // through the identity provider, and must not be prefetched.
      <a href={signInHref} className={`itsm-Button itsm-Button--primary itsm-Button--${buttonSize}`}>
        <span className="itsm-Button__label">{messages.signInAgain}</span>
      </a>
    ) : (
      <Button variant="primary" size={buttonSize} onClick={() => window.location.reload()}>
        {messages.signInAgain}
      </Button>
    );
  } else if (description.remedy === 'reload') {
    remedy = (
      <Button variant="secondary" size={buttonSize} onClick={() => (onRetry ? onRetry() : window.location.reload())}>
        Reload
      </Button>
    );
  } else if (onRetry && (description.remedy === 'retry' ? retryAllowed : problem.retryable === true)) {
    remedy = (
      <Button
        ref={retryRef}
        variant={size === 'lg' ? 'primary' : 'secondary'}
        size={buttonSize}
        disabled={waiting}
        aria-describedby={rateLimited ? waitId : undefined}
        onFocus={() => {
          retryFocused.current = true;
        }}
        onBlur={(event) => {
          // Focus lost to nowhere — the button being disabled under it — is
          // not the person moving on, so the flag stays for the effect above.
          if (event.relatedTarget) retryFocused.current = false;
        }}
        onClick={() => {
          if (waiting) return;
          // Still focused while the retry runs; if it comes back 429, the
          // effect above moves focus to the wait.
          retryFocused.current = true;
          onRetry();
        }}
      >
        {messages.tryAgain}
      </Button>
    );
  }

  const showDrawing = size === 'lg' && description.illustration;
  const hasSecondary = secondaryAction !== undefined && secondaryAction !== null && secondaryAction !== false;

  return (
    <div
      {...rest}
      ref={ref}
      className={cx('itsm-ProblemState', className)}
      data-size={size}
      data-status={problem.status}
      data-kind={description.kind}
      data-tone={description.tone}
      {...(errorBoundary ? { 'data-itsm-error-boundary': '' } : {})}
    >
      {showDrawing ? (
        <StateIllustration
          name={description.illustration!}
          size="lg"
          tone={description.tone === 'danger' ? 'danger' : description.tone === 'warning' ? 'warning' : 'neutral'}
          className="itsm-ProblemState__illustration"
        />
      ) : (
        <span className="itsm-ProblemState__icon" aria-hidden="true">
          <Icon name={description.icon} size={size === 'sm' ? 'md' : '2xl'} />
        </span>
      )}
      <div className="itsm-ProblemState__main">
        <div className="itsm-ProblemState__text" role="alert">
          <Heading className="itsm-ProblemState__title">{description.title}</Heading>
          <p className="itsm-ProblemState__body">{description.body}</p>
        </div>
        {rateLimited ? (
          <p id={waitId} ref={waitRef} tabIndex={-1} className="itsm-ProblemState__wait">
            {waitSentence(remaining)}
          </p>
        ) : null}
        {remedy || hasSecondary ? (
          <div className="itsm-ProblemState__actions">
            {remedy}
            {hasSecondary ? <FeedbackAction action={secondaryAction} onAction={onAction} defaultVariant="secondary" size={buttonSize} /> : null}
          </div>
        ) : null}
        {prefs.showKeys && key && description.kind === 'forbidden' ? (
          <CopyableValue label="Permission key" value={key} messages={messages} />
        ) : null}
        {prefs.showKeys && problem.detail ? (
          <p className="itsm-ProblemState__meta">
            Details: <span className="itsm-ProblemState__detail">{problem.detail}</span>
          </p>
        ) : null}
        {problem.digest ? <CopyableValue label="Error ID" value={problem.digest} messages={messages} /> : null}
      </div>
    </div>
  );
}
