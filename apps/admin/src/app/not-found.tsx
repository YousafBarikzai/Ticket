import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * A 404 for a URL no route answers, outside the frame (SPEC §5.2).
 *
 * The in-frame 404 (`(console)/not-found.tsx`) handles everything under the
 * console's layout, including the platform section's deliberate `notFound()`;
 * this one is for addresses that match no route at all, where there may be no
 * session to draw a frame with. A plain link home, which signs the person in
 * first if they need it.
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
