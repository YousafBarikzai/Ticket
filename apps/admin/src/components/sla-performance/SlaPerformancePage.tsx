import type { ReactNode } from 'react';
import { EmptyState } from '@itsm/ui';

/**
 * Marks this file as the route shell's stand-in (A7 §12 "New routes without
 * PENDING churn"). WP-77 replaces the file with Service levels › Performance
 * (A7 §4.4: the priority × team heatmap, attainment by target); the wave 7
 * and 8 integrators check that no file under `apps/admin/src` still exports it.
 */
export const A7_PLACEHOLDER = true;

/**
 * Service levels › Performance until its page lands: the route, its tab and
 * its gate exist now, so nothing about the navigation changes when the page
 * arrives. Says what the page is for and where the figures are meanwhile,
 * without promising a date.
 */
export function SlaPerformancePage(): ReactNode {
  return (
    <EmptyState
      frame="dashed"
      size="lg"
      icon="sla"
      title="SLA performance"
      description="Attainment by priority and team appears here. Until then, the Command centre shows how many targets the desk met in the last 30 days."
      secondaryAction={{ id: 'home', label: 'Go to the Command centre', href: '/', variant: 'secondary' }}
    />
  );
}
