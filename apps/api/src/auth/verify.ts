import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorisedError, cache, loadConfig, logger } from '@itsm/platform';

/**
 * Token verification (docs/architecture/09 §1).
 *
 * Production tokens come from Keycloak and are verified against its JWKS. A
 * locally signed development token is accepted ONLY when no issuer is
 * configured, so a deployed environment cannot fall back to it by accident.
 */

export interface VerifiedToken {
  kind: 'user' | 'service';
  tenantId: string;
  userId?: string;
  subject: string;
  sessionId?: string;
  name?: string;
  email?: string;
  scopes?: string[];
  acr?: string;
  /**
   * When the token stops being accepted, as epoch seconds.
   *
   * Carried out of verification because the session denylist needs it: an
   * entry is only worth keeping for as long as a token bearing that `sid`
   * could still be presented, and the issuer is the only thing that knows.
   */
  expiresAt?: number;
  impersonation?: { byUserId: string; reason: string };
}

interface JwtPayload {
  sub: string;
  tenant_id?: string;
  sid?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  scope?: string;
  acr?: string;
  azp?: string;
  exp?: number;
  nbf?: number;
  aud?: string | string[];
  iss?: string;
  typ?: string;
  itsm_user_id?: string;
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signDevelopmentToken(payload: JwtPayload, secret = loadConfig().DEV_TOKEN_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyDevelopmentToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorisedError('malformed token');
  const [header, body, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', loadConfig().DEV_TOKEN_SECRET).update(`${header}.${body}`).digest();
  const provided = base64UrlDecode(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorisedError('token signature does not verify');
  }

  const payload = JSON.parse(base64UrlDecode(body).toString('utf8')) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) throw new UnauthorisedError('token has expired');
  if (payload.nbf !== undefined && payload.nbf > now) throw new UnauthorisedError('token is not yet valid');
  return payload;
}

interface JwksKey {
  kid: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Cached for an hour: an identity-provider outage must not end every session. */
async function fetchJwks(issuer: string): Promise<JwksKey[]> {
  const cacheKey = `jwks:${issuer}`;
  try {
    const hit = await cache().get(cacheKey);
    if (hit) return JSON.parse(hit) as JwksKey[];
  } catch {
    // Cache miss or outage: fetch directly.
  }

  const wellKnown = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!wellKnown.ok) throw new UnauthorisedError('the identity provider is not reachable');
  const { jwks_uri: jwksUri } = (await wellKnown.json()) as { jwks_uri: string };

  const response = await fetch(jwksUri, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new UnauthorisedError('the identity provider is not reachable');
  const { keys } = (await response.json()) as { keys: JwksKey[] };

  try {
    await cache().set(cacheKey, JSON.stringify(keys), 'EX', 3600);
  } catch {
    // Not fatal.
  }
  return keys;
}

async function verifyProviderToken(token: string, issuer: string): Promise<JwtPayload> {
  const { createLocalJWKSet, jwtVerify } = await import('jose');
  const keys = await fetchJwks(issuer);
  const jwks = createLocalJWKSet({ keys: keys as never });
  const config = loadConfig();

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.OIDC_AUDIENCE,
      clockTolerance: 30,
    });
    return payload as JwtPayload;
  } catch (error) {
    logger.debug('token verification failed', { error: (error as Error).message });
    throw new UnauthorisedError('token could not be verified');
  }
}

/** Checks the session has not been revoked since the token was issued. */
async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    return (await cache().get(`sess:deny:${sessionId}`)) !== null;
  } catch {
    // If the denylist is unreachable, err towards availability: the session
    // table is checked again on the next refresh.
    return false;
  }
}

export async function verifyAccessToken(authorisation: string): Promise<VerifiedToken> {
  const config = loadConfig();

  if (authorisation.startsWith('ApiKey ')) {
    return verifyApiKey(authorisation.slice('ApiKey '.length).trim());
  }
  if (!authorisation.startsWith('Bearer ')) throw new UnauthorisedError('unsupported authorisation scheme');

  const token = authorisation.slice('Bearer '.length).trim();
  const payload = config.OIDC_ISSUER
    ? await verifyProviderToken(token, config.OIDC_ISSUER)
    : verifyDevelopmentToken(token);

  const tenantId = payload.tenant_id;
  if (!tenantId) throw new UnauthorisedError('this token names no tenant');

  if (payload.sid && (await isSessionRevoked(payload.sid))) {
    throw new UnauthorisedError('this session has been revoked');
  }

  // A client-credentials token has no user behind it.
  if (payload.typ === 'service' || (!payload.email && payload.azp && !payload.itsm_user_id)) {
    return {
      kind: 'service',
      tenantId,
      subject: payload.sub,
      ...(payload.azp ? { name: payload.azp } : {}),
      ...(payload.scope ? { scopes: payload.scope.split(' ').filter(Boolean) } : {}),
    };
  }

  return {
    kind: 'user',
    tenantId,
    userId: payload.itsm_user_id ?? payload.sub,
    subject: payload.sub,
    ...(payload.exp !== undefined ? { expiresAt: payload.exp } : {}),
    ...(payload.sid ? { sessionId: payload.sid } : {}),
    ...(payload.name ?? payload.preferred_username ? { name: payload.name ?? payload.preferred_username } : {}),
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.acr ? { acr: payload.acr } : {}),
  };
}

/** API keys are hashed at rest and compared in constant time. */
async function verifyApiKey(presented: string): Promise<VerifiedToken> {
  const { platformDb } = await import('@itsm/platform');
  const separator = presented.indexOf('_');
  if (separator < 1) throw new UnauthorisedError('malformed API key');
  const prefix = presented.slice(0, separator);

  const record = await platformDb().apiKey.findFirst({ where: { prefix, revokedAt: null } });
  if (!record) throw new UnauthorisedError('unknown API key');
  if (record.expiresAt && record.expiresAt < new Date()) throw new UnauthorisedError('this API key has expired');

  const expected = Buffer.from(record.hash, 'hex');
  const provided = createHmac('sha256', loadConfig().DEV_TOKEN_SECRET).update(presented).digest();
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new UnauthorisedError('API key does not verify');
  }

  return {
    kind: 'service',
    tenantId: record.tenantId,
    subject: record.serviceUserId,
    name: record.name,
    scopes: record.scopes,
  };
}

export function hashApiKey(key: string): string {
  return createHmac('sha256', loadConfig().DEV_TOKEN_SECRET).update(key).digest('hex');
}
