import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  buildPermissionSet,
  createContext,
  DemoResetError,
  DemoUnavailableError,
  EMPTY_PERMISSIONS,
  enterContext,
  isDemoTenant,
  loadConfig,
  logger,
  metrics,
  newCorrelationId,
  stripDemoPermissions,
  SYSTEM_PERMISSIONS,
  tenantFacts,
  TenantSuspendedError,
  UnauthorisedError,
  withContext,
  type DemoContext,
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
const UNAUTHENTICATED_PATHS = new Set([
  '/health/live',
  '/health/ready',
  '/api/openapi.json',
  '/api/docs',
  '/metrics',
  // The development sign-in, which by definition has no token to present. The
  // route is registered only when there is no identity provider and the
  // environment is not production (routes/auth.ts), so in a deployment this
  // entry names a path that answers 404.
  '/api/v1/auth/dev-session',
  // The shared demo's public status (SPEC v3 §4.6.4): the site and every
  // app's demo bar read it before anyone has a session. It names no tenant,
  // user or token. It is the only demo route without authentication; nothing
  // here or anywhere else mints a demo token (D21).
  '/api/demo/v1/status',
]);

/** Where the demo's API routes live (`routes/demo.ts`). */
const DEMO_ROUTE_PREFIX = '/api/demo/';

function isUnauthenticated(request: FastifyRequest): boolean {
  const url = request.url.split('?')[0] ?? '';
  if (UNAUTHENTICATED_PATHS.has(url)) return true;
  // With the demo switched off its routes do not exist, and each answers 404
  // itself (§4.6.4 step 1). Letting them past the door first means a token —
  // or the lack of one — cannot turn that into a 401 that hints otherwise.
  if (url.startsWith(DEMO_ROUTE_PREFIX) && loadConfig().DEMO_MODE !== 'on') return true;
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
      // The shared demo has no directory to provision: its SCIM permission is
      // stripped, so no token can be issued there. This closes the path anyway,
      // as the interlock below does for every other kind of token (D25).
      if (await isDemoTenant(scim.tenantId)) refuseNonDemoToken();
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
    // The database interlock (D25), both ways, before anything else about the
    // tenant is believed: the token's kind and the tenant's must agree.
    assertTenantAccepts(token, tenant);
    if (!tenant) throw new UnauthorisedError('this token names a tenant that does not exist');
    if (tenant.status === 'suspended') throw new TenantSuspendedError();
    const demoTenant = tenant.kind === 'demo';

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
      // Through `tenantFacts` rather than field by field: every context built
      // from a tenant row gets the same set, so a policy that exists here
      // cannot be quietly missing in the worker.
      ...tenantFacts(tenant),
      correlationId: request.correlationId,
      // A demo visitor's address and browser are never kept, not even in the
      // audit rows their writes produce (D23, §4.7.6).
      ...(demoTenant ? {} : { ip: request.ip, userAgent: request.headers['user-agent'] }),
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
    // Never for a demo token, which carries no email and whose subject is the
    // visit rather than the user anyway: belt and braces, because a persona
    // created on the fly by a visitor's request would be a person nobody built.
    if (!actor && !token.demo && token.email && token.userId === token.subject) {
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
    if (!actor || actor.status !== 'active') {
      // A persona the build has not finished, or one the worker's check is
      // about to repair: 503 rather than `demo_reset`, because a re-mint would
      // name the same user and loop (A3 §4.5).
      if (token.demo) throw new DemoUnavailableError('persona');
      throw new UnauthorisedError(actor ? 'this account is not active' : 'this account no longer exists');
    }

    request.tenantContext = createContext({
      ...base,
      actor: { type: 'user', id: actor.userId, displayName: actor.displayName },
      // Whatever the persona's roles say, the shared demo never offers what it
      // strips (§4.7.1): `/me` omits those keys and every check refuses them.
      permissions: demoTenant ? stripDemoPermissions(actor.permissions) : actor.permissions,
      organisationIds: actor.organisationIds,
      organisationPaths: actor.organisationPaths,
      teamIds: actor.teamIds,
      locale: actor.locale,
      timeZone: actor.timeZone,
      ...(token.impersonation ? { impersonation: token.impersonation } : {}),
      ...(token.demo ? { demo: demoContextOf(token.demo) } : {}),
    });

    enterContext(request.tenantContext);
  });

  app.decorateRequest('tenantContext', undefined);
  app.decorateRequest('token', undefined);

  logger.debug('context plugin registered');
});

/** The demo facts the request context carries, copied from the verified token (§4.4). */
function demoContextOf(demo: NonNullable<VerifiedToken['demo']>): DemoContext {
  return {
    sid: demo.sid,
    persona: demo.persona,
    app: demo.app,
    generation: demo.generation,
    personaUserIds: demo.personaUserIds,
    agentTeamIds: demo.agentTeamIds,
  };
}

/** A token that is not a demo session, presented to the demo tenant. */
function refuseNonDemoToken(): never {
  metrics.increment('demo_interlock_refusals_total', { reason: 'non-demo-token' });
  throw new UnauthorisedError('this workspace only accepts demo sessions');
}

/** The tenant fields the interlock reads. */
export interface InterlockTenant {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
}

/**
 * The database interlock (D25; §4.4), in both directions.
 *
 * Redis vouches for a demo token, and Redis is shared by every service; the
 * tenant's `kind` lives in Postgres, is fixed at insert by a trigger, and no
 * application role can write it. So whatever a forged or corrupted Redis
 * says, a demo token reaches only a `kind = 'demo'` tenant, and no other kind
 * of token — Keycloak, development, API key, SCIM — reaches the demo tenant
 * at all, which keeps a real administrator's session out of the shared data
 * as firmly as it keeps visitors out of real data.
 *
 * | Token | Tenant | Outcome |
 * |---|---|---|
 * | demo | demo, `active` | accepted |
 * | demo | demo, any other status, or gone | 401 `demo_reset` (the BFF re-mints onto the live one) |
 * | demo | standard | 401, `SECURITY` error log, metric `{reason: 'kind'}` |
 * | any other | demo | 401 "this workspace only accepts demo sessions", metric `{reason: 'non-demo-token'}` |
 *
 * Returns quietly for a non-demo token and a standard (or missing) tenant;
 * the caller's own checks take it from there.
 */
export function assertTenantAccepts(token: Pick<VerifiedToken, 'demo'>, tenant: InterlockTenant | null): void {
  if (token.demo) {
    // A purged generation: its token already fails the generation check
    // unless the live record still names it, and a re-mint is the way out.
    if (!tenant) throw new DemoResetError();
    if (tenant.kind !== 'demo') {
      logger.error('SECURITY: a demo token named a standard tenant', { tenantId: tenant.id });
      metrics.increment('demo_interlock_refusals_total', { reason: 'kind' });
      throw new UnauthorisedError('this token names a tenant it cannot be used with');
    }
    if (tenant.status !== 'active') throw new DemoResetError();
    return;
  }
  if (tenant?.kind === 'demo') refuseNonDemoToken();
}

/** The context for the current request, or a clear failure if there is none. */
export function contextOf(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) throw new UnauthorisedError('this request has no tenant context');
  return request.tenantContext;
}
