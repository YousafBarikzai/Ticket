import { z } from 'zod';
import { events } from '@itsm/contracts';
import { ConflictError, NotFoundError, ValidationError, authz, enqueue, logger, metrics, newId, publish, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';
import { ENTITIES, mapRecord, parseMapping, type Entity, type Mapping, type MappedRecord } from '../domain/mapping.js';
import { SOURCE_KINDS, describeSources, presetFor, type SourceKind } from '../domain/presets.js';
import { fetchRecords, readFileRecords, resolveSource, sourceConfigSchema, type FetchDeps, type ResolvedSource } from '../sources/fetch.js';
import { applyRow, type Applied, type Outcome } from './importers.js';

/**
 * Jobs: what to import, from where, dry or for real — and how it went, row
 * by row.
 *
 * A job is created with everything it needs copied in, so that editing a
 * saved mapping afterwards changes the next job and not the record of this
 * one. Running it is the worker's, through `import.run`; the API only
 * queues. A dry run walks every row through the same code as a commit with
 * the writes turned off, and the records it leaves behind are the preview.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RECORD_CHUNK = 200;
const KEPT_MAPPED_BYTES = 4_000;

export const mappingDocumentSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  entity: z.enum(ENTITIES),
  document: z.unknown(),
});

export const createJobSchema = z.object({
  name: z.string().min(1).max(200),
  entity: z.enum(ENTITIES),
  source: z.enum(SOURCE_KINDS),
  config: sourceConfigSchema.default({}),
  /** A saved mapping's key, or a mapping written in. One of the two, or the preset's. */
  mappingKey: z.string().max(64).optional(),
  mapping: z.unknown().optional(),
  mode: z.enum(['dry_run', 'commit']).default('dry_run'),
});
export type CreateJobInput = z.input<typeof createJobSchema>;

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function storeFile(ctx: TenantContext, input: { filename: string; mime: string; content: string }) {
  authz.require(ctx, 'migration.manage');
  const bytes = Buffer.byteLength(input.content, 'utf8');
  if (bytes === 0) throw new ValidationError('the file is empty');
  if (bytes > MAX_FILE_BYTES) throw new ValidationError(`files are limited to ${MAX_FILE_BYTES} bytes; split the export`);
  return transaction(ctx, async (tx) => {
    const file = await tx.importFile.create({
      data: { id: newId(), tenantId: ctx.tenantId, filename: input.filename.slice(0, 200), mime: input.mime.slice(0, 100), bytes, content: input.content, uploadedBy: ctx.actor.id },
    });
    await recordAudit(tx, ctx, { action: 'import.file.uploaded', targetType: 'import_file', targetId: file.id, after: { filename: file.filename, bytes } });
    return { id: file.id, filename: file.filename, bytes, createdAt: file.createdAt };
  });
}

/** Files nobody will read again: older than a week, or read by a job that finished. */
export async function sweepFiles(ctx: TenantContext, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  return transaction(ctx, async (tx) => {
    const result = await tx.importFile.deleteMany({ where: { tenantId: ctx.tenantId, createdAt: { lt: cutoff } } });
    return result.count;
  });
}

// ---------------------------------------------------------------------------
// Saved mappings
// ---------------------------------------------------------------------------

export async function saveMapping(ctx: TenantContext, input: z.input<typeof mappingDocumentSchema>) {
  authz.require(ctx, 'migration.manage');
  const parsed = mappingDocumentSchema.parse(input);
  const document = parseMapping(parsed.entity, parsed.document);
  return transaction(ctx, async (tx) => {
    const existing = await tx.importMapping.findFirst({ where: { key: parsed.key } });
    if (existing && existing.entity !== parsed.entity) {
      throw new ConflictError(`the mapping ${parsed.key} is for ${existing.entity}; a mapping cannot change entity`);
    }
    const row = existing
      ? await tx.importMapping.update({ where: { id: existing.id }, data: { name: parsed.name, document: document as never } })
      : await tx.importMapping.create({
          data: { id: newId(), tenantId: ctx.tenantId, key: parsed.key, name: parsed.name, entity: parsed.entity, document: document as never, createdBy: ctx.actor.id },
        });
    await recordAudit(tx, ctx, { action: existing ? 'import.mapping.updated' : 'import.mapping.created', targetType: 'import_mapping', targetId: row.id, after: { key: parsed.key, entity: parsed.entity } });
    return row;
  });
}

export async function listMappings(ctx: TenantContext) {
  authz.require(ctx, 'migration.read');
  return transaction(ctx, (tx) => tx.importMapping.findMany({ orderBy: { key: 'asc' } }));
}

export async function deleteMapping(ctx: TenantContext, key: string): Promise<void> {
  authz.require(ctx, 'migration.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.importMapping.findFirst({ where: { key } });
    if (!existing) throw new NotFoundError('import mapping', key);
    await tx.importMapping.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, { action: 'import.mapping.deleted', targetType: 'import_mapping', targetId: existing.id, before: { key } });
  });
}

/** The sources and presets, for an administrator choosing. */
export function describe() {
  return { sources: describeSources(), entities: ENTITIES };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

async function mappingFor(tx: Tx, input: z.infer<typeof createJobSchema>): Promise<Mapping> {
  if (input.mapping !== undefined) return parseMapping(input.entity, input.mapping);
  if (input.mappingKey) {
    const saved = await tx.importMapping.findFirst({ where: { key: input.mappingKey } });
    if (!saved) throw new NotFoundError('import mapping', input.mappingKey);
    if (saved.entity !== input.entity) throw new ValidationError(`the mapping ${input.mappingKey} is for ${saved.entity}, not ${input.entity}`);
    return parseMapping(input.entity, saved.document);
  }
  const preset = presetFor(input.source, input.entity);
  if (!preset.mapping) {
    throw new ValidationError(`there is no preset mapping for ${input.entity} from ${input.source}; supply mapping or mappingKey`);
  }
  return parseMapping(input.entity, preset.mapping);
}

/**
 * Creates a job and queues it. Everything the run needs is resolved and
 * copied here — the mapping, the source with the preset folded in — so the
 * job is a record of what was asked, and a failed one can be read back.
 */
export async function createJob(ctx: TenantContext, input: CreateJobInput, deps: { enqueueRun?: boolean } = {}) {
  authz.require(ctx, 'migration.manage');
  const parsed = createJobSchema.parse(input);
  // Refused at creation, not at run time: the run is in a worker, and a
  // mapping that names a field the entity does not have should be a 422 to
  // the person typing it.
  resolveSource(parsed.source, parsed.entity, parsed.config);

  const job = await transaction(ctx, async (tx) => {
    const mapping = await mappingFor(tx, parsed);
    if (parsed.source === 'csv' && parsed.config.fileId) {
      const file = await tx.importFile.findFirst({ where: { id: parsed.config.fileId }, select: { id: true } });
      if (!file) throw new NotFoundError('import file', parsed.config.fileId);
    }
    const row = await tx.importJob.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        name: parsed.name,
        entity: parsed.entity,
        source: parsed.source,
        config: parsed.config as never,
        mapping: mapping as never,
        mode: parsed.mode,
        fileId: parsed.config.fileId ?? null,
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'import.job.created', targetType: 'import_job', targetId: row.id, after: { name: parsed.name, entity: parsed.entity, source: parsed.source, mode: parsed.mode } });
    return row;
  });

  if (deps.enqueueRun !== false) {
    await enqueue(ctx, 'imports', 'import.run', { jobId: job.id }, { idempotencyKey: `import-run-${job.id}` });
  }
  metrics.increment('import_jobs_total', { entity: parsed.entity, source: parsed.source, mode: parsed.mode });
  return job;
}

export async function listJobs(ctx: TenantContext, limit = 50) {
  authz.require(ctx, 'migration.read');
  return transaction(ctx, (tx) => tx.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit }));
}

export async function getJob(ctx: TenantContext, jobId: string) {
  authz.require(ctx, 'migration.read');
  return transaction(ctx, async (tx) => {
    const job = await tx.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundError('import job', jobId);
    return job;
  });
}

export async function listRecords(ctx: TenantContext, jobId: string, filter: { outcome?: string; limit?: number; offset?: number } = {}) {
  authz.require(ctx, 'migration.read');
  return transaction(ctx, async (tx) => {
    const job = await tx.importJob.findFirst({ where: { id: jobId }, select: { id: true } });
    if (!job) throw new NotFoundError('import job', jobId);
    return tx.importRecord.findMany({
      where: { jobId, ...(filter.outcome ? { outcome: filter.outcome } : {}) },
      orderBy: { rowNumber: 'asc' },
      take: filter.limit ?? 200,
      skip: filter.offset ?? 0,
    });
  });
}

export async function cancelJob(ctx: TenantContext, jobId: string) {
  authz.require(ctx, 'migration.manage');
  return transaction(ctx, async (tx) => {
    const job = await tx.importJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundError('import job', jobId);
    if (job.status !== 'pending' && job.status !== 'running') throw new ValidationError(`the job is already ${job.status}`);
    const row = await tx.importJob.update({ where: { id: jobId }, data: { status: 'cancelled', finishedAt: new Date() } });
    await recordAudit(tx, ctx, { action: 'import.job.cancelled', targetType: 'import_job', targetId: jobId });
    return row;
  });
}

/** A commit of a dry run: the same job again, for real. */
export async function commitJob(ctx: TenantContext, jobId: string) {
  authz.require(ctx, 'migration.manage');
  const dry = await getJob(ctx, jobId);
  if (dry.mode !== 'dry_run') throw new ValidationError('this job was already a commit');
  if (dry.status !== 'completed') throw new ValidationError(`a dry run is committed once it has completed; this one is ${dry.status}`);
  return createJob(ctx, {
    name: dry.name,
    entity: dry.entity as Entity,
    source: dry.source as SourceKind,
    config: dry.config as never,
    mapping: dry.mapping,
    mode: 'commit',
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface RunResult {
  jobId: string;
  status: 'completed' | 'failed' | 'cancelled';
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  error: string | null;
}

function trimmed(mapped: MappedRecord): unknown {
  const values = Object.fromEntries(
    Object.entries(mapped.values).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value && typeof value === 'object' && 'candidates' in value ? (value as { candidates: string[] }).candidates.join(' / ') : value]),
  );
  const text = JSON.stringify({ ...values, comments: mapped.comments.length });
  return text.length > KEPT_MAPPED_BYTES ? { truncated: true, title: values.title ?? values.name ?? values.email ?? null } : JSON.parse(text);
}

function count(result: RunResult, outcome: Outcome): void {
  if (outcome === 'created' || outcome === 'would_create') result.created += 1;
  else if (outcome === 'updated' || outcome === 'would_update') result.updated += 1;
  else if (outcome === 'unchanged' || outcome === 'would_skip') result.unchanged += 1;
  else result.failed += 1;
}

async function readAll(ctx: TenantContext, source: ResolvedSource, deps: FetchDeps): Promise<{ records: unknown[]; truncated: boolean; pages: number }> {
  if (source.kind === 'csv') {
    const records = await transaction(ctx, (tx) => readFileRecords(tx, source));
    return { records, truncated: false, pages: 1 };
  }
  return fetchRecords(ctx, source, deps);
}

/**
 * Runs one job to the end. Reads the source, maps every row, applies it (or
 * says what applying would do), writes a record per row and the totals on
 * the job, and tells whoever asked. A job cancelled while running stops at
 * the next chunk; what it wrote stays written and remembered.
 */
export async function runJob(ctx: TenantContext, jobId: string, deps: FetchDeps = {}): Promise<RunResult> {
  const job = await transaction(ctx, async (tx) => {
    const found = await tx.importJob.findFirst({ where: { id: jobId } });
    if (!found) throw new NotFoundError('import job', jobId);
    if (found.status !== 'pending') return null;
    return tx.importJob.update({ where: { id: jobId }, data: { status: 'running', startedAt: new Date() } });
  });
  if (!job) {
    return { jobId, status: 'cancelled', seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0, error: 'the job was not pending' };
  }

  const entity = job.entity as Entity;
  const mapping = job.mapping as Mapping;
  const commit = job.mode === 'commit';
  const result: RunResult = { jobId, status: 'completed', seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0, error: null };
  const options = { createMissingUsers: mapping.options.createMissingUsers, overwrite: mapping.options.overwrite, jobId, commit };

  try {
    const source = resolveSource(job.source as SourceKind, entity, job.config);
    const { records, truncated, pages } = await readAll(ctx, source, deps);
    result.seen = records.length;
    if (truncated) {
      result.error = `the source was longer than one job reads (${pages} pages, ${records.length} records); narrow the query and run again for the rest`;
    }

    for (let offset = 0; offset < records.length; offset += RECORD_CHUNK) {
      const still = await transaction(ctx, (tx) => tx.importJob.findFirst({ where: { id: jobId }, select: { status: true } }));
      if (still?.status !== 'running') {
        result.status = 'cancelled';
        break;
      }
      const chunk = records.slice(offset, offset + RECORD_CHUNK);
      const applied: { rowNumber: number; mapped: MappedRecord; outcome: Applied }[] = [];
      for (const [index, record] of chunk.entries()) {
        const mapped = mapRecord(entity, mapping, record);
        const outcome = await applyRow(ctx, entity, mapped, options);
        applied.push({ rowNumber: offset + index + 1, mapped, outcome });
        count(result, outcome.outcome);
      }
      await transaction(ctx, async (tx) => {
        await tx.importRecord.createMany({
          data: applied.map((row) => ({
            id: newId(),
            tenantId: ctx.tenantId,
            jobId,
            rowNumber: row.rowNumber,
            externalKey: row.mapped.externalKey || null,
            outcome: row.outcome.outcome,
            entityId: row.outcome.entityId && row.outcome.entityId !== '00000000-0000-0000-0000-000000000000' ? row.outcome.entityId : null,
            mapped: trimmed(row.mapped) as never,
            problems: [...row.outcome.problems, ...row.outcome.warnings.map((warning) => `warning: ${warning}`)],
          })),
        });
        await tx.importJob.update({
          where: { id: jobId },
          data: { seen: result.seen, created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failed },
        });
      });
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    logger.warn('an import job failed', { tenantId: ctx.tenantId, jobId, error: result.error });
  }

  await transaction(ctx, async (tx) => {
    await tx.importJob.update({
      where: { id: jobId },
      data: {
        status: result.status,
        error: result.error,
        seen: result.seen,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed,
        finishedAt: new Date(),
      },
    });
    // The file was for this job. A dry run keeps it for the commit that
    // follows; a commit is the last reader.
    if (commit && job.fileId) await tx.importFile.deleteMany({ where: { id: job.fileId } });
    await recordAudit(tx, ctx, { action: 'import.job.finished', targetType: 'import_job', targetId: jobId, after: { ...result } });
    await publish(tx, ctx, {
      definition: events.importJobFinished,
      aggregateId: jobId,
      payload: {
        jobId,
        name: job.name,
        entity,
        source: job.source,
        mode: job.mode,
        status: result.status === 'cancelled' ? 'failed' : result.status,
        seen: result.seen,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        failed: result.failed,
        error: result.error,
        audience: job.createdBy ? [{ kind: 'user' as const, userId: job.createdBy }] : [],
      },
    });
  });
  metrics.increment('import_rows_total', { entity, mode: job.mode, outcome: 'failed' }, result.failed);
  metrics.increment('import_rows_total', { entity, mode: job.mode, outcome: 'created' }, result.created);
  return result;
}
