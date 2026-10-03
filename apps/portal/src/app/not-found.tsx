import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AREAS } from '@itsm/contracts/areas';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Not found' };

/**
 * A URL that is no page at all (outside the portal's frame, which has its
 * own): the area's lockup and its home, both from the one area model (D1).
 */
export default function NotFound(): ReactNode {
  return (
    <StatusScreen
      brand="portal"
      brandName={AREAS.portal.name}
      illustration="search"
      title="We couldn’t find that page"
      body="It may have moved, or the link may be out of date."
      actions={[{ id: 'home', label: 'Go to Home', href: AREAS.portal.home, variant: 'primary' }]}
    />
  );
}
