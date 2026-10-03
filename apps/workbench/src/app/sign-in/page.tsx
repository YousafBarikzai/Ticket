import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DEMO_COOKIE } from '@itsm/bff/cookies';
import { bff, deploymentOrigins } from '../../bff.js';
import { demoBarClock } from '../demo/clock.js';
import { SignInScreen } from './SignInScreen.js';
import '../demo/entry.css';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * `/sign-in` (v3 §4.5 I rows, §6.3; A3 §6.6), in every mode: the development
 * form where there is no identity provider, else the D22 chooser for a
 * browser that was in today's demo, else "Sign in to the Service Desk".
 *
 * The decision is the BFF's (`bff.signInPage`), from the re-entry cookie
 * `__Host-itsm-demo` — read here, on the server, and checked for this area's
 * persona and today's date there — and the query's `redirectTo`, which it
 * checks too. `/api/session/dev` answers a failed development sign-in by
 * coming back here with a reason, which only that form shows.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const decision = bff.signInPage({
    demoCookie: (await cookies()).get(DEMO_COOKIE)?.value,
    redirectTo: typeof params.redirectTo === 'string' ? params.redirectTo : null,
  });
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;
  return (
    <SignInScreen
      decision={decision}
      reason={reason}
      demo={bff.config.demo !== null}
      site={deploymentOrigins().site ?? null}
      clock={demoBarClock()}
    />
  );
}
