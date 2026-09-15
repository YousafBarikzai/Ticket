import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authz } from '@itsm/platform';
import {
  checkTicketDrift,
  dashboardService,
  metricService,
  rebuildRange,
  replayProjection,
  reportService,
} from '@itsm/module-analytics';
import { contextOf } from '../plugins/context.js';

/** MOD-12 metrics, dashboards, reports and the projection's own controls. */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(80) });

  // ---- Metrics -----------------------------------------------------------

  app.get('/analytics/metrics', async (request) => {
    const ctx = contextOf(request);
    const data = await metricService.listMetrics(ctx);
    return { data, facts: metricService.describeFacts() };
  });

  app.post('/analytics/metrics', async (request, reply) => {
    const ctx = contextOf(request);
    const metric = await metricService.createMetric(ctx, request.body as never);
    reply.status(201);
    return metric;
  });

  app.patch('/analytics/metrics/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    return metricService.updateMetric(ctx, key, request.body as never);
  });

  app.delete('/analytics/metrics/:key', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    await metricService.deleteMetric(ctx, key);
    reply.status(204);
    return null;
  });

  /** One question, answered: a number, a series or a breakdown. */
  app.post('/analytics/query', async (request) => {
    const ctx = contextOf(request);
    return metricService.evaluate(ctx, request.body as never);
  });

  app.post('/analytics/forecast', async (request) => {
    const ctx = contextOf(request);
    return metricService.forecast(ctx, request.body as never);
  });

  // ---- Dashboards --------------------------------------------------------

  const dashboard = (row: { id: string; key: string; name: string; description: string | null; ownerId: string | null; seeded: boolean; version: number; updatedAt: Date }) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    personal: row.ownerId !== null,
    seeded: row.seeded,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  });

  app.get('/analytics/dashboards', async (request) => {
    const ctx = contextOf(request);
    const rows = await dashboardService.listDashboards(ctx);
    return { data: rows.map((row) => ({ ...dashboard(row), widgetCount: row._count.widgets })) };
  });

  app.post('/analytics/dashboards', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await dashboardService.createDashboard(ctx, request.body as never);
    reply.status(201);
    return dashboard(row);
  });

  app.get('/analytics/dashboards/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await dashboardService.getDashboard(ctx, id);
    return { ...dashboard(row), widgets: row.widgets };
  });

  app.patch('/analytics/dashboards/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return dashboard(await dashboardService.updateDashboard(ctx, id, request.body as never));
  });

  app.delete('/analytics/dashboards/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await dashboardService.deleteDashboard(ctx, id);
    reply.status(204);
    return null;
  });

  /** Every widget evaluated: what a client draws. */
  app.get('/analytics/dashboards/:id/render', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const rendered = await dashboardService.renderDashboard(ctx, id);
    return { ...dashboard(rendered.dashboard), widgets: rendered.widgets };
  });

  // ---- Reports -----------------------------------------------------------

  app.get('/analytics/reports', async (request) => {
    const ctx = contextOf(request);
    const rows = await reportService.listReports(ctx);
    return {
      data: rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        sections: row.sections,
        schedules: row._count.schedules,
        runs: row._count.runs,
        version: row.version,
      })),
    };
  });

  app.post('/analytics/reports', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await reportService.createReport(ctx, request.body as never);
    reply.status(201);
    return { id: row.id, key: row.key, name: row.name };
  });

  app.get('/analytics/reports/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await reportService.getReport(ctx, id);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      sections: row.sections,
      version: row.version,
      schedules: row.schedules.map((schedule) => ({
        id: schedule.id,
        frequency: schedule.frequency,
        hour: schedule.hour,
        minute: schedule.minute,
        dayOfWeek: schedule.dayOfWeek,
        dayOfMonth: schedule.dayOfMonth,
        timeZone: schedule.timeZone,
        recipients: schedule.recipients,
        isActive: schedule.isActive,
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt.toISOString(),
      })),
    };
  });

  app.patch('/analytics/reports/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await reportService.updateReport(ctx, id, request.body as never);
    return { id: row.id, key: row.key, name: row.name, version: row.version };
  });

  app.delete('/analytics/reports/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await reportService.deleteReport(ctx, id);
    reply.status(204);
    return null;
  });

  /** Runs a report now over a period of the caller's choosing (default: last 30 days). */
  app.post('/analytics/reports/:id/run', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const body = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(request.body ?? {});
    const period = body.from && body.to ? { from: new Date(body.from), to: new Date(body.to) } : undefined;
    const run = await reportService.runReport(ctx, id, period ? { period } : {});
    reply.status(201);
    return { id: run.id, status: run.status, period: run.period, summary: run.summary, rowCount: run.rowCount, sections: run.sections };
  });

  app.get('/analytics/reports/:id/runs', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query);
    const runs = await reportService.listRuns(ctx, id, limit);
    return { data: runs.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null })) };
  });

  app.post('/analytics/reports/:id/schedules', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await reportService.createSchedule(ctx, id, request.body as never);
    reply.status(201);
    return { id: row.id, nextRunAt: row.nextRunAt.toISOString() };
  });

  app.patch('/analytics/report-schedules/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await reportService.updateSchedule(ctx, id, request.body as never);
    return { id: row.id, isActive: row.isActive, nextRunAt: row.nextRunAt.toISOString() };
  });

  app.delete('/analytics/report-schedules/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await reportService.deleteSchedule(ctx, id);
    reply.status(204);
    return null;
  });

  app.get('/analytics/report-runs/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const run = await reportService.getRun(ctx, id);
    return {
      id: run.id,
      report: run.report,
      status: run.status,
      periodFrom: run.periodFrom.toISOString(),
      periodTo: run.periodTo.toISOString(),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      rowCount: run.rowCount,
      summary: run.summary,
      error: run.error,
      result: run.result,
    };
  });

  /** The link a report notification carries. Permission-checked like any other read. */
  app.get('/analytics/report-runs/:id/csv', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const { filename, csv } = await reportService.csvForRun(ctx, id);
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      // A CSV is data, never a page: nothing in it should be interpreted.
      .header('x-content-type-options', 'nosniff');
    return csv;
  });

  // ---- The projection itself --------------------------------------------

  app.post('/analytics/rebuild', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'analytics.admin');
    const body = z.object({ from: z.string().datetime(), to: z.string().datetime().optional() }).parse(request.body ?? {});
    return rebuildRange(ctx, new Date(body.from), body.to ? new Date(body.to) : new Date());
  });

  app.post('/analytics/replay', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(request.body ?? {});
    return replayProjection(ctx, {
      ...(body.from ? { from: new Date(body.from) } : {}),
      ...(body.to ? { to: new Date(body.to) } : {}),
    });
  });

  app.post('/analytics/drift-check', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'analytics.admin');
    return checkTicketDrift(ctx);
  });
}
