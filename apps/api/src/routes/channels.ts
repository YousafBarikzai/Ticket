import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  acceptInbound,
  transportForAccount,
  chatTransport,
  execute,
  handleChat,
  normalise,
  replyToChat,
  resolveAccountTenant,
} from '@itsm/module-channels';
import { systemContext, transaction, withContext, logger, metrics } from '@itsm/platform';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-03 channel intake.
 *
 * The provider webhook is the one route in the platform that is reached before
 * any tenant context exists — the message itself is what says which tenant it
 * belongs to. That makes it the route with the least margin for error, so it
 * does four things in a fixed order and nothing else: verify the signature,
 * resolve the account to a tenant, record the delivery idempotently, and hand
 * off. Anything that fails in that order returns 202, because a provider that
 * gets an error retries, and a retry of a message we deliberately rejected is
 * not a message we want again.
 */
export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.post('/channels/email/:accountKey/inbound', async (request, reply) => {
    const { accountKey } = z.object({ accountKey: z.string().min(1).max(200) }).parse(request.params);
    const headers = request.headers as Record<string, string | undefined>;

    // Which mailbox this claims to be for, before anything is trusted. Since
    // PH-3 each mailbox chooses its own provider (OD-03), so the delivery has
    // to be verified with that provider's rules rather than the deployment's —
    // a Graph notification and a Postmark webhook are verified in entirely
    // different ways, and a tenant on one must not be checked against the
    // other's rules.
    const address = decodeURIComponent(accountKey);
    const account = await resolveAccountTenant('email', address);
    if (!account) {
      reply.code(202);
      return { status: 'ignored' };
    }

    const transport = await transportForAccount(account.config);
    if (!transport) {
      logger.error('inbound email received for a mailbox with no usable transport', { address });
      reply.code(202);
      return { status: 'ignored' };
    }

    // The bytes that arrived, not a reconstruction of them: re-serialising
    // loses whitespace and can reorder keys, so an HMAC over it never matches.
    const rawBody = request.rawBody ?? (typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {}));
    if (!transport.verify(rawBody, headers)) {
      metrics.increment('channel_inbound_rejected_total', { channel: 'email', reason: 'bad_signature' });
      // 202 rather than 401: an unsigned request is either a misconfiguration
      // or a probe, and neither is improved by telling the sender which.
      reply.code(202);
      return { status: 'ignored' };
    }

    const parsed = transport.parseInbound(request.body, headers);
    if (!parsed) {
      reply.code(202);
      return { status: 'ignored' };
    }

    const accepted = await acceptInbound(parsed, address);
    if (accepted.status !== 'accepted' || !accepted.messageId) {
      reply.code(202);
      return { status: accepted.status, reason: accepted.reason ?? null };
    }

    const ctx = systemContext(account.tenantId, {
      actor: { type: 'channel', id: null, displayName: 'email' },
    });
    const result = await withContext(ctx, () =>
      transaction(ctx, (tx) => execute(ctx, tx, accepted.messageId!, normalise(parsed))),
    );

    reply.code(202);
    return { status: 'accepted', outcome: result.outcome, ticket: result.ticketNumber ?? null };
  });

  app.get('/channels/accounts', async (request) => {
    const ctx = contextOf(request);
    const { authz } = await import('@itsm/platform');
    authz.require(ctx, 'channel.account.read');
    return {
      data: await transaction(ctx, (tx) =>
        tx.channelAccount.findMany({ orderBy: [{ channel: 'asc' }, { key: 'asc' }] }),
      ),
    };
  });

  app.get('/channels/messages', async (request) => {
    const ctx = contextOf(request);
    const { authz } = await import('@itsm/platform');
    authz.require(ctx, 'channel.message.read');
    const query = z
      .object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    return {
      data: await transaction(ctx, (tx) =>
        tx.inboundMessage.findMany({
          where: query.status ? { status: query.status } : {},
          orderBy: { receivedAt: 'desc' },
          take: query.limit,
        }),
      ),
    };
  });

  app.post('/channels/identities', async (request, reply) => {
    const ctx = contextOf(request);
    const { authz, newId, recordAudit } = await import('@itsm/platform');
    authz.require(ctx, 'channel.identity.manage');
    const body = z
      .object({
        accountId: z.string().uuid(),
        channel: z.string().min(1).max(40),
        externalId: z.string().min(1).max(320),
        userId: z.string().uuid(),
      })
      .strict().parse(request.body);

    const created = await transaction(ctx, async (tx) => {
      const identity = await tx.channelIdentity.upsert({
        where: { tenantId_channel_externalId: { tenantId: ctx.tenantId, channel: body.channel, externalId: body.externalId.toLowerCase() } },
        create: {
          id: newId(),
          tenantId: ctx.tenantId,
          accountId: body.accountId,
          channel: body.channel,
          externalId: body.externalId.toLowerCase(),
          userId: body.userId,
          verified: true,
          verifiedAt: new Date(),
          method: 'admin',
        },
        update: { userId: body.userId, verified: true, verifiedAt: new Date(), method: 'admin' },
      });
      // Linking an address to a person is what lets mail from it act as them,
      // so it is audited like a role grant.
      await recordAudit(tx, ctx, {
        action: 'channel.identity.linked',
        targetType: 'channel_identity',
        targetId: identity.id,
        after: { channel: body.channel, externalId: body.externalId.toLowerCase(), userId: body.userId },
      });
      return identity;
    });

    reply.code(201);
    return created;
  });

  /**
   * The chat webhook.
   *
   * Same fixed order as the email one, and the same 202 for everything that
   * does not proceed: a provider that gets an error retries, and a retry of a
   * message deliberately rejected is not a message we want again.
   *
   * The one difference is the reply. A person who typed a slash command is
   * watching a spinner, so the answer goes back in the response rather than as
   * a second call — which also means a failure to post is a failure they can
   * see rather than silence.
   */
  app.post('/channels/:channel/:accountKey/inbound', async (request, reply) => {
    const params = z
      .object({
        channel: z.enum(['slack', 'teams', 'whatsapp', 'voice']),
        accountKey: z.string().min(1).max(200),
      })
      .parse(request.params);
    const headers = request.headers as Record<string, string | undefined>;

    // Slack asks for this once, when the endpoint is first configured, and it
    // is unsigned by definition. Answered before anything else and without
    // touching a tenant.
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.type === 'url_verification' && typeof body.challenge === 'string') {
      return { challenge: body.challenge };
    }

    const account = await resolveAccountTenant(params.channel, params.accountKey);
    if (!account) {
      reply.code(202);
      return { status: 'ignored' };
    }

    const config = (account.config ?? {}) as { transport?: string };
    const transport = chatTransport(config.transport ?? params.channel);
    if (!transport) {
      logger.error('inbound chat received for an account with no usable transport', {
        channel: params.channel,
        accountKey: params.accountKey,
      });
      reply.code(202);
      return { status: 'ignored' };
    }

    // The bytes that arrived. Reconstructing them is how a correct signature
    // check starts failing and gets turned off.
    const rawBody = request.rawBody ?? '';
    const url = `${request.protocol}://${request.hostname}${request.url}`;
    const verified = transport.verify({ rawBody, headers, url });
    if (!verified.ok) {
      metrics.increment('channel_inbound_rejected_total', {
        channel: params.channel,
        reason: verified.failure ?? 'bad_signature',
      });
      // 202, and no detail: an unsigned request is either a misconfiguration or
      // a probe, and neither is improved by telling the sender which.
      reply.code(202);
      return { status: 'ignored' };
    }

    const parsed = transport.parseInbound(request.body, headers);
    if (!parsed) {
      reply.code(202);
      return { status: 'ignored' };
    }

    const outcome = await handleChat(parsed, params.accountKey);

    if (outcome.reply) {
      // Posted rather than returned for an event; Slack shows nothing for an
      // Events API response body, and the person is looking at the thread.
      if (parsed.slashText !== undefined) {
        return { response_type: 'ephemeral', text: outcome.reply };
      }
      await replyToChat(config.transport ?? params.channel, {
        roomId: parsed.roomId,
        threadId: parsed.threadId,
        text: outcome.reply,
      });
    }

    reply.code(outcome.status === 'accepted' ? 200 : 202);
    return { status: outcome.status, ticketNumber: outcome.ticketNumber ?? null };
  });
}
