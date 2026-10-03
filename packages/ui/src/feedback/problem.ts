import type { DemoProblemCode } from '@itsm/contracts/demo';
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
 * product's, keyed on the status and, where the status alone cannot say
 * what happened, on the problem's `code` (the last segment of its `type`):
 * `tenant_suspended`, `query_timeout` and the shared demo's own four.
 *
 * The demo's codes are checked before the status, because each shares a
 * status with something it is not (SPEC §4.4, §7.0.4): a `demo_limit` is a
 * 429 that waiting will not cure, a `demo_disabled` is a 403 that no
 * administrator can grant, and a `demo_session_ended` is a 401 whose way back
 * is the demo, not an identity provider the visitor has no account with.
 * Their words are `@itsm/contracts/demo`'s — the copy register's — so a
 * toast, a card and the `/demo` page say the same thing.
 *
 * That module is imported for its types only. Its tables (personas, caps,
 * Redis keys) are frozen at the top level, which no minifier drops, and a
 * value import here put about 4 kB (gzip) into every client bundle that words
 * a problem — every page of the Help Portal. So the few fixed strings are
 * written here and pinned to the contract word for word by
 * `problem-state.test.tsx`, and the two sentences that name a feature or a
 * cap are the API's own `detail`, which the API builds with that contract's
 * `demoDisabledSentence` and `demoLimitSentence`: it is shown only when it
 * has exactly that sentence's shape, so developer prose never reaches the
 * page.
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
  | 'timeout'
  | 'server'
  | 'demoDisabled'
  | 'demoLimit'
  | 'demoUnavailable'
  | 'demoSessionEnded'
  | 'unknown';

/**
 * What the primary action of a problem is. A demo session that ended is
 * `signIn` too — its way back is the sign-in route marked as the demo's
 * (`signInAgainHref(path, { demo: true })`), which reopens the demo — with
 * the words in `remedyLabel`.
 */
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
  /**
   * The remedy's words, when they are not the remedy's usual ones: "Continue
   * the demo" for a demo session that ended, where `signIn` would otherwise
   * read "Sign in again".
   */
  readonly remedyLabel?: string;
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

/* ------------------------------------------------------------ The shared demo */

/** The demo's problem codes (`DEMO_PROBLEM_CODES`); `satisfies` fails the build if the contract renames one. */
const DEMO_CODE = {
  reset: 'demo_reset',
  sessionEnded: 'demo_session_ended',
  unavailable: 'demo_unavailable',
  disabled: 'demo_disabled',
  limit: 'demo_limit',
} as const satisfies Record<string, DemoProblemCode>;

/**
 * The demo's fixed words, each equal to the contract's (`DEMO_COPY`,
 * `demoDisabledSentence(null)`, `demoLimitSentence(null)`) and to the
 * `/demo` page's `ended` row (SPEC §4.6.2); the test pins every one.
 */
export const DEMO_PROBLEM_COPY = Object.freeze({
  sessionEnded: 'Your demo session ended',
  sessionEndedBody: 'Pick up where you left off — the demo data may have been reset since.',
  continueDemo: 'Continue the demo',
  /** `DEMO_COPY.unavailable`, two sentences: the first is the heading (no full stop), the second the body. */
  unavailable: 'The demo is paused or being prepared',
  unavailableBody: 'It will be back in a few minutes.',
  disabled: 'Not available in the demo',
  /** For a feature this build cannot name — a converter that dropped `detail`, or a newer API. */
  disabledBody: 'This is a shared demo, so this action is turned off. Everything else works as in the full product.',
  limit: 'Demo limit reached',
  /** For a cap this build cannot name. */
  limitBody: "To keep this shared demo tidy for everyone, each visit can only make a few changes like this. You've reached that limit.",
});

/** `demoDisabledSentence(feature)` for any feature: the phrase has no full stop of its own. */
const DISABLED_SENTENCE = /^This is a shared demo, so [^.]+ is turned off\. Everything else works as in the full product\.$/;
/** `demoLimitSentence(category, { limit })` for any cap or budget. */
const LIMIT_SENTENCE = /^To keep this shared demo tidy for everyone, each visit can [^.]+\. You've reached that limit\.$/;

/** The API's `detail` when it is the contract's sentence for this problem, else the general one. */
function canonicalDetail(detail: string | undefined, shape: RegExp, otherwise: string): string {
  return typeof detail === 'string' && detail.length <= 300 && shape.test(detail) ? detail : otherwise;
}

/**
 * The shared demo's own problems, or `null` for any other. `demo_reset`
 * normally never reaches a page — the BFF re-mints and resends once — so one
 * that does is a re-mint that failed, which is a visit that ended.
 */
function describeDemoProblem(problem: Problem): ProblemDescription | null {
  switch (problem.code) {
    case DEMO_CODE.disabled:
      return {
        kind: 'demoDisabled',
        tone: 'neutral',
        icon: 'lock',
        illustration: 'forbidden',
        title: DEMO_PROBLEM_COPY.disabled,
        body: canonicalDetail(problem.detail, DISABLED_SENTENCE, DEMO_PROBLEM_COPY.disabledBody),
        // No administrator can grant it: the demo turns it off for everyone.
        remedy: 'none',
      };
    case DEMO_CODE.limit:
      return {
        kind: 'demoLimit',
        tone: 'neutral',
        icon: 'ban',
        illustration: 'forbidden',
        title: DEMO_PROBLEM_COPY.limit,
        body: canonicalDetail(problem.detail, LIMIT_SENTENCE, DEMO_PROBLEM_COPY.limitBody),
        // No Retry-After and no retry: waiting does not help; a new visit or the nightly reset does.
        remedy: 'none',
      };
    case DEMO_CODE.unavailable:
      return {
        kind: 'demoUnavailable',
        tone: 'neutral',
        icon: 'hourglass',
        illustration: 'setup',
        title: DEMO_PROBLEM_COPY.unavailable,
        body: DEMO_PROBLEM_COPY.unavailableBody,
        remedy: 'retry',
      };
    case DEMO_CODE.sessionEnded:
    case DEMO_CODE.reset:
      return {
        kind: 'demoSessionEnded',
        tone: 'neutral',
        icon: 'log-in',
        title: DEMO_PROBLEM_COPY.sessionEnded,
        body: DEMO_PROBLEM_COPY.sessionEndedBody,
        remedy: 'signIn',
        remedyLabel: DEMO_PROBLEM_COPY.continueDemo,
      };
    default:
      return null;
  }
}

/**
 * The copy and the next step for a problem. Every status gets an honest
 * answer; an unknown one is "Something went wrong" with a retry, never a
 * blank.
 */
export function describeProblem(problem: Problem, { context, permissionLabel }: DescribeProblemOptions = {}): ProblemDescription {
  const { status, code } = problem;
  const couldNotLoad = context ? `Couldn't load ${inSentence(context)}` : undefined;

  const demo = describeDemoProblem(problem);
  if (demo) return demo;

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
  if (code === 'query_timeout') {
    // The database stopped a query that ran too long (a shared demo's five
    // seconds, Y-M2). Nothing is down: a narrower question, or the same one
    // a moment later, can succeed.
    return {
      kind: 'timeout',
      tone: 'warning',
      icon: 'hourglass',
      illustration: 'error',
      title: couldNotLoad ?? 'That took too long',
      body: couldNotLoad ? 'That took too long. Try a narrower range, or try again in a moment.' : 'Try a narrower range, or try again in a moment.',
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
