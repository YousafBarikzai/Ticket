import type { ReactNode } from 'react';
import { SignInLayout, type DemoBarProps } from '@itsm/ui/shell';
import { LazyPublicDemoBar } from './LazyPublicDemoBar.js';
import { demoClock, demoModeOn, siteHome } from './server.js';
import './entry.css';

/**
 * What the Help Portal's three sign-in surfaces — `/demo`, `/sign-in` and
 * `/signed-out` — share (SPEC v3 §4.6, §6.3): the design system's
 * `SignInLayout` with the public demo bar above it when the demo is on here,
 * and the few parts a page puts in the column.
 *
 * Server components only. The pages render before any provider exists, the
 * proxy lets them through without a session, and every control is a plain
 * link or a plain form post — no client-side router, no prefetch of a
 * sign-in. The demo bar comes as an async chunk (`LazyPublicDemoBar`); the
 * one other island, `AutoSubmitForm`, is `/demo`'s alone (`EntryForm.tsx`).
 */

export { AREA, AREA_IN_SENTENCE, HOME_LABEL, PERSONA, demoModeOn, siteHome } from './server.js';

export interface EntryLayoutProps {
  readonly children: ReactNode;
  /** The public bar's seeded state on `/demo` (X9): "Preparing the demo…", "Paused". */
  readonly demoState?: DemoBarProps['state'];
  /** `chooser` widens the column for the rows of "Explore as …". */
  readonly width?: 'form' | 'chooser';
}

/**
 * `SignInLayout`, with the public demo bar above it when the demo is on here
 * (§3.8: badge, countdown, the one sentence and Demo details — no persona, no
 * Reset, no polling), and the panel's lockup linking to the public site when
 * its origin is known (D18).
 */
export function EntryLayout({ children, demoState, width = 'form' }: EntryLayoutProps): ReactNode {
  const home = siteHome();
  const bar = demoModeOn() ? (
    <LazyPublicDemoBar clock={demoClock()} {...(demoState ? { state: demoState } : {})} links={home ? { home } : {}} />
  ) : undefined;
  return (
    <SignInLayout systemBar={bar} width={width} {...(home ? { productHref: home } : {})}>
      <div className="app-Entry">{children}</div>
    </SignInLayout>
  );
}

/**
 * The page's one heading. `status`: the page is doing something by itself
 * ("Opening the Help Portal…"), so the line is also a polite status — the
 * auto-submit announces nothing of its own (A3 §6.2).
 */
export function EntryTitle({ children, status = false }: { readonly children: ReactNode; readonly status?: boolean }): ReactNode {
  return <h1 className="app-Entry__title">{status ? <span role="status">{children}</span> : children}</h1>;
}

export function EntryBody({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="app-Entry__body">{children}</p>;
}

/** Full-width actions, primary first. */
export function EntryActions({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="app-Entry__actions">{children}</div>;
}

/**
 * A link drawn as a button. A plain `<a>`, never the router's link: these go
 * to sign-in routes, to `/demo`, or off to the public site, and nothing
 * should prefetch any of them.
 */
export function EntryLink({ href, children, primary = false }: { readonly href: string; readonly children: ReactNode; readonly primary?: boolean }): ReactNode {
  return (
    <a href={href} className={`itsm-Button itsm-Button--${primary ? 'primary' : 'secondary'} itsm-Button--lg itsm-Button--fullWidth`}>
      <span className="itsm-Button__label">{children}</span>
    </a>
  );
}
