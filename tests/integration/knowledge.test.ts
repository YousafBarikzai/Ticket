import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHarness,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * MOD-09 knowledge, end to end.
 *
 * The assertions worth the run are the ones that cross a boundary: an article
 * published through the API becoming findable through search with the right
 * audience, a rollback that adds history rather than rewriting it, and a
 * requester being refused an internal runbook whose key they know.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('knowledge');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('knowledge');
  await closeHarness();
});

const admin = () => tenant.people.admin!.token;
const agent = () => tenant.people.agent!.token;
const requester = () => tenant.people.requester!.token;

async function createArticle(key: string, over: Record<string, unknown> = {}) {
  return request('/api/v1/knowledge', {
    method: 'POST',
    token: admin(),
    body: {
      key,
      title: 'How to reset your VPN certificate',
      summary: 'Two minutes, from the portal.',
      body: [{ kind: 'paragraph', runs: [{ text: 'Open the portal, choose Certificates, then Renew.' }] }],
      audience: 'tenant',
      ...over,
    },
  });
}

describe('a tenant starts with somewhere to put things', () => {
  it('seeds categories and no articles', async () => {
    // A seeded article is a lie in the search results: it looks like the
    // tenant's own knowledge and is not.
    const response = await request<{ data: unknown[] }>('/api/v1/knowledge', { token: admin() });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

describe('writing and publishing', () => {
  it('creates a draft that readers cannot see', async () => {
    expect((await createArticle('vpn-certificate')).status).toBe(201);

    const asRequester = await request<{ data: { key: string }[] }>('/api/v1/knowledge', { token: requester() });
    expect(asRequester.body.data.map((a) => a.key)).not.toContain('vpn-certificate');
  });

  it('refuses to send an empty article for review', async () => {
    await createArticle('empty-one', { body: [] });
    const response = await request<{ detail: string }>('/api/v1/knowledge/empty-one/submit', {
      method: 'POST',
      token: admin(),
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toMatch(/no content yet/);
  });

  it('publishes, and the article becomes findable with the right audience', async () => {
    const published = await request<{ version: number }>('/api/v1/knowledge/vpn-certificate/publish', {
      method: 'POST',
      token: admin(),
    });
    expect(published.status).toBe(200);
    expect(published.body.version).toBe(1);

    await drainEvents(tenant.id);

    const found = await request<{ data: { entityType: string; title: string }[] }>(
      '/api/v1/search?q=certificate&types=knowledge',
      { token: requester() },
    );
    expect(found.body.data.some((hit) => hit.title.includes('VPN certificate'))).toBe(true);
  });

  it('lets a requester read a tenant-audience article', async () => {
    const response = await request<{ title: string; version: number }>('/api/v1/knowledge/vpn-certificate', {
      token: requester(),
    });
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(1);
  });
});

describe('an internal article stays internal', () => {
  it('is not returned to a requester who knows its key', async () => {
    // The failure this guards against: a runbook naming the admin account that
    // unlocks a door, reachable because the portal only filtered the list.
    await createArticle('door-unlock-runbook', {
      audience: 'internal',
      title: 'Unlocking the server room door',
      body: [{ kind: 'paragraph', runs: [{ text: 'Use the break-glass account and log it.' }] }],
    });
    await request('/api/v1/knowledge/door-unlock-runbook/publish', { method: 'POST', token: admin() });
    await drainEvents(tenant.id);

    const direct = await request('/api/v1/knowledge/door-unlock-runbook', { token: requester() });
    // 404 rather than 403: "you may not read this" confirms it exists.
    expect(direct.status).toBe(404);

    const listed = await request<{ data: { key: string }[] }>('/api/v1/knowledge', { token: requester() });
    expect(listed.body.data.map((a) => a.key)).not.toContain('door-unlock-runbook');
  });

  it('is not returned to a requester by search either', async () => {
    const found = await request<{ data: { title: string }[] }>('/api/v1/search?q=break-glass', {
      token: requester(),
    });
    expect(found.body.data.some((hit) => hit.title.includes('server room'))).toBe(false);
  });

  it('is returned to an agent', async () => {
    const direct = await request<{ title: string }>('/api/v1/knowledge/door-unlock-runbook', { token: agent() });
    expect(direct.status).toBe(200);
    expect(direct.body.title).toBe('Unlocking the server room door');
  });
});

describe('versions', () => {
  it('keeps the published version in front of readers while a draft is edited', async () => {
    await request('/api/v1/knowledge/vpn-certificate', {
      method: 'PATCH',
      token: admin(),
      body: {
        title: 'How to reset your VPN certificate (new process)',
        body: [{ kind: 'paragraph', runs: [{ text: 'The process changed: raise a request instead.' }] }],
        changeNote: 'New process from October',
      },
    });

    const asReader = await request<{ title: string; version: number }>('/api/v1/knowledge/vpn-certificate', {
      token: requester(),
    });
    expect(asReader.body.version).toBe(1);
    expect(asReader.body.title).not.toMatch(/new process/);
  });

  it('shows the draft in the history, marked as not current', async () => {
    const history = await request<{ data: { version: number; status: string; isCurrent: boolean }[] }>(
      '/api/v1/knowledge/vpn-certificate/history',
      { token: admin() },
    );
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data.find((v) => v.version === 2)?.status).toBe('draft');
    expect(history.body.data.find((v) => v.version === 1)?.isCurrent).toBe(true);
  });

  it('publishes the second version, and readers move to it', async () => {
    await request('/api/v1/knowledge/vpn-certificate/publish', { method: 'POST', token: admin() });
    const asReader = await request<{ version: number; title: string }>('/api/v1/knowledge/vpn-certificate', {
      token: requester(),
    });
    expect(asReader.body.version).toBe(2);
    expect(asReader.body.title).toMatch(/new process/);
  });

  it('rolls back forward, so the history records that it happened', async () => {
    // Version 3 restoring version 1, rather than version 2 disappearing. A
    // silent reversion would hide that anybody ever rolled back.
    const response = await request<{ version: number; restoredFrom: number }>(
      '/api/v1/knowledge/vpn-certificate/rollback',
      { method: 'POST', token: admin(), body: { toVersion: 1 } },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ version: 3, restoredFrom: 1 });

    const history = await request<{ data: { version: number; changeNote: string | null }[] }>(
      '/api/v1/knowledge/vpn-certificate/history',
      { token: admin() },
    );
    expect(history.body.data.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(history.body.data[0]!.changeNote).toMatch(/Restored the content of version 1/);

    const asReader = await request<{ title: string }>('/api/v1/knowledge/vpn-certificate', { token: requester() });
    expect(asReader.body.title).not.toMatch(/new process/);
  });
});

describe('retiring', () => {
  it('takes the article out of search immediately', async () => {
    await createArticle('old-printer-process', {
      title: 'Requesting toner for the third-floor printer',
      body: [{ kind: 'paragraph', runs: [{ text: 'Email facilities. This printer was removed in 2024.' }] }],
    });
    await request('/api/v1/knowledge/old-printer-process/publish', { method: 'POST', token: admin() });
    await drainEvents(tenant.id);

    const before = await request<{ data: unknown[] }>('/api/v1/search?q=toner&types=knowledge', { token: agent() });
    expect(before.body.data.length).toBeGreaterThan(0);

    await request('/api/v1/knowledge/old-printer-process/retire', {
      method: 'POST',
      token: admin(),
      body: { reason: 'The printer was removed' },
    });
    await drainEvents(tenant.id);

    // Withdrawn instructions that are still findable are worse than missing
    // ones: a reader has no way to know they are withdrawn.
    const after = await request<{ data: unknown[] }>('/api/v1/search?q=toner&types=knowledge', { token: agent() });
    expect(after.body.data).toEqual([]);
  });

  it('keeps the history of what it said', async () => {
    const history = await request<{ data: unknown[] }>('/api/v1/knowledge/old-printer-process/history', {
      token: admin(),
    });
    expect(history.body.data.length).toBeGreaterThan(0);
  });
});

describe('feedback', () => {
  it('counts a vote once, however many times it is changed', async () => {
    const vote = (helpful: boolean) =>
      request('/api/v1/knowledge/vpn-certificate/feedback', {
        method: 'POST',
        token: requester(),
        body: { helpful },
      });

    await vote(true);
    await vote(true);
    await vote(false);

    const article = await request<{ helpfulCount: number; unhelpfulCount: number }>(
      '/api/v1/knowledge/vpn-certificate',
      { token: admin() },
    );
    expect(article.body.helpfulCount).toBe(0);
    expect(article.body.unhelpfulCount).toBe(1);
  });
});

describe('permissions', () => {
  it('lets an agent read but not publish', async () => {
    const read = await request('/api/v1/knowledge/vpn-certificate', { token: agent() });
    expect(read.status).toBe(200);

    const publish = await request('/api/v1/knowledge/vpn-certificate/publish', { method: 'POST', token: agent() });
    expect(publish.status).toBe(403);
  });

  it('refuses a requester the authoring routes entirely', async () => {
    const create = await request('/api/v1/knowledge', {
      method: 'POST',
      token: requester(),
      body: { key: 'sneaky', title: 'Mine now', body: [], audience: 'tenant' },
    });
    expect(create.status).toBe(403);
  });
});
