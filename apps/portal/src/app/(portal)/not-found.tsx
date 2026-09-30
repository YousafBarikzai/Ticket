import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Not found' };

/**
 * Not found, inside the frame (SPEC §4.10, §6.3): a request that does not
 * exist or is not this person's, an article they may not read, a service
 * they are not entitled to — the API answers all of them the same way,
 * deliberately, and so does this. The top bar stays, so search is one press
 * away as well as the way home.
 *
 * `StatusScreen` rather than `ProblemState`: it is server-safe, so the page
 * costs no JavaScript at all — a not-found boundary is part of every portal
 * route's first load, whether or not it is ever shown (SPEC §3.7).
 */
export default function PortalNotFound(): ReactNode {
  return (
    <div className="app-Page app-Page--state">
      <StatusScreen
        as="div"
        illustration="search"
        title="We couldn’t find that"
        body="It may have moved, the link may be out of date, or it isn’t yours to see. Search from the bar above, or start again from Home."
        actions={[{ id: 'home', label: 'Go to Home', href: '/', variant: 'primary' }]}
      />
    </div>
  );
}
