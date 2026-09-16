import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  authz,
  logger,
  newId,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { filterSchema } from '../domain/filters.js';
import { RANGES } from '../domain/ranges.js';
import { evaluate, resolveMetric, type QueryResult } from './metric-service.js';

/**
 * Dashboards: shared and personal, in one table.
 *
 * A shared dashboard has no owner and needs `analytics.manage` to change; a
 * personal one belongs to whoever made it and needs only `analytics.read`.
 * Reading is the same permission for both, filtered by ownership, so a
 * person's private dashboard is never in anybody else's list — not by a
 * visibility flag somebody could forget, but because the query asks for
 * "shared, or mine".
 */

export const widgetSchema = z.object({
  title: z.string().min(1).max(120),
  type: z.enum(['number', 'timeseries', 'bar', 'table', 'trend']),
  metricKey: z.string().min(1).max(80),
  filters: z.array(filterSchema).max(20).default([]),
  groupBy: z.string().max(60).optional(),
  range: z.enum(RANGES.filter((range) => range !== 'custom') as [string, ...string[]]).default('30d'),
  width: z.number().int().min(1).max(12).default(4),
  options: z.record(z.unknown()).default({}),
});
export type WidgetInput = z.input<typeof widgetSchema>;

export const dashboardSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/).optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  /** Personal dashboards are the caller's own; anything else is shared. */
  personal: z.boolean().default(false),
  widgets: z.array(widgetSchema).max(24).default([]),
});
export type DashboardInput = z.input<typeof dashboardSchema>;

type DashboardRow = { id: string; key: string; name: string; description: string | null; ownerId: string | null; seeded: boolean; version: number; updatedAt: Date };

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dashboard';
}

/** Shared, or the caller's own. Anything else does not exist as far as they are concerned. */
function visibleWhere(ctx: TenantContext) {
  return { OR: [{ ownerId: null }, ...(ctx.actor.id ? [{ ownerId: ctx.actor.id }] : [])] };
}

async function loadVisible(tx: Tx, ctx: TenantContext, id: string): Promise<DashboardRow> {
  const row = await tx.dashboard.findFirst({ where: { id, ...visibleWhere(ctx) } });
  if (!row) throw new NotFoundError('dashboard', id);
  return row;
}

/** Changing a shared dashboard is management; changing your own is yours. */
function requireEditable(ctx: TenantContext, row: DashboardRow): void {
  if (row.ownerId === null) {
    authz.require(ctx, 'analytics.manage');
    return;
  }
  if (row.ownerId !== ctx.actor.id) throw new ForbiddenError('this dashboard belongs to somebody else');
}

export async function listDashboards(ctx: TenantContext) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, (tx) =>
    tx.dashboard.findMany({
      where: visibleWhere(ctx),
      orderBy: [{ ownerId: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { widgets: true } } },
    }),
  );
}

export async function getDashboard(ctx: TenantContext, id: string) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, async (tx) => {
    const row = await loadVisible(tx, ctx, id);
    const widgets = await tx.dashboardWidget.findMany({ where: { dashboardId: id }, orderBy: { position: 'asc' } });
    return { ...row, widgets };
  });
}

async function assertMetricsExist(ctx: TenantContext, tx: Tx, widgets: z.infer<typeof widgetSchema>[]): Promise<void> {
  for (const widget of widgets) await resolveMetric(ctx, widget.metricKey, tx);
}

async function writeWidgets(tx: Tx, tenantId: string, dashboardId: string, widgets: z.infer<typeof widgetSchema>[]): Promise<void> {
  await tx.dashboardWidget.deleteMany({ where: { dashboardId } });
  if (widgets.length === 0) return;
  await tx.dashboardWidget.createMany({
    data: widgets.map((widget, position) => ({
      id: newId(),
      tenantId,
      dashboardId,
      position,
      title: widget.title,
      type: widget.type,
      metricKey: widget.metricKey,
      filters: widget.filters as never,
      groupBy: widget.groupBy ?? null,
      range: widget.range,
      width: widget.width,
      options: widget.options as never,
    })),
  });
}

export async function createDashboard(ctx: TenantContext, input: DashboardInput) {
  const parsed = dashboardSchema.parse(input);
  authz.require(ctx, parsed.personal ? 'analytics.read' : 'analytics.manage');
  if (parsed.personal && !ctx.actor.id) throw new ForbiddenError('a personal dashboard needs a person');

  return transaction(ctx, async (tx) => {
    await assertMetricsExist(ctx, tx, parsed.widgets);
    // A personal key is namespaced by owner, so two people can each have "My week".
    const key = parsed.personal ? `${slug(parsed.name)}-${ctx.actor.id!.slice(0, 8)}` : (parsed.key ?? slug(parsed.name));
    const existing = await tx.dashboard.findFirst({ where: { key } });
    if (existing) throw new ConflictError(`a dashboard with the key ${key} already exists`);

    const row = await tx.dashboard.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key,
        name: parsed.name,
        description: parsed.description ?? null,
        ownerId: parsed.personal ? ctx.actor.id : null,
        createdBy: ctx.actor.id,
      },
    });
    await writeWidgets(tx, ctx.tenantId, row.id, parsed.widgets);
    await recordAudit(tx, ctx, { action: 'analytics.dashboard.created', targetType: 'dashboard', targetId: row.id, after: { key, name: parsed.name, personal: parsed.personal } });
    return row;
  });
}

export async function updateDashboard(ctx: TenantContext, id: string, input: Partial<DashboardInput>) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, async (tx) => {
    const row = await loadVisible(tx, ctx, id);
    requireEditable(ctx, row);

    const patch = dashboardSchema.partial().parse(input);
    if (patch.widgets) {
      await assertMetricsExist(ctx, tx, patch.widgets);
      await writeWidgets(tx, ctx.tenantId, id, patch.widgets);
    }
    const updated = await tx.dashboard.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.dashboard.updated', targetType: 'dashboard', targetId: id, after: { name: updated.name, widgets: patch.widgets?.length } });
    return updated;
  });
}

export async function deleteDashboard(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'analytics.read');
  await transaction(ctx, async (tx) => {
    const row = await loadVisible(tx, ctx, id);
    requireEditable(ctx, row);
    await tx.dashboard.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: 'analytics.dashboard.deleted', targetType: 'dashboard', targetId: id, before: { key: row.key, name: row.name } });
  });
}

export interface RenderedWidget {
  id: string;
  title: string;
  type: string;
  width: number;
  metricKey: string;
  result?: QueryResult;
  error?: string;
}

/**
 * Evaluates every widget. One widget failing — a metric deleted under it, a
 * filter that no longer fits — reports on that widget rather than taking the
 * dashboard down with it.
 */
export async function renderDashboard(ctx: TenantContext, id: string): Promise<{ dashboard: DashboardRow; widgets: RenderedWidget[] }> {
  const dashboard = await getDashboard(ctx, id);
  const widgets: RenderedWidget[] = [];

  for (const widget of dashboard.widgets) {
    const base = { id: widget.id, title: widget.title, type: widget.type, width: widget.width, metricKey: widget.metricKey };
    try {
      const result = await evaluate(ctx, {
        metricKey: widget.metricKey,
        filters: widget.filters as never,
        range: widget.range as never,
        ...(widget.groupBy ? { groupBy: widget.groupBy } : {}),
        series: widget.type === 'timeseries' || widget.type === 'trend',
      });
      widgets.push({ ...base, result });
    } catch (error) {
      logger.warn('widget failed to render', { dashboardId: id, widgetId: widget.id, error: (error as Error).message });
      widgets.push({ ...base, error: (error as Error).message });
    }
  }

  return { dashboard, widgets };
}

// ---------------------------------------------------------------------------
// The dashboards a tenant starts with.
// ---------------------------------------------------------------------------

const SEEDED: { key: string; name: string; description: string; widgets: WidgetInput[] }[] = [
  {
    key: 'service-desk',
    name: 'Service desk overview',
    description: 'The headline numbers for the last 30 days, and how they are moving.',
    widgets: [
      { title: 'Tickets raised', type: 'number', metricKey: 'tickets.created', width: 3 },
      { title: 'Tickets resolved', type: 'number', metricKey: 'tickets.resolved', width: 3 },
      { title: 'Still open', type: 'number', metricKey: 'tickets.open', width: 3 },
      { title: 'SLA attainment', type: 'number', metricKey: 'sla.attainment', width: 3 },
      { title: 'Raised per day', type: 'timeseries', metricKey: 'tickets.created', width: 8 },
      { title: 'By priority', type: 'bar', metricKey: 'tickets.created', groupBy: 'priority', width: 4 },
      { title: 'By channel', type: 'bar', metricKey: 'tickets.created', groupBy: 'channel', width: 6 },
      { title: 'Time to resolve, by team', type: 'bar', metricKey: 'tickets.time_to_resolve', groupBy: 'teamId', width: 6 },
    ],
  },
  {
    key: 'teams',
    name: 'Teams',
    description: 'Workload and speed by team over the last 90 days.',
    widgets: [
      { title: 'Raised, by team', type: 'bar', metricKey: 'tickets.created', groupBy: 'teamId', range: '90d', width: 6 },
      { title: 'Resolved, by team', type: 'bar', metricKey: 'tickets.resolved', groupBy: 'teamId', range: '90d', width: 6 },
      { title: 'First response, by team', type: 'bar', metricKey: 'tickets.first_response', groupBy: 'teamId', range: '90d', width: 6 },
      { title: 'Breached, by team', type: 'bar', metricKey: 'tickets.breached', groupBy: 'teamId', range: '90d', width: 6 },
      { title: 'Task completion time', type: 'timeseries', metricKey: 'tasks.completion_time', range: '90d', width: 12 },
    ],
  },
  {
    key: 'sla',
    name: 'SLA',
    description: 'Attainment and breaches, and where the misses come from.',
    widgets: [
      { title: 'Attainment', type: 'number', metricKey: 'sla.attainment', width: 4 },
      { title: 'Breaches', type: 'number', metricKey: 'sla.breaches', width: 4 },
      { title: 'Resolved within target (p90 minutes)', type: 'number', metricKey: 'tickets.time_to_resolve_p90', width: 4 },
      { title: 'Attainment over time', type: 'trend', metricKey: 'sla.attainment', range: '90d', width: 12 },
      { title: 'Breaches by priority', type: 'bar', metricKey: 'sla.breaches', groupBy: 'priority', width: 6 },
      { title: 'Breaches by target', type: 'bar', metricKey: 'sla.breaches', groupBy: 'target', width: 6 },
    ],
  },
];

/** Idempotent: a dashboard that already exists is left exactly as the tenant has it. */
export async function seedAnalyticsDefaults(ctx: TenantContext): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    let created = 0;
    for (const dashboard of SEEDED) {
      const existing = await tx.dashboard.findFirst({ where: { key: dashboard.key } });
      if (existing) continue;
      const row = await tx.dashboard.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: dashboard.key,
          name: dashboard.name,
          description: dashboard.description,
          ownerId: null,
          seeded: true,
        },
      });
      await writeWidgets(tx, ctx.tenantId, row.id, dashboard.widgets.map((widget) => widgetSchema.parse(widget)));
      created += 1;
    }
    return { created };
  });
}
