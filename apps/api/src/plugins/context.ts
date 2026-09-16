import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  EMPTY_PERMISSIONS,
  SYSTEM_PERMISSIONS,
  TenantSuspendedError,
  UnauthorisedError,
  buildPermissionSet,
  createContext,
  enterContext,
  loadConfig,
  logger,
  newCorrelationId,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { resolveActor, scimTokenService, userService } from '@itsm/module-identity';
import { tenantService } from '@itsm/module-tenancy';
import { verifyAccessToken, type VerifiedToken } from '../auth/verify.js';

/**
 * The request lifecycle (docs/architecture/08 §3).
 *
 * Correlation, then authentication, then tenant, then context — in that order,
 * because each step needs the one before it. Authorisation deliberately does
 * NOT happen here: it happens in the service layer, against the loaded record
 * (specification §7).
 */

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    token?: VerifiedToken;
    tenantContext?: TenantContext;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Routes that must work before a caller has a tenant or a session. */
const UNAUTHENTICATED_PATHS = new Set(['/health/live', '/health/ready', '/api/openapi.json', '/api/docs', '/metrics']);

function isUnauthenticated(request: FastifyRequest): boolean {
  const url = request.url.split('?')[0] ?? '';
  if (UNAUTHENTICATED_PATHS.has(url)) return true;
  // Signed-token endpoints carry their own proof and have no session.
  if (url.startsWith('/api/v1/public/')) return true;
  // The public status page, by slug or on a mapped host (MOD-23).
  if (url === '/status' || url.startsWith('/status/')) return true;
  // A provider webhook has no token to present: it proves itself with a
  // signature over the body, checked by the channel's transport before the
  // payload is looked at. Matched exactly rather than by prefix, so the rest of
  // the channel routes stay behind authentication.
  return /^\/api\/v1\/channels\/[a-z-]+\/[^/]+\/inbound$/.test(url);
}

export const contextPlugin = fp(async (app: FastifyInstance) => {
  const config = loadConfig();

  app.addHook('onRequest', async (request, reply) => {
    // Honour an inbound correlation id so a trace survives the edge, the BFF
    // and any retry, but never let it be something unreasonable.
    const inbound = request.headers['x-correlation-id'];
    const candidate = typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 200 ? inbound : null;
    request.correlationId = candidate ?? newCorrelationId();
    reply.header('x-correlation-id', request.correlationId);
  });

  /**
   * One hook does authentication, tenant resolution and context binding, in
   * that order, because each needs the one before it. It runs at `preHandler`
   * so that `enterContext` at the end covers the route handler and everything
   * it awaits.
   */
  app.addHook('preHandler', async (request) => {
    if (isUnauthenticated(request)) return;

    const header = request.headers.authorization;
    if (!header) throw new UnauthorisedError('an access token is required');

    // SCIM carries its own token, per tenant, issued by an administrator; the
    // tenant is inside it, resolved through the directory like every other
    // pre-tenant request (ADR-0035). Nothing under /scim/v2 accepts a session.
    if ((request.url.split('?')[0] ?? '').startsWith('/scim/v2')) {
      if (!header.startsWith('Bearer ')) throw new UnauthorisedError('a SCIM bearer token is required');
      const scim = await scimTokenService.authenticate(header.slice('Bearer '.length).trim());
      request.tenantContext = createContext({
        tenantId: scim.tenantId,
        region: scim.region,
        correlationId: request.correlationId,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        actor: { type: 'integration', id: null, displayName: 'scim' },
        permissions: scim.permissions,
      });
      enterContext(request.tenantContext);
      return;
    }

    const token = await verifyAccessToken(header);
    request.token = token;

    const tenant = await tenantService.findTenantById(token.tenantId);
    if (!tenant) throw new UnauthorisedError('this token names a tenant that does not exist');
    if (tenant.status === 'suspended') throw new TenantSuspendedError();

    // The host is only a hint for branding; the token decides the tenant. A
    // mismatch means someone is presenting a token on the wrong front door.
    const host = request.headers.host?.split(':')[0];
    if (host && config.NODE_ENV === 'production') {
      const hostTenant = await tenantService.findTenantByHost(host);
      if (hostTenant && hostTenant.id !== tenant.id) {
        throw new UnauthorisedError('this token does not belong to the tenant for this host');
      }
    }

    const base = {
      tenantId: tenant.id,
      region: tenant.region,
      correlationId: request.correlationId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };

    if (token.kind === 'service') {
      request.tenantContext = createContext({
        ...base,
        actor: { type: 'integration', id: token.subject, displayName: token.name ?? 'integration' },
        permissions: token.scopes?.length
          ? buildPermissionSet(token.scopes.map((key) => ({ key, scope: 'any' as const })))
          : EMPTY_PERMISSIONS,
      });
      enterContext(request.tenantContext);
      return;
    }

    // A user's permissions come from the platform's own tables, never from the
    // token, so a revoked role takes effect without waiting for expiry.
    const bootstrapContext = createContext({
      ...base,
      actor: { type: 'system', id: null },
      permissions: SYSTEM_PERMISSIONS,
    });

    // A token from the identity provider names its subject, which is not one
    // of our ids; looking that up as one would be a database error, not a miss.
    const namesOurId = UUID.test(token.userId ?? '');
    let actor = namesOurId ? await withContext(bootstrapContext, () => resolveActor(bootstrapContext, token.userId!)) : null;
    if (!actor && token.email && token.userId === token.subject) {
      // First login through the identity provider: the token names nobody the
      // platform knows yet. Provision just in time, or link an account that
      // SCIM or an import already made for this address (doc 09 §JIT).
      const provisioned = await withContext(bootstrapContext, () =>
        userService.provisionFromToken(bootstrapContext, { sub: token.subject, email: token.email!, ...(token.name ? { name: token.name } : {}) }),
      ).catch((error: unknown) => {
        // A deactivated account presenting a fresh token is refused, not a
        // validation problem: the answer to "may I come in" is no.
        throw new UnauthorisedError(error instanceof Error ? error.message : 'this account is not active');
      });
      actor = await withContext(bootstrapContext, () => resolveActor(bootstrapContext, provisioned.userId));
    }
    if (!actor) throw new UnauthorisedError('this account no longer exists');
    if (actor.status !== 'active') throw new UnauthorisedError('this account is not active');

    request.tenantContext = createContext({
      ...base,
      actor: { type: 'user', id: actor.userId, displayName: actor.displayName },
      permissions: actor.permissions,
      organisationIds: actor.organisationIds,
      organisationPaths: actor.organisationPaths,
      teamIds: actor.teamIds,
      locale: actor.locale,
      timeZone: actor.timeZone,
      ...(token.impersonation ? { impersonation: token.impersonation } : {}),
    });

    enterContext(request.tenantContext);
  });

  app.decorateRequest('tenantContext', undefined);
  app.decorateRequest('token', undefined);

  logger.debug('context plugin registered');
});

/** The context for the current request, or a clear failure if there is none. */
export function contextOf(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) throw new UnauthorisedError('this request has no tenant context');
  return request.tenantContext;
}
