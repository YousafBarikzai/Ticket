import { cache, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, type DemoEntryDecision } from '@itsm/bff';
import { bff } from '../../bff.js';
import { siteHome } from '../../server/session.js';
import { DemoEntryView, entryTitle } from './entry.js';

/**
 * `/demo`: the one way into the shared demo from this app (SPEC v3 §4.5 P
 * rows, §4.6.2).
 *
 * What it shows is decided by the BFF (`bff.demoEntry`, pure rows P1–P8 and
 * the hop P7h): the demo switched off (a 404, so the route does not exist),
 * paused or being prepared, already open here (straight on, 307), a person
 * signed in to their own account (asked, never switched), an earlier attempt
 * that came back with a reason, an area switch from another area (the hop
 * card), an arrival from this app or the site (submitted by itself), or a link
 * from anywhere else (a button). **No GET ever opens a session**: at most the
 * page renders a form, which `AutoSubmitForm` posts when the decision allows.
 *
 * Never cached and never indexed (`next.config.ts` headers, `robots.ts`), and
 * outside the proxy's sign-in redirect: it is how a visitor with no session
 * gets one.
 */
export const dynamic = 'force-dynamic';

type Query = Record<string, string | string[] | undefined>;
type Props = { readonly searchParams: Promise<Query> };

/** The query as one string, the key `decide` is cached on: the title and the page are handed different objects. */
function queryKey(query: Query): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, one);
  }
  return params.toString();
}

/** One decision per request, shared by the title and the page (it reads the demo's records once). */
const decide = cache(async (query: string): Promise<DemoEntryDecision> => {
  const jar = await cookies();
  return bff.demoEntry({ cookie: jar.get(SESSION_COOKIE)?.value, query: new URLSearchParams(query), headers: await headers() });
});

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const decision = await decide(queryKey(await searchParams));
  const robots = { index: false, follow: false };
  if (decision.kind === 'not-found' || decision.kind === 'redirect') return { robots };
  return { title: entryTitle(decision), robots };
}

export default async function DemoPage({ searchParams }: Props): Promise<ReactNode> {
  const decision = await decide(queryKey(await searchParams));
  if (decision.kind === 'not-found') notFound();
  if (decision.kind === 'redirect') redirect(decision.location);
  return <DemoEntryView decision={decision} home={siteHome()} />;
}
