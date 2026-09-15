import { z } from 'zod';
import { call, type GatewayResponse } from '@itsm/module-integrations';
import { ValidationError, resolveSecret, type TenantContext } from '@itsm/platform';
import { mappingSchema, recordsFrom, valueAt, type Mapping } from '../domain/mapping.js';
import { parseCsvRecords } from '../domain/csv.js';
import { presetFor, type SourceKind } from './presets.js';

/**
 * Pulling a feed.
 *
 * Every byte goes through the MOD-14 gateway, which is the only way out
 * (ADR-0023). That matters more here than anywhere else in the platform: a
 * discovery source's URL is typed by a tenant administrator, who is a
 * customer's employee, and "fetch this URL on a schedule with a credential
 * attached" is a request-forgery primitive aimed at our own network if nothing
 * checks the destination. The gateway checks it, pins the address, refuses
 * redirects and keeps the credential out of the log.
 */

export const sourceConfigSchema = z.object({
  url: z.string().url().max(2_000).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string().max(60), z.string().max(2_000)).optional(),
  body: z.unknown().optional(),
  /** Where the records are in the response: `value`, `data`, `configurationItems`. */
  recordsPath: z.string().max(200).optional(),
  /** Where the next page's URL is, for feeds that page. */
  nextPath: z.string().max(200).optional(),
  maxPages: z.number().int().min(1).max(50).optional(),
  credentialHeader: z.string().max(60).optional(),
  /** Sign the request rather than attaching a bearer token. */
  signing: z
    .object({
      kind: z.literal('aws_sigv4'),
      region: z.string().min(1).max(40),
      service: z.string().min(1).max(40),
    })
    .optional(),
  /** CSV only. */
  delimiter: z.string().length(1).optional(),
  skipLines: z.number().int().min(0).max(20).optional(),
  mapping: mappingSchema.optional(),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export interface ResolvedSource {
  key: string;
  kind: SourceKind;
  credentialRef: string | null;
  config: SourceConfig;
  mapping: Mapping;
}

export interface FetchDeps {
  callGateway?: typeof call;
}

const MAX_RECORDS = 20_000;

/**
 * Merges what the preset knows with what the tenant configured.
 *
 * The tenant's value wins every time, including for a preset's URL — a
 * sovereign-cloud Graph endpoint is a different host, and a preset that could
 * not be pointed elsewhere would be a preset half the world cannot use.
 */
export function resolveSource(source: {
  key: string;
  kind: string;
  credentialRef: string | null;
  config: unknown;
}): ResolvedSource {
  const preset = presetFor(source.kind as SourceKind);
  const configured = sourceConfigSchema.parse(source.config ?? {});

  const config: SourceConfig = {
    ...preset,
    ...Object.fromEntries(Object.entries(configured).filter(([, value]) => value !== undefined)),
  };

  const mapping = configured.mapping ?? preset.mapping;
  if (!mapping) {
    throw new ValidationError(
      `the source ${source.key} has no mapping, so nothing it returns can become a configuration item`,
    );
  }
  if (!config.url) throw new ValidationError(`the source ${source.key} has no url to ask`);

  return {
    key: source.key,
    kind: source.kind as SourceKind,
    credentialRef: source.credentialRef,
    config,
    mapping: mappingSchema.parse(mapping),
  };
}

function recordsOf(source: ResolvedSource, response: GatewayResponse): unknown[] {
  if (source.kind === 'csv') {
    if (typeof response.body !== 'string') {
      throw new ValidationError('that endpoint did not return text, so there is no CSV to read');
    }
    return parseCsvRecords(response.body, {
      ...(source.config.delimiter ? { delimiter: source.config.delimiter } : {}),
      ...(source.config.skipLines !== undefined ? { skipLines: source.config.skipLines } : {}),
    });
  }
  return recordsFrom(response.body, source.config.recordsPath);
}

/**
 * Reads every page the feed offers, up to a bound.
 *
 * Bounded twice — pages and records — because a feed that pages for ever, by
 * bug or by a filter somebody removed, would otherwise be a job that never
 * finishes holding a worker nobody can get back. Hitting either bound is
 * reported rather than silently truncated: a run that read the first 20 000 of
 * something larger is a run whose "not seen, so perhaps retired" conclusions
 * would be wrong.
 */
export async function fetchRecords(
  ctx: TenantContext,
  source: ResolvedSource,
  deps: FetchDeps = {},
): Promise<{ records: unknown[]; pages: number; truncated: boolean }> {
  const gateway = deps.callGateway ?? call;
  const credential = source.credentialRef
    ? await resolveSecret(ctx, source.credentialRef)
    : null;
  if (source.credentialRef && !credential) {
    throw new ValidationError(
      `this source names the credential ${source.credentialRef}, which is not configured; store it before running`,
    );
  }

  const records: unknown[] = [];
  let url: string | undefined = source.config.url;
  let pages = 0;
  const maxPages = source.config.maxPages ?? 10;

  while (url && pages < maxPages) {
    const response: GatewayResponse = await gateway(ctx, {
      connector: `discovery:${source.key}`,
      method: source.config.method ?? 'GET',
      url,
      // The gateway asks for JSON by default, and an endpoint that honours it
      // would hand a CSV source a JSON error page to parse as a spreadsheet.
      headers: {
        ...(source.kind === 'csv' ? { accept: 'text/csv, text/plain' } : {}),
        ...(source.config.headers ?? {}),
      },
      // A POST body goes on the first page only: a Resource Graph query sends
      // its continuation token in the next link, and re-sending the query with
      // it would ask for page one for ever.
      ...(pages === 0 && source.config.body !== undefined ? { body: source.config.body } : {}),
      ...(credential && source.config.credentialHeader
        ? { credential: { header: source.config.credentialHeader, value: credential } }
        : {}),
      ...(source.config.signing ? { signing: source.config.signing } : {}),
      cause: { kind: 'discovery', id: source.key },
    });

    if (response.status >= 400) {
      throw new ValidationError(
        `the source answered ${response.status}; nothing was imported`,
      );
    }

    records.push(...recordsOf(source, response));
    pages += 1;

    if (records.length >= MAX_RECORDS) {
      return { records: records.slice(0, MAX_RECORDS), pages, truncated: true };
    }

    const next = source.config.nextPath ? valueAt(response.body, source.config.nextPath) : undefined;
    url = typeof next === 'string' && next.length > 0 ? next : undefined;
  }

  return { records, pages, truncated: Boolean(url) };
}
