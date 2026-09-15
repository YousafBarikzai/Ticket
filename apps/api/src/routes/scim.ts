import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ZodError } from 'zod';
import { ConflictError, DomainError, NotFoundError, UnauthorisedError, ValidationError, loadConfig, logger, metrics } from '@itsm/platform';
import {
  GROUP_SCHEMA,
  ScimError,
  USER_SCHEMA,
  pageSchema,
  resourceTypes,
  scimErrorBody,
  scimService,
  scimTokenService,
  serviceProviderConfig,
} from '@itsm/module-identity';
import { contextOf } from '../plugins/context.js';

/**
 * /scim/v2 (RFC 7644), for identity providers.
 *
 * Mounted at the root with its own error handler, because SCIM has its own
 * error shape and a provider reads `scimType` to decide whether to retry:
 * a problem document would be a 400 it cannot classify. The context plugin
 * has already turned the bearer token into a tenant context by the time a
 * handler runs (see `scimTokenService.authenticate`).
 */

const SCIM = 'application/scim+json; charset=utf-8';
const byId = z.object({ id: z.string().uuid() });

function location(path: string): string {
  return `${loadConfig().API_BASE_URL}/scim/v2${path}`;
}

export async function scimRoutes(app: FastifyInstance): Promise<void> {
  // Providers send `application/scim+json`; some send plain JSON. Both parse.
  app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_request, body, done) => {
    try {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      done(null, text.trim() === '' ? {} : JSON.parse(text));
    } catch (error) {
      done(new ScimError(400, `the body is not JSON: ${(error as Error).message}`, 'invalidSyntax'), undefined);
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    let status = 500;
    let detail = 'the request failed';
    let scimType: Parameters<typeof scimErrorBody>[2];
    if (error instanceof ScimError) {
      status = error.status;
      detail = error.message;
      scimType = error.scimType;
    } else if (error instanceof ZodError) {
      status = 400;
      detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      scimType = 'invalidValue';
    } else if (error instanceof NotFoundError) {
      status = 404;
      detail = error.message;
    } else if (error instanceof ConflictError) {
      status = 409;
      detail = error.message;
      scimType = 'uniqueness';
    } else if (error instanceof ValidationError) {
      status = 400;
      detail = error.message;
      scimType = 'invalidValue';
    } else if (error instanceof UnauthorisedError) {
      status = 401;
      detail = error.message;
    } else if (error instanceof DomainError) {
      status = error.status;
      detail = error.message;
    } else {
      const fastifyStatus = (error as { statusCode?: number }).statusCode;
      if (fastifyStatus && fastifyStatus < 500) {
        status = fastifyStatus;
        detail = (error as Error).message;
      } else {
        logger.error('scim request failed', { url: request.url, message: (error as Error).message, stack: (error as Error).stack });
      }
    }
    metrics.increment('scim_errors_total', { status: String(status) });
    if (status === 401) reply.header('www-authenticate', 'Bearer realm="scim"');
    reply.status(status).type(SCIM).send(scimErrorBody(status, detail, scimType));
  });

  app.get('/ServiceProviderConfig', async (_request, reply) => reply.type(SCIM).send(serviceProviderConfig(location)));
  app.get('/ResourceTypes', async (_request, reply) => reply.type(SCIM).send(resourceTypes(location)));
  app.get('/Schemas', async (_request, reply) =>
    reply.type(SCIM).send({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        { id: USER_SCHEMA, name: 'User', description: 'A person who can sign in.', meta: { resourceType: 'Schema', location: location(`/Schemas/${USER_SCHEMA}`) } },
        { id: GROUP_SCHEMA, name: 'Group', description: 'A team.', meta: { resourceType: 'Schema', location: location(`/Schemas/${GROUP_SCHEMA}`) } },
      ],
    }),
  );

  // ---- Users -----------------------------------------------------------------

  app.get('/Users', async (request, reply) => {
    const ctx = contextOf(request);
    return reply.type(SCIM).send(await scimService.listUsers(ctx, pageSchema.parse(request.query), location));
  });

  app.post('/Users', async (request, reply) => {
    const ctx = contextOf(request);
    const result = await scimService.createUser(ctx, request.body, location);
    return reply.status(201).type(SCIM).send(result.resource);
  });

  app.get('/Users/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.getUser(ctx, id, location));
  });

  app.put('/Users/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.replaceUser(ctx, id, request.body, location));
  });

  app.patch('/Users/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.patchUser(ctx, id, request.body, location));
  });

  app.delete('/Users/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await scimService.deleteUser(ctx, id);
    return reply.status(204).send();
  });

  // ---- Groups ----------------------------------------------------------------

  app.get('/Groups', async (request, reply) => {
    const ctx = contextOf(request);
    return reply.type(SCIM).send(await scimService.listGroups(ctx, pageSchema.parse(request.query), location));
  });

  app.post('/Groups', async (request, reply) => {
    const ctx = contextOf(request);
    const result = await scimService.createGroup(ctx, request.body, location);
    return reply.status(201).type(SCIM).send(result.resource);
  });

  app.get('/Groups/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.getGroup(ctx, id, location));
  });

  app.put('/Groups/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.replaceGroup(ctx, id, request.body, location));
  });

  app.patch('/Groups/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    return reply.type(SCIM).send(await scimService.patchGroup(ctx, id, request.body, location));
  });

  app.delete('/Groups/:id', async (request, reply) => {
    const ctx = contextOf(request);
    const { id } = byId.parse(request.params);
    await scimService.deleteGroup(ctx, id);
    return reply.status(204).send();
  });
}

/** The administrator's side: the token, and which groups grant which roles. */
export async function scimAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/scim/token', async (request) => {
    const ctx = contextOf(request);
    const rows = await scimTokenService.describeTokens(ctx);
    return {
      endpoint: location(''),
      data: rows.map((row) => ({
        id: row.id,
        hint: row.hint,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
    };
  });

  /** Issues a new token, shown once. Any current token keeps working for a day. */
  app.post('/scim/token', async (request, reply) => {
    const ctx = contextOf(request);
    const issued = await scimTokenService.rotateToken(ctx);
    reply.status(201);
    return { id: issued.id, token: issued.token, hint: issued.hint, endpoint: location(''), previousValidUntil: issued.previousValidUntil.toISOString() };
  });

  app.delete('/scim/token', async (request) => {
    const ctx = contextOf(request);
    return { revoked: await scimTokenService.revokeTokens(ctx) };
  });

  app.get('/scim/role-mappings', async (request) => {
    const ctx = contextOf(request);
    const rows = await scimService.listRoleMappings(ctx);
    return { data: rows.map((row) => ({ groupName: row.groupName, roleKey: row.roleKey })) };
  });

  app.put('/scim/role-mappings', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ data: z.unknown() }).strict().parse(request.body);
    const rows = await scimService.setRoleMappings(ctx, body.data as never);
    return { data: rows.map((row) => ({ groupName: row.groupName, roleKey: row.roleKey })) };
  });
}
