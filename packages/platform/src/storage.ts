import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import type { TenantContext } from './context.js';
import { newId } from './ids.js';

/**
 * Object storage (ADR-0016).
 *
 * Attachments never pass through the API: clients receive a presigned URL and
 * upload directly. Keys are tenant-prefixed and never contain a user-supplied
 * filename, which keeps both tenant isolation and path traversal out of reach.
 */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  objectKey: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

export interface PresignInput {
  kind: 'attachment' | 'import' | 'export' | 'audit-export';
  filename: string;
  mime: string;
  size: number;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function objectKeyFor(ctx: TenantContext, kind: PresignInput['kind']): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `tenants/${ctx.tenantId}/${kind}s/${yyyy}/${mm}/${newId()}`;
}

/**
 * Signs an upload. The local development driver signs with an HMAC that the
 * API's own upload endpoint verifies, so the flow (presign, PUT elsewhere,
 * register) is exercised end to end without an S3 account.
 */
export function presignUpload(ctx: TenantContext, input: PresignInput): PresignedUpload {
  const config = loadConfig();
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachments are limited to ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  const objectKey = objectKeyFor(ctx, input.kind);
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const signature = signKey(objectKey, expiresAt, input.mime);

  const base = config.STORAGE_ENDPOINT ?? `${config.API_BASE_URL}/api/v1/storage`;
  return {
    url: `${base}/${encodeURIComponent(objectKey)}?expires=${expiresAt.getTime()}&signature=${signature}`,
    method: 'PUT',
    objectKey,
    headers: { 'Content-Type': input.mime, 'Content-Length': String(input.size) },
    expiresAt: expiresAt.toISOString(),
    maxBytes: MAX_ATTACHMENT_BYTES,
  };
}

export function signKey(objectKey: string, expiresAt: Date, mime: string): string {
  const secret = loadConfig().DEV_TOKEN_SECRET;
  return createHmac('sha256', secret).update(`${objectKey}:${expiresAt.getTime()}:${mime}`).digest('hex');
}

export function verifyUploadSignature(objectKey: string, expires: number, mime: string, signature: string): boolean {
  if (Number.isNaN(expires) || expires < Date.now()) return false;
  const expected = signKey(objectKey, new Date(expires), mime);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A short-lived download URL, issued only after a permission check. */
export function presignDownload(objectKey: string, ttlSeconds = 300): { url: string; expiresAt: string } {
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const nonce = randomBytes(8).toString('hex');
  const signature = createHmac('sha256', config.DEV_TOKEN_SECRET)
    .update(`${objectKey}:${expiresAt.getTime()}:${nonce}`)
    .digest('hex');
  const base = config.STORAGE_ENDPOINT ?? `${config.API_BASE_URL}/api/v1/storage`;
  return {
    url: `${base}/${encodeURIComponent(objectKey)}?expires=${expiresAt.getTime()}&nonce=${nonce}&signature=${signature}`,
    expiresAt: expiresAt.toISOString(),
  };
}
