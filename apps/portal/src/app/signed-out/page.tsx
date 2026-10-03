import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { signInFailureSentence } from '@itsm/bff/cookies';
import { AREAS, appOrigins } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_PERSONAS, DEMO_RESET, demoEntryHref } from '@itsm/contracts/demo';
import { currentSession } from '../../server/session.js';
import { AREA, EntryActions, EntryBody, EntryLayout, EntryLink, EntryTitle, HOME_LABEL, demoModeOn, siteHome } from '../demo/entry.js';

export const metadata: Metadata = { title: 'Signed out' };
export const dynamic = 'force-dynamic';

/**
 * Where a sign-out lands, and where a failed sign-in lands (SPEC v3 §4.6.3,
 * A3 §6.7), on the sign-in layout.
 *
 *   - `reason=<code>`: the sign-in did not finish, in the BFF's own sentence
 *     for the code — never prose from the query, so nobody can put words of
 *     their own on this page by editing the link, and a code it does not know
 *     reads as the generic sentence.
 *   - `demo=1&restored=1`: a demo visit ended and handed the person's own
 *     session back (O2).
 *   - `demo=1`: a demo visit ended — the public site's home, and a way back
 *     in as each of the three personas.
 *   - nothing: an ordinary sign-out.
 *
 * The demo's forms only while the demo is on here. Links are plain `<a>`:
 * "Sign in again" goes through the identity provider, and nothing should
 * prefetch a sign-in.
 */

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "Explore as Agent" — one per area, each naming its persona; a sibling whose origin is unknown is left out. */
function exploreRows(): { readonly key: string; readonly href: string; readonly label: string; readonly detail: string }[] {
  const origins = appOrigins(process.env);
  return DEMO_PERSONAS.flatMap((persona) => {
    const origin = persona.area === 'portal' ? '' : origins[persona.area];
    if (origin === undefined) return [];
    return [
      {
        key: persona.key,
        href: demoEntryHref(origin, persona.key),
        label: `Explore as ${persona.button}`,
        detail: `${persona.name}, ${persona.title} · ${AREAS[persona.area].name}`,
      },
    ];
  });
}

/** The site's home after a demo ends: `?ended=1` lets the landing page drop its "Continue" hint (A5 §8). */
function endedHome(home: string): string {
  return `${home}${home.includes('?') ? '&' : '?'}ended=1`;
}

export default async function SignedOutPage({ searchParams }: { searchParams: Promise<Params> }): Promise<ReactNode> {
  const params = await searchParams;
  const reason = first(params.reason);
  const demo = demoModeOn() && first(params.demo) === '1';
  const home = siteHome();

  if (reason) {
    return (
      <EntryLayout>
        <EntryTitle>That sign-in didn&apos;t finish</EntryTitle>
        <EntryBody>{signInFailureSentence(reason)}</EntryBody>
        <EntryActions>
          {/* A demo visit whose parked account expired signs in to that account (L1), never back into the demo. */}
          <EntryLink href={reason === 'parked_expired' ? '/api/session/login?account=1' : '/api/session/login'} primary>
            Sign in again
          </EntryLink>
        </EntryActions>
      </EntryLayout>
    );
  }

  if (demo && first(params.restored) === '1') {
    const name = (await currentSession())?.displayName?.trim();
    return (
      <EntryLayout>
        <EntryTitle>Thanks for exploring</EntryTitle>
        <EntryBody>{name ? `You're back in your own account, signed in as ${name}.` : "You're back in your own account."}</EntryBody>
        <EntryActions>
          <EntryLink href="/" primary>{`Continue to the ${AREA.name}`}</EntryLink>
        </EntryActions>
      </EntryLayout>
    );
  }

  if (demo) {
    const rows = exploreRows();
    return (
      <EntryLayout width="chooser">
        <EntryTitle>Thanks for exploring</EntryTitle>
        <EntryBody>
          {`Your demo session has ended. ${DEMO_COMPANY.name} and its people are fictional, and the demo resets every night at ${DEMO_RESET.label}.`}
        </EntryBody>
        {home ? (
          <EntryActions>
            <EntryLink href={endedHome(home)} primary>
              {HOME_LABEL}
            </EntryLink>
          </EntryActions>
        ) : null}
        {rows.length > 0 ? (
          <ul className="app-Entry__explore" aria-label="Explore the demo again">
            {rows.map((row) => (
              <li key={row.key}>
                <a className="app-Entry__exploreLink" href={row.href} rel="nofollow">
                  <span className="app-Entry__exploreLabel">{row.label}</span>
                  <span className="app-Entry__exploreDetail">{row.detail}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </EntryLayout>
    );
  }

  return (
    <EntryLayout>
      <EntryTitle>You&apos;re signed out</EntryTitle>
      <EntryBody>Your session on this device has ended.</EntryBody>
      <EntryActions>
        <EntryLink href="/api/session/login" primary>
          Sign in again
        </EntryLink>
        {demoModeOn() && home ? <EntryLink href={home}>{HOME_LABEL}</EntryLink> : null}
      </EntryActions>
    </EntryLayout>
  );
}
