import { z } from 'zod';
import { call, type GatewayResponse } from '@itsm/module-integrations';
import { ValidationError, parseCsvRecords, recordsFrom, resolveSecret, valueAt, type TenantContext, type Tx } from '@itsm/platform';
import type { Entity } from '../domain/mapping.js';
import { presetFor, type Paging, type SourceKind } from '../domain/presets.js';

/**
 * Reading the source.
 *
 * A file somebody uploaded is read from the table it was kept in. Anything
 * else goes through the MOD-14 gateway, which is the only way out
 * (ADR-0023): an import job's URL is typed by a tenant administrator, and
 * "fetch this URL with a credential attached" is a request-forgery primitive
 * aimed at our own network if nothing checks the destination.
 */

export const pagingSchema: z.ZodType<Paging> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('link'), nextPath: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal('offset'),
    param: z.string().min(1).max(60),
    limitParam: z.string().min(1).max(60),
    limit: z.number().int().min(1).max(1000),
    totalPath: z.string().max(200).optional(),
    lastPagePath: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('page'),
    param: z.string().min(1).max(60),
    limitParam: z.string().min(1).max(60),
    limit: z.number().int().min(1).max(1000),
    startAt: z.number().int().min(0).max(1).optional(),
  }),
]);

export const sourceConfigSchema = z.object({
  /** An uploaded file, for csv. */
  fileId: z.string().uuid().optional(),
  /** The instance, for a named adapter: https://acme.service-now.com. */
  baseUrl: z.string().url().max(500).optional(),
  /** A path on the instance, or the whole URL for http_json. */
  path: z.string().max(2_000).optional(),
  url: z.string().url().max(2_000).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string().max(60), z.string().max(2_000)).optional(),
  body: z.unknown().optional(),
  /** Where the records are in the response; empty for a bare list. */
  recordsPath: z.string().max(200).optional(),
  paging: pagingSchema.optional(),
  maxPages: z.number().int().min(1).max(500).optional(),
  /** The stored credential whose value is the whole header: `Basic …`, `Bearer …`. */
  credentialRef: z.string().max(120).optional(),
  credentialHeader: z.string().max(60).optional(),
  /** CSV only. */
  delimiter: z.string().length(1).optional(),
  skipLines: z.number().int().min(0).max(20).optional(),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export interface ResolvedSource {
  kind: SourceKind;
  entity: Entity;
  url: string | null;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: unknown;
  recordsPath: string | undefined;
  paging: Paging;
  maxPages: number;
  credentialRef: string | null;
  credentialHeader: string;
  fileId: string | null;
  delimiter: string | undefined;
  skipLines: number | undefined;
}

export interface FetchDeps {
  callGateway?: typeof call;
}

export const MAX_RECORDS = 50_000;

/** Merges what the preset knows with what the tenant configured; the tenant wins. */
export function resolveSource(kind: SourceKind, entity: Entity, input: unknown): ResolvedSource {
  const preset = presetFor(kind, entity);
  const config = sourceConfigSchema.parse(input ?? {});

  let url: string | null = null;
  if (kind === 'csv') {
    if (!config.fileId) throw new ValidationError('a csv job needs fileId: upload the file first');
  } else if (config.url) {
    url = config.url;
  } else {
    const path = config.path ?? preset.path;
    if (!config.baseUrl) throw new ValidationError(`a ${kind} job needs baseUrl (the instance) or url`);
    if (!path) throw new ValidationError(`a ${kind} job for ${entity} needs path or url; there is no preset for it`);
    url = `${config.baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  return {
    kind,
    entity,
    url,
    method: config.method ?? preset.method ?? 'GET',
    headers: { ...(preset.headers ?? {}), ...(config.headers ?? {}) },
    body: config.body ?? preset.body,
    recordsPath: config.recordsPath ?? preset.recordsPath,
    paging: config.paging ?? preset.paging ?? { kind: 'none' },
    maxPages: config.maxPages ?? 100,
    credentialRef: config.credentialRef ?? null,
    credentialHeader: config.credentialHeader ?? preset.credentialHeader ?? 'authorization',
    fileId: config.fileId ?? null,
    delimiter: config.delimiter,
    skipLines: config.skipLines,
  };
}

function withParams(url: string, params: Record<string, string | number>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) parsed.searchParams.set(key, String(value));
  return parsed.toString();
}

/** The uploaded file, read once. */
export async function readFileRecords(tx: Tx, source: ResolvedSource): Promise<unknown[]> {
  if (!source.fileId) throw new ValidationError('this job has no file');
  const file = await tx.importFile.findFirst({ where: { id: source.fileId } });
  if (!file) throw new ValidationError('the uploaded file is gone; files are kept for seven days');
  return parseCsvRecords(file.content, {
    ...(source.delimiter ? { delimiter: source.delimiter } : {}),
    ...(source.skipLines !== undefined ? { skipLines: source.skipLines } : {}),
    maxRows: MAX_RECORDS,
  });
}

/**
 * Every page the API offers, up to a bound.
 *
 * Bounded by pages and by records, because an API that pages for ever — by
 * bug, or by a filter somebody removed — would otherwise be a job that
 * never finishes holding a worker nobody can get back. Hitting a bound is
 * reported, not silently truncated: an import that read the first fifty
 * thousand of something larger is an import somebody has to run again with
 * a narrower query, and they need to know.
 */
export async function fetchRecords(
  ctx: TenantContext,
  source: ResolvedSource,
  deps: FetchDeps = {},
): Promise<{ records: unknown[]; pages: number; truncated: boolean }> {
  if (!source.url) throw new ValidationError('this source has no url');
  const gateway = deps.callGateway ?? call;
  const credential = source.credentialRef ? await resolveSecret(ctx, source.credentialRef) : null;
  if (source.credentialRef && !credential) {
    throw new ValidationError(`this job names the credential ${source.credentialRef}, which is not configured; store it before running`);
  }

  const records: unknown[] = [];
  const paging = source.paging;
  let pages = 0;
  let offset = 0;
  let page = paging.kind === 'page' ? (paging.startAt ?? 1) : 0;
  let url: string | undefined = source.url;

  while (url && pages < source.maxPages) {
    let requestUrl = url;
    if (paging.kind === 'offset') requestUrl = withParams(url, { [paging.param]: offset, [paging.limitParam]: paging.limit });
    if (paging.kind === 'page') requestUrl = withParams(url, { [paging.param]: page, [paging.limitParam]: paging.limit });

    const response: GatewayResponse = await gateway(ctx, {
      connector: `import:${source.kind}`,
      method: source.method,
      url: requestUrl,
      headers: { accept: 'application/json', ...source.headers },
      ...(pages === 0 && source.body !== undefined ? { body: source.body } : {}),
      ...(credential ? { credential: { header: source.credentialHeader, value: credential } } : {}),
      cause: { kind: 'import', id: source.entity },
    });
    if (response.status >= 400) {
      throw new ValidationError(`the source answered ${response.status}; nothing was imported`);
    }

    const batch = recordsFrom(response.body, source.recordsPath || undefined);
    records.push(...batch);
    pages += 1;
    if (records.length >= MAX_RECORDS) return { records: records.slice(0, MAX_RECORDS), pages, truncated: true };

    switch (paging.kind) {
      case 'none':
        url = undefined;
        break;
      case 'link': {
        const next = valueAt(response.body, paging.nextPath);
        url = typeof next === 'string' && next.length > 0 ? next : undefined;
        break;
      }
      case 'offset': {
        offset += batch.length;
        const total = paging.totalPath ? Number(valueAt(response.body, paging.totalPath)) : Number.NaN;
        const last = paging.lastPagePath ? valueAt(response.body, paging.lastPagePath) === true : false;
        if (batch.length < paging.limit || batch.length === 0 || last || (Number.isFinite(total) && offset >= total)) url = undefined;
        break;
      }
      case 'page': {
        page += 1;
        if (batch.length < paging.limit || batch.length === 0) url = undefined;
        break;
      }
    }
  }

  return { records, pages, truncated: Boolean(url) };
}
