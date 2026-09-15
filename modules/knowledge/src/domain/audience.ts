import type { DocumentAcl } from '@itsm/module-search';

/**
 * Who may read an article.
 *
 * This is access control, not presentation — the same reasoning as catalogue
 * entitlement. An internal runbook that says which admin account unlocks a
 * door must not appear in a requester's portal search, and "we do not render it
 * on that page" is not a control: search is a different page, the API is a
 * different client, and a knowledge article is exactly the kind of record whose
 * *title alone* can be sensitive.
 *
 * So audience is turned into the search document's ACL, which is applied before
 * ranking, and is checked again on read. Filtering the list alone would be a
 * client-side control.
 */

export const AUDIENCES = ['internal', 'tenant', 'organisation'] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}

export interface ArticleVisibility {
  audience: string;
  orgId: string | null;
  status: string;
  ownerId: string | null;
  authorId: string | null;
}

/**
 * The search ACL for an article.
 *
 * Only a published article is indexed for readers at all; a draft is visible to
 * the people working on it, which the `userIds` list carries. `tenantWide` is
 * the flag the search backends read as "anyone signed in may see this", so it
 * is true only for the `tenant` audience.
 *
 * `internal` is expressed as tenantWide: false with no org, which means a
 * reader reaches it only through the `any` scope — the scope agents have and
 * requesters do not. That is the one line that keeps internal articles off the
 * portal, so it has a test of its own.
 */
export function aclForArticle(article: ArticleVisibility): DocumentAcl {
  const editors = [article.ownerId, article.authorId].filter((id): id is string => Boolean(id));

  if (article.status !== 'published') {
    return { userIds: editors, teamIds: [], orgId: null, tenantWide: false };
  }

  switch (article.audience) {
    case 'tenant':
      return { userIds: editors, teamIds: [], orgId: null, tenantWide: true };
    case 'organisation':
      return { userIds: editors, teamIds: [], orgId: article.orgId, tenantWide: false };
    case 'internal':
    default:
      // Not tenant-wide and belonging to no organisation: only a caller with
      // tenant-wide read reaches it.
      return { userIds: editors, teamIds: [], orgId: null, tenantWide: false };
  }
}

/**
 * Whether this person may read this article, checked on the read path.
 *
 * The search ACL and this function answer the same question in two places on
 * purpose: search decides what is *listed*, and this decides what is *served*.
 * A reader who guesses an article key must be refused by the second even if the
 * first never showed it to them.
 */
export function canRead(
  article: ArticleVisibility,
  reader: { userId: string | null; organisationIds: string[]; scope: 'own' | 'team' | 'any' },
): boolean {
  // Whoever is writing it can always read it, published or not.
  if (reader.userId && (article.ownerId === reader.userId || article.authorId === reader.userId)) return true;

  // An unpublished article is not a document yet, whatever its audience says.
  if (article.status !== 'published') return reader.scope === 'any';

  switch (article.audience) {
    case 'tenant':
      return true;
    case 'organisation':
      return reader.scope === 'any' || (article.orgId !== null && reader.organisationIds.includes(article.orgId));
    case 'internal':
      return reader.scope === 'any';
    default:
      // An audience nobody recognises is treated as the most restrictive one.
      // A new audience added without updating this function should hide
      // articles, not reveal them.
      return reader.scope === 'any';
  }
}
