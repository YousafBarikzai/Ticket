import type { IconName, Illustration, Problem } from '../types.js';

/**
 * An API error, explained: which kind of trouble it is, what to call it, what
 * to say about it and what the person can do next. Pure and server-safe, so a
 * toast, a card and the route error page all say the same thing about the
 * same failure.
 *
 * The API's own `title` is its error code with spaces ("rate limited") and its
 * `detail` is written for developers ("permission rules.rule.read is
 * required"), so neither is shown as the headline. The copy here is the
 * product's, keyed on the status and, for a 403, on the `tenant_suspended`
 * code.
 */

export type ProblemKind =
  | 'session'
  | 'plan'
  | 'suspended'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'invalid'
  | 'rateLimited'
  | 'unavailable'
  | 'server'
  | 'unknown';

/** What the primary action of a problem is. */
export type ProblemRemedy = 'signIn' | 'reload' | 'retry' | 'none';

export interface ProblemDescription {
  readonly kind: ProblemKind;
  readonly tone: 'neutral' | 'warning' | 'danger';
  readonly icon: IconName;
  /** The drawing for a page-sized state; absent where an icon says it better. */
  readonly illustration?: Illustration;
  readonly title: string;
  /** The sentence under the title. A 429's time to wait is separate: see `waitSentence`. */
  readonly body: string;
  readonly remedy: ProblemRemedy;
}

export interface DescribeProblemOptions {
  /** What failed to load, e.g. "Failed deliveries". */
  readonly context?: string;
  /** The missing permission in words, e.g. "Read rules". */
  readonly permissionLabel?: string;
}

/**
 * A context phrase as it reads inside a sentence: "Failed deliveries" becomes
 * "failed deliveries" in "Couldn't load failed deliveries", but "AI triage"
 * and "INC-000123" keep their capitals — only a word that is capitalised
 * because it starts the phrase is lowered.
 */
export function inSentence(context: string): string {
  const [first, second] = context;
  if (!first || !second) return context;
  return first === first.toUpperCase() && second === second.toLowerCase() && second !== second.toUpperCase()
    ? first.toLowerCase() + context.slice(1)
    : context;
}

/** "20 s", "2 min" — short, because it sits in a sentence and on a button. */
export function formatWait(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < 60) return `${whole} s`;
  return `${Math.ceil(whole / 60)} min`;
}

/** The 429 sentence for the time still to wait. */
export function waitSentence(seconds: number): string {
  return seconds > 0 ? `Try again in ${formatWait(seconds)}.` : 'You can try again now.';
}

/** Statuses where the same request may work if sent again. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** The permission key named in the API's own 403 detail ("permission rules.rule.read is required"), if any. */
export function permissionKeyFrom(problem: Problem): string | undefined {
  const match = /\bpermission ([a-z][a-z0-9_.-]*[a-z0-9]) is required\b/i.exec(problem.detail ?? '');
  return match?.[1];
}

/**
 * The copy and the next step for a problem. Every status gets an honest
 * answer; an unknown one is "Something went wrong" with a retry, never a
 * blank.
 */
export function describeProblem(problem: Problem, { context, permissionLabel }: DescribeProblemOptions = {}): ProblemDescription {
  const { status, code } = problem;
  const couldNotLoad = context ? `Couldn't load ${inSentence(context)}` : undefined;

  if (status === 401) {
    return {
      kind: 'session',
      tone: 'neutral',
      icon: 'log-in',
      title: 'Your session ended',
      body: 'Sign in again to carry on where you left off.',
      remedy: 'signIn',
    };
  }
  if (status === 402) {
    return {
      kind: 'plan',
      tone: 'warning',
      icon: 'circle-alert',
      illustration: 'setup',
      title: 'Plan limit reached',
      body: "Your organisation has reached a limit of its plan, so this can't be done right now. An administrator can review usage.",
      remedy: 'none',
    };
  }
  if (status === 403 && code === 'tenant_suspended') {
    return {
      kind: 'suspended',
      tone: 'warning',
      icon: 'ban',
      illustration: 'forbidden',
      title: 'This workspace is suspended',
      body: "Nobody can use it until it's restored. Contact your provider to find out more.",
      remedy: 'none',
    };
  }
  if (status === 403) {
    return {
      kind: 'forbidden',
      tone: 'neutral',
      icon: 'lock',
      illustration: 'forbidden',
      title: context ? `You don't have access to ${context}` : "You don't have access",
      body: permissionLabel
        ? `This needs the ${permissionLabel} permission. Ask an administrator if you should have it.`
        : 'Ask an administrator if you think you should have access.',
      remedy: 'none',
    };
  }
  if (status === 404 || status === 410) {
    return {
      kind: 'notFound',
      tone: 'neutral',
      icon: 'search',
      illustration: 'search',
      title: context ? `Couldn't find ${inSentence(context)}` : "We couldn't find that",
      body: 'It may have been moved or deleted, or the link may be out of date.',
      remedy: 'none',
    };
  }
  if (status === 409 || status === 412 || status === 428) {
    return {
      kind: 'conflict',
      tone: 'warning',
      icon: 'history',
      illustration: 'error',
      title: 'Someone else changed this',
      body: 'Reload to see the latest version, then try again.',
      remedy: 'reload',
    };
  }
  if (status === 422 || status === 400) {
    const count = Object.keys(problem.fieldErrors ?? {}).length;
    return {
      kind: 'invalid',
      tone: 'warning',
      icon: 'triangle-alert',
      illustration: 'error',
      title: 'Some details need another look',
      body:
        count === 1
          ? 'One answer needs changing before this can go through.'
          : count > 1
            ? `${count} answers need changing before this can go through.`
            : 'Check what was entered and try again.',
      remedy: 'none',
    };
  }
  if (status === 429) {
    return {
      kind: 'rateLimited',
      tone: 'warning',
      icon: 'hourglass',
      illustration: 'error',
      title: couldNotLoad ?? 'Too many requests',
      body: 'Too many requests were sent in a short time.',
      remedy: 'retry',
    };
  }
  if (status === 0 || status === 408 || status === 502 || status === 503 || status === 504) {
    return {
      kind: 'unavailable',
      tone: 'danger',
      icon: 'cloud-off',
      illustration: 'offline',
      title: couldNotLoad ?? "Can't reach the service",
      body: couldNotLoad ? "The service can't be reached right now. Try again in a moment." : 'Check your connection, or try again in a moment.',
      remedy: 'retry',
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      tone: 'danger',
      icon: 'circle-alert',
      illustration: 'error',
      title: couldNotLoad ?? 'Something went wrong',
      body: "It's not you — something went wrong on our side. Try again in a moment.",
      remedy: 'retry',
    };
  }
  return {
    kind: 'unknown',
    tone: 'danger',
    icon: 'circle-alert',
    illustration: 'error',
    title: couldNotLoad ?? 'Something went wrong',
    body: 'Try again in a moment.',
    remedy: 'retry',
  };
}
