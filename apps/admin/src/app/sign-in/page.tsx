import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DEMO_COOKIE } from '@itsm/bff';
import { bff } from '../../bff.js';
import { demoModeOn, siteHome } from '../../server/session.js';
import { EntryFrame, PublicBar } from '../demo/entry.js';
import { SignInContent } from './content.js';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/sign-in`, in every mode (SPEC v3 §4.5 I rows, A3 §6.6, D22).
 *
 * The BFF decides which of three pages this is (`bff.signInPage`):
 *
 *   - **I1**, development (no identity provider and not production): the
 *     development form — there is no password, because a development
 *     database is not a secret — and, when this browser was in the demo
 *     today, "Continue the demo as Jordan Lee" beside it.
 *   - **I2**, the demo's re-entry chooser: this browser was exploring the
 *     demo here today (`__Host-itsm-demo`, read on the server and checked for
 *     this area's persona and today's date — never a query parameter), so it
 *     is offered the demo back, or a real sign-in, which always wins.
 *   - **I3**: "Sign in to Administration" with the work account, and, with
 *     the demo on, "New here? Explore the demo".
 *
 * Every link is a plain `<a>`, never a prefetched client navigation: a
 * prefetcher must never begin a sign-in. Outside the console's frame, on the
 * sign-in layout, with the public demo bar above it when the demo is on.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const jar = await cookies();
  const decision = bff.signInPage({
    demoCookie: jar.get(DEMO_COOKIE)?.value,
    redirectTo: typeof params.redirectTo === 'string' ? params.redirectTo : null,
  });
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;
  const mode = demoModeOn();
  const home = mode ? siteHome() : null;

  return (
    <EntryFrame bar={mode ? <PublicBar home={home} /> : undefined} home={home}>
      <SignInContent decision={decision} reason={reason} home={home} />
    </EntryFrame>
  );
}
