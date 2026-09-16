import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cache } from '@itsm/platform';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * "Sign out everywhere", end to end.
 *
 * Doc 08 §9 promises a person can see their sessions and end them. Until this
 * suite existed the platform broke that promise in three places at once, and
 * each break hid the next:
 *
 *   - nothing called `recordSession`, so `Session` rows were written only by a
 *     test and `GET /me/sessions` was permanently empty;
 *   - so `DELETE /me/sessions/:id` had nothing to address;
 *   - and had it, the revocation set `revoked_at` on a row that no request-time
 *     code path reads, while `sess:deny:<sid>` — the key the token verifier
 *     checks on every single request — was read by the verifier and written by
 *     nothing at all.
 *
 * Any one of those looks like a small omission. Together they are a security
 * control that does not exist. The tests walk that chain in order, so a
 * regression at any link names itself rather than showing up as an empty list.
 */

let tenant: TestTenant;

/** The `sid` the harness puts in a person's token. */
const sidOf = (userId: string): string => `test-${userId}`;

beforeAll(async () => {
  tenant = await createTestTenant('sessions');
}, 120_000);

afterAll(async () => {
  // The denylist outlives the tenant, because its keys are global by design
  // (a `sid` is unique across tenants, and the verifier reads the list before
  // it knows which tenant a token names). Purging a tenant does not touch
  // them, so they are cleaned up here or they leak into the next run.
  const redis = cache();
  for (const person of Object.values(tenant.people)) await redis.del(`sess:deny:${sidOf(person.id)}`);
  await deleteTestTenant('sessions');
  await closeHarness();
});

describe('recording a session', () => {
  it('starts with nothing, because holding a token is not having a session', async () => {
    const response = await request<{ data: unknown[] }>('/api/v1/me/sessions', { token: tenant.people.agent!.token });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('records what the token says', async () => {
    const created = await request<{ id: string; expiresAt: string }>('/api/v1/auth/session', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {},
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    // The token's own `exp`, because the denylist entry has to outlive the
    // token and nothing else knows when that is.
    expect(new Date(created.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const listed = await request<{ data: { id: string }[] }>('/api/v1/me/sessions', {
      token: tenant.people.agent!.token,
    });
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]!.id).toBe(created.body.id);
  });

  it('is idempotent, so an application may call it on every refresh', async () => {
    const again = await request<{ id: string }>('/api/v1/auth/session', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {},
    });
    expect(again.status).toBe(201);

    const listed = await request<{ data: { id: string }[] }>('/api/v1/me/sessions', {
      token: tenant.people.agent!.token,
    });
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]!.id).toBe(again.body.id);
  });

  it('shows one person nothing of another’s', async () => {
    await request('/api/v1/auth/session', { method: 'POST', token: tenant.people.requester!.token, body: {} });
    const agent = await request<{ data: { id: string }[] }>('/api/v1/me/sessions', {
      token: tenant.people.agent!.token,
    });
    const requester = await request<{ data: { id: string }[] }>('/api/v1/me/sessions', {
      token: tenant.people.requester!.token,
    });
    expect(agent.body.data).toHaveLength(1);
    expect(requester.body.data).toHaveLength(1);
    expect(agent.body.data[0]!.id).not.toBe(requester.body.data[0]!.id);
  });

  it('refuses a body it does not recognise, rather than ignoring it', async () => {
    // Before the schema was strict this answered 201 and silently discarded
    // both keys, which is the shape of every bug where a client believes it
    // sent something the server never read.
    const response = await request('/api/v1/auth/session', {
      method: 'POST',
      token: tenant.people.requester!.token,
      body: { userId: 'somebody-else', device: 'a phone' },
    });
    expect(response.status).toBe(422);
  });

  it('needs a token, like everything else under /api/v1', async () => {
    const response = await request('/api/v1/auth/session', { method: 'POST', body: {} });
    expect(response.status).toBe(401);
  });
});

describe('revoking a session', () => {
  // The spare person: this test kills their token, and nothing else asserts
  // anything about them.
  it('stops the token that session belongs to', async () => {
    const person = tenant.people.spare!;
    await request('/api/v1/auth/session', { method: 'POST', token: person.token, body: {} });

    const listed = await request<{ data: { id: string }[] }>('/api/v1/me/sessions', { token: person.token });
    expect(listed.body.data).toHaveLength(1);
    const id = listed.body.data[0]!.id;

    // A working token, one request before the revocation.
    const before = await request('/api/v1/me', { token: person.token });
    expect(before.status).toBe(200);

    const revoked = await request(`/api/v1/me/sessions/${id}`, { method: 'DELETE', token: person.token });
    expect(revoked.status).toBe(204);

    // The whole point of this work. Before it, the same token carried on
    // working until it expired — which on a shared machine is the difference
    // between a sign-out and a suggestion.
    const after = await request('/api/v1/me', { token: person.token });
    expect(after.status).toBe(401);

    // And it is the key the verifier reads that was written, not merely a
    // column on a row nobody consults.
    await expect(cache().get(`sess:deny:${sidOf(person.id)}`)).resolves.toBe('1');
  });

  it('leaves everybody else signed in', async () => {
    const response = await request('/api/v1/me', { token: tenant.people.requester!.token });
    expect(response.status).toBe(200);
  });
});
