import { z } from 'zod';
import { events } from '@itsm/contracts';
import { NotFoundError, ValidationError, authz, enqueue, metrics, newId, publish, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';
import {
  IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  componentStatusForImpact,
  maintenanceStatusAt,
  worstOf,
  type ComponentStatus,
  type Impact,
  type IncidentStatus,
  type MaintenanceStatus,
} from '../domain/status.js';
import { componentsForServices, loadPage } from './page-service.js';

/**
 * Incidents and maintenance on the page, from whichever side they arrive.
 *
 * Two doors again. An operator posts by hand through the API; MOD-08 posts
 * through the handlers. Both end in `openIncident`, `postUpdate`,
 * `resolveIncident` and `upsertMaintenance`, which write the rows, recompute
 * the components they touch, publish the event and queue the subscribers'
 * email — so the page cannot tell which door a line came through, and neither
 * can a subscriber.
 */

export const openIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  impact: z.enum(IMPACTS).default('minor'),
  status: z.enum(INCIDENT_STATUSES).default('investigating'),
  componentKeys: z.array(z.string()).max(50).default([]),
  body: z.string().min(1).max(5000),
});

export const updateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  body: z.string().min(1).max(5000),
});

export const maintenanceSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).nullable().optional(),
  componentKeys: z.array(z.string()).max(50).default([]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
});

// ---------------------------------------------------------------------------
// Components follow what touches them
// ---------------------------------------------------------------------------

/**
 * Sets each component to the worst of every open incident touching it, or
 * maintenance if a window is live over it, or operational. Recomputed rather
 * than nudged, so a component can never be left red by an incident that was
 * resolved through another door.
 */
export async function recomputeComponents(tx: Tx, componentIds: string[], now: Date = new Date()): Promise<void> {
  if (componentIds.length === 0) return;
  const open = await tx.statusIncident.findMany({ where: { status: { not: 'resolved' }, isVisible: true } });
  const windows = await tx.maintenanceWindow.findMany({ where: { status: { in: ['scheduled', 'in_progress'] } } });

  for (const componentId of new Set(componentIds)) {
    const fromIncidents = open
      .filter((incident) => incident.componentIds.includes(componentId))
      .map((incident) => componentStatusForImpact(incident.impact as Impact));
    const underMaintenance = windows.some(
      (window) => window.componentIds.includes(componentId) && maintenanceStatusAt({ ...window, status: window.status as MaintenanceStatus }, now) === 'in_progress',
    );
    const status: ComponentStatus = worstOf([...fromIncidents, ...(underMaintenance ? ['maintenance' as const] : [])]);
    await tx.statusComponent.update({ where: { id: componentId }, data: { status } });
  }
}

async function componentIdsForKeys(tx: Tx, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await tx.statusComponent.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  const missing = keys.filter((key) => !rows.some((row) => row.key === key));
  if (missing.length > 0) throw new ValidationError(`unknown component(s): ${missing.join(', ')}`);
  return rows.map((row) => row.id);
}

async function componentKeysForIds(tx: Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.statusComponent.findMany({ where: { id: { in: ids } }, select: { key: true }, orderBy: { order: 'asc' } });
  return rows.map((row) => row.key);
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

interface OpenInput {
  title: string;
  impact: Impact;
  status: IncidentStatus;
  componentIds: string[];
  body: string;
  source: 'major_incident' | 'manual';
  majorIncidentId?: string | null;
  sourceRef?: string | null;
  startedAt?: Date;
}

/** The single write path for a new incident on the page. */
export async function openIncident(ctx: TenantContext, tx: Tx, input: OpenInput, now: Date = new Date()) {
  const page = await loadPage(tx, ctx);
  const incident = await tx.statusIncident.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      pageId: page.id,
      majorIncidentId: input.majorIncidentId ?? null,
      title: input.title,
      impact: input.impact,
      status: input.status,
      componentIds: input.componentIds,
      startedAt: input.startedAt ?? now,
      createdBy: ctx.actor.id,
    },
  });
  await postUpdate(ctx, tx, incident.id, { status: input.status, body: input.body, source: input.source, sourceRef: input.sourceRef ?? null }, now);
  metrics.increment('status_incidents_total', { source: input.source });
  return incident;
}

/** A line on the timeline; moves the incident when it names a status. */
export async function postUpdate(
  ctx: TenantContext,
  tx: Tx,
  incidentId: string,
  input: { status?: IncidentStatus; body: string; source: 'major_incident' | 'manual'; sourceRef?: string | null },
  now: Date = new Date(),
) {
  const incident = await tx.statusIncident.findFirst({ where: { id: incidentId } });
  if (!incident) throw new NotFoundError('status incident', incidentId);
  const page = await loadPage(tx, ctx);

  // The same MOD-08 timeline entry delivered twice is one line, not two.
  if (input.sourceRef) {
    const seen = await tx.statusUpdate.findFirst({ where: { sourceRef: input.sourceRef } });
    if (seen) return seen;
  }

  const status = input.status ?? (incident.status as IncidentStatus);
  const update = await tx.statusUpdate.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      incidentId,
      status,
      body: input.body,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      postedAt: now,
      postedBy: ctx.actor.id,
    },
  });

  if (status !== incident.status) {
    await tx.statusIncident.update({
      where: { id: incidentId },
      data: { status, ...(status === 'resolved' ? { resolvedAt: now } : {}) },
    });
  }
  await recomputeComponents(tx, incident.componentIds, now);

  await publish(tx, ctx, {
    definition: events.statusIncidentUpdated,
    aggregateId: incidentId,
    payload: {
      incidentId,
      pageSlug: page.slug,
      title: incident.title,
      status,
      impact: incident.impact,
      componentKeys: await componentKeysForIds(tx, incident.componentIds),
      body: input.body,
      source: input.source,
    },
  });
  await enqueue(ctx, 'notify', 'status.notify', { updateId: update.id }, { idempotencyKey: `status-notify-${update.id}` });
  return update;
}

/**
 * Resolves, once. Delivery is unordered and at least once, so the resolution
 * can arrive from two directions — the public "resolved" update and the
 * `incident.major.resolved` event — and whichever is second finds it done.
 */
export async function resolveIncident(ctx: TenantContext, tx: Tx, incidentId: string, body: string, source: 'major_incident' | 'manual', sourceRef?: string | null) {
  const incident = await tx.statusIncident.findFirst({ where: { id: incidentId } });
  if (!incident) throw new NotFoundError('status incident', incidentId);
  if (incident.status === 'resolved') return null;
  return postUpdate(ctx, tx, incidentId, { status: 'resolved', body, source, sourceRef: sourceRef ?? null });
}

// ---- The operator's door ----------------------------------------------------

export async function openIncidentByHand(ctx: TenantContext, input: z.input<typeof openIncidentSchema>) {
  authz.require(ctx, 'statuspage.manage');
  const parsed = openIncidentSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const componentIds = await componentIdsForKeys(tx, parsed.componentKeys);
    const incident = await openIncident(ctx, tx, { ...parsed, componentIds, source: 'manual' });
    await recordAudit(tx, ctx, { action: 'statuspage.incident.opened', targetType: 'status_incident', targetId: incident.id, after: parsed });
    return incident;
  });
}

export async function postUpdateByHand(ctx: TenantContext, incidentId: string, input: z.input<typeof updateSchema>) {
  authz.require(ctx, 'statuspage.manage');
  const parsed = updateSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const update = await postUpdate(ctx, tx, incidentId, { ...parsed, source: 'manual' });
    await recordAudit(tx, ctx, { action: 'statuspage.incident.updated', targetType: 'status_incident', targetId: incidentId, after: parsed });
    return update;
  });
}

export async function editIncident(ctx: TenantContext, incidentId: string, input: { title?: string; impact?: Impact; componentKeys?: string[]; isVisible?: boolean }) {
  authz.require(ctx, 'statuspage.manage');
  return transaction(ctx, async (tx) => {
    const incident = await tx.statusIncident.findFirst({ where: { id: incidentId } });
    if (!incident) throw new NotFoundError('status incident', incidentId);
    const componentIds = input.componentKeys ? await componentIdsForKeys(tx, input.componentKeys) : incident.componentIds;
    const row = await tx.statusIncident.update({
      where: { id: incidentId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.impact !== undefined ? { impact: input.impact } : {}),
        ...(input.componentKeys !== undefined ? { componentIds } : {}),
        ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
      },
    });
    await recomputeComponents(tx, [...new Set([...incident.componentIds, ...componentIds])]);
    await recordAudit(tx, ctx, { action: 'statuspage.incident.edited', targetType: 'status_incident', targetId: incidentId, after: input });
    return row;
  });
}

export async function listIncidents(ctx: TenantContext, options: { limit?: number } = {}) {
  authz.require(ctx, 'statuspage.read');
  return transaction(ctx, (tx) =>
    tx.statusIncident.findMany({ orderBy: { startedAt: 'desc' }, take: options.limit ?? 50, include: { updates: { orderBy: { postedAt: 'asc' } } } }),
  );
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

interface MaintenanceInput {
  title: string;
  body: string | null;
  componentIds: string[];
  startsAt: Date;
  endsAt: Date;
  status?: MaintenanceStatus;
  source: 'change' | 'manual';
  changeId?: string | null;
}

/** Creates or moves a window; a change re-scheduled moves its notice rather than adding one. */
export async function upsertMaintenance(ctx: TenantContext, tx: Tx, input: MaintenanceInput, now: Date = new Date()) {
  if (input.endsAt <= input.startsAt) throw new ValidationError('a maintenance window must end after it starts');
  const page = await loadPage(tx, ctx);
  const existing = input.changeId ? await tx.maintenanceWindow.findFirst({ where: { changeId: input.changeId } }) : null;
  const status = input.status ?? maintenanceStatusAt({ startsAt: input.startsAt, endsAt: input.endsAt, status: 'scheduled' }, now);

  const data = {
    title: input.title,
    body: input.body,
    componentIds: input.componentIds,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status,
  };
  const window = existing
    ? await tx.maintenanceWindow.update({ where: { id: existing.id }, data })
    : await tx.maintenanceWindow.create({
        data: { id: newId(), tenantId: ctx.tenantId, pageId: page.id, changeId: input.changeId ?? null, createdBy: ctx.actor.id, ...data },
      });

  await recomputeComponents(tx, [...new Set([...(existing?.componentIds ?? []), ...input.componentIds])], now);
  await announceMaintenance(ctx, tx, window.id, input.source);
  metrics.increment('status_maintenance_total', { source: input.source });
  return window;
}

export async function setMaintenanceStatus(ctx: TenantContext, tx: Tx, windowId: string, status: MaintenanceStatus, source: 'change' | 'manual', now: Date = new Date()) {
  const window = await tx.maintenanceWindow.findFirst({ where: { id: windowId } });
  if (!window) throw new NotFoundError('maintenance window', windowId);
  if (window.status === status) return window;
  const row = await tx.maintenanceWindow.update({ where: { id: windowId }, data: { status } });
  await recomputeComponents(tx, window.componentIds, now);
  await announceMaintenance(ctx, tx, windowId, source);
  return row;
}

async function announceMaintenance(ctx: TenantContext, tx: Tx, windowId: string, source: 'change' | 'manual'): Promise<void> {
  const window = await tx.maintenanceWindow.findFirst({ where: { id: windowId } });
  if (!window) return;
  const page = await loadPage(tx, ctx);
  await publish(tx, ctx, {
    definition: events.statusMaintenanceScheduled,
    aggregateId: windowId,
    payload: {
      maintenanceId: windowId,
      pageSlug: page.slug,
      title: window.title,
      status: window.status,
      componentKeys: await componentKeysForIds(tx, window.componentIds),
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      source,
    },
  });
  await enqueue(ctx, 'notify', 'status.notify', { maintenanceId: windowId, status: window.status }, { idempotencyKey: `status-maint-${windowId}-${window.status}-${Date.now()}` });
}

/** Moves every window along by the clock. Run by the sweep. */
export async function sweepMaintenance(ctx: TenantContext, now: Date = new Date()): Promise<number> {
  return transaction(ctx, async (tx) => {
    const windows = await tx.maintenanceWindow.findMany({ where: { status: { in: ['scheduled', 'in_progress'] } } });
    let moved = 0;
    for (const window of windows) {
      const due = maintenanceStatusAt({ ...window, status: window.status as MaintenanceStatus }, now);
      if (due !== window.status) {
        await setMaintenanceStatus(ctx, tx, window.id, due, 'manual', now);
        moved += 1;
      }
    }
    return moved;
  });
}

// ---- The operator's door ----------------------------------------------------

export async function scheduleMaintenanceByHand(ctx: TenantContext, input: z.input<typeof maintenanceSchema>) {
  authz.require(ctx, 'statuspage.manage');
  const parsed = maintenanceSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const componentIds = await componentIdsForKeys(tx, parsed.componentKeys);
    const window = await upsertMaintenance(ctx, tx, {
      title: parsed.title,
      body: parsed.body ?? null,
      componentIds,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      ...(parsed.status ? { status: parsed.status } : {}),
      source: 'manual',
    });
    await recordAudit(tx, ctx, { action: 'statuspage.maintenance.scheduled', targetType: 'maintenance_window', targetId: window.id, after: parsed });
    return window;
  });
}

export async function updateMaintenanceByHand(ctx: TenantContext, windowId: string, input: Partial<z.input<typeof maintenanceSchema>>) {
  authz.require(ctx, 'statuspage.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.maintenanceWindow.findFirst({ where: { id: windowId } });
    if (!existing) throw new NotFoundError('maintenance window', windowId);
    const patch = maintenanceSchema.partial().parse(input);
    if (patch.status && Object.keys(patch).length === 1) {
      return setMaintenanceStatus(ctx, tx, windowId, patch.status, 'manual');
    }
    const componentIds = patch.componentKeys ? await componentIdsForKeys(tx, patch.componentKeys) : existing.componentIds;
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : existing.startsAt;
    const endsAt = patch.endsAt ? new Date(patch.endsAt) : existing.endsAt;
    if (endsAt <= startsAt) throw new ValidationError('a maintenance window must end after it starts');
    const row = await tx.maintenanceWindow.update({
      where: { id: windowId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        componentIds,
        startsAt,
        endsAt,
        ...(patch.status ? { status: patch.status } : {}),
      },
    });
    await recomputeComponents(tx, [...new Set([...existing.componentIds, ...componentIds])]);
    await announceMaintenance(ctx, tx, windowId, 'manual');
    await recordAudit(tx, ctx, { action: 'statuspage.maintenance.updated', targetType: 'maintenance_window', targetId: windowId, after: patch });
    return row;
  });
}

export async function listMaintenance(ctx: TenantContext) {
  authz.require(ctx, 'statuspage.read');
  return transaction(ctx, (tx) => tx.maintenanceWindow.findMany({ orderBy: { startsAt: 'desc' }, take: 50 }));
}

export { componentsForServices };
