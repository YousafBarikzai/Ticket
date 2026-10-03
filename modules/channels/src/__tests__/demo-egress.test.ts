import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E6, E7 and E8 (SPEC v3 §4.7.2): the shared demo's channels send nothing.
 * No mailbox has a transport (E6), an agent's public reply reaches no
 * requester's inbox or chat thread (E7), and nothing is posted into a chat
 * thread (E8) — while a real tenant's mail and chat go out exactly as before.
 *
 * Transports are recording fakes and the tenant transaction is a stand-in, so
 * each case can show that nothing was asked of a provider and no row moved.
 */

vi.mock('@itsm/module-ticket', () => ({ ticketService: {} }));

const {
  buildPermissionSet,
  createContext,
  handlersFor,
  metrics,
  registerSecretResolver,
  resetSecretResolvers,
  setTenantKindReader,
} = await import('@itsm/platform');
const { transportForAccount } = await import('../service/transport-registry.js');
const { registerEmailTransport } = await import('../service/email-transport.js');
const { clearChatTransports, registerChatTransport } = await import('../service/chat-transport.js');
const { postToTicketThread, replyToChat } = await import('../service/chat-inbound.js');
await import('../handlers/index.js');

const DEMO = '0192a000-0000-7000-8000-00000000de00';
const STANDARD = '0192a000-0000-7000-8000-000000000001';

function contextOf(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });
}

function suppressed(choke: string): number {
  return metrics.snapshot().counters[`demo_egress_suppressed_total{choke=${choke}}`] ?? 0;
}

const resolver = vi.fn(async (_ctx: unknown, ref: string) => `secret-for-${ref}`);
const mailed = vi.fn(async (message: { headers: Record<string, string> }) => ({ messageId: message.headers['Message-ID'] ?? '', providerId: null }));
const posted = vi.fn(async () => ({ messageId: 'chat-1' }));

/** A tenant transaction holding one ticket with one conversation on it. */
function ticketWith(conversation: { channel: string; state?: object; accountConfig: object }) {
  const updates: string[] = [];
  const reads: string[] = [];
  const read = <T>(name: string, value: T) => async () => {
    reads.push(name);
    return value;
  };
  const tx = {
    conversation: {
      findMany: read('conversation.findMany', [
        { id: 'conv-1', accountId: 'acc-1', channel: conversation.channel, externalThreadId: '<thread-1@example.test>', state: conversation.state ?? {}, lastInboundAt: new Date() },
      ]),
      findFirst: read('conversation.findFirst', {
        id: 'conv-1',
        accountId: 'acc-1',
        channel: conversation.channel,
        externalThreadId: '1700000000.0001',
        state: conversation.state ?? {},
      }),
      update: async () => {
        updates.push('conversation.update');
      },
    },
    channelAccount: { findFirst: read('channelAccount.findFirst', { id: 'acc-1', key: 'support', address: 'support@northwind.example', config: conversation.accountConfig }) },
    ticketComment: {
      findFirst: read('ticketComment.findFirst', { id: 'c-1', body: 'We have reset your VPN profile.', channel: null }),
      count: read('ticketComment.count', 2),
    },
    ticket: { findFirst: read('ticket.findFirst', { id: 't-1', number: 'INC-000101', title: 'The VPN is down', requesterId: 'u-1' }) },
    user: { findFirst: read('user.findFirst', { id: 'u-1', email: 'emma.clarke@northwind.example' }) },
  };
  return { tx: tx as never, updates, reads };
}

function commentAdded(tenantId: string) {
  return {
    id: 'evt-1',
    type: 'ticket.comment.added',
    tenantId,
    occurredAt: new Date().toISOString(),
    payload: { ticketId: 't-1', number: 'INC-000101', commentId: 'c-1', visibility: 'public' },
  } as never;
}

function replyHandler() {
  const handler = handlersFor('ticket.comment.added').find((one) => one.consumer === 'channels');
  expect(handler).toBeDefined();
  return handler!;
}

beforeEach(() => {
  resolver.mockClear();
  mailed.mockClear();
  posted.mockClear();
  setTenantKindReader(async (tenantId) => (tenantId === DEMO ? 'demo' : 'standard'));
  registerSecretResolver('test', resolver);
  registerEmailTransport({
    name: 'development',
    sendMessage: mailed as never,
    parseInbound: () => null,
    verify: () => false,
  });
  registerChatTransport({
    name: 'fake-chat',
    channel: 'slack',
    verify: () => ({ ok: true }),
    parseInbound: () => null,
    send: posted,
  } as never);
});

afterEach(() => {
  setTenantKindReader(null);
  resetSecretResolvers();
  clearChatTransports();
});

describe('E6 · a mailbox’s transport', () => {
  const postmark = { transport: 'postmark', tokenRef: 'pm-token', webhookSecretRef: 'pm-hook' };

  it('is none in the demo, and no credential is looked up for it', async () => {
    const before = suppressed('E6');
    await expect(transportForAccount(postmark, contextOf(DEMO))).resolves.toBeNull();

    expect(resolver).not.toHaveBeenCalled();
    expect(suppressed('E6')).toBe(before + 1);
  });

  it('is built for a real tenant, as before', async () => {
    const before = suppressed('E6');
    const transport = await transportForAccount(postmark, contextOf(STANDARD));

    expect(transport?.name).toBe('postmark');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(suppressed('E6')).toBe(before);
  });

  it('is built as before when no tenant is named: the inbound webhook verifying a delivery', async () => {
    const before = suppressed('E6');
    expect((await transportForAccount(postmark))?.name).toBe('postmark');
    expect(suppressed('E6')).toBe(before);
  });
});

describe('E7 · an agent’s public reply', () => {
  it('goes to nobody in the demo, by e-mail or chat, and leaves the conversation as it was', async () => {
    const before = suppressed('E7');
    for (const conversation of [
      { channel: 'email', accountConfig: { transport: 'development' } },
      { channel: 'slack', state: { roomId: 'C123' }, accountConfig: { transport: 'fake-chat' } },
    ]) {
      const { tx, updates } = ticketWith(conversation);
      await replyHandler().handle(contextOf(DEMO), commentAdded(DEMO), tx);
      expect(updates).toEqual([]);
    }

    expect(mailed).not.toHaveBeenCalled();
    expect(posted).not.toHaveBeenCalled();
    expect(suppressed('E7')).toBe(before + 2);
  });

  it('is e-mailed to a real tenant’s requester, threaded as before', async () => {
    const before = suppressed('E7');
    const { tx, updates } = ticketWith({ channel: 'email', accountConfig: { transport: 'development' } });
    await replyHandler().handle(contextOf(STANDARD), commentAdded(STANDARD), tx);

    expect(mailed).toHaveBeenCalledTimes(1);
    expect(mailed.mock.calls[0]![0]).toMatchObject({
      to: 'emma.clarke@northwind.example',
      body: 'We have reset your VPN profile.',
      headers: { 'x-itsm-ticket': 'INC-000101', 'In-Reply-To': '<thread-1@example.test>' },
    });
    expect(updates).toEqual(['conversation.update']);
    expect(suppressed('E7')).toBe(before);
  });

  it('is posted into a real tenant’s chat thread, as before', async () => {
    const { tx, updates } = ticketWith({ channel: 'slack', state: { roomId: 'C123' }, accountConfig: { transport: 'fake-chat' } });
    await replyHandler().handle(contextOf(STANDARD), commentAdded(STANDARD), tx);

    expect(posted).toHaveBeenCalledWith({ roomId: 'C123', threadId: '<thread-1@example.test>', text: '*INC-000101* — We have reset your VPN profile.' });
    expect(updates).toEqual(['conversation.update']);
  });
});

describe('E8 · chat replies and thread posts', () => {
  const message = { roomId: 'C123', threadId: '1700000000.0001', text: 'Raised INC-000101. I will post updates here.' };

  it('posts nothing for the demo', async () => {
    const before = suppressed('E8');
    await replyToChat(DEMO, 'fake-chat', message);

    expect(posted).not.toHaveBeenCalled();
    expect(suppressed('E8')).toBe(before + 1);
  });

  it('posts a real tenant’s reply, as before', async () => {
    const before = suppressed('E8');
    await replyToChat(STANDARD, 'fake-chat', message);

    expect(posted).toHaveBeenCalledWith(message);
    expect(suppressed('E8')).toBe(before);
  });

  it('asks nothing in the demo’s ticket thread, reads no row and marks no reply as awaited', async () => {
    const before = suppressed('E8');
    const { tx, reads, updates } = ticketWith({ channel: 'slack', state: { roomId: 'C123' }, accountConfig: { transport: 'fake-chat' } });
    const outcome = await postToTicketThread(contextOf(DEMO), tx, 't-1', { text: 'How did we do?' }, { action: 'survey', data: {}, expiresAt: '2026-10-10T00:00:00Z' } as never);

    expect(outcome).toEqual({ posted: false, conversationId: null, channel: null, supportsButtons: false });
    expect(posted).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
    expect(updates).toEqual([]);
    expect(suppressed('E8')).toBe(before + 1);
  });

  it('asks in a real tenant’s ticket thread, as before', async () => {
    const { tx, updates } = ticketWith({ channel: 'slack', state: { roomId: 'C123' }, accountConfig: { transport: 'fake-chat' } });
    const outcome = await postToTicketThread(contextOf(STANDARD), tx, 't-1', { text: 'How did we do?' });

    expect(outcome).toEqual({ posted: true, conversationId: 'conv-1', channel: 'slack', supportsButtons: true });
    expect(posted).toHaveBeenCalledWith({ roomId: 'C123', threadId: '1700000000.0001', text: 'How did we do?' });
    expect(updates).toEqual(['conversation.update']);
  });
});
