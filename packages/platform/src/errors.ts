import type { ProblemDetails } from '@itsm/contracts';

/**
 * Typed domain errors. Services throw these; one handler in the API maps them
 * to RFC 9457 problem details, so no route ever builds an error body by hand
 * and no stack trace can leak (specification §7).
 */
export abstract class DomainError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly fieldErrors?: { field: string; code: string; message: string }[];

  constructor(message: string, fieldErrors?: { field: string; code: string; message: string }[]) {
    super(message);
    this.name = new.target.name;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

/**
 * Returned when a record does not exist OR when the caller may not know that it
 * exists. Responses must never reveal that a resource belongs to another tenant
 * (specification §7 Authorisation), so the permission layer raises this rather
 * than Forbidden whenever the caller lacks read access to the target.
 */
export class NotFoundError extends DomainError {
  readonly status = 404;
  readonly code = 'not_found';
  constructor(resource: string, id?: string) {
    super(id ? `${resource} ${id} was not found` : `${resource} was not found`);
  }
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  readonly code = 'forbidden';
  constructor(public readonly permission: string, message = `permission ${permission} is required`) {
    super(message);
  }
}

export class UnauthorisedError extends DomainError {
  readonly status = 401;
  readonly code = 'unauthorised';
}

export class ValidationError extends DomainError {
  readonly status = 422;
  readonly code = 'validation_failed';
}

export class ConflictError extends DomainError {
  readonly status = 409;
  readonly code = 'conflict';
  constructor(message: string, public readonly current?: unknown) {
    super(message);
  }
}

export class PreconditionRequiredError extends DomainError {
  readonly status = 428;
  readonly code = 'precondition_required';
  constructor(message = 'If-Match is required for this update') {
    super(message);
  }
}

export class StateTransitionError extends DomainError {
  readonly status = 422;
  readonly code = 'invalid_transition';
  constructor(from: string, to: string, allowed: string[]) {
    super(`cannot move from ${from} to ${to}; allowed: ${allowed.join(', ') || 'none'}`);
  }
}

export class RateLimitedError extends DomainError {
  readonly status = 429;
  readonly code = 'rate_limited';
  constructor(public readonly retryAfterSeconds: number) {
    super('rate limit exceeded');
  }
}

export class DependencyUnavailableError extends DomainError {
  readonly status = 503;
  readonly code = 'dependency_unavailable';
  constructor(dependency: string) {
    super(`${dependency} is unavailable`);
  }
}

export class TenantSuspendedError extends DomainError {
  readonly status = 403;
  readonly code = 'tenant_suspended';
  constructor() {
    super('this tenant is suspended');
  }
}

/** Raised when code reaches the data layer without a tenant context (ADR-0004). */
export class MissingTenantContextError extends DomainError {
  readonly status = 500;
  readonly code = 'missing_tenant_context';
  constructor(detail: string) {
    super(`no tenant context: ${detail}`);
  }
}

export function toProblemDetails(error: unknown, correlationId: string, instance?: string): ProblemDetails {
  const base = { correlationId, ...(instance ? { instance } : {}) };
  if (error instanceof DomainError) {
    return {
      type: `https://docs.itsm.example/problems/${error.code}`,
      title: error.code.replace(/_/g, ' '),
      status: error.status,
      detail: error.message,
      ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
      ...base,
    };
  }
  return {
    type: 'https://docs.itsm.example/problems/internal_error',
    title: 'internal error',
    status: 500,
    detail: 'The request could not be completed.',
    ...base,
  };
}
