import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { bff, deploymentOrigins } from '../../bff.js';
import { currentSession } from '../../server/session.js';
import { demoBarClock } from '../demo/clock.js';
import { SignedOutScreen } from './SignedOutScreen.js';
import '../demo/entry.css';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | null {
  const found = Array.isArray(value) ? value[0] : value;
  return typeof found === 'string' && found !== '' ? found : null;
}

/**
 * Where a sign-out lands, and where a failed sign-in lands (v3 §4.6.3; A3
 * §6.7): codes in the query, words on the page (`SignedOutScreen`). The
 * restored account's name is read from the session the BFF handed back
 * (§4.5 O2), never from the link.
 */
export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const demo = first(params.demo) === '1';
  const restored = demo && first(params.restored) === '1';
  const session = restored ? await currentSession() : null;
  const signedInAs = session && session.kind !== 'demo' ? session.displayName : null;
  return (
    <SignedOutScreen
      demo={demo}
      restored={restored}
      reason={first(params.reason)}
      signedInAs={signedInAs}
      mode={bff.config.demo !== null}
      origins={deploymentOrigins()}
      ownOrigin={bff.config.appOrigin}
      clock={demoBarClock()}
    />
  );
}
