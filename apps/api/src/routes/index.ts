import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ForbiddenError,
  ValidationError,
  authz,
  metrics,
  permissionRegistry,
  subscribeTopics,
  topicForEntity,
  topicForUser,
} from '@itsm/platform';
import { userService } from '@itsm/module-identity';
import { auditService } from '@itsm/module-security';
import { notificationService } from '@itsm/module-notifications';
import { searchService } from '@itsm/module-search';
import { settingsService } from '@itsm/module-admin';
import { webhookService } from '@itsm/module-integrations';
import { tenantService } from '@itsm/module-tenancy';
import { contextOf } from '../plugins/context.js';
import { ticketRoutes } from './tickets.js';
import { ruleRoutes } from './rules.js';
import { approvalRoutes } from './approvals.js';
import { slaRoutes } from './sla.js';
import { notificationPreferenceRoutes } from './notification-preferences.js';
import { channelRoutes } from './channels.js';
import { catalogueRoutes } from './catalogue.js';
import { knowledgeRoutes } from './knowledge.js';
import { workflowRoutes } from './workflows.js';
import { integrationRoutes } from './integrations.js';
import { workloadRoutes } from './workload.js';
import { majorIncidentRoutes } from './major-incidents.js';
import { problemRoutes } from './problems.js';
import { changeRoutes } from './changes.js';
import { cmdbRoutes } from './cmdb.js';
import { discoveryRoutes } from './discovery.js';
import { analyticsRoutes } from './analytics.js';
import { feedbackRoutes } from './feedback.js';
import { timeRoutes } from './time.js';
import { platformRoutes } from './platform.js';

/** Mounts every module's routes under the versioned tenant prefix. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.register(
    async (v1) => {
      await ticketRoutes(v1);
      await identityRoutes(v1);
      await ruleRoutes(v1);
      await approvalRoutes(v1);
      await slaRoutes(v1);
      await notificationPreferenceRoutes(v1);
      await channelRoutes(v1);
      await catalogueRoutes(v1);
      await knowledgeRoutes(v1);
      await workflowRoutes(v1);
      await integrationRoutes(v1);
      await workloadRoutes(v1);
      await majorIncidentRoutes(v1);
      await problemRoutes(v1);
      await changeRoutes(v1);
      await cmdbRoutes(v1);
      await discoveryRoutes(v1);
      await analyticsRoutes(v1);
      await feedbackRoutes(v1);
      await timeRoutes(v1);
      await adminRoutes(v1);
      await supportingRoutes(v1);
    },
    { prefix: '/api/v1' },
  );

  app.register(platformRoutes, { prefix: '/api/platform/v1' });
}

async function identityRoutes(app: FastifyInstance): Promise<void> {
  /** Everything a client needs to render itself: identity, permissions, tenant. */
  app.get('/me', async (request) => {
    const ctx = contextOf(request);
    const tenant = await tenantService.findTenantById(ctx.tenantId);
    const organisations = await tenantService.listOrganisations(ctx);

    return {
      actor: { type: ctx.actor.type, id: ctx.actor.id, displayName: ctx.actor.displayName ?? null },
      tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug, region: tenant.region } : null,
      permissions: ctx.permissions.keys().map((key) => ({ key, scope: ctx.permissions.scopeFor(key) })),
      organisations: organisations
        .filter((org) => ctx.organisationIds.includes(org.id))
        .map((org) => ({ id: org.id, name: org.name, code: org.code, path: org.path })),
      teamIds: ctx.teamIds,
      locale: ctx.locale,
      timeZone: ctx.timeZone,
    };
  });

  app.get('/users', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), status: z.string().optional() })
      .parse(request.query);

    const users = await userService.listUsers(ctx, {
      limit: query.limit,
      ...(query.q ? { search: query.q } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
    return {
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        primaryOrgId: user.primaryOrgId,
      })),
    };
  });

  app.post('/users', async (request, reply) => {
    const ctx = contextOf(request);
    const user = await userService.createUser(ctx, userService.createUserSchema.parse(request.body));
    reply.status(201);
    return { id: user.id, email: user.email, displayName: user.displayName, status: user.status };
  });

  app.get('/users/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const user = await userService.getUser(ctx, id);
    return { id: user.id, email: user.email, displayName: user.displayName, status: user.status, primaryOrgId: user.primaryOrgId };
  });

  app.post('/users/:id/deactivate', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().max(1000).optional() }).parse(request.body ?? {});
    const user = await userService.deactivateUser(ctx, id, body.reason);
    return { id: user.id, status: user.status };
  });

  app.post('/role-assignments', async (request, reply) => {
    const ctx = contextOf(request);
    const body = z
      .object({
        userId: z.string().uuid(),
        roleKey: z.string().min(1).max(100),
        scopeType: z.enum(['organisation', 'team', 'service']).optional(),
        scopeId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const assignment = await userService.assignRole(ctx, body);
    reply.status(201);
    return { id: assignment.id, userId: assignment.userId, roleId: assignment.roleId };
  });

  app.delete('/role-assignments/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await userService.revokeRole(ctx, id);
    reply.status(204);
  });

  app.get('/me/sessions', async (request) => {
    const ctx = contextOf(request);
    if (!ctx.actor.id) return { data: [] };
    const sessions = await userService.listSessions(ctx, ctx.actor.id);
    return {
      data: sessions.map((session) => ({
        id: session.id,
        device: session.device,
        ip: session.ip,
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
    };
  });

  app.delete('/me/sessions/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await userService.revokeSession(ctx, id);
    reply.status(204);
  });

  app.get('/permissions', async () => ({
    data: permissionRegistry().map((permission) => ({
      key: permission.key,
      module: permission.module,
      scopes: permission.scopes,
      description: permission.description ?? null,
    })),
  }));

  app.get('/organisations', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'identity.org.read');
    const organisations = await tenantService.listOrganisations(ctx);
    return {
      data: organisations.map((org) => ({ id: org.id, name: org.name, code: org.code, path: org.path, parentId: org.parentId })),
    };
  });

  app.post('/organisations', async (request, reply) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'tenant.org.manage');
    const body = z
      .object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(60),
        parentId: z.string().uuid().optional(),
        type: z.string().max(60).optional(),
      })
      .parse(request.body);
    const org = await tenantService.createOrganisation(ctx, body);
    reply.status(201);
    return { id: org.id, name: org.name, code: org.code, path: org.path };
  });

  app.post('/teams', async (request, reply) => {
    const ctx = contextOf(request);
    const body = z
      .object({ key: z.string().min(1).max(100), name: z.string().min(1).max(200), orgId: z.string().uuid(), type: z.string().max(60).optional() })
      .parse(request.body);
    const team = await userService.createTeam(ctx, body);
    reply.status(201);
    return { id: team.id, key: team.key, name: team.name };
  });

  app.post('/teams/:id/members', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ userId: z.string().uuid(), isLead: z.boolean().default(false) }).parse(request.body);
    const membership = await userService.addTeamMember(ctx, id, body.userId, body.isLead);
    reply.status(201);
    return { teamId: membership.teamId, userId: membership.userId, isLead: membership.isLead };
  });
}

async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'admin.setting.read');
    return { data: settingsService.listDeclaredSettings() };
  });

  app.get('/settings/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(200) }).parse(request.params);
    return settingsService.getSettingWithProvenance(ctx, key);
  });

  app.put('/settings/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(200) }).parse(request.params);
    // `value` may legitimately be null or false, so it is required rather than
    // optional: an absent value is a malformed request, not a null setting.
    const body = z
      .object({
        value: z.unknown().refine((value) => value !== undefined, { message: 'value is required' }),
        scopeType: z.enum(['tenant', 'organisation']).optional(),
        scopeId: z.string().uuid().optional(),
        reason: z.string().max(1000).optional(),
      })
      .parse(request.body);
    const { value, ...rest } = body;
    return settingsService.publishSetting(ctx, { key, value, ...rest });
  });

  app.get('/settings/:key/versions', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(200) }).parse(request.params);
    const versions = await settingsService.listSettingVersions(ctx, key);
    return {
      data: versions.map((version) => ({
        version: version.version,
        value: version.value,
        reason: version.reason,
        publishedAt: version.publishedAt.toISOString(),
        publishedBy: version.publishedBy,
      })),
    };
  });

  app.post('/settings/:key/rollback', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(200) }).parse(request.params);
    const body = z.object({ toVersion: z.number().int().min(1), reason: z.string().max(1000).optional() }).parse(request.body);
    return settingsService.rollbackSetting(ctx, { key, ...body });
  });

  app.get('/feature-flags', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'admin.setting.read');
    return { data: settingsService.listDeclaredFlags() };
  });

  app.put('/feature-flags/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(200) }).parse(request.params);
    const body = z
      .object({ value: z.boolean(), scopeType: z.enum(['tenant', 'organisation']).optional(), scopeId: z.string().uuid().optional(), reason: z.string().max(1000).optional() })
      .parse(request.body);
    const override = await settingsService.setFlag(ctx, { key, ...body });
    return { key: override.key, value: override.value, scopeType: override.scopeType };
  });

  app.get('/modules', async (request) => {
    const ctx = contextOf(request);
    const installed = await settingsService.listInstalledModules(ctx);
    return { data: installed };
  });

  app.post('/modules/:id/:action', async (request) => {
    const ctx = contextOf(request);
    const { id, action } = z.object({ id: z.string().min(1).max(20), action: z.enum(['enable', 'disable']) }).parse(request.params);
    const record = await settingsService.setModuleEnabled(ctx, id, action === 'enable');
    return { moduleId: record.moduleId, enabled: record.enabled };
  });

  app.get('/admin/activity', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    const activity = await settingsService.listAdminActivity(ctx, query.limit);
    return {
      data: activity.map((row) => ({
        id: row.id,
        action: row.action,
        actorType: row.actorType,
        actorId: row.actorId,
        targetType: row.targetType,
        targetId: row.targetId,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  });
}

async function supportingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({
        q: z.string().min(1).max(200),
        types: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        /** `status:open,priority:P1` — repeated fields are "any of", different fields "all of". */
        filter: z.string().max(500).optional(),
        facets: z.string().max(200).optional(),
      })
      .parse(request.query);

    const filters: Record<string, string[]> = {};
    for (const pair of query.filter?.split(',').filter(Boolean) ?? []) {
      const separator = pair.indexOf(':');
      if (separator < 1) continue;
      const field = pair.slice(0, separator);
      (filters[field] ??= []).push(pair.slice(separator + 1));
    }

    const result = await searchService.searchWithFacets(ctx, {
      query: query.q,
      limit: query.limit,
      ...(query.types ? { types: query.types.split(',').filter(Boolean) } : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(query.facets ? { facetsToCount: query.facets.split(',').filter(Boolean) } : {}),
    });

    // `engine` is reported rather than hidden: when the search server is down
    // the answer comes from the PostgreSQL projection, which is correct but has
    // no typo tolerance and counts facets over the page only. A caller that
    // cannot tell the difference cannot explain it to a user.
    return { data: result.hits, meta: { facets: result.facetCounts, engine: result.engine } };
  });

  app.get('/notifications', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50), unread: z.coerce.boolean().default(false) })
      .parse(request.query);
    const inbox = await notificationService.listInbox(ctx, { limit: query.limit, unreadOnly: query.unread });
    return {
      unread: inbox.unread,
      data: inbox.data.map((notification) => ({
        id: notification.id,
        subject: notification.subject,
        body: notification.body,
        ticketId: notification.ticketId,
        eventType: notification.eventType,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
    };
  });

  app.post('/notifications/:id/read', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (id !== 'all' && !z.string().uuid().safeParse(id).success) {
      throw new ValidationError('id must be a notification id or "all"');
    }
    const count = await notificationService.markRead(ctx, id === 'all' ? 'all' : id);
    return { marked: count };
  });

  app.get('/audit-events', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({
        actorId: z.string().uuid().optional(),
        action: z.string().max(200).optional(),
        targetType: z.string().max(100).optional(),
        targetId: z.string().max(100).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        cursor: z.string().max(50).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);

    const result = await auditService.searchAuditEvents(ctx, query);
    return {
      data: result.data.map((row) => ({
        id: row.id,
        seq: row.seq,
        action: row.action,
        actorType: row.actorType,
        actorId: row.actorId,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before,
        after: row.after,
        reason: row.reason,
        correlationId: row.correlationId,
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  });

  app.get('/security/alerts', async (request) => {
    const ctx = contextOf(request);
    const alerts = await auditService.listAlerts(ctx);
    return {
      data: alerts.map((alert) => ({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        details: alert.details,
        createdAt: alert.createdAt.toISOString(),
      })),
    };
  });

  app.get('/webhooks', async (request) => {
    const ctx = contextOf(request);
    const subscriptions = await webhookService.listSubscriptions(ctx);
    return {
      data: subscriptions.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        url: subscription.url,
        eventTypes: subscription.eventTypes,
        status: subscription.status,
        failureCount: subscription.failureCount,
      })),
    };
  });

  app.post('/webhooks', async (request, reply) => {
    const ctx = contextOf(request);
    const body = z
      .object({
        name: z.string().min(1).max(200),
        url: z.string().url().max(2000),
        eventTypes: z.array(z.string().min(1).max(100)).min(1).max(50),
        filters: z.unknown().optional(),
      })
      .parse(request.body);
    const subscription = await webhookService.createSubscription(ctx, body as never);
    reply.status(201);
    // The signing secret is shown exactly once, at creation.
    return { id: subscription.id, name: subscription.name, url: subscription.url, secret: subscription.secret };
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await webhookService.deleteSubscription(ctx, id);
    reply.status(204);
  });

  /**
   * Server-sent events (ADR-0015). The stream carries only change notices;
   * clients refetch through the API, so nothing permission-sensitive travels
   * over the channel.
   */
  app.get('/events/stream', async (request, reply) => {
    const ctx = contextOf(request);
    const query = z.object({ topics: z.string().max(2000).optional() }).parse(request.query);

    const requested = (query.topics ?? '').split(',').filter(Boolean);
    const topics = [topicForUser(ctx.tenantId, ctx.actor.id ?? 'anonymous')];
    for (const topic of requested.slice(0, 20)) {
      const [entity, id] = topic.split(':');
      if (entity && id) topics.push(topicForEntity(ctx.tenantId, entity, id));
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-correlation-id': request.correlationId,
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ topics: topics.length })}\n\n`);

    const subscription = await subscribeTopics(topics, (_topic, notice) => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify(notice)}\n\n`);
    });
    // Heartbeats keep intermediaries from closing an idle stream.
    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      void subscription.close();
    });

    metrics.increment('sse_connections_total');
    return reply;
  });
}

export { ForbiddenError };
