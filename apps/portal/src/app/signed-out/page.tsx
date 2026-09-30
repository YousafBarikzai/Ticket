import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Banner, StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, and where a failed sign-in lands (SPEC §6.3).
 *
 * The reason is shown because the alternative — bouncing somebody back to
 * the sign-in page with no explanation — produces a loop the person cannot
 * tell from a broken application. The text is only ever one of this app's
 * own messages: the identity provider's `error_description` is never echoed
 * here, since it is written about our client, not to this reader.
 *
 * "Sign in again" is a plain link (the status screen draws no client-side
 * links): it goes through the identity provider, and nothing should prefetch
 * a sign-in.
 */

/** The BFF's reasons are phrases ("that sign-in link is incomplete"); shown as a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;

  return (
    <StatusScreen
      brand="portal"
      illustration={reason ? 'error' : 'success'}
      title={reason ? 'That sign-in didn’t finish' : 'You’re signed out'}
      body={
        reason ? (
          <Banner tone="danger" title="What happened">
            {sentence(reason)}
          </Banner>
        ) : (
          'Your session on this device has ended.'
        )
      }
      actions={[{ id: 'sign-in', label: 'Sign in again', href: '/api/session/login', variant: 'primary' }]}
    />
  );
}
