import type { ReactNode } from 'react';
import { signInFailureSentence } from '@itsm/bff/cookies';
import { AREAS } from '@itsm/contracts/areas';
import { DEMO_COMPANY, DEMO_RESET } from '@itsm/contracts/demo';
import { Banner } from '@itsm/ui';
import type { DemoExploreLink } from '../../server/session.js';
import { EntryLink, EntryTitle, type Home } from '../demo/entry.js';

/**
 * Which `/signed-out` this is (§4.6.3), from the query alone:
 *
 *   - `failed`: a `reason` code — a sign-in that did not finish, or (with
 *     `demo=1`) `parked_expired`, the person's own sign-in that expired while
 *     they explored the demo;
 *   - `restored`: `demo=1&restored=1`, the demo ended and the person's own
 *     account is back;
 *   - `demo`: `demo=1`, the demo visit ended;
 *   - `plain`: an ordinary sign-out.
 */
export type SignedOutVariant =
  | { readonly kind: 'failed'; readonly reason: string; readonly demo: boolean }
  | { readonly kind: 'restored' }
  | { readonly kind: 'demo' }
  | { readonly kind: 'plain' };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function signedOutVariant(query: Readonly<Record<string, string | string[] | undefined>>): SignedOutVariant {
  const reason = first(query.reason);
  const demo = first(query.demo) === '1';
  if (reason) return { kind: 'failed', reason, demo };
  if (demo && first(query.restored) === '1') return { kind: 'restored' };
  if (demo) return { kind: 'demo' };
  return { kind: 'plain' };
}

/** `/api/session/login`, or with `account=1` where the person's own sign-in is what is wanted (O2's `parked_expired`). */
function signInAgain(variant: SignedOutVariant): string {
  return variant.kind === 'failed' && variant.reason === 'parked_expired' ? '/api/session/login?account=1' : '/api/session/login';
}

export interface SignedOutContentProps {
  readonly variant: SignedOutVariant;
  /** The site's home (D18), when the demo is on and a site is configured. */
  readonly home: Home | null;
  /** `restored`: the name of the account that came back. */
  readonly restoredAs?: string | null;
  /** `demo`: "Explore as …", one per area. */
  readonly explore?: readonly DemoExploreLink[];
}

export function SignedOutContent({ variant, home, restoredAs = null, explore = [] }: SignedOutContentProps): ReactNode {
  const homeLink = home ? (
    <a href={home.href} className="app-Entry__link">
      {home.label}
    </a>
  ) : null;

  if (variant.kind === 'failed') {
    return (
      <>
        <EntryTitle>{variant.demo ? 'Thanks for exploring' : 'That sign-in didn’t finish'}</EntryTitle>
        <Banner tone={variant.demo ? 'warning' : 'danger'} live="assertive">
          {signInFailureSentence(variant.reason)}
        </Banner>
        <div className="app-Entry__actions">
          <EntryLink href={signInAgain(variant)} primary>
            Sign in again
          </EntryLink>
        </div>
      </>
    );
  }

  if (variant.kind === 'restored') {
    return (
      <>
        <EntryTitle>Thanks for exploring</EntryTitle>
        <div className="app-Entry__body">
          <p>{restoredAs ? `You’re back in your own account, signed in as ${restoredAs}.` : 'You’re back in your own account.'}</p>
        </div>
        <div className="app-Entry__actions">
          <EntryLink href="/" primary>
            Continue to {AREAS.admin.name}
          </EntryLink>
        </div>
      </>
    );
  }

  if (variant.kind === 'demo') {
    return (
      <>
        <EntryTitle>Thanks for exploring</EntryTitle>
        <div className="app-Entry__body">
          <p>
            Your demo session has ended. {DEMO_COMPANY.name} and its people are fictional, and the demo resets every night at {DEMO_RESET.label}.
          </p>
        </div>
        {home ? (
          <div className="app-Entry__actions">
            <EntryLink href={home.href} primary>
              {home.label}
            </EntryLink>
          </div>
        ) : null}
        {explore.length > 0 ? (
          <ul className="app-Entry__links" aria-label="Explore the demo again">
            {explore.map((link) => (
              <li key={link.area}>
                <a href={link.href} className="app-Entry__link">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  return (
    <>
      <EntryTitle>You’re signed out</EntryTitle>
      <div className="app-Entry__body">
        <p>Your session on this device has ended.</p>
      </div>
      <div className="app-Entry__actions">
        <EntryLink href="/api/session/login" primary>
          Sign in again
        </EntryLink>
      </div>
      {homeLink}
    </>
  );
}
