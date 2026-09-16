import { DomainError } from '@itsm/platform';

/**
 * SCIM has its own error shape (RFC 7644 §3.12), and an identity provider
 * reads the `scimType` to decide whether to retry, so a platform problem
 * document is not enough: the route layer turns every error into one of
 * these, and the domain throws them where the type matters.
 */
export type ScimType = 'invalidFilter' | 'tooMany' | 'uniqueness' | 'mutability' | 'invalidSyntax' | 'invalidPath' | 'noTarget' | 'invalidValue' | 'invalidVers' | 'sensitive';

export class ScimError extends DomainError {
  readonly code = 'scim_error';

  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: ScimType,
  ) {
    super(message);
  }
}

export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export function scimErrorBody(status: number, detail: string, scimType?: ScimType) {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) };
}
