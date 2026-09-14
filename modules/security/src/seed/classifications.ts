import { classifyField, newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * Default data classifications.
 *
 * Pulled forward from PH-2 because audit redaction and, later, AI context
 * assembly both read this registry: a field that is not classified in PH-1 is a
 * field that leaks into a log in PH-2.
 */
export const DEFAULT_CLASSIFICATIONS = [
  { entity: 'user', field: 'email', level: 'confidential' as const },
  { entity: 'user', field: 'idpSubject', level: 'restricted' as const, unlockedBy: 'identity.user.manage' },
  { entity: 'ticket_comment', field: 'body', level: 'internal' as const },
  { entity: 'attachment', field: 'objectKey', level: 'internal' as const },
  { entity: 'api_key', field: 'hash', level: 'restricted' as const },
  { entity: 'webhook_subscription', field: 'secret', level: 'restricted' as const },
  { entity: 'channel_identity', field: 'externalUserId', level: 'confidential' as const },
];

export async function seedClassifications(ctx: TenantContext): Promise<number> {
  let written = 0;
  await transaction(ctx, async (tx) => {
    for (const declaration of DEFAULT_CLASSIFICATIONS) {
      const existing = await tx.dataClassification.findFirst({
        where: { entity: declaration.entity, field: declaration.field },
      });
      if (existing) continue;
      await tx.dataClassification.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          entity: declaration.entity,
          field: declaration.field,
          level: declaration.level,
        },
      });
      written += 1;
    }
  });
  return written;
}

/** Registers the in-process masking rules. Called once at boot. */
export function registerDefaultClassifications(): void {
  for (const declaration of DEFAULT_CLASSIFICATIONS) {
    classifyField(declaration);
  }
}
