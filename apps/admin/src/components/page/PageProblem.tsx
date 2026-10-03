import type { ReactNode } from 'react';
import {
  DEMO_PROBLEM_CODES,
  demoDisabledSentence,
  demoLimitSentence,
  signInAgainHref,
} from '@itsm/contracts/demo';
import { ProblemState, type ActionSpec, type Problem } from '@itsm/ui';

/** What a demo problem's body may carry beyond `Problem`: the feature (403) or the cap (429) it names. */
export interface DemoProblemFacts {
  /** `demo_disabled`: the feature turned off (`problem.feature` in the API's answer). */
  readonly feature?: string | null;
  /** `demo_limit`: the cap reached (`problem.category`). */
  readonly category?: string | null;
  /** `demo_limit` with category `writes`: the deployment's per-visit budget. */
  readonly limit?: number;
}

const DISABLED = /^This is a shared demo, so [^.]+ is turned off\. Everything else works as in the full product\.$/;
const LIMIT = /^To keep this shared demo tidy for everyone, each visit can [^.]+\. You've reached that limit\.$/;

/**
 * A3's sentence for a shared-demo refusal (A7 §2.6, §2.8), or `null` for any
 * other problem: `demoDisabledSentence(feature)` for a 403 `demo_disabled`,
 * `demoLimitSentence(category)` for a 429 `demo_limit`. For a toast as much as
 * for a page: a capped write says the same words in either.
 *
 * The facts win over the API's `detail`, and the `detail` over the general
 * sentence — but only a detail in the contract's own shape, so an older or
 * stranger answer can never put other words on the page.
 */
export function demoProblemSentence(problem: Problem, facts: DemoProblemFacts = {}): string | null {
  if (problem.code === DEMO_PROBLEM_CODES.disabled) {
    if (facts.feature) return demoDisabledSentence(facts.feature);
    return problem.detail && DISABLED.test(problem.detail) ? problem.detail : demoDisabledSentence(null);
  }
  if (problem.code === DEMO_PROBLEM_CODES.limit) {
    if (facts.category) return demoLimitSentence(facts.category, facts.limit === undefined ? {} : { limit: facts.limit });
    return problem.detail && LIMIT.test(problem.detail) ? problem.detail : demoLimitSentence(null);
  }
  return null;
}

export interface PageProblemProps extends DemoProblemFacts {
  readonly problem: Problem;
  /** The page's own path (`currentPath()`), where "Sign in again" or "Continue the demo" comes back to. */
  readonly path: string;
  /** A shared-demo session: the way back after a 401 reopens the demo rather than an identity provider (D22). */
  readonly demo?: boolean;
  /** What failed to load: "Failed deliveries". */
  readonly context?: string;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly headingLevel?: 1 | 2 | 3 | 4;
  readonly secondaryAction?: ActionSpec | ReactNode;
  readonly className?: string;
}

/**
 * A page's or a section's failure, worded by `ProblemState`, with the two
 * things a server page knows and `ProblemState` cannot:
 *
 * - **where "Sign in again" goes.** `signInAgainHref(path, { demo })`, so a
 *   demo visitor whose session ended is offered "Continue the demo" back to
 *   this page, never a sign-in they have no account for (D22; WP-42a open
 *   issue 6). Without it the page would reload and the frame would decide;
 * - **the demo's own sentences.** A capped write or a turned-off feature
 *   reads A3's sentence for its feature or cap (`demoProblemSentence`).
 *
 * No hooks and no server-only imports, so a server page and a client view can
 * both render it.
 */
export function PageProblem({ problem, path, demo = false, feature, category, limit, context, size, headingLevel, secondaryAction, className }: PageProblemProps): ReactNode {
  const sentence = demoProblemSentence(problem, { ...(feature ? { feature } : {}), ...(category ? { category } : {}), ...(limit === undefined ? {} : { limit }) });
  return (
    <ProblemState
      problem={sentence ? { ...problem, detail: sentence } : problem}
      signInHref={signInAgainHref(path, { demo })}
      {...(context ? { context } : {})}
      {...(size ? { size } : {})}
      {...(headingLevel ? { headingLevel } : {})}
      {...(secondaryAction ? { secondaryAction } : {})}
      {...(className ? { className } : {})}
    />
  );
}
