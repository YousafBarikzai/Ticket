import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@itsm/bff/cookies';
import { bff, deploymentOrigins } from '../../bff.js';
import { demoBarClock } from './clock.js';
import { DemoEntryScreen } from './DemoEntry.js';
import './entry.css';

export const metadata: Metadata = { title: 'Explore the demo', robots: { index: false, follow: false } };

/** Per request: the answer depends on the session, the demo's state and who linked here. */
export const dynamic = 'force-dynamic';

/**
 * `/demo` — the Service Desk's way into the shared demo (v3 §4.5 P rows,
 * §4.6; A3 §6.2), as Alex Morgan, the area's persona (D11).
 *
 * The BFF decides (`bff.demoEntry`: the session, the demo's records, the
 * query and the `Sec-Fetch-Site` and `Referer` headers); this page words the
 * decision. With the demo off it does not exist (P1, 404); a visitor already
 * in today's demo here goes straight on (P4, 307 to `redirectTo`).
 *
 * Outside the proxy's matcher (`demo(?:/|$)`), so it answers without a
 * session, and never indexed or stored (`next.config.ts` headers).
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const decision = await bff.demoEntry({
    cookie: (await cookies()).get(SESSION_COOKIE)?.value,
    query: await searchParams,
    headers: await headers(),
  });
  if (decision.kind === 'not-found') notFound();
  if (decision.kind === 'redirect') redirect(decision.location);
  return <DemoEntryScreen decision={decision} site={deploymentOrigins().site ?? null} clock={demoBarClock()} />;
}
