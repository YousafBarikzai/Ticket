import { defineHandler } from '@itsm/platform';

/**
 * Whether anybody is actually using the desk a pack stood up.
 *
 * A maximum, not a count. Delivery is at least once and unordered
 * (ADR-0031), so a handler that added one would inflate the figure on every
 * redelivery and could never be rebuilt from anything — and "how many" is not
 * worth a number nobody can defend. "When was this last used" answers the
 * question a pack raises, survives redelivery untouched, and costs one
 * comparison.
 */
defineHandler({
  consumer: 'esm',
  moduleId: 'MOD-22',
  eventType: 'request.submitted',
  required: false,
  async handle(ctx, event, tx) {
    const { requestTypeKey } = event.payload as { requestTypeKey?: string };
    if (!requestTypeKey) return;

    const item = await tx.packItem.findFirst({ where: { kind: 'request_type', itemKey: requestTypeKey } });
    if (!item) return;

    const installation = await tx.packInstallation.findFirst({ where: { id: item.installationId } });
    if (!installation) return;

    const at = new Date(event.occurredAt);
    if (installation.lastRequestAt && installation.lastRequestAt >= at) return;
    await tx.packInstallation.update({ where: { id: installation.id }, data: { lastRequestAt: at } });
  },
});
