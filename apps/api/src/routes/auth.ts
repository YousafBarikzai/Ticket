import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SYSTEM_PERMISSIONS, UnauthorisedError, createContext, loadConfig, logger } from '@itsm/platform';
import { userService } from '@itsm/module-identity';
import { tenantService } from '@itsm/module-tenancy';
import { signDevelopmentToken } from '../auth/verify.js';

/**
 * The development sign-in.
 *
 * Production authentication is Keycloak, and the BFF in `apps/workbench`
 * performs Authorization Code with PKCE against it (doc 09 §2). That leaves a
 * gap that had been papered over with a script: with no identity provider
 * running, there was no way for a browser to obtain a token at all, so the web
 * applications could not be run by a developer who had not first read
 * `infra/scripts/walking-skeleton.ts` and copied its token-minting out of it.
 *
 * This endpoint closes that gap, and puts the whole affordance in one place
 * rather than in each application that needs it. It is the only code path that
 * issues a token without a provider, which is exactly why it is worth having
 * once and guarding hard:
 *
 *   - it is registered only when `NODE_ENV` is not production AND no
 *     `OIDC_ISSUER` is configured, so a deployment cannot reach it even if
 *     something else is misconfigured;
 *   - the token it mints is the same HS256 development token the API already
 *     accepts under exactly those conditions, so it grants nothing that was not
 *     already grantable;
 *   - it names no password, because there is none — a development database is
 *     not a secret, and pretending otherwise would invite somebody to deploy it.
 *
 * `isDevelopmentSignInEnabled` is exported so that the decision is one
 * expression with one test, rather than a condition repeated at a call site.
 */

export function isDevelopmentSignInEnabled(config = loadConfig()): boolean {
  return config.NODE_ENV !== 'production' && !config.OIDC_ISSUER;
}

const request = z.object({
  tenantSlug: z.string().min(1).max(64),
  email: z.string().email().max(320),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  if (!isDevelopmentSignInEnabled()) {
    logger.info('development sign-in is not registered', { reason: 'production or an OIDC issuer is configured' });
    return;
  }

  logger.warn('development sign-in is registered; this must never be a deployed configuration');

  app.post('/auth/dev-session', async (httpRequest, reply) => {
    const { tenantSlug, email } = request.parse(httpRequest.body);

    // One message for a missing tenant and a missing user. There is no secret
    // to protect here, but a sign-in that reports which half was wrong is a
    // habit that follows people into the endpoints where there is.
    const unknown = new UnauthorisedError('no such tenant and user; run `pnpm seed` first');

    const tenant = await tenantService.findTenantBySlug(tenantSlug);
    if (!tenant) throw unknown;

    const ctx = createContext({
      tenantId: tenant.id,
      actor: { type: 'system', id: null },
      permissions: SYSTEM_PERMISSIONS,
    });
    // Through the module rather than through Prisma: an application that
    // queries a module's tables directly is the first crack in the contract
    // that makes extraction possible (doc 04 §3), and `contains` is a filter,
    // so the exact address is matched here.
    const candidates = await userService.listUsers(ctx, { search: email, limit: 10, status: 'active' });
    const user = candidates.find((row) => row.email.toLowerCase() === email.toLowerCase());
    if (!user) throw unknown;

    const expiresInSeconds = 60 * 60;
    const accessToken = signDevelopmentToken({
      sub: user.id,
      itsm_user_id: user.id,
      tenant_id: tenant.id,
      email: user.email,
      name: user.displayName,
      sid: `dev-${user.id}`,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });

    reply.status(201);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds,
      tenantId: tenant.id,
      userId: user.id,
      displayName: user.displayName,
    };
  });
}
