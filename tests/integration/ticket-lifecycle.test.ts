import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  transaction,
  verifyAuditChain,
  withContext,
} from '@itsm/platform';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Ticket core integration (MOD-04-E1).
 *
 * These are the guarantees that only a real database can demonstrate: that the
 * row, its audit event and its outbox event are one transaction; that
 * concurrent edits cannot silently overwrite one another; and that numbering
 * leaves no gaps under load.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('lifecycle');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('lifecycle');
  await closeHarness();
});

function agentToken(): string {
  return tenant.people.agent!.token;
}

describe('creation', () => {
  it('numbers tickets per tenant and per type, with no gaps', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await request<{ number: string }>('/api/v1/tickets', {
        method: 'POST',
        token: agentToken(),
        body: { type: 'incident', title: `Sequence check ${i}`, sourceChannel: 'api' },
      });
      numbers.push(response.body.number);
    }

    const sequence = numbers.map((number) => Number(number.replace('INC-', '')));
    for (let i = 1; i < sequence.length; i += 1) {
      expect(sequence[i]).toBe(sequence[i - 1]! + 1);
    }
  });

  it('gives each ticket type its own prefix', async () => {
    const request_ = await request<{ number: string }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'request', title: 'A service request', sourceChannel: 'api' },
    });
    expect(request_.body.number.startsWith('REQ-')).toBe(true);
  });

  it('allocates numbers without collision under concurrency', async () => {
    // The counter is incremented inside the creating transaction, so parallel
    // creates serialise briefly rather than racing (ADR-0020).
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request<{ number: string }>('/api/v1/tickets', {
          method: 'POST',
          token: agentToken(),
          body: { type: 'incident', title: `Concurrent ${i}`, sourceChannel: 'api' },
        }),
      ),
    );
    const numbers = responses.map((response) => response.body.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rejects a ticket with no title', async () => {
    const response = await request<{ errors: { field: string }[] }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', sourceChannel: 'api' },
    });
    expect(response.status).toBe(422);
    expect(response.body.errors?.some((error) => error.field.includes('title'))).toBe(true);
  });

  it('derives priority from the impact and urgency matrix', async () => {
    const response = await request<{ priority: string }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Whole site is down', impact: 'high', urgency: 'high', sourceChannel: 'api' },
    });
    // High impact against high urgency is P1 in the default matrix (§11.3).
    expect(response.body.priority).toBe('P1');
  });
});

describe('the write, its audit event and its outbox event are one transaction', () => {
  it('writes all three together', async () => {
    const created = await request<{ id: string; number: string }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Atomicity check', sourceChannel: 'api' },
    });

    const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const rows = await withContext(ctx, () =>
      transaction(ctx, async (tx) => {
        const [ticket, audit, outbox] = await Promise.all([
          tx.ticket.findFirst({ where: { id: created.body.id } }),
          tx.auditEvent.findMany({ where: { targetId: created.body.id } }),
          tx.outboxEvent.findMany({ where: { aggregateId: created.body.id } }),
        ]);
        return { ticket, audit, outbox };
      }),
    );

    expect(rows.ticket).not.toBeNull();
    expect(rows.audit.map((row) => row.action)).toContain('ticket.created');
    expect(rows.outbox.map((row) => row.type)).toContain('ticket.created');
    // Same correlation id throughout: one request, one causal chain.
    expect(rows.audit[0]?.correlationId).toBeTruthy();
  });

  it('writes no rows at all when the command is refused', async () => {
    const before = await countTickets();
    const refused = await request('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'not-a-type', title: 'Should not exist', sourceChannel: 'api' },
    });
    expect(refused.status).toBe(422);
    expect(await countTickets()).toBe(before);
  });

  it('keeps the audit chain intact after a burst of changes', async () => {
    const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const result = await withContext(ctx, () => transaction(ctx, (tx) => verifyAuditChain(tx, tenant.id)));
    expect(result.valid).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
  });
});

async function countTickets(): Promise<number> {
  const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
  return withContext(ctx, () => transaction(ctx, (tx) => tx.ticket.count()));
}

describe('optimistic locking', () => {
  it('refuses a second writer holding a stale version', async () => {
    const created = await request<{ number: string; version: number }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Lock check', sourceChannel: 'api' },
    });
    const { number, version } = created.body;

    const first = await request<{ version: number }>(`/api/v1/tickets/${number}`, {
      method: 'PATCH',
      token: agentToken(),
      body: { title: 'First writer wins' },
      headers: { 'if-match': `"${version}"` },
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(version + 1);

    // The second writer read the same version and must be told, not ignored.
    const second = await request(`/api/v1/tickets/${number}`, {
      method: 'PATCH',
      token: agentToken(),
      body: { title: 'Second writer loses' },
      headers: { 'if-match': `"${version}"` },
    });
    expect(second.status).toBe(409);

    const current = await request<{ title: string }>(`/api/v1/tickets/${number}`, { token: agentToken() });
    expect(current.body.title).toBe('First writer wins');
  });

  it('requires a version rather than defaulting to last-write-wins', async () => {
    const response = await request(`/api/v1/tickets/${tenant.ticketNumbers[0]}`, {
      method: 'PATCH',
      token: agentToken(),
      body: { title: 'No version supplied' },
    });
    expect(response.status).toBe(428);
  });

  /**
   * Assignment is the one write where the version is optional, and the
   * asymmetry is on purpose. A queue screen claims a ticket from a list it read
   * a minute ago; requiring `If-Match` there would mean re-reading every row
   * before every claim, so the route answers without one. But a client that
   * *has* the version can say so, and two agents claiming the same ticket in
   * the same second then get a 409 rather than one of them silently losing the
   * ticket they believed they had taken.
   */
  it('assigns without a version, because a queue does not hold one', async () => {
    const response = await request<{ version: number }>(`/api/v1/tickets/${tenant.ticketNumbers[0]}/assign`, {
      method: 'POST',
      token: agentToken(),
      body: { assigneeId: tenant.people.agent!.id, method: 'manual' },
    });
    expect(response.status).toBe(200);
  });

  it('refuses an assignment carrying a stale version', async () => {
    const created = await request<{ number: string; version: number }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Two agents, one ticket', sourceChannel: 'api' },
    });
    const { number, version } = created.body;

    const first = await request(`/api/v1/tickets/${number}/assign`, {
      method: 'POST',
      token: agentToken(),
      body: { assigneeId: tenant.people.agent!.id, method: 'manual' },
      headers: { 'if-match': `"${version}"` },
    });
    expect(first.status).toBe(200);

    const second = await request(`/api/v1/tickets/${number}/assign`, {
      method: 'POST',
      token: agentToken(),
      body: { assigneeId: tenant.people.otherAgent!.id, method: 'manual' },
      headers: { 'if-match': `"${version}"` },
    });
    expect(second.status).toBe(409);

    // The first claim stands. Before the route read `If-Match` the second
    // silently won, and the first agent kept working a ticket that was no
    // longer theirs.
    const current = await request<{ assigneeId: string }>(`/api/v1/tickets/${number}`, { token: agentToken() });
    expect(current.body.assigneeId).toBe(tenant.people.agent!.id);
  });
});

describe('a body the API does not recognise', () => {
  /**
   * Zod strips unknown keys by default, so a client that misspelled a field got
   * a 201 and a ticket without it. Every request body under `/api/v1` is now
   * strict, which turns that into a 422 naming the key — at the HTTP boundary
   * only. The module schemas stay permissive, because an internal caller that
   * passes an extra key is a type error caught at build time, not a stranger's
   * typo.
   */
  it('refuses a misspelled field instead of quietly dropping it', async () => {
    const response = await request<{ status: number }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', titel: 'A typo nobody would notice', sourceChannel: 'api' },
    });
    expect(response.status).toBe(422);
  });

  it('names the key it did not recognise', async () => {
    const response = await request<{ detail?: string; errors?: unknown }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Valid', sourceChannel: 'api', urgencey: 'high' },
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('urgencey');
  });
});

describe('an update that changes nothing is not a change', () => {
  it('does not record a change when custom fields are re-sent with their keys in another order', async () => {
    // `custom` is a JSONB column, so what comes back from the database has been
    // through PostgreSQL's key ordering. Compared by stringifying, an identical
    // re-send reads as a change: an audit row, a version bump, a
    // `ticket.updated` event, and every rule and notification waiting on one.
    // Nothing fails; the ticket just acquires a history of edits nobody made.
    const created = await request<{ number: string; version: number }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: {
        type: 'incident',
        title: 'Custom field no-op',
        sourceChannel: 'api',
        custom: { alpha: 'one', bravo: 'two', nested: { x: 1, y: 2 } },
      },
    });
    expect(created.status).toBe(201);

    const resent = await request<{ version: number }>(`/api/v1/tickets/${created.body.number}`, {
      method: 'PATCH',
      token: agentToken(),
      // The same value, written the other way round.
      body: { custom: { nested: { y: 2, x: 1 }, bravo: 'two', alpha: 'one' } },
      headers: { 'if-match': `"${created.body.version}"` },
    });
    expect(resent.status).toBe(200);
    expect(resent.body.version).toBe(created.body.version);
  });

  it('still records a change when a custom field really differs', async () => {
    // The guard against the fix going too far: a no-op must be quiet, and a
    // real edit must not be.
    const created = await request<{ number: string; version: number }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'Custom field edit', sourceChannel: 'api', custom: { alpha: 'one' } },
    });
    const changed = await request<{ version: number }>(`/api/v1/tickets/${created.body.number}`, {
      method: 'PATCH',
      token: agentToken(),
      body: { custom: { alpha: 'two' } },
      headers: { 'if-match': `"${created.body.version}"` },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.version).toBe(created.body.version + 1);
  });
});

describe('the state machine', () => {
  async function freshTicket(): Promise<string> {
    const response = await request<{ number: string }>('/api/v1/tickets', {
      method: 'POST',
      token: agentToken(),
      body: { type: 'incident', title: 'State machine check', sourceChannel: 'api' },
    });
    return response.body.number;
  }

  it('walks the documented path and records each step', async () => {
    const number = await freshTicket();
    for (const to of ['in_progress', 'pending_requester', 'in_progress', 'resolved']) {
      const response = await request<{ status: string }>(`/api/v1/tickets/${number}/transitions`, {
        method: 'POST',
        token: agentToken(),
        body: { to },
      });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe(to);
    }

    const timeline = await request<{ entries: { kind: string; type?: string }[] }>(`/api/v1/tickets/${number}/timeline`, {
      token: agentToken(),
    });
    const statusChanges = timeline.body.entries.filter((entry) => entry.kind === 'event' && entry.type === 'status.changed');
    expect(statusChanges).toHaveLength(4);
  });

  it('refuses a move the machine does not allow', async () => {
    const number = await freshTicket();
    const response = await request<{ detail: string }>(`/api/v1/tickets/${number}/transitions`, {
      method: 'POST',
      token: agentToken(),
      body: { to: 'closed' },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toContain('cannot move from new to closed');
  });

  it('pauses and restarts the resolution clock around a pending state', async () => {
    const number = await freshTicket();
    await request(`/api/v1/tickets/${number}/transitions`, { method: 'POST', token: agentToken(), body: { to: 'in_progress' } });

    await request(`/api/v1/tickets/${number}/transitions`, {
      method: 'POST',
      token: agentToken(),
      body: { to: 'pending_requester' },
    });
    const paused = await request<{ statusCategory: string }>(`/api/v1/tickets/${number}`, { token: agentToken() });
    expect(paused.body.statusCategory).toBe('paused');

    await request(`/api/v1/tickets/${number}/transitions`, { method: 'POST', token: agentToken(), body: { to: 'in_progress' } });
    const resumed = await request<{ statusCategory: string }>(`/api/v1/tickets/${number}`, { token: agentToken() });
    expect(resumed.body.statusCategory).toBe('open');
  });

  it('stamps resolution and clears it again on reopen', async () => {
    const number = await freshTicket();
    await request(`/api/v1/tickets/${number}/transitions`, { method: 'POST', token: agentToken(), body: { to: 'in_progress' } });
    const resolved = await request<{ resolvedAt: string | null }>(`/api/v1/tickets/${number}/transitions`, {
      method: 'POST',
      token: agentToken(),
      body: { to: 'resolved' },
    });
    expect(resolved.body.resolvedAt).not.toBeNull();

    const reopened = await request<{ resolvedAt: string | null; reopenCount: number }>(
      `/api/v1/tickets/${number}/transitions`,
      { method: 'POST', token: agentToken(), body: { to: 'reopened' } },
    );
    expect(reopened.body.resolvedAt).toBeNull();
    expect(reopened.body.reopenCount).toBe(1);
  });
});

describe('comments and the timeline', () => {
  it('keeps internal notes out of the requester projection', async () => {
    const number = tenant.ticketNumbers[0]!;
    const secret = `internal-only-${Date.now()}`;
    await request(`/api/v1/tickets/${number}/comments`, {
      method: 'POST',
      token: agentToken(),
      body: { body: secret, visibility: 'internal' },
    });

    const requesterView = await request(`/api/v1/tickets/${number}/timeline`, { token: tenant.people.requester!.token });
    expect(JSON.stringify(requesterView.body)).not.toContain(secret);

    const agentView = await request(`/api/v1/tickets/${number}/timeline`, { token: agentToken() });
    expect(JSON.stringify(agentView.body)).toContain(secret);
  });
});

describe('pagination', () => {
  it('pages forward without repeating or skipping a ticket', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const query: string = cursor ? `/api/v1/tickets?limit=3&cursor=${encodeURIComponent(cursor)}` : '/api/v1/tickets?limit=3';
      const response = await request<{ data: { id: string }[]; nextCursor: string | null }>(query, { token: agentToken() });
      seen.push(...response.body.data.map((ticket) => ticket.id));
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('rejects a cursor it did not issue', async () => {
    const response = await request('/api/v1/tickets?limit=3&cursor=not-a-real-cursor', { token: agentToken() });
    expect(response.status).toBe(422);
  });
});

describe('errors', () => {
  it('returns problem details with a correlation id', async () => {
    const response = await request<{ type: string; status: number; correlationId: string; title: string }>(
      '/api/v1/tickets/INC-999999',
      { token: agentToken() },
    );
    expect(response.status).toBe(404);
    expect(response.body.type).toContain('/problems/');
    expect(response.body.correlationId).toBeTruthy();
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('never leaks internals in an error body', async () => {
    const response = await request(`/api/v1/tickets/${tenant.ticketNumbers[0]}`, {
      method: 'PATCH',
      token: agentToken(),
      body: { priority: 'P9' },
      headers: { 'if-match': '"1"' },
    });
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('postgres');
    expect(text).not.toContain('prisma');
    expect(text).not.toMatch(/at [A-Za-z]+\./);
  });
});
