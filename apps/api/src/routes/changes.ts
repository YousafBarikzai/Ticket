import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changeService,
  windowService,
  createChangeSchema,
  scheduleSchema,
  transitionSchema,
  windowSchema,
  templateSchema,
} from '@itsm/module-change';
import { contextOf } from '../plugins/context.js';

/** MOD-08-E3 changes, windows and standard templates. */
export async function changeRoutes(app: FastifyInstance): Promise<void> {
  const byNumber = z.object({ number: z.string().min(1).max(40) });
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(200) });

  const shape = (change: {
    number: string; title: string; kind: string; status: string; risk: string; impact: string;
    plannedStartAt: Date | null; plannedEndAt: Date | null; actualStartAt: Date | null; actualEndAt: Date | null;
    approvalNote: string | null; retrospectiveApprovedAt: Date | null; closeCode: string | null;
    backoutPlan: string | null; serviceId: string | null; problemId: string | null; majorIncidentId: string | null;
    templateVersion: number | null; ownerId: string | null;
  }) => ({
    number: change.number,
    title: change.title,
    kind: change.kind,
    status: change.status,
    risk: change.risk,
    impact: change.impact,
    ownerId: change.ownerId,
    serviceId: change.serviceId,
    problemId: change.problemId,
    majorIncidentId: change.majorIncidentId,
    templateVersion: change.templateVersion,
    hasBackoutPlan: Boolean(change.backoutPlan),
    approvalNote: change.approvalNote,
    retrospectiveApprovedAt: change.retrospectiveApprovedAt?.toISOString() ?? null,
    plannedStartAt: change.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: change.plannedEndAt?.toISOString() ?? null,
    actualStartAt: change.actualStartAt?.toISOString() ?? null,
    actualEndAt: change.actualEndAt?.toISOString() ?? null,
    closeCode: change.closeCode,
  });

  app.get('/changes', async (request) => {
    const ctx = contextOf(request);
    const query = z
      .object({ status: z.string().optional(), kind: z.string().optional(), open: z.coerce.boolean().optional() })
      .parse(request.query);
    return { data: (await changeService.listChanges(ctx, query)).map(shape) };
  });

  app.get('/changes/:number', async (request) => {
    const ctx = contextOf(request);
    return shape(await changeService.getChange(ctx, byNumber.parse(request.params).number));
  });

  app.post('/changes', async (request, reply) => {
    const ctx = contextOf(request);
    const change = await changeService.createChange(ctx, createChangeSchema.strict().parse(request.body));
    return reply.code(201).send(shape(change));
  });

  app.post('/changes/:number/submit', async (request) => {
    const ctx = contextOf(request);
    return shape(await changeService.submitChange(ctx, byNumber.parse(request.params).number));
  });

  /** Refused outright when the period is inside a blackout. */
  app.post('/changes/:number/schedule', async (request) => {
    const ctx = contextOf(request);
    const { change, verdict } = await changeService.scheduleChange(
      ctx,
      byNumber.parse(request.params).number,
      scheduleSchema.strict().parse(request.body),
    );
    return { ...shape(change), inWindows: verdict.inWindows, outsideWindows: verdict.outsideWindows };
  });

  app.post('/changes/:number/transition', async (request) => {
    const ctx = contextOf(request);
    return shape(
      await changeService.transition(ctx, byNumber.parse(request.params).number, transitionSchema.strict().parse(request.body)),
    );
  });

  app.post('/changes/:number/retrospective-approval', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(request.body ?? {});
    return shape(await changeService.approveRetrospectively(ctx, byNumber.parse(request.params).number, body.note));
  });

  /** The debt the record carries: emergency changes nobody has signed off. */
  app.get('/changes/owed-retrospectives', async (request) => {
    const ctx = contextOf(request);
    const owed = await changeService.owedRetrospectives(ctx);
    return {
      data: owed.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      overdue: owed.filter((row) => row.overdue).length,
    };
  });

  // ---- windows -----------------------------------------------------------
  app.get('/change-windows', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ kind: z.enum(['change', 'blackout']).optional() }).parse(request.query);
    const windows = await windowService.listWindows(ctx, query.kind);
    return {
      data: windows.map((window) => ({
        id: window.id,
        kind: window.kind,
        name: window.name,
        reason: window.reason,
        timeZone: window.timeZone,
        startsAt: window.startsAt?.toISOString() ?? null,
        endsAt: window.endsAt?.toISOString() ?? null,
        weekday: window.weekday,
        startTime: window.startTime,
        endTime: window.endTime,
        serviceIds: window.serviceIds,
      })),
    };
  });

  app.post('/change-windows', async (request, reply) => {
    const ctx = contextOf(request);
    const window = await windowService.createWindow(ctx, windowSchema.parse(request.body));
    return reply.code(201).send({ id: window.id, kind: window.kind, name: window.name });
  });

  app.delete('/change-windows/:id', async (request, reply) => {
    const ctx = contextOf(request);
    await windowService.retireWindow(ctx, byId.parse(request.params).id);
    reply.status(204);
  });

  // ---- standard change templates -----------------------------------------
  app.get('/standard-changes', async (request) => {
    const ctx = contextOf(request);
    const templates = await windowService.listTemplates(ctx);
    return {
      data: templates.map((template) => ({
        key: template.key,
        name: template.name,
        status: template.status,
        version: template.version,
        risk: template.risk,
        hasBackoutPlan: Boolean(template.backoutPlan),
        approvedAt: template.approvedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/standard-changes', async (request, reply) => {
    const ctx = contextOf(request);
    const template = await windowService.createTemplate(ctx, templateSchema.strict().parse(request.body));
    return reply.code(201).send({ key: template.key, status: template.status, version: template.version });
  });

  /** Publishing is the act of pre-approving every change raised from it. */
  app.post('/standard-changes/:key/publish', async (request) => {
    const ctx = contextOf(request);
    const template = await windowService.publishTemplate(ctx, byKey.parse(request.params).key);
    return { key: template.key, status: template.status, version: template.version };
  });
}
