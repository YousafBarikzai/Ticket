import { z } from 'zod';
import {
  type TenantContext,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  currentKekVersion,
  fingerprint,
  isCryptoConfigured,
  logger,
  needsRewrap,
  newId,
  open,
  recordAudit,
  rewrap,
  seal,
  transaction,
  type SealedValue,
} from '@itsm/platform';
import { parseAwsCredential } from '../gateway/sigv4.js';

/**
 * The credential store (docs/architecture/09 §4).
 *
 * Write-only by design. A credential goes in and is used; it never comes back
 * out through the API, and the audit entry records that one was written rather
 * than what it was. An operator sees a fingerprint — enough to tell two apart,
 * useless to anybody who steals the table.
 *
 * That constraint is what makes the rest defensible. A store that can read a
 * secret back is a store whose read path is the thing an attacker wants, and
 * every access-control rule on it is the only thing standing between them and
 * the credential.
 */

export const credentialSchema = z.object({
  ref: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/, 'lowercase letters, digits and hyphens'),
  value: z.string().min(1).max(8_192),
  kind: z.string().max(40).default('generic'),
  description: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

export interface CredentialSummary {
  ref: string;
  kind: string;
  description: string | null;
  fingerprint: string;
  createdAt: Date;
  rotatedAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  /** True when the KEK has rotated since this was written. */
  needsRewrap: boolean;
}

export async function storeCredential(ctx: TenantContext, input: unknown): Promise<CredentialSummary> {
  authz.require(ctx, 'integration.credential.manage');
  const parsed = credentialSchema.parse(input);

  if (!isCryptoConfigured()) {
    // Refused rather than stored in the clear. There is no acceptable
    // degradation here.
    throw new ValidationError(
      'this environment has no CREDENTIAL_KEK, so credentials cannot be stored safely and will not be stored at all',
    );
  }

  // Checked while somebody is still looking at the form. A malformed AWS
  // credential is otherwise stored happily and fails at the first signed
  // request, as `InvalidClientTokenId` — which reads like an IAM problem and
  // sends whoever is on call to look in entirely the wrong place.
  if (parsed.kind === 'aws_sigv4') parseAwsCredential(parsed.value);

  const sealed = seal(parsed.value);

  return transaction(ctx, async (tx) => {
    const existing = await tx.connectorCredential.findFirst({ where: { ref: parsed.ref } });
    if (existing) {
      throw new ConflictError(`a credential called ${parsed.ref} already exists; rotate it rather than replacing it`);
    }

    const row = await tx.connectorCredential.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ref: parsed.ref,
        kind: parsed.kind,
        description: parsed.description ?? null,
        sealed: sealed as never,
        kekVersion: sealed.kekVersion,
        fingerprint: fingerprint(parsed.value),
        createdBy: ctx.actor.id ?? null,
        ...(parsed.expiresAt ? { expiresAt: new Date(parsed.expiresAt) } : {}),
      },
    });

    // The audit records that a credential was written, and its fingerprint —
    // never the value, and never a `before` that would hold the old one.
    await recordAudit(tx, ctx, {
      action: 'integration.credential.stored',
      targetType: 'connector_credential',
      targetId: row.id,
      after: { ref: parsed.ref, kind: parsed.kind, fingerprint: row.fingerprint },
    });

    return summarise(row);
  });
}

/** Replaces the value, keeping the reference so nothing has to be reconfigured. */
export async function rotateCredential(ctx: TenantContext, ref: string, value: string): Promise<CredentialSummary> {
  authz.require(ctx, 'integration.credential.manage');
  if (!value) throw new ValidationError('a rotation needs the new value');

  const sealed = seal(value);

  return transaction(ctx, async (tx) => {
    const existing = await tx.connectorCredential.findFirst({ where: { ref } });
    if (!existing) throw new NotFoundError('credential', ref);

    const row = await tx.connectorCredential.update({
      where: { id: existing.id },
      data: {
        sealed: sealed as never,
        kekVersion: sealed.kekVersion,
        fingerprint: fingerprint(value),
        rotatedAt: new Date(),
      },
    });

    await recordAudit(tx, ctx, {
      action: 'integration.credential.rotated',
      targetType: 'connector_credential',
      targetId: row.id,
      // Both fingerprints, so an auditor can see the value genuinely changed
      // without either value being recorded.
      before: { fingerprint: existing.fingerprint },
      after: { ref, fingerprint: row.fingerprint },
    });

    return summarise(row);
  });
}

/** What an operator sees. Never the value. */
export async function listCredentials(ctx: TenantContext): Promise<CredentialSummary[]> {
  authz.require(ctx, 'integration.credential.read');
  return transaction(ctx, async (tx) => {
    const rows = await tx.connectorCredential.findMany({ orderBy: { ref: 'asc' } });
    return rows.map(summarise);
  });
}

export async function deleteCredential(ctx: TenantContext, ref: string): Promise<void> {
  authz.require(ctx, 'integration.credential.manage');
  await transaction(ctx, async (tx) => {
    const existing = await tx.connectorCredential.findFirst({ where: { ref } });
    if (!existing) throw new NotFoundError('credential', ref);

    await tx.connectorCredential.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, {
      action: 'integration.credential.deleted',
      targetType: 'connector_credential',
      targetId: existing.id,
      before: { ref, fingerprint: existing.fingerprint },
    });
  });
}

/**
 * Reads a credential for use.
 *
 * Not exported through the module's public interface, and not reachable from
 * any route: it is registered as a resolver with the platform, so the only
 * callers are the adapters that need to make a call. That is the difference
 * between a store with a read path and a store whose secrets are only ever
 * used.
 */
async function useCredential(ctx: TenantContext, ref: string): Promise<string | null> {
  return transaction(ctx, async (tx) => {
    const row = await tx.connectorCredential.findFirst({ where: { ref } });
    if (!row) return null;

    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      // Refused rather than used: an expired credential usually fails at the
      // far end anyway, and failing here says why.
      logger.warn('a credential has expired and was not used', { ref, expiredAt: row.expiresAt.toISOString() });
      return null;
    }

    const value = open(row.sealed as never as SealedValue);

    // Recorded so "is anything still using this?" is answerable before somebody
    // deletes it. Deliberately not awaited into the read path's latency budget
    // beyond this transaction.
    await tx.connectorCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });

    return value;
  });
}

/**
 * Re-wraps everything still under an old KEK.
 *
 * The plaintext never leaves `rewrap`, which decrypts and re-encrypts in one
 * step. Run after a key rotation; idempotent, so running it twice is free.
 */
export async function rewrapCredentials(ctx: TenantContext): Promise<{ examined: number; rewrapped: number }> {
  const rows = await transaction(ctx, (tx) => tx.connectorCredential.findMany({}));
  let rewrapped = 0;

  for (const row of rows) {
    const sealed = row.sealed as never as SealedValue;
    if (!needsRewrap(sealed)) continue;

    const fresh = rewrap(sealed);
    await transaction(ctx, (tx) =>
      tx.connectorCredential.update({
        where: { id: row.id },
        data: { sealed: fresh as never, kekVersion: fresh.kekVersion },
      }),
    );
    rewrapped += 1;
  }

  logger.info('credential re-wrap finished', { tenantId: ctx.tenantId, examined: rows.length, rewrapped });
  return { examined: rows.length, rewrapped };
}

function summarise(row: {
  ref: string;
  kind: string;
  description: string | null;
  fingerprint: string;
  kekVersion: string;
  createdAt: Date;
  rotatedAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}): CredentialSummary {
  return {
    ref: row.ref,
    kind: row.kind,
    description: row.description,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    // Compared against the current KEK by version rather than by unsealing:
    // a listing must not decrypt every credential to render a badge.
    needsRewrap: isCryptoConfigured() ? row.kekVersion !== currentKekVersion() : false,
  };
}

/**
 * Registers the stored credentials with the platform resolver.
 *
 * Registered before the environment resolver, so a tenant's own stored
 * credential wins over a deployment-wide one of the same name — which is what
 * a tenant expects when they configure their own, and what an operator expects
 * when they have not.
 */
export function registerCredentialStore(register: (name: string, resolve: (ctx: TenantContext | null, ref: string) => Promise<string | null>) => void): void {
  register('credential-store', async (ctx, ref) => {
    // No tenant context means no tenant credential: this is reached from the
    // pre-tenant inbound path, where the environment resolver is correct.
    if (!ctx) return null;
    try {
      return await useCredential(ctx, ref);
    } catch (error) {
      logger.warn('a stored credential could not be read', {
        ref,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
}
