import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';

/**
 * Signed links.
 *
 * A survey lands in somebody's inbox and has to work when they click it, with
 * no session and no password. The link therefore carries its own proof: a
 * payload naming the tenant and the thing it opens, an expiry, and an HMAC
 * over both. Anybody can read the payload; nobody can alter it or extend it.
 *
 * The same secret signs presigned uploads (`storage.ts`), so this is one
 * secret to rotate rather than two. A rotation invalidates outstanding links,
 * which for a link that expires in days is the right trade.
 */

export interface SignedTokenPayload {
  tenantId: string;
  /** What the link opens: `survey_invitation`, say. */
  kind: string;
  subjectId: string;
  expiresAt: string;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/**
 * The signing secret: the environment's value when it is set, else the
 * validated configuration's default. Read this way so a unit test can set one
 * variable rather than a whole environment.
 */
function secret(): string {
  return process.env.DEV_TOKEN_SECRET ?? loadConfig().DEV_TOKEN_SECRET;
}

function signature(encoded: string): string {
  return createHmac('sha256', secret()).update(encoded).digest('base64url');
}

export function signToken(payload: SignedTokenPayload): string {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

export type TokenVerdict = { ok: true; payload: SignedTokenPayload } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/** Verifies the signature before reading the payload, and the expiry after. */
export function verifyToken(token: string, now: Date = new Date()): TokenVerdict {
  const [encoded, provided] = token.split('.');
  if (!encoded || !provided) return { ok: false, reason: 'malformed' };

  const expected = signature(encoded);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  let payload: SignedTokenPayload;
  try {
    payload = JSON.parse(decode(encoded)) as SignedTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload.tenantId !== 'string' || typeof payload.subjectId !== 'string' || typeof payload.kind !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  const expires = new Date(payload.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
