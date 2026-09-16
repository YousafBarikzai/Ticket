import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SYSTEM_PERMISSIONS, UnauthorisedError, ValidationError, createContext, loadConfig, logger } from '@itsm/platform';
import { userService } from '@itsm/module-identity';
import { tenantService } from '@itsm/module-tenancy';
import { contextOf } from '../plugins/context.js';
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

/** `POST /auth/session` takes nothing: the token is the whole of the evidence. */
const emptyBody = z.object({});

/**
 * `POST /auth/session` — the BFF telling the platform a session has begun.
 *
 * Doc 09 §2 has the web applications call this after a sign-in. Nothing did,
 * and the consequence was quiet and complete: `Session` rows were only ever
 * written by a test, so `GET /me/sessions` listed nothing, `DELETE
 * /me/sessions/:id` had nothing to revoke, and the denylist the token verifier
 * consults on every single request never gained an entry. "Sign out
 * everywhere" was a promise doc 08 §9 makes and the platform could not keep.
 *
 * The token is the proof, so there is nothing in the body. Everything recorded
 * — who, which session, when it expires, from where — comes from the verified
 * token and the request, never from the caller's claims about itself.
 *
 * Idempotent: an application may call it on every refresh, and `recordSession`
 * updates `last_seen_at` rather than creating a second row.
 */
async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/session', async (httpRequest, reply) => {
    const ctx = contextOf(httpRequest);
    const token = httpRequest.token;

    // There is nothing to send, and saying so is the point: strict, so a
    // client that puts a user id or a device name in the body is told it was
    // not read, rather than being left to believe the platform believed it.
    emptyBody.strict().parse(httpRequest.body ?? {});

    // Three separate refusals rather than one, because they are three different
    // mistakes and the caller can only fix the one it made.
    if (!token) throw new UnauthorisedError('a session can only be recorded by the person it belongs to');
    if (token.kind === 'service') {
      // An integration has no session to record; it presents a key or a
      // client-credentials token on every call, and there is nothing to sign
      // out of.
      throw new ValidationError('only a person\u2019s session can be recorded');
    }
    if (!token.sessionId) {
      throw new ValidationError('this token carries no session identifier, so there is nothing to record');
    }
    if (!ctx.actor.id) {
      throw new ValidationError('this token has not been matched to a user, so there is no session to record');
    }

    // The token's own expiry, because the denylist entry has to outlive the
    // token and nothing else knows when that is. A token without one is
    // treated as short-lived rather than eternal.
    const expiresAt = token.expiresAt
      ? new Date(token.expiresAt * 1000)
      : new Date(Date.now() + 10 * 60_000);

    const session = await userService.recordSession(ctx, {
      userId: ctx.actor.id,
      sid: token.sessionId,
      expiresAt,
      ...(httpRequest.ip ? { ip: httpRequest.ip } : {}),
      ...(typeof httpRequest.headers['user-agent'] === 'string'
        ? { userAgent: httpRequest.headers['user-agent'] }
        : {}),
    });

    reply.status(201);
    return {
      id: session.id,
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
    };
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  await sessionRoutes(app);

  if (!isDevelopmentSignInEnabled()) {
    logger.info('development sign-in is not registered', { reason: 'production or an OIDC issuer is configured' });
    return;
  }

  logger.warn('development sign-in is registered; this must never be a deployed configuration');

  app.post('/auth/dev-session', async (httpRequest, reply) => {
    const { tenantSlug, email } = request.strict().parse(httpRequest.body);

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
