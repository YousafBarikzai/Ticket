import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AREAS } from '@itsm/contracts/areas';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Not found' };

/**
 * A URL that is no page at all (outside the desk, which has its own): the
 * area's lockup, and the way back to its home, the Overview (v3 §3.5).
 */
export default function NotFound(): ReactNode {
  return (
    <StatusScreen
      brand="workbench"
      brandName={AREAS.workbench.name}
      illustration="search"
      title="We couldn’t find that page"
      body="It may have moved, or the link may be out of date."
      actions={[{ id: 'home', label: `Go to the ${AREAS.workbench.name}`, href: AREAS.workbench.home, variant: 'primary' }]}
    />
  );
}
