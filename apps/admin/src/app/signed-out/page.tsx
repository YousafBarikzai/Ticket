import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Banner, StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, and where a failed sign-in lands (SPEC §6.1).
 *
 * The reason is shown because the alternative — bouncing somebody back to the
 * sign-in page with no explanation — produces a loop the person cannot tell
 * from a broken application. The text is only ever one of this app's own
 * messages: the identity provider's `error_description` is never echoed here,
 * since it is written about our client, not to this reader.
 *
 * *Sign in again* is a plain link, deliberately not a prefetched client
 * navigation: it starts a sign-in with the identity provider, which is a full
 * page load and nothing a prefetcher should begin on its own.
 */
export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;

  return (
    <StatusScreen
      brand="admin"
      illustration={reason ? 'error' : 'success'}
      title={reason ? 'That sign-in didn’t finish' : 'You’re signed out'}
      body={
        reason ? (
          <Banner tone="danger" live="assertive">
            {reason}
          </Banner>
        ) : (
          'Your session has ended on this device.'
        )
      }
      actions={[{ id: 'sign-in', label: 'Sign in again', icon: 'log-in', href: '/api/session/login' }]}
    />
  );
}
