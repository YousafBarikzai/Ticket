import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { EmptyState } from '@itsm/ui';
import { ServiceBrowser } from '../../../../catalogue/ServiceBrowser.js';
import { SectionProblem } from '../../../../home/SectionProblem.js';
import { settle } from '../../../../home/settle.js';
import { mayOpen } from '../../../../navigation.js';
import { apiFor, currentMe, heldPermissions, requireSession } from '../../../../server/session.js';
import '../catalogue.css';

export const metadata: Metadata = { title: 'Services' };
export const dynamic = 'force-dynamic';

/**
 * `/catalogue` — Services (SPEC §6.3, §5.4): what this person may ask for,
 * grouped by service, with a search and chips that jump between services.
 *
 * The list is already filtered by entitlement on the server (MOD-05): what is
 * not here is not here because this person cannot have it, and nothing on this
 * page says so. That is deliberate — a catalogue that showed locked items
 * would be a list of things to ask about.
 *
 * The heading stays whatever happens: a failed read says so under it, with
 * Retry, and a person without `catalogue.read` is told plainly rather than
 * shown an empty catalogue.
 */
export default async function CataloguePage(): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();

  const header = (
    <header className="app-Services__header">
      <h1 className="app-Services__title" tabIndex={-1}>
        Services
      </h1>
      <p className="app-Services__lede">Ask for software, access, equipment and more.</p>
    </header>
  );

  if (!mayOpen('/catalogue', heldPermissions(me))) {
    return (
      <div className="app-Page app-Catalogue">
        {header}
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="Services aren’t available to you"
          description="Your account can’t request services here. You can still report an issue or follow your requests."
          action={{ id: 'requests', label: 'My requests', href: '/tickets' }}
        />
      </div>
    );
  }

  const read = await settle(apiFor(session).catalogue());

  return (
    <div className="app-Page app-Catalogue">
      {header}
      {read.ok ? <ServiceBrowser items={read.value.data} /> : <SectionProblem what="the services" />}
    </div>
  );
}
