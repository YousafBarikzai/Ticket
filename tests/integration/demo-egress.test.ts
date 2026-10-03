import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  digest,
  handlersFor,
  metrics,
  newId,
  registerSecretResolver,
  resolveSecret,
  signToken,
  transaction,
  withContext,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { ticketService } from '@itsm/module-ticket';
import { gateway } from '@itsm/module-integrations';
import { notificationService, registerTransport } from '@itsm/module-notifications';
import { publicService } from '@itsm/module-statuspage';
import {
  emailTransport,
  postToTicketThread,
  registerChatTransport,
  registerEmailTransport,
  replyToChat,
  transportForAccount,
  type ChatTransport,
} from '@itsm/module-channels';
import { addAiProvider, callModel, decide, registerModelPrices, type AiProvider } from '@itsm/module-ai';
import { DEMO_FEATURES, demoDisabledSentence } from '@itsm/contracts/demo';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The shared demo's egress guards, E1–E12, against the real database and the
 * real API (SPEC v3 §4.7.2; A3 §11.2 rows 20 and 21; Y-M5).
 *
 * Two tenants with the same shape — one `kind = 'demo'`, one standard — and
 * every choke point driven once in each. For the demo: nothing reaches a
 * provider, the rows say why, and the counter `demo_egress_suppressed_total`
 * moves for that choke point. For the standard tenant: the same call behaves
 * exactly as before, which is how a guard keyed on the wrong thing is caught.
 * Providers are recording fakes; the database, the tenant's kind and the HTTP
 * routes are real.
 */

const STANDARD_SLUG = 'egress-standard';
const DEMO_SLUG = 'egress-demo';

interface DemoTenant {
  id: string;
  slug: string;
  agentId: string;
  requesterId: string;
  requesterEmail: string;
  ticketId: string;
}

let standard: TestTenant;
let demo: DemoTenant;

/** Everything the platform tried to send, in place of the providers. */
const mailed: { to: string; subject: string | null }[] = [];
const repliesMailed: string[] = [];
const chatPosts: { roomId: string; text: string }[] = [];
const chatVerified: string[] = [];
const fetched: string[] = [];
const modelAsks: string[] = [];

function suppressed(choke: string): number {
  return metrics.snapshot().counters[`demo_egress_suppressed_total{choke=${choke}}`] ?? 0;
}

function inTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx = contextFor(tenantId);
  return withContext(ctx, () => transaction(ctx, fn));
}

/** A demo tenant with the people and the ticket these rows need, built like the harness's. */
async function createDemoTenant(slug: string): Promise<DemoTenant> {
  const existing = await tenantService.findTenantBySlug(slug);
  if (existing) await tenantService.purgeTenant(existing.id);

  const { tenantId } = await tenantService.provisionTenant({ name: 'Egress demo', slug, region: 'eu-west', kind: 'demo' });
  const base = contextFor(tenantId);
  return withContext(base, async () => {
    const org = await tenantService.createOrganisation(base, { name: 'Northwind Traders', code: 'ORG-EGRESS' });
    const ctx: TenantContext = { ...base, organisationIds: [org.id], organisationPaths: [org.path] };
    const team = await userService.createTeam(ctx, { key: 'service-desk', name: 'Service Desk', orgId: org.id });
    const agent = await userService.createUser(ctx, { email: `alex.morgan@${slug}.test`, displayName: 'Alex Morgan', primaryOrgId: org.id }, 'seed');
    await userService.assignRole(ctx, { userId: agent.id, roleKey: 'agent' });
    await userService.addTeamMember(ctx, team.id, agent.id, true);
    const requester = await userService.createUser(ctx, { email: `emma.clarke@${slug}.test`, displayName: 'Emma Clarke', primaryOrgId: org.id }, 'seed');
    await userService.assignRole(ctx, { userId: requester.id, roleKey: 'requester' });

    const requesterCtx: TenantContext = { ...ctx, actor: { type: 'user', id: requester.id, displayName: 'Emma Clarke' } };
    const ticket = await withContext(requesterCtx, () =>
      ticketService.createTicket(requesterCtx, {
        type: 'incident',
        title: 'VPN will not connect',
        description: 'VPN will not connect — created by the egress suite.',
        priority: 'P3',
        requesterId: requester.id,
        groupId: team.id,
        orgId: org.id,
        sourceChannel: 'portal',
      }),
    );
    return { id: tenantId, slug, agentId: agent.id, requesterId: requester.id, requesterEmail: requester.email, ticketId: ticket.id };
  });
}

/** Both tenants, as `{ kind, id, … }`, so every row can be written once and run twice. */
function both() {
  return [
    { kind: 'demo' as const, id: demo.id, slug: demo.slug, ticketId: demo.ticketId, requesterId: demo.requesterId, requesterEmail: demo.requesterEmail, agentId: demo.agentId },
    {
      kind: 'standard' as const,
      id: standard.id,
      slug: standard.slug,
      ticketId: standard.ticketIds[0]!,
      requesterId: standard.people.requester!.id,
      requesterEmail: standard.people.requester!.email,
      agentId: standard.people.agent!.id,
    },
  ];
}

const accounts = new Map<string, { email: string; chat: string }>();

beforeAll(async () => {
  standard = await createTestTenant(STANDARD_SLUG);
  demo = await createDemoTenant(DEMO_SLUG);

  // The providers, as recording fakes. The development mail transport is
  // wrapped rather than replaced, so inbound verification still works.
  registerTransport({
    channel: 'email',
    async send(input) {
      mailed.push({ to: input.to, subject: input.subject });
      return { providerRef: 'fake-1' };
    },
  });
  const development = emailTransport('development')!;
  registerEmailTransport({
    ...development,
    async sendMessage(message) {
      repliesMailed.push(message.to);
      return development.sendMessage(message);
    },
  });
  const chat: ChatTransport = {
    name: 'egress-chat',
    channel: 'slack',
    verify(input) {
      chatVerified.push(input.url);
      return { ok: false, failure: 'bad_signature' } as ReturnType<ChatTransport['verify']>;
    },
    parseInbound: () => null,
    async send(message) {
      chatPosts.push({ roomId: message.roomId, text: message.text });
      return { messageId: 'chat-1' };
    },
  };
  registerChatTransport(chat);

  // Each tenant's mailbox switched on at its own address, a chat workspace,
  // and an e-mail and a chat conversation on its ticket.
  for (const tenant of both()) {
    const email = `support-${tenant.slug}@example.invalid`;
    const chat = `${tenant.slug}-workspace`;
    accounts.set(tenant.kind, { email, chat });
    await inTenant(tenant.id, async (tx) => {
      await tx.channelAccount.updateMany({ where: { channel: 'email', key: 'support' }, data: { address: email, status: 'active' } });
      const mailbox = await tx.channelAccount.findFirst({ where: { channel: 'email', key: 'support' } });
      const workspace = await tx.channelAccount.create({
        data: { id: newId(), tenantId: tenant.id, channel: 'slack', key: 'egress-slack', name: 'Egress Slack', address: chat, config: { transport: 'egress-chat' } as never, status: 'active' },
      });
      await tx.conversation.create({
        data: { id: newId(), tenantId: tenant.id, accountId: mailbox!.id, channel: 'email', ticketId: tenant.ticketId, externalThreadId: `<egress-${tenant.kind}@example.test>`, state: {} as never },
      });
      await tx.conversation.create({
        data: {
          id: newId(),
          tenantId: tenant.id,
          accountId: workspace.id,
          channel: 'slack',
          ticketId: tenant.ticketId,
          externalThreadId: `1700000000.${tenant.kind === 'demo' ? '0001' : '0002'}`,
          state: { roomId: `C-${tenant.kind}` } as never,
          lastInboundAt: new Date(),
        },
      });
    });
  }
}, 180_000);

afterAll(async () => {
  await deleteTestTenant(STANDARD_SLUG);
  const leftover = await tenantService.findTenantBySlug(DEMO_SLUG);
  if (leftover) await tenantService.purgeTenant(leftover.id);
  await closeHarness();
});

describe('the two tenants', () => {
  it('are one demo and one standard, by the column the guards read', async () => {
    const { platformDb } = await import('@itsm/platform');
    const kinds = await platformDb().tenant.findMany({ where: { id: { in: [demo.id, standard.id] } }, select: { id: true, kind: true } });
    expect(Object.fromEntries(kinds.map((row) => [row.id, row.kind]))).toEqual({ [demo.id]: 'demo', [standard.id]: 'standard' });
  });
});

describe('E1 · the integration gateway', () => {
  const resolver = async () => [{ address: '93.184.216.34' }];
  const fetchImpl = (async (url: string) => {
    fetched.push(url);
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  it('refuses the demo’s call, records it as refused for the demo, and sends nothing', async () => {
    const before = suppressed('E1');
    await expect(
      gateway.call(contextFor(demo.id), { connector: 'egress-webhook', method: 'POST', url: 'https://hooks.example.test/demo', body: { n: 1 } }, { fetchImpl, resolver }),
    ).rejects.toThrow(gateway.DEMO_GATEWAY_REFUSAL);

    expect(fetched).toEqual([]);
    const rows = await inTenant(demo.id, (tx) => tx.integrationLog.findMany({ where: { connector: 'egress-webhook' } }));
    expect(rows).toEqual([expect.objectContaining({ status: 0, error: 'refused: demo' })]);
    expect(suppressed('E1')).toBe(before + 1);
  });

  it('makes the same call for the standard tenant', async () => {
    const before = suppressed('E1');
    await expect(
      gateway.call(contextFor(standard.id), { connector: 'egress-webhook', method: 'POST', url: 'https://hooks.example.test/standard', body: { n: 1 } }, { fetchImpl, resolver }),
    ).resolves.toMatchObject({ status: 200 });

    expect(fetched).toEqual(['https://hooks.example.test/standard']);
    const rows = await inTenant(standard.id, (tx) => tx.integrationLog.findMany({ where: { connector: 'egress-webhook' } }));
    expect(rows).toEqual([expect.objectContaining({ status: 200, error: null })]);
    expect(suppressed('E1')).toBe(before);
  });
});

describe('E2 · notification e-mail', () => {
  async function notificationFor(tenant: ReturnType<typeof both>[number]): Promise<string> {
    const id = newId();
    await inTenant(tenant.id, (tx) =>
      tx.notification.create({
        data: {
          id,
          tenantId: tenant.id,
          eventId: newId(),
          eventType: 'ticket.assigned',
          recipientId: tenant.requesterId,
          ruleKey: 'egress-suite',
          templateKey: 'egress-suite',
          subject: 'INC-000101 was updated',
          body: 'There is news on your ticket.',
        },
      }),
    );
    return id;
  }

  it('is suppressed in the demo, with the record the delivery log reads, and in-app still delivers', async () => {
    const [tenant] = both();
    const id = await notificationFor(tenant!);
    const before = suppressed('E2');

    await expect(notificationService.dispatch(contextFor(tenant!.id), id, 'inapp')).resolves.toBe('sent');
    await expect(notificationService.dispatch(contextFor(tenant!.id), id, 'email')).resolves.toBe('skipped');
    // A redelivered job writes nothing new.
    await expect(notificationService.dispatch(contextFor(tenant!.id), id, 'email')).resolves.toBe('skipped');

    expect(mailed.filter((message) => message.to === tenant!.requesterEmail)).toEqual([]);
    const [notification, attempts] = await inTenant(tenant!.id, (tx) =>
      Promise.all([tx.notification.findFirst({ where: { id } }), tx.deliveryAttempt.findMany({ where: { notificationId: id } })]),
    );
    expect(notification?.status).toBe('suppressed');
    expect(attempts.map((row) => ({ channel: row.channel, attempt: row.attempt, status: row.status, error: row.error }))).toEqual([
      { channel: 'email', attempt: 1, status: 'suppressed', error: 'demo' },
    ]);
    expect(suppressed('E2')).toBe(before + 2);
  });

  it('is sent for the standard tenant', async () => {
    const [, tenant] = both();
    const id = await notificationFor(tenant!);
    const before = suppressed('E2');

    await expect(notificationService.dispatch(contextFor(tenant!.id), id, 'email')).resolves.toBe('sent');
    expect(mailed).toContainEqual({ to: tenant!.requesterEmail, subject: 'INC-000101 was updated' });
    const attempts = await inTenant(tenant!.id, (tx) => tx.deliveryAttempt.findMany({ where: { notificationId: id } }));
    expect(attempts.map((row) => row.status)).toEqual(['sent']);
    expect(suppressed('E2')).toBe(before);
  });
});

describe('E3, E4 and the page · the public status page', () => {
  it('takes a demo subscription with the usual answer, stores no address and sends nothing', async () => {
    const before = suppressed('E4');
    const response = await request<{ ok: boolean }>(`/status/${DEMO_SLUG}/subscribe`, { method: 'POST', body: { email: 'visitor@example.test' } });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(await inTenant(demo.id, (tx) => tx.statusSubscriber.count())).toBe(0);
    expect(mailed.filter((message) => message.to === 'visitor@example.test')).toEqual([]);
    expect(suppressed('E4')).toBe(before + 1);
  });

  it('asks a standard page’s subscriber to confirm, as before', async () => {
    const response = await request<{ ok: boolean }>(`/status/${STANDARD_SLUG}/subscribe`, { method: 'POST', body: { email: 'reader@example.test' } });

    expect(response.status).toBe(200);
    expect(await inTenant(standard.id, (tx) => tx.statusSubscriber.findMany({ select: { email: true, confirmedAt: true } }))).toEqual([
      { email: 'reader@example.test', confirmedAt: null },
    ]);
    expect(mailed).toContainEqual({ to: 'reader@example.test', subject: 'Confirm your status updates subscription' });
  });

  it('serves the demo’s page with no form and says why; the standard page keeps its form', async () => {
    const demoHtml = await request<string>(`/status/${DEMO_SLUG}`, { headers: { accept: 'text/html' } });
    expect(demoHtml.status).toBe(200);
    expect(demoHtml.body).toContain('Subscriptions are turned off for this demo.');
    expect(demoHtml.body).not.toContain('<form');
    expect((await request<{ demo?: boolean }>(`/status/${DEMO_SLUG}`)).body.demo).toBe(true);

    const standardHtml = await request<string>(`/status/${STANDARD_SLUG}`, { headers: { accept: 'text/html' } });
    expect(standardHtml.body).toContain(`action="/status/${STANDARD_SLUG}/subscribe"`);
    expect(standardHtml.body).not.toContain('Subscriptions are turned off');
    expect((await request<{ demo?: boolean }>(`/status/${STANDARD_SLUG}`)).body.demo).toBe(false);
  });

  it('e-mails no confirmed demo subscriber about maintenance; a standard one hears', async () => {
    for (const tenant of both()) {
      const windowId = newId();
      await inTenant(tenant.id, async (tx) => {
        const page = await tx.statusPage.findFirst();
        await tx.statusSubscriber.create({
          data: { id: newId(), tenantId: tenant.id, pageId: page!.id, email: `subscriber-${tenant.kind}@example.test`, confirmedAt: new Date() },
        });
        await tx.maintenanceWindow.create({
          data: { id: windowId, tenantId: tenant.id, pageId: page!.id, title: 'Payroll upgrade', startsAt: new Date('2030-01-05T22:00:00Z'), endsAt: new Date('2030-01-06T02:00:00Z') },
        });
      });
      const before = suppressed('E3');
      const sent = await publicService.notifySubscribers(contextFor(tenant.id), { maintenanceId: windowId });

      if (tenant.kind === 'demo') {
        expect(sent).toBe(0);
        expect(mailed.filter((message) => message.to === 'subscriber-demo@example.test')).toEqual([]);
        expect(suppressed('E3')).toBe(before + 1);
      } else {
        expect(sent).toBe(1);
        expect(mailed.map((message) => message.to)).toContain('subscriber-standard@example.test');
        expect(suppressed('E3')).toBe(before);
      }
    }
  });
});

describe('E5 · mirroring onto the public page', () => {
  it('mirrors a customer-facing major incident for the standard tenant only', async () => {
    const handler = handlersFor('incident.major.declared').find((one) => one.consumer === 'statuspage')!;
    expect(handler).toBeDefined();

    for (const tenant of both()) {
      const incidentId = newId();
      await inTenant(tenant.id, (tx) =>
        tx.majorIncident.create({
          data: { id: incidentId, tenantId: tenant.id, number: 'MI-9901', title: 'Payroll is unavailable', severity: 'SEV2', customerFacing: true, commanderId: tenant.agentId },
        }),
      );
      const before = suppressed('E5');
      const envelope = { id: newId(), type: 'incident.major.declared', tenantId: tenant.id, occurredAt: new Date().toISOString(), payload: { incidentId } } as never;
      await inTenant(tenant.id, (tx) => handler.handle(contextFor(tenant.id), envelope, tx));

      const mirrored = await inTenant(tenant.id, (tx) => tx.statusIncident.count({ where: { majorIncidentId: incidentId } }));
      expect(mirrored, tenant.kind).toBe(tenant.kind === 'demo' ? 0 : 1);
      expect(suppressed('E5')).toBe(before + (tenant.kind === 'demo' ? 1 : 0));
    }
  });
});

describe('E6, E7 and E8 · mail and chat transports', () => {
  it('gives a demo mailbox no transport, and a standard one its own (E6)', async () => {
    const before = suppressed('E6');
    await expect(transportForAccount({ transport: 'development' }, contextFor(demo.id))).resolves.toBeNull();
    expect((await transportForAccount({ transport: 'development' }, contextFor(standard.id)))?.name).toBe('development');
    expect(suppressed('E6')).toBe(before + 1);
  });

  it('sends an agent’s public reply to nobody in the demo, and to the standard requester by mail and chat (E7)', async () => {
    const handler = handlersFor('ticket.comment.added').find((one) => one.consumer === 'channels')!;
    expect(handler).toBeDefined();

    for (const tenant of both()) {
      const commentId = newId();
      await inTenant(tenant.id, (tx) =>
        tx.ticketComment.create({
          data: { id: commentId, tenantId: tenant.id, ticketId: tenant.ticketId, authorId: tenant.agentId, visibility: 'public', body: 'We have reset your VPN profile.' },
        }),
      );
      const before = { e7: suppressed('E7'), mailed: repliesMailed.length, posted: chatPosts.length };
      const envelope = {
        id: newId(),
        type: 'ticket.comment.added',
        tenantId: tenant.id,
        occurredAt: new Date().toISOString(),
        payload: { ticketId: tenant.ticketId, number: 'INC-000001', commentId, visibility: 'public' },
      } as never;
      await inTenant(tenant.id, (tx) => handler.handle(contextFor(tenant.id), envelope, tx));

      if (tenant.kind === 'demo') {
        expect(repliesMailed.length).toBe(before.mailed);
        expect(chatPosts.length).toBe(before.posted);
        expect(suppressed('E7')).toBe(before.e7 + 1);
      } else {
        expect(repliesMailed.slice(before.mailed)).toEqual([tenant.requesterEmail]);
        expect(chatPosts.slice(before.posted)).toEqual([{ roomId: 'C-standard', text: expect.stringContaining('We have reset your VPN profile.') }]);
        expect(suppressed('E7')).toBe(before.e7);
      }
    }
  });

  it('posts no chat reply or survey ask for the demo, and both for the standard tenant (E8)', async () => {
    for (const tenant of both()) {
      const before = { e8: suppressed('E8'), posted: chatPosts.length };
      await replyToChat(tenant.id, 'egress-chat', { roomId: `C-${tenant.kind}`, threadId: null, text: 'Added that to your ticket.' });
      const outcome = await inTenant(tenant.id, (tx) => postToTicketThread(contextFor(tenant.id), tx, tenant.ticketId, { text: 'How did we do?' }));

      if (tenant.kind === 'demo') {
        expect(outcome.posted).toBe(false);
        expect(chatPosts.length).toBe(before.posted);
        expect(suppressed('E8')).toBe(before.e8 + 2);
      } else {
        expect(outcome).toMatchObject({ posted: true, channel: 'slack' });
        expect(chatPosts.slice(before.posted).map((post) => post.text)).toEqual(['Added that to your ticket.', 'How did we do?']);
        expect(suppressed('E8')).toBe(before.e8);
      }
    }
  });
});

describe('E9 · live AI', () => {
  const fake: AiProvider = {
    name: 'egress-engine',
    models: ['egress-model'],
    processingRegion: 'eu-west',
    async complete(input) {
      modelAsks.push('complete');
      return { text: '{"summary":"ok"}', model: input.model, inputTokens: 1, outputTokens: 1, finishReason: 'stop' };
    },
    async decide() {
      modelAsks.push('decide');
      return { answers: { type: { value: 'incident', confidence: 0.9 } }, model: 'egress-model', inputTokens: 1, outputTokens: 1, providerRequestId: null };
    },
  };

  beforeAll(() => {
    registerModelPrices({ 'egress-model': { inputPerThousand: 1n, outputPerThousand: 1n } });
    addAiProvider(fake);
  });

  const question = { type: { kind: 'choice' as const, ask: 'Type?', options: ['incident', 'request'] } };

  it('decides by rules for the demo, every link skipped for the demo, and asks no provider', async () => {
    const before = suppressed('E9');
    const result = await decide({
      tenantId: demo.id,
      purpose: 'triage',
      state: { title: 'VPN will not connect' },
      questions: question,
      allowedRegions: ['eu-west'],
      budgetAvailable: true,
      chain: ['egress-engine'],
    });

    expect(result).toMatchObject({ decision: null, provider: 'rules' });
    expect(result.attempts).toEqual([expect.objectContaining({ provider: 'egress-engine', outcome: 'skipped', reason: 'demo' })]);
    expect(modelAsks).toEqual([]);
    expect(suppressed('E9')).toBe(before + 1);
  });

  it('refuses a demo model call with the demo’s sentence', async () => {
    const call = { capability: 'ticket-summary' as const, systemPrompt: 'Summarise.', template: '{{title}}', context: { title: 'VPN' }, model: 'egress-model', allowedRegions: ['eu-west'] };
    expect(DEMO_FEATURES).toContain('ai');
    await expect(callModel({ ...call, tenantId: demo.id })).rejects.toMatchObject({ status: 403, code: 'demo_disabled', feature: 'ai', message: demoDisabledSentence('ai') });
    expect(modelAsks).toEqual([]);
  });

  it('asks the provider for the standard tenant', async () => {
    const result = await decide({
      tenantId: standard.id,
      purpose: 'triage',
      state: { title: 'VPN will not connect' },
      questions: question,
      allowedRegions: ['eu-west'],
      budgetAvailable: true,
      chain: ['egress-engine'],
    });
    expect(result.provider).toBe('egress-engine');
    expect(modelAsks).toEqual(['decide']);
  });
});

describe('E10 · credentials', () => {
  it('resolves nothing for the demo before any resolver runs; the standard tenant’s resolves', async () => {
    const asked: string[] = [];
    registerSecretResolver('egress-suite', async (ctx, ref) => {
      asked.push(`${ctx?.tenantId ?? 'none'}:${ref}`);
      return ref === 'egress-ref' ? 'the-secret' : null;
    });
    const before = suppressed('E10');

    await expect(resolveSecret(contextFor(demo.id), 'egress-ref')).resolves.toBeNull();
    await expect(resolveSecret(contextFor(standard.id), 'egress-ref')).resolves.toBe('the-secret');
    expect(asked).toEqual([`${standard.id}:egress-ref`]);
    expect(suppressed('E10')).toBe(before + 1);
  });
});

describe('E11 · provider webhooks', () => {
  function deliver(address: string) {
    return request<{ status: string; outcome?: string }>(`/api/v1/channels/email/${encodeURIComponent(address)}/inbound`, {
      method: 'POST',
      body: { messageId: `<egress-${newId()}@example.test>`, from: 'stranger@example.test', subject: 'hello', text: 'anyone there?', headers: {} },
    });
  }

  it('ignores mail for a demo mailbox before anything is recorded; accepts the standard one’s', async () => {
    const before = suppressed('E11');
    const toDemo = await deliver(accounts.get('demo')!.email);
    expect(toDemo.status).toBe(202);
    expect(toDemo.body).toEqual({ status: 'ignored' });
    expect(await inTenant(demo.id, (tx) => tx.inboundMessage.count())).toBe(0);
    expect(suppressed('E11')).toBe(before + 1);

    const toStandard = await deliver(accounts.get('standard')!.email);
    expect(toStandard.status).toBe(202);
    expect(toStandard.body.status).toBe('accepted');
    expect(await inTenant(standard.id, (tx) => tx.inboundMessage.count())).toBe(1);
    expect(suppressed('E11')).toBe(before + 1);
  });

  it('ignores a chat delivery for a demo workspace before its signature is even checked', async () => {
    const before = suppressed('E11');
    for (const kind of ['demo', 'standard'] as const) {
      const response = await request<{ status: string }>(`/api/v1/channels/slack/${accounts.get(kind)!.chat}/inbound`, {
        method: 'POST',
        body: { type: 'event_callback', event: { type: 'message', text: 'help' } },
      });
      expect(response.status).toBe(202);
      expect(response.body.status).toBe('ignored');
    }
    // Only the standard workspace's delivery reached its transport's check.
    expect(chatVerified).toHaveLength(1);
    expect(chatVerified[0]).toContain(accounts.get('standard')!.chat);
    expect(suppressed('E11')).toBe(before + 1);
  });
});

describe('E12 · public links into a tenant', () => {
  async function invitationFor(tenant: ReturnType<typeof both>[number]): Promise<{ id: string; token: string }> {
    const id = newId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    // Signed with the deployment's key: what a forger holds when that key is
    // left at its default, and what a genuine link would carry.
    const token = signToken({ tenantId: tenant.id, kind: 'survey_invitation', subjectId: id, expiresAt: expiresAt.toISOString() });
    await inTenant(tenant.id, async (tx) => {
      const survey = await tx.surveyDefinition.findFirst({ where: { key: 'csat' } });
      const version = await tx.surveyVersion.findFirst({ where: { definitionId: survey!.id }, orderBy: { version: 'desc' } });
      await tx.surveyInvitation.create({
        data: { id, tenantId: tenant.id, surveyId: survey!.id, versionId: version!.id, ticketId: tenant.ticketId, recipientId: tenant.requesterId, tokenHash: digest(token), expiresAt },
      });
    });
    return { id, token };
  }

  it('answers a survey link into the demo with 404 and writes no response', async () => {
    const [tenant] = both();
    const { id, token } = await invitationFor(tenant!);
    const before = suppressed('E12');

    expect((await request(`/api/v1/public/surveys/${token}`)).status).toBe(404);
    const posted = await request(`/api/v1/public/surveys/${token}`, { method: 'POST', body: { rating: 1, comment: 'forged' } });
    expect(posted.status).toBe(404);

    const [responses, invitation] = await inTenant(tenant!.id, (tx) =>
      Promise.all([tx.surveyResponse.count({ where: { invitationId: id } }), tx.surveyInvitation.findFirst({ where: { id } })]),
    );
    expect(responses).toBe(0);
    expect(invitation?.status).toBe('pending');
    expect(suppressed('E12')).toBe(before + 2);
  });

  it('records the standard tenant’s answer, as before', async () => {
    const [, tenant] = both();
    const { id, token } = await invitationFor(tenant!);
    const posted = await request<{ ok: boolean }>(`/api/v1/public/surveys/${token}`, { method: 'POST', body: { rating: 5 } });

    expect(posted.status).toBe(200);
    expect(posted.body.ok).toBe(true);
    expect(await inTenant(tenant!.id, (tx) => tx.surveyResponse.count({ where: { invitationId: id } }))).toBe(1);
  });

  it('answers status-page confirm and unsubscribe links into the demo with 404 and changes no row', async () => {
    for (const tenant of both()) {
      const subscriberId = newId();
      await inTenant(tenant.id, async (tx) => {
        const page = await tx.statusPage.findFirst();
        await tx.statusSubscriber.create({ data: { id: subscriberId, tenantId: tenant.id, pageId: page!.id, email: `linked-${tenant.kind}@example.test` } });
      });
      const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
      const confirmLink = signToken({ tenantId: tenant.id, kind: 'status_confirm', subjectId: subscriberId, expiresAt });
      const unsubscribeLink = signToken({ tenantId: tenant.id, kind: 'status_unsubscribe', subjectId: subscriberId, expiresAt });
      const before = suppressed('E12');

      const confirmed = await request(`/status/${tenant.slug}/confirm/${confirmLink}`);
      const unsubscribed = await request(`/status/${tenant.slug}/unsubscribe/${unsubscribeLink}`);
      const row = await inTenant(tenant.id, (tx) => tx.statusSubscriber.findFirst({ where: { id: subscriberId } }));

      if (tenant.kind === 'demo') {
        expect([confirmed.status, unsubscribed.status]).toEqual([404, 404]);
        expect(row).toMatchObject({ confirmedAt: null, unsubscribedAt: null });
        expect(suppressed('E12')).toBe(before + 2);
      } else {
        expect([confirmed.status, unsubscribed.status]).toEqual([200, 200]);
        expect(row?.confirmedAt).not.toBeNull();
        expect(row?.unsubscribedAt).not.toBeNull();
        expect(suppressed('E12')).toBe(before);
      }
    }
  });
});
