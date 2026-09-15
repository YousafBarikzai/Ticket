import type { TenantContext } from './context.js';
import { logger } from './telemetry.js';

/**
 * Where a credential reference is resolved.
 *
 * A module that needs a secret — the email adapters, the integration gateway,
 * SCIM — holds a *name* and asks for the value. What backs that name is a
 * deployment concern, not the module's: Phase 3 shipped environment variables,
 * Phase 4 adds an encrypted per-tenant store, and neither adapter changed.
 *
 * A registry rather than a direct call, for the same reason the tenant purge
 * uses one: `modules/channels` must not depend on `modules/integrations` in
 * order to read a token. Each resolver is tried in registration order, so the
 * database-backed one can be added without removing the environment fallback
 * that a single-tenant deployment relies on.
 */

export interface SecretRef {
  /** The name on the record, e.g. `graph-acme`. */
  ref: string;
}

export type SecretResolver = (ctx: TenantContext | null, ref: string) => Promise<string | null>;

const resolvers: { name: string; resolve: SecretResolver }[] = [];

export function registerSecretResolver(name: string, resolve: SecretResolver): void {
  if (resolvers.some((entry) => entry.name === name)) return;
  resolvers.push({ name, resolve });
}

export function registeredSecretResolvers(): string[] {
  return resolvers.map((entry) => entry.name);
}

/** Test helper: forget registered resolvers. */
export function resetSecretResolvers(): void {
  resolvers.length = 0;
}

/** Turns `graph-acme` into `ITSM_CREDENTIAL_GRAPH_ACME`. */
export function environmentNameFor(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

/**
 * The resolver a deployment always has.
 *
 * Registered last, so a per-tenant stored credential wins over a deployment-wide
 * one of the same name — which is the behaviour a tenant expects when they
 * configure their own, and the behaviour an operator expects when they have
 * not.
 */
export const environmentResolver: SecretResolver = async (_ctx, ref) => process.env[environmentNameFor(ref)] ?? null;

/**
 * Resolves a reference, or returns null.
 *
 * Null rather than throwing, because the caller knows what a missing credential
 * means in its own context — for an email transport it is "refuse the
 * delivery", for a health check it is "report not configured". What is *not*
 * acceptable is silence: a missing credential is named in the log, because the
 * symptom otherwise is "mail stopped arriving" and the fix is one environment
 * variable nobody can guess.
 */
export async function resolveSecret(ctx: TenantContext | null, ref: string | undefined): Promise<string | null> {
  if (!ref) return null;

  for (const resolver of resolvers) {
    try {
      const value = await resolver.resolve(ctx, ref);
      if (value) return value;
    } catch (error) {
      // One broken resolver must not hide a secret another one holds.
      logger.warn('a credential resolver failed', {
        resolver: resolver.name,
        ref,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn('a credential was asked for and is not configured anywhere', {
    ref,
    expects: environmentNameFor(ref),
    resolvers: registeredSecretResolvers(),
  });
  return null;
}

/** Which of these references cannot be resolved, for a configuration check. */
export async function missingSecrets(ctx: TenantContext | null, refs: (string | undefined)[]): Promise<string[]> {
  const missing: string[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    if (!(await resolveSecret(ctx, ref))) missing.push(ref);
  }
  return missing;
}
