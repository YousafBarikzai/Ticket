import {
  buildPermissionSet,
  createContext,
  loadConfig,
  logger,
  metrics,
  newId,
  signToken,
  transaction,
  verifyToken,
  withContext,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import { transportFor } from '@itsm/module-notifications';
import { overallStatus, type ComponentStatus, type MaintenanceStatus } from '../domain/status.js';
import { pathFor } from './page-service.js';

/**
 * The public side: reading the page with no session, and subscribing.
 *
 * A public request has no token and no tenant; it has a slug in the path, or
 * a host that a tenant mapped. Either resolves through the tenant directory,
 * which is the one thing the platform may look up before a tenant is known
 * (ADR-0035). The read then runs as nobody — a context with no permissions,
 * which reaches exactly the rows the page is made of because none of these
 * reads consult authz, and the database lets it see only that tenant.
 */

export interface PublicStatus {
  page: { slug: string; name: string; description: string | null; supportUrl: string | null; path: string };
  overall: ComponentStatus;
  components: { key: string; name: string; description: string | null; group: string | null; status: ComponentStatus }[];
  incidents: {
    id: string;
    title: string;
    impact: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    components: string[];
    updates: { status: string; body: string; postedAt: string }[];
  }[];
  maintenance: { id: string; title: string; body: string | null; status: MaintenanceStatus; startsAt: string; endsAt: string; components: string[] }[];
  generatedAt: string;
}

/** A tenant as the public side needs it: enough to read its page and address it. */
export interface PublicTenant {
  id: string;
  slug: string;
}

const RECENT_DAYS = 7;

/** A context for reading a tenant's page as the public. */
export function publicContext(tenantId: string): TenantContext {
  return createContext({ tenantId, actor: { type: 'system', id: null, displayName: 'public' }, permissions: buildPermissionSet([]) });
}

function servable(tenant: { id: string; slug: string; status: string } | null): PublicTenant | null {
  // A suspended tenant's page is not served: the page is a statement by the
  // desk, and a desk that has been switched off is not making any.
  if (!tenant || tenant.status !== 'active') return null;
  return { id: tenant.id, slug: tenant.slug };
}

/** The tenant behind /status/<slug>. */
export async function tenantForSlug(slug: string): Promise<PublicTenant | null> {
  return servable(await tenantService.findTenantBySlug(slug));
}

/** The tenant behind a mapped host, for a page on the tenant's own domain. */
export async function tenantForHost(host: string): Promise<PublicTenant | null> {
  return servable(await tenantService.findTenantByHost(host));
}

export async function readPublicStatus(tenant: PublicTenant, now: Date = new Date()): Promise<PublicStatus | null> {
  const ctx = publicContext(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const page = await tx.statusPage.findFirst({ where: { tenantId: tenant.id, isPublic: true } });
      if (!page) return null;

      const components = await tx.statusComponent.findMany({ where: { pageId: page.id, isVisible: true }, orderBy: [{ groupName: 'asc' }, { order: 'asc' }, { name: 'asc' }] });
      const byId = new Map(components.map((component) => [component.id, component.key]));
      const since = new Date(now.getTime() - RECENT_DAYS * 24 * 3600 * 1000);
      const incidents = await tx.statusIncident.findMany({
        where: { pageId: page.id, isVisible: true, OR: [{ status: { not: 'resolved' } }, { resolvedAt: { gte: since } }] },
        orderBy: { startedAt: 'desc' },
        include: { updates: { orderBy: { postedAt: 'desc' } } },
      });
      const maintenance = await tx.maintenanceWindow.findMany({
        where: { pageId: page.id, status: { in: ['scheduled', 'in_progress'] } },
        orderBy: { startsAt: 'asc' },
      });

      return {
        page: { slug: tenant.slug, name: page.name, description: page.description, supportUrl: page.supportUrl, path: pathFor(tenant.slug) },
        overall: overallStatus(components.map((component) => ({ status: component.status as ComponentStatus, isVisible: component.isVisible }))),
        components: components.map((component) => ({
          key: component.key,
          name: component.name,
          description: component.description,
          group: component.groupName,
          status: component.status as ComponentStatus,
        })),
        incidents: incidents.map((incident) => ({
          id: incident.id,
          title: incident.title,
          impact: incident.impact,
          status: incident.status,
          startedAt: incident.startedAt.toISOString(),
          resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          components: incident.componentIds.map((id) => byId.get(id)).filter((key): key is string => Boolean(key)),
          updates: incident.updates.map((update) => ({ status: update.status, body: update.body, postedAt: update.postedAt.toISOString() })),
        })),
        maintenance: maintenance.map((window) => ({
          id: window.id,
          title: window.title,
          body: window.body,
          status: window.status as MaintenanceStatus,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          components: window.componentIds.map((id) => byId.get(id)).filter((key): key is string => Boolean(key)),
        })),
        generatedAt: now.toISOString(),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

const CONFIRM_DAYS = 3;

function statusUrl(slug: string): string {
  return `${loadConfig().API_BASE_URL}${pathFor(slug)}`;
}

function link(slug: string, kind: 'confirm' | 'unsubscribe', tenantId: string, subscriberId: string, expiresAt: Date): string {
  const token = signToken({ tenantId, kind: `status_${kind}`, subjectId: subscriberId, expiresAt: expiresAt.toISOString() });
  return `${statusUrl(slug)}/${kind}/${token}`;
}

async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
  const transport = transportFor('email');
  if (!transport) {
    logger.warn('no email transport is registered; a status-page email was not sent', { subject });
    return false;
  }
  await transport.send({ to, subject, body });
  return true;
}

/**
 * Asks for confirmation. Says the same thing whether the address is new,
 * already subscribed, already asked, or the page is private: the page must
 * not be a way to find out who subscribes to it, or whether it exists.
 */
export async function subscribe(tenant: PublicTenant, email: string, now: Date = new Date()): Promise<{ ok: true }> {
  const ctx = publicContext(tenant.id);
  const address = email.trim().toLowerCase();
  const result = await withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const page = await tx.statusPage.findFirst({ where: { tenantId: tenant.id, isPublic: true } });
      if (!page) return null;
      let subscriber = await tx.statusSubscriber.findFirst({ where: { email: address } });
      if (subscriber?.confirmedAt && !subscriber.unsubscribedAt) return { subscriber, alreadyConfirmed: true };
      if (!subscriber) {
        subscriber = await tx.statusSubscriber.create({ data: { id: newId(), tenantId: tenant.id, pageId: page.id, email: address } });
      } else if (subscriber.unsubscribedAt) {
        subscriber = await tx.statusSubscriber.update({ where: { id: subscriber.id }, data: { unsubscribedAt: null, confirmedAt: null } });
      }
      return { subscriber, alreadyConfirmed: false };
    }),
  );
  if (!result || result.alreadyConfirmed) return { ok: true };

  const expiresAt = new Date(now.getTime() + CONFIRM_DAYS * 24 * 3600 * 1000);
  await sendMail(
    address,
    'Confirm your status updates subscription',
    `Somebody asked for status updates to be sent to this address.\n\nIf that was you, confirm here (the link works for ${CONFIRM_DAYS} days):\n${link(tenant.slug, 'confirm', tenant.id, result.subscriber.id, expiresAt)}\n\nIf it was not, ignore this message and nothing further will be sent.`,
  );
  metrics.increment('status_subscriptions_total', { step: 'requested' });
  return { ok: true };
}

/** The slug a signed link belongs to, so the notice can send the person back to the page. */
async function slugOf(tenantId: string): Promise<string | null> {
  const tenant = await tenantService.findTenantById(tenantId);
  return tenant?.slug ?? null;
}

export async function confirm(token: string, now: Date = new Date()): Promise<{ ok: boolean; slug: string | null }> {
  const verdict = verifyToken(token, now);
  if (!verdict.ok || verdict.payload.kind !== 'status_confirm') return { ok: false, slug: null };
  const slug = await slugOf(verdict.payload.tenantId);
  if (!slug) return { ok: false, slug: null };
  const ctx = publicContext(verdict.payload.tenantId);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const subscriber = await tx.statusSubscriber.findFirst({ where: { id: verdict.payload.subjectId } });
      if (!subscriber) return { ok: false, slug };
      if (!subscriber.confirmedAt || subscriber.unsubscribedAt) {
        await tx.statusSubscriber.update({ where: { id: subscriber.id }, data: { confirmedAt: now, unsubscribedAt: null } });
        metrics.increment('status_subscriptions_total', { step: 'confirmed' });
      }
      return { ok: true, slug };
    }),
  );
}

export async function unsubscribe(token: string, now: Date = new Date()): Promise<{ ok: boolean; slug: string | null }> {
  const verdict = verifyToken(token, now);
  if (!verdict.ok || verdict.payload.kind !== 'status_unsubscribe') return { ok: false, slug: null };
  const slug = await slugOf(verdict.payload.tenantId);
  if (!slug) return { ok: false, slug: null };
  const ctx = publicContext(verdict.payload.tenantId);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const subscriber = await tx.statusSubscriber.findFirst({ where: { id: verdict.payload.subjectId } });
      if (!subscriber) return { ok: false, slug };
      if (!subscriber.unsubscribedAt) {
        await tx.statusSubscriber.update({ where: { id: subscriber.id }, data: { unsubscribedAt: now } });
        metrics.increment('status_subscriptions_total', { step: 'unsubscribed' });
      }
      return { ok: true, slug };
    }),
  );
}

/** Every confirmed subscriber, with a working unsubscribe link each. */
async function confirmedSubscribers(tx: Tx, tenantId: string, slug: string) {
  const rows = await tx.statusSubscriber.findMany({ where: { confirmedAt: { not: null }, unsubscribedAt: null } });
  // An unsubscribe link in an old email should still work: a year, not a day.
  const farOff = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  return rows.map((row) => ({ email: row.email, unsubscribeUrl: link(slug, 'unsubscribe', tenantId, row.id, farOff) }));
}

/**
 * Tells subscribers about one update or one maintenance notice. Run as a
 * job, so the sending is outside the transaction that wrote the row and a
 * slow mail server holds up nothing but itself. The row is marked before
 * anything is sent, so a job retried after a partial send does not send
 * everybody the same email twice.
 */
export async function notifySubscribers(ctx: TenantContext, input: { updateId?: string; maintenanceId?: string; status?: string }): Promise<number> {
  const prepared = await transaction(ctx, async (tx) => {
    const page = await tx.statusPage.findFirst({ where: { tenantId: ctx.tenantId } });
    const tenant = await tx.tenant.findFirst({ where: { id: ctx.tenantId }, select: { slug: true } });
    if (!page || !tenant) return null;
    const url = statusUrl(tenant.slug);

    let subject: string;
    let body: string;
    if (input.updateId) {
      const update = await tx.statusUpdate.findFirst({ where: { id: input.updateId }, include: { incident: true } });
      if (!update || update.notifiedAt) return null;
      subject = `[${page.name} status] ${update.incident.title}: ${update.status}`;
      body = `${update.incident.title}\nStatus: ${update.status} · Impact: ${update.incident.impact}\n\n${update.body}\n\nSee the page: ${url}`;
      await tx.statusUpdate.update({ where: { id: update.id }, data: { notifiedAt: new Date() } });
    } else if (input.maintenanceId) {
      const window = await tx.maintenanceWindow.findFirst({ where: { id: input.maintenanceId } });
      if (!window) return null;
      // A window is announced on every change of status, so the marker is
      // per status rather than once: the job payload says which.
      if (input.status && input.status !== window.status) return null;
      subject = `[${page.name} status] Maintenance ${window.status.replace('_', ' ')}: ${window.title}`;
      body = `${window.title}\n${window.startsAt.toISOString()} to ${window.endsAt.toISOString()}\n\n${window.body ?? ''}\n\nSee the page: ${url}`;
      await tx.maintenanceWindow.update({ where: { id: window.id }, data: { notifiedAt: new Date() } });
    } else {
      return null;
    }

    return { subject, body, recipients: await confirmedSubscribers(tx, ctx.tenantId, tenant.slug) };
  });
  if (!prepared) return 0;

  let sent = 0;
  for (const subscriber of prepared.recipients) {
    const ok = await sendMail(subscriber.email, prepared.subject, `${prepared.body}\n\nUnsubscribe: ${subscriber.unsubscribeUrl}`);
    if (ok) sent += 1;
  }
  metrics.increment('status_notifications_sent_total', {}, sent);
  return sent;
}
