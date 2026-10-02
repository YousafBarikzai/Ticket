import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: true } };

/**
 * Every address the site does not serve (A5 §3.2). The design system's
 * server-safe status screen, so a 404 looks like the rest of the product, with
 * a plain link back to the home page — a full load, which is all a 404 needs.
 * `id="main"` is the skip link's target.
 */
export default function NotFound(): ReactNode {
  return (
    <StatusScreen
      id="main"
      tabIndex={-1}
      illustration="search"
      title="We couldn’t find that page"
      body="The address may be mistyped, or the page may have moved."
      actions={[{ id: 'home', label: 'Go to the home page', href: '/' }]}
    />
  );
}
