import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The channel account a tenant starts with.
 *
 * Created disabled. An inbound mailbox that is live before anybody has pointed
 * a real address at it is a mailbox that silently accepts nothing, and the
 * administrator has no reason to look at it — so it starts off, visible in the
 * admin console, waiting to be configured.
 */
export async function seedChannelDefaults(ctx: TenantContext, slug = 'support'): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    const existing = await tx.channelAccount.findFirst({ where: { channel: 'email', key: 'support' } });
    if (existing) return { created: 0 };

    await tx.channelAccount.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        channel: 'email',
        key: 'support',
        name: 'Support mailbox',
        address: `${slug}@example.invalid`,
        config: { transport: 'development', maxPerSenderPerHour: 30 } as never,
        status: 'disabled',
      },
    });
    return { created: 1 };
  });
}
