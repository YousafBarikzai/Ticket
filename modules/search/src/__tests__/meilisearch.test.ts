import { describe, expect, it } from 'vitest';
import { buildFilter, indexNameFor } from '../backend/meilisearch.js';
import { documentKey } from '../backend/types.js';
import type { SearchQuery, Visibility } from '../backend/types.js';

/**
 * The filter expression is where a permission bug in an external engine would
 * live: everything else is transport. These tests read it as a reviewer would
 * — does every query name the tenant, and can a person reach a document the
 * SQL backend would have hidden?
 */

const visibility = (over: Partial<Visibility> = {}): Visibility => ({
  scope: 'own',
  userId: 'user-1',
  teamIds: ['team-a', 'team-b'],
  organisationIds: ['org-1'],
  ...over,
});

const query = (over: Partial<SearchQuery> = {}): SearchQuery => ({ query: 'vpn', limit: 20, ...over });

describe('the Meilisearch filter', () => {
  it('names the tenant on every query, even one that filters nothing else', () => {
    // The index is already per-tenant. This is the second lock: the index name
    // is a string, and strings can be built wrongly.
    expect(buildFilter('t-1', query(), visibility({ scope: 'any' }))).toBe('tenantId = "t-1"');
  });

  it('lets somebody with tenant-wide scope see tenant-wide documents', () => {
    const filter = buildFilter('t-1', query(), visibility({ scope: 'team' }));
    expect(filter).toContain('aclTenantWide = true');
    expect(filter).toContain('aclUserIds = "user-1"');
  });

  it('does not let own-scope reach tenant-wide documents', () => {
    // The difference between an agent and a requester, expressed as a filter.
    const filter = buildFilter('t-1', query(), visibility({ scope: 'own' }));
    expect(filter).not.toContain('aclTenantWide');
    expect(filter).toContain('aclUserIds = "user-1"');
    expect(filter).toContain('aclTeamIds = "team-a"');
    expect(filter).toContain('aclOrgId = "org-1"');
  });

  it('drops the permission clause only for unrestricted scope', () => {
    expect(buildFilter('t-1', query(), visibility({ scope: 'any' }))).not.toContain('aclUserIds');
  });

  it('reads several values for one facet as any-of and several facets as all-of', () => {
    const filter = buildFilter(
      't-1',
      query({ filters: { status: ['open', 'in_progress'], priority: ['P1'] } }),
      visibility({ scope: 'any' }),
    );
    expect(filter).toContain('(facetValues = "status:open" OR facetValues = "status:in_progress")');
    expect(filter).toContain('(facetValues = "priority:P1")');
    expect(filter.split(' AND ')).toHaveLength(3);
  });

  it('escapes a quote rather than letting it end the value', () => {
    // A team name or an organisation code is tenant data, so it reaches the
    // filter expression. Without escaping, a quote would close the string and
    // the rest would be read as filter syntax.
    const filter = buildFilter('t-1', query(), visibility({ scope: 'own', teamIds: ['a" OR aclTenantWide = true OR "'] }));
    expect(filter).toContain('\\"');
    expect(filter).not.toContain('" OR aclTenantWide = true OR "');
  });

  it('ignores an empty filter list rather than producing an empty clause', () => {
    expect(buildFilter('t-1', query({ filters: { status: [] } }), visibility({ scope: 'any' }))).toBe('tenantId = "t-1"');
  });
});

describe('naming', () => {
  it('makes an index name Meilisearch accepts', () => {
    // Hyphens are not allowed in an index uid, and a tenant id is a UUID.
    const name = indexNameFor('0199f0c2-1e8e-7a1b-9f00-2f3c4d5e6f70');
    expect(name).toBe('itsm_0199f0c21e8e7a1b9f002f3c4d5e6f70');
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('gives a document an id that includes its tenant', () => {
    // Two tenants hold tickets with the same id in a restore-from-backup case;
    // the document id must still differ.
    const a = documentKey('tenant-a', 'ticket', 'abc');
    const b = documentKey('tenant-b', 'ticket', 'abc');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
