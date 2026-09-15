import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, and where a failed sign-in lands.
 *
 * The reason is shown because the alternative — bouncing somebody back to the
 * sign-in page with no explanation — produces a loop the person cannot tell
 * from a broken application. The text is only ever one of this app's own
 * messages: the identity provider's `error_description` is never echoed here,
 * since it is written about our client, not to this reader.
 */
export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;

  return (
    <main className="itsm-SignIn">
      <h1 className="itsm-SignIn__heading">{reason ? 'That sign-in did not finish' : 'You are signed out'}</h1>
      {reason ? (
        <p className="itsm-SignIn__error" role="alert">
          {reason}
        </p>
      ) : (
        <p className="itsm-SignIn__note">Your session has ended on this device.</p>
      )}
      <p>
        <Link href="/api/session/login">Sign in again</Link>
      </p>
    </main>
  );
}
