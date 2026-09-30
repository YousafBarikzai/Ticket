import type { ReactNode } from 'react';
import { StatCard } from '@itsm/ui/charts';
import { credentialsSummary, type IntegrationsHealth } from './presentation.js';

/**
 * The state of this desk's outbound calls at a glance, above the failed
 * deliveries (SPEC §6.1): what is failing, how many actions are live and
 * how many need attention, and whether any credential has expired or is
 * about to. Each card opens the tab that explains it; a part this person may
 * not read is left out rather than shown as zero.
 */
export function HealthSummary({
  health,
  links,
  locale,
}: {
  readonly health: IntegrationsHealth;
  readonly links: { readonly actions?: string; readonly credentials?: string };
  readonly locale: string;
}): ReactNode {
  const cards: ReactNode[] = [];
  if (health.deliveries) {
    const { open, capped } = health.deliveries;
    cards.push(
      <StatCard
        key="deliveries"
        label="Failed deliveries"
        value={open}
        {...(capped ? { approx: 'atLeast' as const } : {})}
        icon="webhook"
        status={open > 0 ? 'critical' : 'default'}
        footnote={open > 0 ? 'Waiting to be replayed or dismissed' : 'Every outbound call has gone through'}
        locale={locale}
      />,
    );
  }
  if (health.actions) {
    const { live, draft, attention } = health.actions;
    cards.push(
      <StatCard
        key="actions"
        label="Live actions"
        value={live}
        {...(draft > 0 ? { secondary: `· ${draft} draft` } : {})}
        icon="integrations"
        status={attention > 0 ? 'attention' : 'default'}
        footnote={attention > 0 ? `${attention} ${attention === 1 ? 'needs' : 'need'} attention` : live + draft === 0 ? 'None defined yet' : 'All healthy'}
        {...(links.actions ? { href: links.actions } : {})}
        locale={locale}
      />,
    );
  }
  if (health.credentials) {
    const said = credentialsSummary(health.credentials);
    cards.push(
      <StatCard
        key="credentials"
        label="Credentials"
        value={health.credentials.total}
        icon="key"
        status={said.tone}
        footnote={said.text}
        {...(links.credentials ? { href: links.credentials } : {})}
        locale={locale}
      />,
    );
  }
  if (cards.length === 0) return null;
  return (
    // A grid of its own rather than `StatGrid`: three cards, one column on a phone rather than two and an orphan.
    <section aria-label="Integration health" className="app-IntegrationsHealth">
      {cards}
    </section>
  );
}
