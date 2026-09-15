/**
 * The article lifecycle (docs/architecture/05 §8).
 *
 * The same shape as every other versioned definition in the platform — rules,
 * forms, SLA policies, approval policies — for the same reason: an author works
 * on a draft without touching what readers see, publication freezes a version,
 * and a rollback is a *forward* publish of an earlier version's content rather
 * than a mutation of history. Nothing that was ever published is edited or
 * deleted, so a reader can always be told what they saw.
 */

export const ARTICLE_STATUSES = ['draft', 'in_review', 'published', 'retired'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Which transitions exist, and what each one is called to a person. */
const TRANSITIONS: Record<ArticleStatus, Partial<Record<ArticleStatus, string>>> = {
  draft: {
    in_review: 'submit for review',
    published: 'publish',
    retired: 'abandon',
  },
  in_review: {
    draft: 'send back for changes',
    published: 'approve and publish',
    retired: 'reject',
  },
  published: {
    // A published article is edited by starting a new draft version; the
    // article itself stays published, so readers keep the version they had.
    retired: 'retire',
  },
  retired: {
    draft: 'bring back as a draft',
  },
};

export function canTransition(from: string, to: string): boolean {
  return Boolean(TRANSITIONS[from as ArticleStatus]?.[to as ArticleStatus]);
}

export function transitionsFrom(from: string): { to: ArticleStatus; label: string }[] {
  return Object.entries(TRANSITIONS[from as ArticleStatus] ?? {}).map(([to, label]) => ({
    to: to as ArticleStatus,
    label: label as string,
  }));
}

/**
 * Why a transition is refused, in words an author can act on.
 *
 * Returning the reason rather than a boolean because "you cannot do that" is
 * the least useful message a content tool can give somebody who has just
 * written something.
 */
export function refusalReason(from: string, to: string): string | null {
  if (canTransition(from, to)) return null;
  if (from === to) return `this article is already ${from.replace('_', ' ')}`;
  if (from === 'published' && to === 'draft') {
    return 'a published article stays published while you work: start a new draft version instead, and publish it when it is ready';
  }
  if (from === 'retired' && to === 'published') {
    return 'bring the article back as a draft first, so somebody reads it before it is live again';
  }
  const available = transitionsFrom(from).map((t) => t.label);
  return available.length > 0
    ? `an article that is ${from.replace('_', ' ')} can only be: ${available.join(', ')}`
    : `an article that is ${from.replace('_', ' ')} cannot be changed`;
}
