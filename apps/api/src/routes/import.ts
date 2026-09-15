import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_FILE_BYTES, jobService } from '@itsm/module-migration';
import { contextOf } from '../plugins/context.js';

/** MOD-24 imports: files, saved mappings, jobs and their rows. */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  const byId = z.object({ id: z.string().uuid() });
  const byKey = z.object({ key: z.string().min(1).max(64) });

  const job = (row: {
    id: string; name: string; entity: string; source: string; mode: string; status: string;
    seen: number; created: number; updated: number; unchanged: number; failed: number;
    error: string | null; fileId: string | null; createdBy: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null;
  }) => ({
    id: row.id,
    name: row.name,
    entity: row.entity,
    source: row.source,
    mode: row.mode,
    status: row.status,
    counts: { seen: row.seen, created: row.created, updated: row.updated, unchanged: row.unchanged, failed: row.failed },
    error: row.error,
    fileId: row.fileId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });

  app.get('/import/sources', async (request) => {
    contextOf(request);
    return jobService.describe();
  });

  // ---- Files -----------------------------------------------------------------
  //
  // A CSV export is posted as its own body (text/csv) with the name in a
  // header, or as JSON with the text inside. Either way it is bigger than the
  // API's usual limit, so this route carries its own.

  app.post('/import/files', { bodyLimit: MAX_FILE_BYTES + 64 * 1024 }, async (request, reply) => {
    const ctx = contextOf(request);
    const contentType = String(request.headers['content-type'] ?? '');
    let filename: string;
    let content: string;
    if (contentType.startsWith('text/')) {
      content = typeof request.body === 'string' ? request.body : '';
      filename = z.string().min(1).max(200).parse(request.headers['x-filename'] ?? 'upload.csv');
    } else {
      const body = z.object({ filename: z.string().min(1).max(200), content: z.string().min(1) }).parse(request.body);
      filename = body.filename;
      content = body.content;
    }
    const stored = await jobService.storeFile(ctx, { filename, mime: contentType.split(';')[0] || 'text/csv', content });
    reply.status(201);
    return { id: stored.id, filename: stored.filename, bytes: stored.bytes, createdAt: stored.createdAt.toISOString() };
  });

  // ---- Mappings --------------------------------------------------------------

  app.get('/import/mappings', async (request) => {
    const ctx = contextOf(request);
    const rows = await jobService.listMappings(ctx);
    return { data: rows.map((row) => ({ id: row.id, key: row.key, name: row.name, entity: row.entity, document: row.document, updatedAt: row.updatedAt.toISOString() })) };
  });

  app.put('/import/mappings/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(120), entity: z.string(), document: z.unknown() }).parse(request.body);
    const row = await jobService.saveMapping(ctx, { key, ...body } as never);
    return { id: row.id, key: row.key, name: row.name, entity: row.entity, document: row.document };
  });

  app.delete('/import/mappings/:key', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = byKey.parse(request.params);
    await jobService.deleteMapping(ctx, key);
    reply.status(204);
    return null;
  });

  // ---- Jobs ------------------------------------------------------------------

  app.get('/import/jobs', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const rows = await jobService.listJobs(ctx, query.limit);
    return { data: rows.map(job) };
  });

  app.post('/import/jobs', async (request, reply) => {
    const ctx = contextOf(request);
    const row = await jobService.createJob(ctx, request.body as never);
    reply.status(201);
    return job(row);
  });

  app.get('/import/jobs/:id', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await jobService.getJob(ctx, id);
    return { ...job(row), config: row.config, mapping: row.mapping };
  });

  app.get('/import/jobs/:id/records', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const query = z
      .object({
        outcome: z.string().max(20).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    const rows = await jobService.listRecords(ctx, id, query);
    return {
      data: rows.map((row) => ({
        rowNumber: row.rowNumber,
        externalKey: row.externalKey,
        outcome: row.outcome,
        entityId: row.entityId,
        mapped: row.mapped,
        problems: row.problems,
      })),
    };
  });

  app.post('/import/jobs/:id/commit', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    const row = await jobService.commitJob(ctx, id);
    reply.status(201);
    return job(row);
  });

  app.post('/import/jobs/:id/cancel', async (request) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return job(await jobService.cancelJob(ctx, id));
  });
}
