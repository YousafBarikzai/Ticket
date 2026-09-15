import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The email channel (MOD-03), end to end.
 *
 * Every assertion goes in through the provider webhook, because that is the one
 * route reached before any tenant context exists: the message itself says which
 * tenant it belongs to. The cases that matter are the ones where getting it
 * wrong leaks data or floods a mailbox — a forged sender, a replayed delivery,
 * a holiday responder, and a reply that should join a ticket rather than start
 * a second one.
 */

let tenant: TestTenant;
let accountAddress: string;

beforeAll(async () => {
  tenant = await createTestTenant('email-channel');
  accountAddress = `support-${tenant.slug}@example.invalid`;

  const { transaction, withContext } = await import('@itsm/platform');
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      // The seeded account starts disabled and on a placeholder address, which
      // is what an unconfigured tenant should look like. Configure it here.
      await tx.channelAccount.updateMany({
        where: { channel: 'email', key: 'support' },
        data: { address: accountAddress, status: 'active' },
      });
    }),
  );
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('email-channel');
  await closeHarness();
});

let sequence = 0;
function deliver(body: Record<string, unknown>) {
  sequence += 1;
  return request<{ status: string; outcome?: string; ticket?: string | null; reason?: string | null }>(
    `/api/v1/channels/email/${encodeURIComponent(accountAddress)}/inbound`,
    {
      method: 'POST',
      body: { messageId: `<msg-${sequence}@example.test>`, headers: {}, ...body },
    },
  );
}

async function linkIdentity(email: string, userId: string) {
  const { transaction, withContext } = await import('@itsm/platform');
  const ctx = contextFor(tenant.id);
  const account = await withContext(ctx, () =>
    transaction(ctx, (tx) => tx.channelAccount.findFirst({ where: { channel: 'email', key: 'support' } })),
  );
  return request('/api/v1/channels/identities', {
    method: 'POST',
    token: tenant.people.admin!.token,
    body: { accountId: account!.id, channel: 'email', externalId: email, userId },
  });
}

describe('the webhook needs no token', () => {
  it('accepts a delivery without an authorization header', async () => {
    const response = await deliver({ from: 'nobody@example.test', subject: 'hello', text: 'anyone there?' });
    // 202 whatever happens next: a provider that gets an error retries, and a
    // retry of something we deliberately refused is not wanted again.
    expect(response.status).toBe(202);
  });
});

describe('an unverified sender', () => {
  it('cannot raise a ticket, because an envelope is trivially forged', async () => {
    const response = await deliver({ from: 'stranger@example.test', subject: 'urgent', text: 'let me in' });
    expect(response.body.outcome).toBe('refused');
    expect(response.body.ticket).toBeNull();
  });
});

describe('a verified sender', () => {
  beforeAll(async () => {
    const linked = await linkIdentity('ada.requester@email-channel.test', tenant.people.requester!.id);
    expect(linked.status).toBe(201);
  });

  it('raises a ticket, as themselves', async () => {
    const response = await deliver({
      from: 'ada.requester@email-channel.test',
      subject: 'my laptop will not charge',
      text: 'It stopped this morning.',
    });
    expect(response.body.outcome).toBe('created');
    expect(response.body.ticket).toMatch(/^INC-\d+$/);

    const ticket = await request<{ requesterId: string; sourceChannel: string; description: string }>(
      `/api/v1/tickets/${response.body.ticket}`,
      { token: tenant.people.agent!.token },
    );
    expect(ticket.body.requesterId).toBe(tenant.people.requester!.id);
    expect(ticket.body.sourceChannel).toBe('email');
  });

  it('joins a reply to the same ticket rather than starting a second', async () => {
    const created = await deliver({
      from: 'ada.requester@email-channel.test',
      subject: 'printer is jammed',
      text: 'Third floor.',
    });
    const number = created.body.ticket!;

    const reply = await deliver({
      from: 'ada.requester@email-channel.test',
      subject: `Re: [${number}] printer is jammed`,
      text: 'Still jammed, thanks.',
    });
    expect(reply.body.outcome).toBe('commented');
    expect(reply.body.ticket).toBe(number);
  });

  it('keeps only what the person wrote, not the quoted history', async () => {
    const created = await deliver({ from: 'ada.requester@email-channel.test', subject: 'vpn drops', text: 'Every hour.' });
    const number = created.body.ticket!;

    await deliver({
      from: 'ada.requester@email-channel.test',
      subject: `Re: [${number}] vpn drops`,
      text: 'That fixed it, thank you.\n\nOn Monday, Service Desk wrote:\n> Have you tried the new client?',
    });

    const timeline = await request<{ entries: { kind: string; body?: string }[] }>(
      `/api/v1/tickets/${number}/timeline`,
      { token: tenant.people.agent!.token },
    );
    const comments = timeline.body.entries.filter((entry) => entry.kind === 'comment');
    const latest = comments.at(-1)!;
    expect(latest.body).toBe('That fixed it, thank you.');
    expect(latest.body).not.toContain('Have you tried');
  });
});

describe('the things that flood a mailbox', () => {
  it('processes a replayed delivery once', async () => {
    const payload = {
      messageId: '<replayed@example.test>',
      from: 'ada.requester@email-channel.test',
      subject: 'duplicate check',
      text: 'once only',
      headers: {},
    };
    const first = await request<{ status: string; ticket?: string | null }>(
      `/api/v1/channels/email/${encodeURIComponent(accountAddress)}/inbound`,
      { method: 'POST', body: payload },
    );
    const second = await request<{ status: string }>(
      `/api/v1/channels/email/${encodeURIComponent(accountAddress)}/inbound`,
      { method: 'POST', body: payload },
    );
    expect(first.body.status).toBe('accepted');
    expect(second.body.status).toBe('duplicate');
  });

  it('drops an out-of-office responder', async () => {
    const response = await deliver({
      from: 'ada.requester@email-channel.test',
      subject: 'Out of office',
      text: 'I am away until Monday.',
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    expect(response.body.status).toBe('rejected');
    expect(response.body.reason).toBe('auto_reply');
  });

  it('drops mail from its own address', async () => {
    const response = await deliver({ from: accountAddress, subject: 'loop', text: 'round and round' });
    expect(response.body.reason).toBe('loop_detected');
  });

  it('ignores a delivery for an address it does not host', async () => {
    const response = await request<{ status: string }>(
      '/api/v1/channels/email/someone-else%40example.invalid/inbound',
      { method: 'POST', body: { messageId: '<x@y>', from: 'a@b.test', subject: 'hi', text: 'hi', headers: {} } },
    );
    expect(response.status).toBe(202);
  });
});

describe('what an administrator can see', () => {
  it('lists what arrived, including what was rejected and why', async () => {
    const response = await request<{ data: { status: string; rejectedReason: string | null }[] }>(
      '/api/v1/channels/messages?limit=100',
      { token: tenant.people.admin!.token },
    );
    expect(response.status).toBe(200);
    const rejected = response.body.data.filter((row) => row.status === 'rejected');
    // "37 rejected" tells nobody anything; the reason is the point.
    expect(rejected.some((row) => row.rejectedReason === 'auto_reply')).toBe(true);
    expect(rejected.some((row) => row.rejectedReason === 'unverified_sender')).toBe(true);
  });

  it('refuses an agent the message list', async () => {
    const response = await request('/api/v1/channels/messages', { token: tenant.people.agent!.token });
    expect(response.status).toBe(403);
  });
});
