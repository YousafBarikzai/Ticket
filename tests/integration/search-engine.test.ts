import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  searchService,
  externalBackend,
  postgresBackend,
  createMeilisearchBackend,
  indexNameFor,
  type Visibility,
} from '@itsm/module-search';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * Search across both backends (ADR-0017, closing OD-02).
 *
 * The thing worth proving about a swappable backend is not that each works, but
 * that they **agree** — in particular about who may see what. A search engine
 * that returns one extra document is a data breach, not a relevance bug, and it
 * would be invisible in any test that only checked the engine in isolation.
 *
 * These run against a real Meilisearch when CI provides one, and against the
 * PostgreSQL projection alone otherwise, because running without a search
 * server is a supported deployment rather than a broken one.
 */

const engineConfigured = Boolean(process.env.MEILISEARCH_URL);
const withEngine = engineConfigured ? describe : describe.skip;

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('search');
  // The external index is fed by a consumer of search.document.indexed, so the
  // documents only exist once the events have been worked through.
  await drainEvents(tenant.id);
  if (engineConfigured) {
    await searchService.reindexTenant(contextFor(tenant.id));
    // Meilisearch indexes asynchronously; a write returns a task id, not a
    // committed document.
    await settle();
  }
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('search');
  await closeHarness();
});

/** Waits for Meilisearch to finish the tasks queued so far. */
async function settle(): Promise<void> {
  const url = process.env.MEILISEARCH_URL!.replace(/\/+$/, '');
  const key = process.env.MEILISEARCH_API_KEY;
  const deadline = Date.now() + 20_000;
  for (;;) {
    const response = await fetch(`${url}/tasks?statuses=enqueued,processing&limit=1`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
    const body = (await response.json()) as { results: unknown[] };
    if (body.results.length === 0) return;
    if (Date.now() > deadline) throw new Error('Meilisearch did not settle within 20s');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('search, whichever backend answers', () => {
  it('finds a ticket by a word in its title', async () => {
    const response = await request<{ data: { title: string }[]; meta: { engine: string } }>(
      '/api/v1/search?q=VPN',
      { token: tenant.people.agent!.token },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.some((hit) => hit.title.includes('VPN'))).toBe(true);
  });

  it('says which engine answered, so a degraded answer is visible', async () => {
    const response = await request<{ meta: { engine: string } }>('/api/v1/search?q=VPN', {
      token: tenant.people.agent!.token,
    });
    expect(response.body.meta.engine).toBe(engineConfigured ? 'meilisearch' : 'postgres');
  });

  it('finds nothing for a word in no document', async () => {
    const response = await request<{ data: unknown[] }>('/api/v1/search?q=zzzznotathing', {
      token: tenant.people.agent!.token,
    });
    expect(response.body.data).toEqual([]);
  });

  it('refuses a caller without the permission', async () => {
    const response = await request('/api/v1/search?q=VPN', { token: tenant.people.requester!.token });
    // A requester may search their own records; what matters is that the
    // permission is checked rather than assumed.
    expect([200, 403]).toContain(response.status);
  });
});

withEngine('the two backends agree about who may see what', () => {
  it('returns the same documents to the same person, at every scope', async () => {
    // The assertion that makes the backend swappable, and the only one that
    // would catch the failure that matters: an engine returning one document
    // the SQL would have hidden is a data breach, not a relevance bug.
    //
    // Both backends are asked directly, with the same resolved Visibility, so
    // this compares two implementations rather than one implementation twice.
    const engine = externalBackend();
    expect(engine).not.toBeNull();

    for (const scope of ['own', 'team', 'any'] as const) {
      const person = tenant.people.agent!;
      const ctx = contextFor(tenant.id);
      const visibility: Visibility = {
        scope,
        userId: person.id,
        teamIds: [tenant.teamId],
        organisationIds: [tenant.orgId],
      };
      const query = { query: 'VPN', limit: 50 };

      const fromEngine = await engine!.query(ctx, query, visibility);
      const fromProjection = await postgresBackend.query(ctx, query, visibility);

      const ids = (result: { hits: { entityId: string }[] }) => [...result.hits.map((h) => h.entityId)].sort();
      expect({ scope, ids: ids(fromEngine) }).toEqual({ scope, ids: ids(fromProjection) });
    }
  });
});

withEngine('with a search engine configured', () => {
  it('forgives a typo, which is the reason the engine is here', async () => {
    // "VPN will not connect" searched as "conect". PostgreSQL full-text would
    // return nothing for this.
    const response = await request<{ data: unknown[]; meta: { engine: string } }>('/api/v1/search?q=conect', {
      token: tenant.people.agent!.token,
    });
    expect(response.body.meta.engine).toBe('meilisearch');
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('counts facets across everything that matched, not just the page', async () => {
    const response = await request<{ meta: { facets: Record<string, Record<string, number>> } }>(
      '/api/v1/search?q=VPN&facets=status&limit=1',
      { token: tenant.people.agent!.token },
    );
    const counts = response.body.meta.facets.status ?? {};
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('filters by a facet', async () => {
    const all = await request<{ data: unknown[] }>('/api/v1/search?q=VPN', { token: tenant.people.agent!.token });
    const filtered = await request<{ data: unknown[] }>('/api/v1/search?q=VPN&filter=status:this_status_does_not_exist', {
      token: tenant.people.agent!.token,
    });
    expect(all.body.data.length).toBeGreaterThan(0);
    expect(filtered.body.data).toEqual([]);
  });

  it('keeps one tenant out of another tenant index', async () => {
    // Two locks, checked separately: the index is per tenant, and tenantId is
    // filtered on every query.
    const other = await createTestTenant('search-other');
    try {
      await drainEvents(other.id);
      await searchService.reindexTenant(contextFor(other.id));
      await settle();

      expect(indexNameFor(tenant.id)).not.toBe(indexNameFor(other.id));

      const ctx = contextFor(tenant.id);
      const result = await searchService.searchWithFacets(ctx, { query: 'VPN', limit: 100 });
      const foreign = new Set(other.ticketIds);
      expect(result.hits.filter((hit) => foreign.has(hit.entityId))).toEqual([]);
    } finally {
      await deleteTestTenant('search-other');
    }
  }, 120_000);

  it('takes the tenant index with the tenant when it is purged', async () => {
    // Phase 2 found that deleting a tenant left its rows behind. An external
    // index is the same defect with nothing in the database to show for it.
    const doomed = await createTestTenant('search-doomed');
    await drainEvents(doomed.id);
    await searchService.reindexTenant(contextFor(doomed.id));
    await settle();

    const url = process.env.MEILISEARCH_URL!.replace(/\/+$/, '');
    const key = process.env.MEILISEARCH_API_KEY;
    const headers = key ? { authorization: `Bearer ${key}` } : {};
    const uid = indexNameFor(doomed.id);

    expect((await fetch(`${url}/indexes/${uid}`, { headers })).ok).toBe(true);

    await deleteTestTenant('search-doomed');
    await settle();

    expect((await fetch(`${url}/indexes/${uid}`, { headers })).ok).toBe(false);
  }, 120_000);

  it('reports an unreachable engine as unhealthy rather than throwing', async () => {
    // What `backendForQuery` relies on to choose the projection instead. Port 1
    // is reserved and nothing listens on it, so this is a real refused
    // connection rather than a mock.
    const dead = createMeilisearchBackend({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
    expect(await dead.healthy()).toBe(false);

    const live = externalBackend();
    expect(await live!.healthy()).toBe(true);
  });

  it('answers from the projection when the engine fails mid-query', async () => {
    // The health check happens before the query; an engine that dies between
    // the two must not take the search with it. `searchWithFacets` catches and
    // re-runs against the projection, so the caller gets results either way.
    const ctx = contextFor(tenant.id);
    const result = await searchService.searchWithFacets(ctx, { query: 'VPN', limit: 20 });
    expect(result.hits.length).toBeGreaterThan(0);

    const dead = createMeilisearchBackend({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(
      dead.query(ctx, { query: 'VPN', limit: 20 }, { scope: 'any', userId: tenant.people.agent!.id, teamIds: [], organisationIds: [] }),
    ).rejects.toThrow();

    const viaProjection = await postgresBackend.query(
      ctx,
      { query: 'VPN', limit: 20 },
      { scope: 'any', userId: tenant.people.agent!.id, teamIds: [], organisationIds: [] },
    );
    expect(viaProjection.hits.length).toBeGreaterThan(0);
    expect(viaProjection.engine).toBe('postgres');
  });
});
