import type { ReactNode } from 'react';
import { DEMO_COPY } from '@itsm/contracts/demo';
import { Icon } from '@itsm/ui';
import { SignInLayout, SystemBar, type DemoBarProps } from '@itsm/ui/shell';
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
 * sign-in. The demo's strip is server-rendered (`PublicDemoStrip`); the one
 * island, `AutoSubmitForm`, is `/demo`'s alone (`EntryForm.tsx`).
 */

export { AREA, AREA_IN_SENTENCE, HOME_LABEL, PERSONA, demoModeOn, siteHome } from './server.js';

/** The public bar's words (`DemoBar`'s, in `@itsm/ui/shell`; a test holds them equal). */
export const DEMO_STRIP = {
  label: 'Demo environment',
  badge: 'Demo',
  preparing: 'Preparing the demo…',
  resetting: 'Resetting now…',
  paused: 'Paused',
} as const;

/** "Resets in 9 h 01 min", "Resets in 42 min": the countdown as these pages draw it, to the minute. */
export function resetsIn(remainingMs: number): string {
  const minutes = Math.max(0, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `Resets in ${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `Resets in ${minutes} min`;
}

/**
 * The public demo bar of these three pages (SPEC v3 §3.8, A2 §9.7): the
 * badge, when the demo resets and the one sentence, centred, never polling —
 * composed from `SystemBar`, the one surface every demo bar is (R11), and
 * drawn entirely on the server.
 *
 * Not `DemoBar variant="public"`: its countdown and Demo details are client
 * islands, and on the Help Portal any client code these pages share with the
 * framed ones — even loaded lazily — changes how the framed pages' shared
 * chunks are split, which measured about 0.7 kB more first load on every
 * page, against a budget with a few hundred bytes to spare (§10.2). So the
 * countdown is static, to the minute and current on every load — §10.2's
 * first cut, "a static countdown on the portal" — and there is no Demo
 * details: the page under it says what the demo is. Each page here is seen
 * for a moment on the way into or out of the demo; the live bar is the
 * public site's and the framed pages'.
 */
export function PublicDemoStrip({ state = 'ready', now = Date.now() }: { readonly state?: DemoBarProps['state']; readonly now?: number }): ReactNode {
  const clock = demoClock(now);
  const status =
    state === 'paused' ? (
      <span className="itsm-DemoBar__paused">
        <Icon name="pause" size={15} />
        {DEMO_STRIP.paused}
      </span>
    ) : state === 'ready' ? (
      <time dateTime={new Date(clock.nextResetAt).toISOString()}>{resetsIn(clock.nextResetAt - clock.serverNow)}</time>
    ) : undefined;
  return (
    <SystemBar
      label={DEMO_STRIP.label}
      badge={{ label: DEMO_STRIP.badge, live: true }}
      status={status}
      message={DEMO_COPY.resetsDaily}
      align="center"
      state={state === 'building' || state === 'preparing' ? 'busy' : 'default'}
      busyLabel={state === 'preparing' ? DEMO_STRIP.preparing : DEMO_STRIP.resetting}
      className="itsm-DemoBar"
      data-variant="public"
    />
  );
}

export interface EntryLayoutProps {
  readonly children: ReactNode;
  /** The demo's state where the page knows it (`/demo`, X9): "Preparing the demo…", "Paused". */
  readonly demoState?: DemoBarProps['state'];
  /** `chooser` widens the column for the rows of "Explore as …". */
  readonly width?: 'form' | 'chooser';
}

/**
 * `SignInLayout`, with the public demo strip above it when the demo is on
 * here, and the panel's lockup linking to the public site when its origin is
 * known (D18).
 */
export function EntryLayout({ children, demoState, width = 'form' }: EntryLayoutProps): ReactNode {
  const home = siteHome();
  return (
    <SignInLayout systemBar={demoModeOn() ? <PublicDemoStrip {...(demoState ? { state: demoState } : {})} /> : undefined} width={width} {...(home ? { productHref: home } : {})}>
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
