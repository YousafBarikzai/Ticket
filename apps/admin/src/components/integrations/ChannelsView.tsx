import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';

/**
 * Marks this file as the route shell's stand-in (A7 §12 "New routes without
 * PENDING churn"). WP-79 replaces it with Integrations › Channels (A7 §5.9:
 * the mailboxes and chat channels, tickets by channel); the wave 7 and 8
 * integrators check that no file under `apps/admin/src` still exports it.
 */
export const A7_PLACEHOLDER = true;

/**
 * Integrations › Channels until its list lands. The tab and its gate
 * (`channel.account.read`) exist now. Nothing here reads the accounts: the
 * list must render only named, safe fields (A7 §14 R8), which is its owner's
 * work.
 */
export function ChannelsView(): ReactNode {
  return (
    <EmptyState
      frame="dashed"
      size="lg"
      icon="mail"
      title="Channels"
      description="The mailboxes and chat channels tickets arrive through are listed here. Until then, Insights shows how many tickets each channel brings."
      secondaryAction={{ id: 'deliveries', label: 'Go to Failed deliveries', href: '/integrations', variant: 'secondary' }}
    />
  );
}
