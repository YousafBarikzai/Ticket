import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Not found' };

/** A URL that is no page at all (outside the portal's frame, which has its own). */
export default function NotFound(): ReactNode {
  return (
    <StatusScreen
      brand="portal"
      illustration="search"
      title="We couldn’t find that page"
      body="It may have moved, or the link may be out of date."
      actions={[{ id: 'home', label: 'Go to Home', href: '/', variant: 'primary' }]}
    />
  );
}
