import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

/**
 * The page the service worker serves when there is no network and no cached
 * copy of what was asked for.
 *
 * Static on purpose — it is precached on install, so it is the one page that
 * works before anything else has been visited. It says what is true and what
 * is still possible, because "you are offline" on its own reads as "stop".
 */
export default function OfflinePage(): ReactNode {
  return (
    <main className="itsm-Page">
      <h1 className="itsm-Page__heading">You are offline</h1>
      <p className="itsm-Page__lede">
        This page has not been open on this device before, so there is nothing saved to show you.
      </p>
      <p>
        Pages you have visited are still readable, and anything you write will be sent when you are back on a network.
      </p>
      <p>
        <Link href="/queue">Back to the queue</Link>
      </p>
    </main>
  );
}
