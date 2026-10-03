import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { demoExploreLinks, demoModeOn, currentSession, siteHome } from '../../server/session.js';
import { EntryFrame, PublicBar } from '../demo/entry.js';
import { SignedOutContent, signedOutVariant } from './content.js';

export const metadata: Metadata = { title: 'Signed out', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, where a demo visit ends, and where a failed sign-in
 * lands (SPEC v3 §4.6.3, A3 §6.7).
 *
 * The reason is shown because the alternative — bouncing somebody back to the
 * sign-in page with no explanation — produces a loop the person cannot tell
 * from a broken application. The query carries a code (`stale`, `provider`,
 * …), never prose: the sentence comes from the BFF's own list, and a code it
 * does not know reads as the generic sentence, so nobody can put words of
 * their own on this page by editing the link. The identity provider's
 * `error_description` never reaches it either.
 *
 * A demo visit ends here with `demo=1` — "Thanks for exploring", the site and
 * the three ways back in — or with `demo=1&restored=1` when the person's own
 * account came back on this device (§4.5 O2). Every action is a plain link,
 * never a prefetched client navigation: a sign-in is a full page load through
 * the identity provider, and nothing a prefetcher should begin on its own.
 */
export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const variant = signedOutVariant(await searchParams);
  const mode = demoModeOn();
  const home = mode ? siteHome() : null;
  // The restored account's name, from the session the BFF handed back under this browser's cookie.
  const restoredAs = variant.kind === 'restored' ? ((await currentSession())?.displayName ?? null) : null;

  return (
    <EntryFrame bar={mode ? <PublicBar home={home} /> : undefined} home={home}>
      <SignedOutContent variant={variant} home={home} restoredAs={restoredAs} explore={variant.kind === 'demo' ? demoExploreLinks() : []} />
    </EntryFrame>
  );
}
