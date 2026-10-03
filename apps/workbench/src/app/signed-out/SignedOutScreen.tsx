import type { ReactNode } from 'react';
import { AREAS, SITE, type Origins } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_PERSONAS, DEMO_RESET, demoEntryHref } from '@itsm/contracts/demo';
import { signInFailureSentence } from '@itsm/bff/cookies';
import { Banner, Button } from '@itsm/ui';
import { SignInLayout, type DemoBarProps } from '@itsm/ui/shell';
import { areaInSentence } from '../demo/copy.js';
import { DemoBarSlot } from '../demo/DemoBarSlot.js';

/**
 * Where a sign-out lands, and where a failed sign-in lands (v3 §4.6.3; A3
 * §6.7), on `SignInLayout`.
 *
 * The query carries codes (`demo=1`, `restored=1`, `reason=stale`, …), never
 * prose: every sentence comes from this page or the BFF's own list, and a
 * code it does not know reads as the generic sentence, so nobody can put
 * words of their own on this page by editing the link.
 *
 * - **A failed sign-in** says what happened, and offers the sign-in again —
 *   with a work account (`account=1`) when it was the person's own session
 *   that lapsed while they explored the demo (`parked_expired`).
 * - **The end of a demo visit** thanks the visitor, says the company is
 *   fictional, and links the site and each area's demo by its persona.
 *   When the visit handed back the person's own session, it says who they
 *   are signed in as instead.
 * - **A sign-out** says the session ended, with Sign in again.
 */

export interface SignedOutScreenProps {
  readonly demo: boolean;
  readonly restored: boolean;
  readonly reason: string | null;
  /** The restored session's display name (`demo=1&restored=1`). */
  readonly signedInAs?: string | null;
  /** `DEMO_MODE=on` here: the public demo bar, and the way to the site. */
  readonly mode: boolean;
  /** The deployment's public origins: the site, and each area's demo entry. */
  readonly origins: Origins;
  /** This app's own origin, for its own demo entry. */
  readonly ownOrigin: string;
  readonly clock: DemoBarProps['clock'];
}

const AREA = AREAS.workbench.name;

/** The site's home after a demo, with `ended=1` so the site forgets its "Continue the demo" hint (A5 §6.6). */
function endedHome(site: string): string {
  const url = new URL(site);
  url.searchParams.set('ended', '1');
  return url.toString();
}

function Column(props: SignedOutScreenProps): ReactNode {
  const { demo, restored, reason, signedInAs, mode, origins, ownOrigin } = props;
  const site = origins.site ?? null;

  if (reason) {
    const account = reason === 'parked_expired';
    return (
      <div className="app-Entry">
        <h1 className="app-Entry__title">That sign-in didn’t finish</h1>
        <Banner tone="danger" title="What happened">
          {signInFailureSentence(reason)}
        </Banner>
        <div className="app-Entry__actions">
          <Button href={account ? '/api/session/login?account=1' : '/api/session/login'} variant="primary" size="lg" fullWidth>
            Sign in again
          </Button>
        </div>
      </div>
    );
  }

  if (demo && restored) {
    return (
      <div className="app-Entry">
        <h1 className="app-Entry__title">Thanks for exploring</h1>
        <p className="app-Entry__body">
          {signedInAs ? (
            <>
              You’re back in your own account, signed in as <strong>{signedInAs}</strong>.
            </>
          ) : (
            'You’re back in your own account.'
          )}
        </p>
        <div className="app-Entry__actions">
          <Button href="/" variant="primary" size="lg" fullWidth>
            Continue to {areaInSentence(AREA)}
          </Button>
        </div>
      </div>
    );
  }

  if (demo) {
    const explore = DEMO_PERSONAS.flatMap((persona) => {
      const origin = persona.area === 'workbench' ? ownOrigin : origins[persona.area];
      return origin ? [{ persona, href: demoEntryHref(origin, persona.key) }] : [];
    });
    return (
      <div className="app-Entry">
        <h1 className="app-Entry__title">Thanks for exploring</h1>
        <p className="app-Entry__body">
          Your demo session has ended. {DEMO_COMPANY.name} and its people are fictional, and the demo resets every night at {DEMO_RESET.label}.
        </p>
        {site ? (
          <div className="app-Entry__actions">
            <Button href={endedHome(site)} variant="primary" size="lg" fullWidth>
              {SITE.homeLabel}
            </Button>
          </div>
        ) : null}
        {explore.length > 0 ? (
          <ul className="app-Entry__links" aria-label="Explore the demo again">
            {explore.map(({ persona, href }) => (
              <li key={persona.key}>
                {/* The landing's role links: nofollow, and a plain link so the area's /demo sees where it came from. */}
                <a className="app-Entry__link" href={href} rel="nofollow">
                  Explore as {persona.button} · {persona.name}, {persona.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-Entry">
      <h1 className="app-Entry__title">You’re signed out</h1>
      <p className="app-Entry__body">Your session on this device has ended.</p>
      <div className="app-Entry__actions">
        <Button href="/api/session/login" variant="primary" size="lg" fullWidth>
          Sign in again
        </Button>
        {mode && site ? (
          <Button href={site} variant="ghost" size="lg" fullWidth>
            {SITE.homeLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SignedOutScreen(props: SignedOutScreenProps): ReactNode {
  const site = props.mode ? (props.origins.site ?? null) : null;
  return (
    <SignInLayout
      {...(site ? { productHref: site } : {})}
      {...(props.mode ? { systemBar: <DemoBarSlot variant="public" clock={props.clock} {...(site ? { links: { home: site } } : {})} /> } : {})}
    >
      <Column {...props} />
    </SignInLayout>
  );
}
