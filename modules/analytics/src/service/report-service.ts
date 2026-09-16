import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  loadConfig,
  logger,
  metrics,
  newId,
  publish,
  recordAudit,
  transaction,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { filterSchema } from '../domain/filters.js';
import { RANGES, resolveRange, type Period, type RangeKey } from '../domain/ranges.js';
import { nextRunAfter, periodFor, scheduleSchema, type Schedule } from '../domain/schedule.js';
import { toCsv } from '../domain/csv.js';
import { evaluate, type QueryResult } from './metric-service.js';

/**
 * Reports: a definition, the schedules that run it, and the runs it produced.
 *
 * A run keeps its result. That is what makes a report a record rather than a
 * view: the figure in March's report is the figure March's report showed, even
 * after a rebuild has corrected the facts underneath. A run's CSV is rendered
 * from the stored result on request, so nothing goes to object storage and
 * the download link in the notification stays valid for as long as the run
 * exists.
 */

export const MAX_REPORT_ROWS = 10_000;

export const sectionSchema = z.object({
  title: z.string().min(1).max(120),
  metricKey: z.string().min(1).max(80),
  filters: z.array(filterSchema).max(20).default([]),
  groupBy: z.string().max(60).optional(),
  /** Omitted means the run's own period — yesterday, last week, last month. */
  range: z.enum(RANGES.filter((range) => range !== 'custom') as [string, ...string[]]).optional(),
  series: z.boolean().default(false),
});

export const reportSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  sections: z.array(sectionSchema).min(1).max(20),
});
export type ReportInput = z.input<typeof reportSchema>;

const recipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('role'), key: z.string().min(1).max(100) }),
]);

export const scheduleInputSchema = scheduleSchema.and(
  z.object({ recipients: z.array(recipientSchema).min(1).max(50), isActive: z.boolean().default(true) }),
);
export type ScheduleInput = z.input<typeof scheduleInputSchema>;

type Section = z.infer<typeof sectionSchema>;

export interface SectionResult {
  title: string;
  metricKey: string;
  unit: string;
  kind: 'value' | 'series' | 'groups';
  value: number | null;
  rows: { label: string; value: number | null }[];
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export async function listReports(ctx: TenantContext) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, (tx) =>
    tx.reportDefinition.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { schedules: true, runs: true } } } }),
  );
}

export async function getReport(ctx: TenantContext, id: string) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, async (tx) => {
    const row = await tx.reportDefinition.findFirst({ where: { id }, include: { schedules: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw new NotFoundError('report', id);
    return row;
  });
}

export async function createReport(ctx: TenantContext, input: ReportInput) {
  authz.require(ctx, 'analytics.manage');
  const parsed = reportSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const existing = await tx.reportDefinition.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a report with the key ${parsed.key} already exists`);
    const row = await tx.reportDefinition.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        sections: parsed.sections as never,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.report.created', targetType: 'report_definition', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateReport(ctx: TenantContext, id: string, input: Partial<ReportInput>) {
  authz.require(ctx, 'analytics.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.reportDefinition.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('report', id);
    const patch = reportSchema.partial().parse(input);
    const row = await tx.reportDefinition.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.sections !== undefined ? { sections: patch.sections as never } : {}),
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.report.updated', targetType: 'report_definition', targetId: id, after: patch });
    return row;
  });
}

export async function deleteReport(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'analytics.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.reportDefinition.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('report', id);
    await tx.reportDefinition.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: 'analytics.report.deleted', targetType: 'report_definition', targetId: id, before: { key: existing.key } });
  });
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

function scheduleOf(row: { frequency: string; hour: number; minute: number; dayOfWeek: number | null; dayOfMonth: number | null; timeZone: string }): Schedule {
  return {
    frequency: row.frequency as Schedule['frequency'],
    hour: row.hour,
    minute: row.minute,
    ...(row.dayOfWeek !== null ? { dayOfWeek: row.dayOfWeek } : {}),
    ...(row.dayOfMonth !== null ? { dayOfMonth: row.dayOfMonth } : {}),
    timeZone: row.timeZone,
  };
}

export async function createSchedule(ctx: TenantContext, reportId: string, input: ScheduleInput, now: Date = new Date()) {
  authz.require(ctx, 'analytics.manage');
  const parsed = scheduleInputSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const report = await tx.reportDefinition.findFirst({ where: { id: reportId } });
    if (!report) throw new NotFoundError('report', reportId);
    const row = await tx.reportSchedule.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        reportId,
        frequency: parsed.frequency,
        hour: parsed.hour,
        minute: parsed.minute,
        dayOfWeek: parsed.dayOfWeek ?? null,
        dayOfMonth: parsed.dayOfMonth ?? null,
        timeZone: parsed.timeZone,
        recipients: parsed.recipients as never,
        isActive: parsed.isActive,
        nextRunAt: nextRunAfter(parsed, now),
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.schedule.created', targetType: 'report_schedule', targetId: row.id, after: parsed });
    return row;
  });
}

export async function updateSchedule(ctx: TenantContext, id: string, input: Partial<ScheduleInput>, now: Date = new Date()) {
  authz.require(ctx, 'analytics.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.reportSchedule.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('schedule', id);
    const merged = scheduleInputSchema.parse({ ...scheduleOf(existing), recipients: existing.recipients, isActive: existing.isActive, ...input });
    const row = await tx.reportSchedule.update({
      where: { id },
      data: {
        frequency: merged.frequency,
        hour: merged.hour,
        minute: merged.minute,
        dayOfWeek: merged.dayOfWeek ?? null,
        dayOfMonth: merged.dayOfMonth ?? null,
        timeZone: merged.timeZone,
        recipients: merged.recipients as never,
        isActive: merged.isActive,
        nextRunAt: nextRunAfter(merged, now),
      },
    });
    await recordAudit(tx, ctx, { action: 'analytics.schedule.updated', targetType: 'report_schedule', targetId: id, after: merged });
    return row;
  });
}

export async function deleteSchedule(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'analytics.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.reportSchedule.findFirst({ where: { id } });
    if (!existing) throw new NotFoundError('schedule', id);
    await tx.reportSchedule.delete({ where: { id } });
    await recordAudit(tx, ctx, { action: 'analytics.schedule.deleted', targetType: 'report_schedule', targetId: id });
  });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function toRows(result: QueryResult): SectionResult['rows'] {
  if (result.series) return result.series.map((point) => ({ label: point.at.toISOString().slice(0, 10), value: point.value }));
  if (result.groups) return result.groups.map((group) => ({ label: group.label ?? group.key ?? '(none)', value: group.value }));
  return [];
}

function format(value: number | null, unit: string): string {
  if (value === null) return '—';
  if (unit === 'percent') return `${value.toFixed(1)} %`;
  if (unit === 'minutes') return `${Math.round(value)} min`;
  return String(Math.round(value));
}

async function evaluateSections(ctx: TenantContext, sections: Section[], period: Period): Promise<SectionResult[]> {
  const results: SectionResult[] = [];
  for (const section of sections) {
    const result = await evaluate(ctx, {
      metricKey: section.metricKey,
      filters: section.filters,
      ...(section.range
        ? { range: section.range as RangeKey }
        : { range: 'custom', from: period.from.toISOString(), to: period.to.toISOString() }),
      ...(section.groupBy ? { groupBy: section.groupBy } : {}),
      series: section.series,
    });
    results.push({
      title: section.title,
      metricKey: section.metricKey,
      unit: result.metric.unit,
      kind: result.series ? 'series' : result.groups ? 'groups' : 'value',
      value: result.value ?? null,
      rows: toRows(result),
    });
  }
  return results;
}

function summarise(sections: SectionResult[]): string {
  return sections
    .map((section) => (section.kind === 'value' ? `${section.title}: ${format(section.value, section.unit)}` : `${section.title}: ${section.rows.length} rows`))
    .join(' · ');
}

function downloadUrl(runId: string): string {
  return `${loadConfig().API_BASE_URL}/api/v1/analytics/report-runs/${runId}/csv`;
}

/**
 * Runs a report over a period and keeps the result.
 *
 * Two transactions on purpose. The run row is created first and committed, so
 * a report that takes a minute is visible as "running" rather than absent; the
 * result and the event commit together afterwards, so nobody is told about a
 * result that did not land.
 */
export async function runReport(
  ctx: TenantContext,
  reportId: string,
  options: { period?: Period; scheduleId?: string; now?: Date } = {},
) {
  authz.require(ctx, 'analytics.read');
  const now = options.now ?? new Date();

  const { report, schedule, runId, period } = await transaction(ctx, async (tx) => {
    const found = await tx.reportDefinition.findFirst({ where: { id: reportId } });
    if (!found) throw new NotFoundError('report', reportId);
    const found_schedule = options.scheduleId ? await tx.reportSchedule.findFirst({ where: { id: options.scheduleId, reportId } }) : null;
    if (options.scheduleId && !found_schedule) throw new NotFoundError('schedule', options.scheduleId);

    const runPeriod = options.period ?? (found_schedule ? periodFor(scheduleOf(found_schedule), now) : resolveRange('30d', now));
    const id = newId();
    await tx.reportRun.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        reportId,
        scheduleId: found_schedule?.id ?? null,
        requestedBy: ctx.actor.id,
        periodFrom: runPeriod.from,
        periodTo: runPeriod.to,
        status: 'running',
      },
    });
    return { report: found, schedule: found_schedule, runId: id, period: runPeriod };
  });

  try {
    const sections = await evaluateSections(ctx, report.sections as unknown as Section[], period);
    const rowCount = sections.reduce((sum, section) => sum + Math.max(1, section.rows.length), 0);
    if (rowCount > MAX_REPORT_ROWS) throw new ValidationError(`the report produced ${rowCount} rows; the limit is ${MAX_REPORT_ROWS}`);
    const summary = summarise(sections);

    // A scheduled run goes to its recipients. A run somebody asked for right
    // now goes to nobody: they are looking at the result, and MOD-11 would in
    // any case not tell a person about their own action.
    const audience = schedule ? (schedule.recipients as { kind: string }[]) : [];

    await transaction(ctx, async (tx) => {
      await tx.reportRun.update({
        where: { id: runId },
        data: { status: 'done', finishedAt: new Date(), result: sections as never, rowCount, summary },
      });
      if (schedule) {
        await tx.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now, nextRunAt: nextRunAfter(scheduleOf(schedule), now) } });
      }
      await publish(tx, ctx, {
        definition: events.reportGenerated,
        aggregateId: runId,
        payload: {
          reportId,
          runId,
          key: report.key,
          name: report.name,
          periodFrom: period.from.toISOString(),
          periodTo: period.to.toISOString(),
          rowCount,
          summary,
          downloadUrl: downloadUrl(runId),
          audience,
        },
      });
    });
    metrics.increment('analytics_report_runs_total', { outcome: 'done' });
    return { id: runId, status: 'done' as const, period, sections, summary, rowCount };
  } catch (error) {
    // Recorded, and the schedule moved on: a report that fails every night
    // must not also pile up a run per sweep behind the first failure.
    await transaction(ctx, async (tx) => {
      await tx.reportRun.update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date(), error: (error as Error).message } });
      if (schedule) {
        await tx.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now, nextRunAt: nextRunAfter(scheduleOf(schedule), now) } });
      }
    });
    metrics.increment('analytics_report_runs_total', { outcome: 'failed' });
    logger.warn('report run failed', { reportId, runId, error: (error as Error).message });
    throw error;
  }
}

/** Every schedule whose time has come, run in turn. Called by the sweep. */
export async function runDue(ctx: TenantContext, now: Date = new Date()): Promise<number> {
  const due = await transaction(ctx, (tx) =>
    tx.reportSchedule.findMany({ where: { isActive: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 50 }),
  );
  let ran = 0;
  for (const schedule of due) {
    try {
      await runReport(ctx, schedule.reportId, { scheduleId: schedule.id, now });
      ran += 1;
    } catch {
      // Already recorded on the run and logged; the next schedule still runs.
    }
  }
  return ran;
}

export async function listRuns(ctx: TenantContext, reportId: string, limit = 20) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, (tx) =>
    tx.reportRun.findMany({
      where: { reportId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { id: true, status: true, startedAt: true, finishedAt: true, periodFrom: true, periodTo: true, rowCount: true, summary: true, error: true, scheduleId: true },
    }),
  );
}

async function loadRun(tx: Tx, runId: string) {
  const run = await tx.reportRun.findFirst({ where: { id: runId }, include: { report: { select: { key: true, name: true } } } });
  if (!run) throw new NotFoundError('report run', runId);
  return run;
}

export async function getRun(ctx: TenantContext, runId: string) {
  authz.require(ctx, 'analytics.read');
  return transaction(ctx, (tx) => loadRun(tx, runId));
}

/** The whole result as a flat CSV: section, label, value. */
export async function csvForRun(ctx: TenantContext, runId: string): Promise<{ filename: string; csv: string }> {
  authz.require(ctx, 'analytics.read');
  const run = await transaction(ctx, (tx) => loadRun(tx, runId));
  if (run.status !== 'done') throw new ForbiddenError(`this run is ${run.status}`);

  const rows: Record<string, unknown>[] = [];
  for (const section of run.result as unknown as SectionResult[]) {
    if (section.kind === 'value') rows.push({ section: section.title, metric: section.metricKey, label: '', value: section.value, unit: section.unit });
    for (const row of section.rows) rows.push({ section: section.title, metric: section.metricKey, label: row.label, value: row.value, unit: section.unit });
  }
  const columns = [
    { key: 'section', header: 'Section' },
    { key: 'metric', header: 'Metric' },
    { key: 'label', header: 'Label' },
    { key: 'value', header: 'Value' },
    { key: 'unit', header: 'Unit' },
  ];
  const stamp = run.periodTo.toISOString().slice(0, 10);
  return { filename: `${run.report.key}-${stamp}.csv`, csv: toCsv(columns, rows) };
}
