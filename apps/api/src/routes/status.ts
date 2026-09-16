import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SlidingWindow, incidentService, pageService, publicService, renderNotice, renderStatusPage, type PublicTenant } from '@itsm/module-statuspage';
import { contextOf } from '../plugins/context.js';

/**
 * MOD-23. Two faces.
 *
 * The public one is served at the root, outside `/api`, because its URL is
 * printed on things: `/status/<tenant slug>` is the page, HTML to a browser
 * and JSON to anything else, and `/status` alone is the same page on a
 * tenant's own mapped domain. Nothing under it has a session; the context
 * plugin lets the prefix through and every handler resolves the tenant from
 * the path or the host and nothing else.
 *
 * The operator's face is under `/api/v1/status-page`, behind the usual
 * permissions.
 */

const wantsHtml = (accept: string | undefined) => (accept ?? '').includes('text/html');
const html = (reply: FastifyReply, body: string) => reply.type('text/html; charset=utf-8').send(body);

const bySlug = z.object({ slug: z.string().min(1).max(100) });
const withToken = bySlug.extend({ token: z.string().min(10).max(2000) });

// Five subscription attempts a quarter of an hour from one address is a person
// who mistyped their email twice; more is a script. Per tenant as well, so one
// page being hammered does not cost another its allowance.
const subscribeAttempts = new SlidingWindow(5, 15 * 60_000);

async function resolveTenant(request: FastifyRequest, slug: string | undefined): Promise<PublicTenant | null> {
  if (slug) return publicService.tenantForSlug(slug);
  return request.hostname ? publicService.tenantForHost(request.hostname.split(':')[0] ?? '') : null;
}

async function servePage(request: FastifyRequest, reply: FastifyReply, slug: string | undefined, message?: string) {
  const tenant = await resolveTenant(request, slug);
  const status = tenant ? await publicService.readPublicStatus(tenant) : null;
  if (!status) {
    reply.status(404);
    return wantsHtml(request.headers.accept) ? html(reply, renderNotice('Status', 'There is no status page here.')) : { error: 'not_found' };
  }
  reply.header('cache-control', 'public, max-age=30');
  return wantsHtml(request.headers.accept) ? html(reply, renderStatusPage(status, message)) : status;
}

export async function statusPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (request, reply) => servePage(request, reply, undefined));

  app.get('/status/:slug', async (request, reply) => {
    const { slug } = bySlug.parse(request.params);
    return servePage(request, reply, slug);
  });

  app.post('/status/:slug/subscribe', async (request, reply) => {
    const { slug } = bySlug.parse(request.params);
    const body = z.object({ email: z.string().trim().email().max(254) }).safeParse(request.body ?? {});
    const tenant = await publicService.tenantForSlug(slug);
    const back = pageService.pathFor(slug);

    if (!body.success) {
      reply.status(422);
      return wantsHtml(request.headers.accept)
        ? html(reply, renderNotice('Subscribe', 'That does not look like an email address.', back))
        : { error: 'invalid_email' };
    }
    // The answer is the same whether or not the page exists, and the same
    // whether or not the address was already subscribed: a stranger learns
    // nothing from it. Rationed per address and per client address.
    const client = request.ip ?? 'unknown';
    const allowed = subscribeAttempts.allow(`${slug}:${client}`) && subscribeAttempts.allow(`${slug}:${body.data.email.toLowerCase()}`);
    if (allowed && tenant) await publicService.subscribe(tenant, body.data.email);

    const message = 'If that address can receive email, a confirmation is on its way. Nothing is sent until you confirm.';
    if (wantsHtml(request.headers.accept)) {
      if (tenant) return servePage(request, reply, slug, message);
      return html(reply, renderNotice('Subscribe', message));
    }
    return { ok: true, message };
  });

  app.get('/status/:slug/confirm/:token', async (request, reply) => {
    const { slug, token } = withToken.parse(request.params);
    const result = await publicService.confirm(token);
    const back = pageService.pathFor(result.slug ?? slug);
    if (!result.ok) {
      reply.status(404);
      return wantsHtml(request.headers.accept)
        ? html(reply, renderNotice('Subscription', 'This confirmation link is not valid or has expired. Subscribe again to get a new one.', back))
        : { ok: false, error: 'invalid_link' };
    }
    return wantsHtml(request.headers.accept)
      ? html(reply, renderNotice('Subscribed', 'You will be emailed when something on this page changes.', back))
      : { ok: true };
  });

  app.get('/status/:slug/unsubscribe/:token', async (request, reply) => {
    const { slug, token } = withToken.parse(request.params);
    const result = await publicService.unsubscribe(token);
    const back = pageService.pathFor(result.slug ?? slug);
    if (!result.ok) {
      reply.status(404);
      return wantsHtml(request.headers.accept)
        ? html(reply, renderNotice('Unsubscribe', 'This link is not valid.', back))
        : { ok: false, error: 'invalid_link' };
    }
    return wantsHtml(request.headers.accept) ? html(reply, renderNotice('Unsubscribed', 'You will not be emailed again.', back)) : { ok: true };
  });
}

export async function statusAdminRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(64) });
  const byId = z.object({ id: z.string().uuid() });

  const component = (row: { id: string; key: string; name: string; description: string | null; groupName: string | null; order: number; serviceId: string | null; status: string; isVisible: boolean }) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    group: row.groupName,
    order: row.order,
    serviceId: row.serviceId,
    status: row.status,
    isVisible: row.isVisible,
  });

  const incident = (row: {
    id: string;
    majorIncidentId: string | null;
    title: string;
    impact: string;
    status: string;
    componentIds: string[];
    startedAt: Date;
    resolvedAt: Date | null;
    isVisible: boolean;
    updates?: { id: string; status: string; body: string; source: string; postedAt: Date; notifiedAt: Date | null }[];
  }) => ({
    id: row.id,
    majorIncidentId: row.majorIncidentId,
    title: row.title,
    impact: row.impact,
    status: row.status,
    componentIds: row.componentIds,
    startedAt: row.startedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    isVisible: row.isVisible,
    ...(row.updates
      ? { updates: row.updates.map((update) => ({ id: update.id, status: update.status, body: update.body, source: update.source, postedAt: update.postedAt.toISOString(), notifiedAt: update.notifiedAt?.toISOString() ?? null })) }
      : {}),
  });

  const window = (row: { id: string; changeId: string | null; title: string; body: string | null; componentIds: string[]; startsAt: Date; endsAt: Date; status: string }) => ({
    id: row.id,
    changeId: row.changeId,
    title: row.title,
    body: row.body,
    componentIds: row.componentIds,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
  });

  // ---- The page --------------------------------------------------------------

  app.get('/status-page', async (request) => {
    const ctx = contextOf(request);
    const page = await pageService.getPage(ctx);
    return {
      id: page.id,
      slug: page.slug,
      path: page.path,
      name: page.name,
      description: page.description,
      isPublic: page.isPublic,
      timeZone: page.timeZone,
      supportUrl: page.supportUrl,
      subscribers: page.subscribers,
      components: page.components.map(component),
    };
  });

  app.patch('/status-page', async (request) => {
    const ctx = contextOf(request);
    const row = await pageService.updatePage(ctx, request.body as never);
    return { id: row.id, slug: row.slug, path: row.path, name: row.name, description: row.description, isPublic: row.isPublic, timeZone: row.timeZone, supportUrl: row.supportUrl };
  });

  app.post('/status-page/components', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await pageService.createComponent(ctx, request.body as never);
    reply.status(201);
    return component(row);
  });

  app.patch('/status-page/components/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return component(await pageService.updateComponent(ctx, key, request.body as never));
  });

  app.delete('/status-page/components/:key', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    await pageService.deleteComponent(ctx, key);
    reply.status(204);
    return null;
  });

  // ---- Incidents, by hand ------------------------------------------------------

  app.get('/status-page/incidents', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const rows = await incidentService.listIncidents(ctx, { limit: query.limit });
    return { data: rows.map(incident) };
  });

  app.post('/status-page/incidents', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await incidentService.openIncidentByHand(ctx, request.body as never);
    reply.status(201);
    return incident(row);
  });

  app.patch('/status-page/incidents/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        impact: z.enum(['none', 'minor', 'major', 'critical']).optional(),
        componentKeys: z.array(z.string()).max(50).optional(),
        isVisible: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    return incident(await incidentService.editIncident(ctx, id, body));
  });

  app.post('/status-page/incidents/:id/updates', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await incidentService.postUpdateByHand(ctx, id, request.body as never);
    reply.status(201);
    return { id: row.id, status: row.status, body: row.body, source: row.source, postedAt: row.postedAt.toISOString() };
  });

  // ---- Maintenance, by hand ----------------------------------------------------

  app.get('/status-page/maintenance', async (request) => {
    const ctx = contextOf(request);
    const rows = await incidentService.listMaintenance(ctx);
    return { data: rows.map(window) };
  });

  app.post('/status-page/maintenance', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await incidentService.scheduleMaintenanceByHand(ctx, request.body as never);
    reply.status(201);
    return window(row);
  });

  app.patch('/status-page/maintenance/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return window(await incidentService.updateMaintenanceByHand(ctx, id, request.body as never));
  });

  // ---- Subscribers -------------------------------------------------------------

  app.get('/status-page/subscribers', async (request) => {
    const ctx = contextOf(request);
    const rows = await pageService.listSubscribers(ctx);
    return {
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.delete('/status-page/subscribers/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await pageService.removeSubscriber(ctx, id);
    reply.status(204);
    return null;
  });
}
