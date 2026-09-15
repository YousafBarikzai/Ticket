import { logger } from '@itsm/platform';

/**
 * Provider credentials, by reference.
 *
 * A channel account's `config` is tenant-editable JSON, so a provider token
 * must never live in it: anyone who can configure a mailbox would be able to
 * read the key that sends mail as the organisation, and it would be in every
 * audit `after` payload and every configuration export.
 *
 * So the account stores a *name* — `{ "credentialRef": "graph-acme" }` — and
 * the value is resolved here from the environment as
 * `ITSM_CREDENTIAL_GRAPH_ACME`. That works today on a platform where each
 * service has its own environment, keeps secrets out of the database, and is a
 * reference an encrypted store can satisfy later without any adapter changing
 * (docs/architecture/09 §4; the store itself is MOD-14's, in PH-4).
 */

export interface ResolvedCredential {
  ref: string;
  value: string;
}

/** Turns `graph-acme` into `ITSM_CREDENTIAL_GRAPH_ACME`. */
export function environmentNameFor(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

export function resolveCredential(ref: string | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedCredential | null {
  if (!ref) return null;
  const name = environmentNameFor(ref);
  const value = env[name];
  if (!value) {
    // Named rather than silent: "mail is not going out" is a support call, and
    // "ITSM_CREDENTIAL_GRAPH_ACME is not set" is a fix.
    logger.warn('a channel account names a credential that is not configured', { ref, expects: name });
    return null;
  }
  return { ref, value };
}

/**
 * Every credential an account needs, so a misconfiguration is one message
 * rather than one per failed send.
 */
export function missingCredentials(refs: (string | undefined)[], env: NodeJS.ProcessEnv = process.env): string[] {
  return refs
    .filter((ref): ref is string => Boolean(ref))
    .filter((ref) => !env[environmentNameFor(ref)])
    .map(environmentNameFor);
}
