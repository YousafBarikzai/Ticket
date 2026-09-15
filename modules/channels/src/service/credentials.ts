import { environmentNameFor, resolveSecret, type TenantContext } from '@itsm/platform';

/**
 * Provider credentials, by reference.
 *
 * A channel account's `config` is tenant-editable JSON, so a provider token
 * must never live in it: anyone who can configure a mailbox would be able to
 * read the key that sends mail as the organisation, and it would be in every
 * audit `after` payload and every configuration export.
 *
 * So the account stores a *name* — `{ "credentialRef": "graph-acme" }` — and
 * the platform resolves it. Phase 3 resolved names from the environment; Phase
 * 4 added an encrypted per-tenant store in front of that. This file did not
 * change, which is what the indirection was for.
 */

export interface ResolvedCredential {
  ref: string;
  value: string;
}

export { environmentNameFor };

export async function resolveCredential(
  ref: string | undefined,
  ctx: TenantContext | null = null,
): Promise<ResolvedCredential | null> {
  const value = await resolveSecret(ctx, ref);
  return value ? { ref: ref!, value } : null;
}

/**
 * Every credential an account needs that cannot be resolved, so a
 * misconfiguration is one message rather than one per failed send.
 */
export async function missingCredentials(
  refs: (string | undefined)[],
  ctx: TenantContext | null = null,
): Promise<string[]> {
  const missing: string[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    if (!(await resolveSecret(ctx, ref))) missing.push(environmentNameFor(ref));
  }
  return missing;
}
