import { describe, expect, it } from 'vitest';
import { aclForArticle, canRead, type ArticleVisibility } from '../domain/audience.js';

/**
 * Audience is access control, so these read as access-control tests: what can
 * the wrong person reach? The interesting failures are all in one direction —
 * an internal runbook appearing on a requester's portal — so most of these
 * assert a refusal.
 */

const article = (over: Partial<ArticleVisibility> = {}): ArticleVisibility => ({
  audience: 'internal',
  orgId: null,
  status: 'published',
  ownerId: 'owner-1',
  authorId: 'author-1',
  ...over,
});

const reader = (over: Partial<Parameters<typeof canRead>[1]> = {}) => ({
  userId: 'reader-1',
  organisationIds: ['org-1'],
  scope: 'own' as const,
  ...over,
});

describe('the search ACL', () => {
  it('marks a tenant-audience article as visible to anyone signed in', () => {
    expect(aclForArticle(article({ audience: 'tenant' })).tenantWide).toBe(true);
  });

  it('does not mark an internal article tenant-wide', () => {
    // The one line that keeps internal runbooks off the portal. Every search
    // backend reads tenantWide as "anyone signed in may see this".
    expect(aclForArticle(article({ audience: 'internal' })).tenantWide).toBe(false);
    expect(aclForArticle(article({ audience: 'internal' })).orgId).toBeNull();
  });

  it('scopes an organisation article to its organisation and no wider', () => {
    const acl = aclForArticle(article({ audience: 'organisation', orgId: 'org-9' }));
    expect(acl.tenantWide).toBe(false);
    expect(acl.orgId).toBe('org-9');
  });

  it('shows an unpublished article to nobody but the people writing it', () => {
    const acl = aclForArticle(article({ status: 'draft', audience: 'tenant' }));
    expect(acl.tenantWide).toBe(false);
    expect(acl.userIds).toEqual(['owner-1', 'author-1']);
  });
});

describe('reading an article directly', () => {
  it('refuses a requester an internal article even if they know its key', () => {
    // Search decides what is listed; this decides what is served. Somebody who
    // guesses a key must be refused by the second.
    expect(canRead(article({ audience: 'internal' }), reader({ scope: 'own' }))).toBe(false);
    expect(canRead(article({ audience: 'internal' }), reader({ scope: 'team' }))).toBe(false);
  });

  it('lets an agent read an internal article', () => {
    expect(canRead(article({ audience: 'internal' }), reader({ scope: 'any' }))).toBe(true);
  });

  it('lets anyone signed in read a tenant-audience article', () => {
    expect(canRead(article({ audience: 'tenant' }), reader({ scope: 'own' }))).toBe(true);
  });

  it('lets an organisation article be read inside that organisation only', () => {
    const inOrg = reader({ organisationIds: ['org-9'] });
    const elsewhere = reader({ organisationIds: ['org-1'] });
    expect(canRead(article({ audience: 'organisation', orgId: 'org-9' }), inOrg)).toBe(true);
    expect(canRead(article({ audience: 'organisation', orgId: 'org-9' }), elsewhere)).toBe(false);
  });

  it('lets the author read their own draft, and nobody else', () => {
    const draft = article({ status: 'draft', audience: 'tenant' });
    expect(canRead(draft, reader({ userId: 'author-1' }))).toBe(true);
    expect(canRead(draft, reader({ userId: 'owner-1' }))).toBe(true);
    expect(canRead(draft, reader({ userId: 'somebody-else' }))).toBe(false);
  });

  it('hides a retired article from a reader', () => {
    // Retired instructions that are still readable are worse than missing ones.
    expect(canRead(article({ status: 'retired', audience: 'tenant' }), reader())).toBe(false);
  });

  it('treats an audience it does not recognise as the most restrictive one', () => {
    // A new audience added without updating this function must hide articles,
    // not reveal them.
    expect(canRead(article({ audience: 'everyone-on-the-internet' }), reader({ scope: 'own' }))).toBe(false);
    expect(aclForArticle(article({ audience: 'everyone-on-the-internet' })).tenantWide).toBe(false);
  });
});

describe('what search is told', () => {
  it('marks a whole-tenant article as visible to everyone signed in', () => {
    // Caught by the integration suite: `tenantWide` alone reaches only a caller
    // whose search scope is team or wider, because every ticket is tenantWide
    // and that is what keeps one requester's ticket out of another's results.
    // An article for the whole tenant is meant for requesters, so without a
    // separate flag self-service knowledge was invisible to the people it
    // exists for.
    const acl = aclForArticle(article({ audience: 'tenant' }));
    expect(acl.everyone).toBe(true);
  });

  it('never marks an internal or organisation article as visible to everyone', () => {
    expect(aclForArticle(article({ audience: 'internal' })).everyone).toBe(false);
    expect(aclForArticle(article({ audience: 'organisation', orgId: 'org-9' })).everyone).toBe(false);
    expect(aclForArticle(article({ status: 'draft', audience: 'tenant' })).everyone).toBe(false);
  });
});
