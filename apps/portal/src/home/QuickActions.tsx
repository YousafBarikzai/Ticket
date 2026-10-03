import type { ReactNode } from 'react';
import { IconTile, Skeleton, type IconName } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { ReportTile } from './HomeHero.js';

/**
 * The four quick actions under the hero (v3 §7.2, A6 §6.1.2): *Report an
 * issue* (opens "How can we help?"), *Request something* (Services), *My
 * requests* with how many are open, and *Approvals* with how many wait.
 *
 * A server component: three tiles are links drawn here, and the fourth is
 * the hero's own client island (`ReportTile`). A tile the person has no
 * permission for is not drawn, and the row reflows to three or two; a count
 * that could not be read is left out rather than shown as 0 (v2 principle 6).
 *
 * Each tile carries `data-quick-action`, the hook the PMO-parity helper reads
 * (v3 §7.0.1).
 */

export interface QuickActionsProps {
  readonly can: { readonly createTickets: boolean; readonly readCatalogue: boolean; readonly readApprovals: boolean };
  /** "4 open"; null when the requests could not be read. */
  readonly openLabel: string | null;
  /** "3 waiting"; null when the approvals could not be read. */
  readonly approvalsLabel: string | null;
}

function Tile({ id, href, icon, label, sub }: { readonly id: string; readonly href: string; readonly icon: IconName; readonly label: string; readonly sub: string | null }): ReactNode {
  return (
    <li className="app-QuickActions__item">
      <AppLink className="app-QuickAction" href={href} data-quick-action={id}>
        <IconTile icon={icon} size={40} />
        <span className="app-QuickAction__text">
          <span className="app-QuickAction__label">{label}</span>
          {sub ? <span className="app-QuickAction__sub">{sub}</span> : null}
        </span>
      </AppLink>
    </li>
  );
}

export function QuickActions({ can, openLabel, approvalsLabel }: QuickActionsProps): ReactNode {
  return (
    <nav className="app-QuickActions" aria-label="Quick actions">
      <ul className="app-QuickActions__list">
        {can.createTickets ? (
          <li className="app-QuickActions__item">
            <ReportTile />
          </li>
        ) : null}
        {can.readCatalogue ? <Tile id="request" href="/catalogue" icon="package" label="Request something" sub="Browse services" /> : null}
        <Tile id="requests" href="/tickets" icon="ticket" label="My requests" sub={openLabel} />
        {can.readApprovals ? <Tile id="approvals" href="/approvals" icon="approvals" label="Approvals" sub={approvalsLabel} /> : null}
      </ul>
    </nav>
  );
}

/** Four tile-shaped ghosts while the counts are read (A6 §6.1.5). */
export function QuickActionsSkeleton(): ReactNode {
  return (
    <div className="app-QuickActions" aria-hidden="true">
      <ul className="app-QuickActions__list">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="app-QuickActions__item">
            <Skeleton height="var(--app-quick-action-height)" radius="lg" />
          </li>
        ))}
      </ul>
    </div>
  );
}
