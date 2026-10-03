import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';

/**
 * Marks this file as the route shell's stand-in (A7 §12 "New routes without
 * PENDING churn"). WP-91 replaces it with the Status page console (A7 §4.7:
 * the public verdict, components with their uptime, incidents and
 * maintenance); the wave 7 and 8 integrators check that no file under
 * `apps/admin/src` still exports it.
 */
export const A7_PLACEHOLDER = true;

/**
 * The Status page console until it lands. The sidebar slot and its gate
 * (`statuspage.read`) exist now, so the frame does not change when it does.
 */
export function StatusPageConsole(): ReactNode {
  return (
    <EmptyState
      frame="dashed"
      size="lg"
      icon="globe"
      title="Status page"
      description="Your public service status — components, incidents and maintenance — is managed here. Until then, major incidents are run from the Service Desk."
      secondaryAction={{ id: 'home', label: 'Go to the Command centre', href: '/', variant: 'secondary' }}
    />
  );
}
