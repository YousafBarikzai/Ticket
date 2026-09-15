import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  assetService,
  ciService,
  impactService,
  linkService,
  ENTITY_TYPES,
  createAssetSchema,
  createCiSchema,
  classSchema,
  linkSchema,
  relationshipSchema,
  statusSchema,
  updateAssetSchema,
  updateCiSchema,
  updateClassSchema,
  assignSchema,
  modelSchema,
} from '@itsm/module-assets';
import { contextOf } from '../plugins/context.js';

/** MOD-10-E1 configuration items, relationships, impact and the asset register. */
export async function cmdbRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(60) });
  const byTag = z.object({ tag: z.string().min(1).max(60) });

  const ci = (item: {
    id: string; name: string; status: string; criticality: string; externalKey: string | null;
    serviceId: string | null; ownerId: string | null; environment: string | null; description: string | null;
    attributes: unknown; source: string; classId: string; retiredAt: Date | null; updatedAt: Date;
  }) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    criticality: item.criticality,
    externalKey: item.externalKey,
    serviceId: item.serviceId,
    ownerId: item.ownerId,
    environment: item.environment,
    description: item.description,
    attributes: item.attributes,
    source: item.source,
    retiredAt: item.retiredAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  });

  const asset = (row: {
    id: string; tag: string; serial: string | null; status: string; ciId: string | null;
    location: string | null; costCentre: string | null; supplier: string | null;
    purchasedOn: Date | null; warrantyEndsOn: Date | null; retiredAt: Date | null;
  }) => ({
    id: row.id,
    tag: row.tag,
    serial: row.serial,
    status: row.status,
    ciId: row.ciId,
    location: row.location,
    costCentre: row.costCentre,
    supplier: row.supplier,
    purchasedOn: row.purchasedOn?.toISOString().slice(0, 10) ?? null,
    warrantyEndsOn: row.warrantyEndsOn?.toISOString().slice(0, 10) ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
  });

  // ---- classes -----------------------------------------------------------
  app.get('/ci-classes', async (request) => {
    const ctx = contextOf(request);
    const classes = await ciService.listClasses(ctx);
    return { data: classes.map((row) => ({ id: row.id, key: row.key, name: row.name, parentId: row.parentId })) };
  });

  app.post('/ci-classes', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await ciService.createClass(ctx, classSchema.strict().parse(request.body));
    return reply.code(201).send({ id: created.id, key: created.key, name: created.name });
  });

  app.patch('/ci-classes/:key', async (request) => {
    const ctx = contextOf(request);
    const updated = await ciService.updateClass(ctx, byKey.parse(request.params).key, updateClassSchema.strict().parse(request.body));
    return { id: updated.id, key: updated.key, name: updated.name, parentId: updated.parentId };
  });

  /** Everything an item of this class must and may carry, inheritance included. */
  app.get('/ci-classes/:key/attributes', async (request) => {
    const ctx = contextOf(request);
    return { data: await ciService.classAttributes(ctx, byKey.parse(request.params).key) };
  });

  // ---- configuration items -----------------------------------------------
  app.get('/cis', async (request) => {
    const ctx = contextOf(request);
    return { data: (await ciService.listCis(ctx, request.query as never)).map(ci) };
  });

  app.post('/cis', async (request, reply) => {
    const ctx = contextOf(request);
    return reply.code(201).send(ci(await ciService.createCi(ctx, createCiSchema.strict().parse(request.body))));
  });

  app.get('/cis/:id', async (request) => {
    const ctx = contextOf(request);
    return ci(await ciService.getCi(ctx, byId.parse(request.params).id));
  });

  app.patch('/cis/:id', async (request) => {
    const ctx = contextOf(request);
    return ci(await ciService.updateCi(ctx, byId.parse(request.params).id, updateCiSchema.strict().parse(request.body)));
  });

  app.post('/cis/:id/status', async (request) => {
    const ctx = contextOf(request);
    return ci(await ciService.setStatus(ctx, byId.parse(request.params).id, statusSchema.strict().parse(request.body)));
  });

  app.post('/cis/:id/retire', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(2000) }).strict().parse(request.body);
    return ci(await ciService.retireCi(ctx, byId.parse(request.params).id, body.reason));
  });

  // ---- relationships -----------------------------------------------------
  app.get('/cis/:id/relationships', async (request) => {
    const ctx = contextOf(request);
    const { outgoing, incoming } = await ciService.relationshipsOf(ctx, byId.parse(request.params).id);
    return {
      needs: outgoing.map((row) => ({ type: row.type, ci: row.to })),
      neededBy: incoming.map((row) => ({ type: row.type, ci: row.from })),
    };
  });

  app.post('/ci-relationships', async (request, reply) => {
    const ctx = contextOf(request);
    const result = await ciService.relate(ctx, relationshipSchema.strict().parse(request.body));
    // The sentence goes back so whoever wrote it can see the direction they
    // actually recorded, which is the mistake worth catching immediately.
    return reply.code(result.created ? 201 : 200).send({ id: result.relationship.id, reads: result.description });
  });

  app.delete('/ci-relationships', async (request, reply) => {
    const ctx = contextOf(request);
    await ciService.unrelate(ctx, relationshipSchema.strict().parse(request.body));
    reply.status(204);
  });

  // ---- impact ------------------------------------------------------------
  const traversalQuery = z.object({
    depth: z.coerce.number().int().min(1).max(6).optional(),
    types: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value)),
  });

  app.get('/cis/:id/impact', async (request) => {
    const ctx = contextOf(request);
    const result = await impactService.impact(
      ctx,
      byId.parse(request.params).id,
      traversalQuery.parse(request.query) as never,
    );
    return { ci: result.ci, depth: result.depth, summary: result.summary, data: result.nodes };
  });

  app.get('/cis/:id/dependencies', async (request) => {
    const ctx = contextOf(request);
    const result = await impactService.dependencies(
      ctx,
      byId.parse(request.params).id,
      traversalQuery.parse(request.query) as never,
    );
    return { ci: result.ci, depth: result.depth, summary: result.summary, data: result.nodes };
  });

  // ---- links to records --------------------------------------------------
  app.post('/ci-links', async (request, reply) => {
    const ctx = contextOf(request);
    const result = await linkService.linkCi(ctx, linkSchema.strict().parse(request.body));
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.delete('/ci-links', async (request, reply) => {
    const ctx = contextOf(request);
    await linkService.unlinkCi(ctx, linkSchema.strict().parse(request.body));
    reply.status(204);
  });

  app.get('/cis/:id/history', async (request) => {
    const ctx = contextOf(request);
    const history = await linkService.historyFor(ctx, byId.parse(request.params).id);
    return {
      ci: history.ci,
      data: history.links.map((link) => ({ ...link, linkedAt: link.linkedAt.toISOString() })),
    };
  });

  app.get('/records/:entityType/:entityId/cis', async (request) => {
    const ctx = contextOf(request);
    const params = z
      .object({ entityType: z.enum(ENTITY_TYPES), entityId: z.string().uuid() })
      .parse(request.params);
    const links = await linkService.cisFor(ctx, params.entityType, params.entityId);
    return { data: links.map((link) => ({ ...link, linkedAt: link.linkedAt.toISOString() })) };
  });

  // ---- assets ------------------------------------------------------------
  app.get('/assets', async (request) => {
    const ctx = contextOf(request);
    return { data: (await assetService.listAssets(ctx, request.query as never)).map(asset) };
  });

  app.post('/assets', async (request, reply) => {
    const ctx = contextOf(request);
    return reply.code(201).send(asset(await assetService.createAsset(ctx, createAssetSchema.strict().parse(request.body))));
  });

  app.get('/assets/:tag', async (request) => {
    const ctx = contextOf(request);
    const found = await assetService.getAsset(ctx, byTag.parse(request.params).tag);
    return {
      ...asset(found),
      assignments: found.assignments.map((row) => ({
        userId: row.userId,
        location: row.location,
        note: row.note,
        assignedAt: row.assignedAt.toISOString(),
        returnedAt: row.returnedAt?.toISOString() ?? null,
      })),
    };
  });

  app.patch('/assets/:tag', async (request) => {
    const ctx = contextOf(request);
    return asset(await assetService.updateAsset(ctx, byTag.parse(request.params).tag, updateAssetSchema.strict().parse(request.body)));
  });

  app.post('/assets/:tag/assign', async (request) => {
    const ctx = contextOf(request);
    const result = await assetService.assignAsset(ctx, byTag.parse(request.params).tag, assignSchema.strict().parse(request.body));
    return asset(result.asset);
  });

  app.post('/assets/:tag/return', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ location: z.string().max(200).optional() }).parse(request.body ?? {});
    return asset(await assetService.returnAsset(ctx, byTag.parse(request.params).tag, body.location));
  });

  app.post('/assets/:tag/retire', async (request) => {
    const ctx = contextOf(request);
    const body = z
      .object({ reason: z.string().min(1).max(2000), disposed: z.boolean().default(false) })
      .strict().parse(request.body);
    return asset(await assetService.retireAsset(ctx, byTag.parse(request.params).tag, body.reason, body.disposed));
  });

  /** Warranties running out, and those that already have. */
  app.get('/assets-warranties', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ withinDays: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query);
    const rows = await assetService.warrantiesExpiring(ctx, query.withinDays);
    const now = Date.now();
    return {
      data: rows.map((row) => ({
        ...asset(row),
        expired: Boolean(row.warrantyEndsOn && row.warrantyEndsOn.getTime() < now),
      })),
    };
  });

  app.get('/asset-models', async (request) => {
    const ctx = contextOf(request);
    const models = await assetService.listModels(ctx);
    return {
      data: models.map((row) => ({
        id: row.id,
        manufacturer: row.manufacturer,
        model: row.model,
        category: row.category,
        lifespanMonths: row.lifespanMonths,
      })),
    };
  });

  app.post('/asset-models', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await assetService.createModel(ctx, modelSchema.strict().parse(request.body));
    return reply.code(201).send({ id: created.id, manufacturer: created.manufacturer, model: created.model });
  });
}
