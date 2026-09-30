import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * A 404 outside the frame (SPEC §5.2): the last resort.
 *
 * Inside the console every unknown address — and the platform section's
 * deliberate `notFound()` — gets the in-frame 404 (`(console)/not-found.tsx`,
 * reached through the `(console)/[...missing]` catch-all). This one is left
 * for what no console route can catch, where there may be no session to draw
 * a frame with. A plain link home, which signs the person in first if they
 * need it.
 */
export default function NotFound(): ReactNode {
  return (
    <StatusScreen
      brand="admin"
      illustration="search"
      title="We couldn’t find that page"
      body="The address may be mistyped, or the page may have moved."
      actions={[{ id: 'home', label: 'Go to Command centre', href: '/' }]}
    />
  );
}
