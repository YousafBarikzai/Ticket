import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import {
  ConflictError,
  DomainError,
  RateLimitedError,
  ValidationError,
  logger,
  metrics,
  toProblemDetails,
} from '@itsm/platform';

/**
 * One error handler for the whole API (specification §7 Errors).
 *
 * Every failure becomes RFC 9457 problem details carrying the correlation id,
 * and no stack trace, driver message or connection string ever reaches a
 * client.
 */

function fromZodError(error: ZodError): ValidationError {
  return new ValidationError(
    'the request did not match the expected shape',
    error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      code: issue.code,
      message: issue.message,
    })),
  );
}

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId = request.correlationId ?? 'unknown';
    const domainError = error instanceof ZodError ? fromZodError(error) : error;

    if (domainError instanceof DomainError) {
      const problem = toProblemDetails(domainError, correlationId, request.url);

      if (domainError instanceof ConflictError && domainError.current) {
        // The current version lets a client merge rather than guess.
        reply.header('x-current-version', String((domainError.current as { version?: number }).version ?? ''));
      }
      if (domainError instanceof RateLimitedError) {
        reply.header('retry-after', String(domainError.retryAfterSeconds));
      }

      metrics.increment('api_errors_total', { status: String(domainError.status) });
      // A client mistake is not worth an error log; a server fault is.
      if (domainError.status >= 500) {
        logger.error('request failed', { url: request.url, code: domainError.code, message: domainError.message });
      }
      reply.status(domainError.status).type('application/problem+json').send(problem);
      return;
    }

    // Fastify's own routing and payload errors carry a status code.
    const status = (error as { statusCode?: number }).statusCode;
    const message = (error as Error).message ?? 'request failed';
    if (status && status < 500) {
      metrics.increment('api_errors_total', { status: String(status) });
      reply.status(status).type('application/problem+json').send({
        type: 'https://docs.itsm.example/problems/bad_request',
        title: 'bad request',
        status,
        detail: message,
        correlationId,
        instance: request.url,
      });
      return;
    }

    logger.error('unhandled error', { url: request.url, message, stack: (error as Error).stack });
    metrics.increment('api_errors_total', { status: '500' });
    reply.status(500).type('application/problem+json').send(toProblemDetails(error, correlationId, request.url));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).type('application/problem+json').send({
      type: 'https://docs.itsm.example/problems/not_found',
      title: 'not found',
      status: 404,
      detail: `no route for ${request.method} ${request.url}`,
      correlationId: request.correlationId ?? 'unknown',
    });
  });
});
