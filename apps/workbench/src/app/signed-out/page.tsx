import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { signInFailureSentence } from '@itsm/bff/cookies';
import { Banner, StatusScreen } from '@itsm/ui';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, and where a failed sign-in lands (SPEC v3 §4.6.3).
 *
 * The reason is shown because the alternative — bouncing somebody back to
 * the sign-in page with no explanation — produces a loop the person cannot
 * tell from a broken application. The query carries a code (`stale`,
 * `provider`, …), never prose: the sentence comes from the BFF's own list,
 * and a code it does not know reads as the generic sentence, so nobody can
 * put words of their own on this page by editing the link. The identity
 * provider's `error_description` never reaches it either.
 *
 * "Sign in again" is a plain link (the status screen draws no client-side
 * links): it goes through the identity provider, and nothing should prefetch
 * a sign-in.
 */
export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;

  return (
    <StatusScreen
      brand="workbench"
      illustration={reason ? 'error' : 'success'}
      title={reason ? 'That sign-in didn’t finish' : 'You’re signed out'}
      body={
        reason ? (
          <Banner tone="danger" title="What happened">
            {signInFailureSentence(reason)}
          </Banner>
        ) : (
          'Your session on this device has ended.'
        )
      }
      actions={[{ id: 'sign-in', label: 'Sign in again', href: '/api/session/login', variant: 'primary' }]}
    />
  );
}
