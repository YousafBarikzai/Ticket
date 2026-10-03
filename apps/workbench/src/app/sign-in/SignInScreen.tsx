import type { ReactNode } from 'react';
import type { SignInDecision } from '@itsm/bff';
import { AREAS, SITE } from '@itsm/contracts/areas';
import { Banner, Button, FormField, Input } from '@itsm/ui';
import { SignInLayout, type DemoBarProps } from '@itsm/ui/shell';
import { areaInSentence } from '../demo/copy.js';
import { DemoBarSlot } from '../demo/DemoBarSlot.js';

/**
 * What `/sign-in` shows (v3 §4.5 I rows; A3 §6.6), for the Service Desk, on
 * `SignInLayout` like the site's chooser (A5 §6.2).
 *
 * - **I1, development:** the development form — no password, because a
 *   development database is not a secret — and, when this browser was in
 *   today's demo, the way back to it.
 * - **I2, the chooser:** this browser was exploring the demo today (the
 *   re-entry cookie says so, never a query parameter), so it is offered back,
 *   beside a real sign-in, which always wins (D22).
 * - **I3:** "Sign in to the Service Desk" with a work account and, with the
 *   demo on, "New here? Explore the demo".
 *
 * Plain links, never `next/link`: nothing should prefetch a sign-in.
 */

export interface SignInScreenProps {
  readonly decision: SignInDecision;
  /** I1 only: why the development sign-in came back (its own words, at most 300 characters). */
  readonly reason?: string | null;
  /** `DEMO_MODE=on` here: the public demo bar sits above the layout (A2 §9.7). */
  readonly demo: boolean;
  /** The site, for the lockup (D18); null when not configured. */
  readonly site: string | null;
  readonly clock: DemoBarProps['clock'];
}

const AREA = AREAS.workbench.name;

function Column({ decision, reason }: { readonly decision: SignInDecision; readonly reason: string | null }): ReactNode {
  switch (decision.row) {
    case 'I1':
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">Sign in to {areaInSentence(AREA)}</h1>
          <Banner tone="info" title="Development sign-in">
            No identity provider is configured. Any active account in the workspace will do — run <code>pnpm seed</code> if there are none.
          </Banner>
          {reason ? (
            <Banner tone="danger" title="That didn’t work">
              {reason}
            </Banner>
          ) : null}
          <form className="app-Entry__form" action="/api/session/dev" method="post">
            <input type="hidden" name="redirectTo" value={decision.redirectTo} />
            <FormField label="Workspace" required>
              <Input name="tenantSlug" defaultValue="acme" autoComplete="organization" required />
            </FormField>
            <FormField label="Email address" required>
              <Input name="email" type="email" autoComplete="username" required />
            </FormField>
            <Button type="submit" variant="primary" size="lg" fullWidth>
              Sign in
            </Button>
          </form>
          {decision.continueDemo ? (
            <Button href={decision.continueDemo.href} variant="secondary" size="lg" fullWidth>
              Continue the demo as {decision.continueDemo.persona.name}
            </Button>
          ) : null}
        </div>
      );
    case 'I2':
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">Welcome back</h1>
          <p className="app-Entry__body">
            This browser was exploring the demo as{' '}
            <strong>
              {decision.persona.name}, {decision.persona.title}
            </strong>
            .
          </p>
          <div className="app-Entry__actions">
            <Button href={decision.continueHref} variant="primary" size="lg" fullWidth>
              Continue the demo as {decision.persona.name}
            </Button>
            <Button href={decision.workAccountHref} variant="secondary" size="lg" fullWidth>
              Sign in with your work account
            </Button>
          </div>
          {decision.homeHref ? (
            <a className="app-Entry__link" href={decision.homeHref}>
              {SITE.homeLabel}
            </a>
          ) : null}
        </div>
      );
    case 'I3':
      return (
        <div className="app-Entry">
          <h1 className="app-Entry__title">Sign in to {areaInSentence(AREA)}</h1>
          <p className="app-Entry__body">You’ll continue to your organisation’s sign-in page.</p>
          <div className="app-Entry__actions">
            <Button href={decision.workAccountHref} variant="primary" size="lg" fullWidth>
              Sign in with your work account
            </Button>
          </div>
          {decision.exploreHref || decision.homeHref ? (
            <ul className="app-Entry__links">
              {decision.exploreHref ? (
                <li>
                  <a className="app-Entry__link" href={decision.exploreHref}>
                    New here? Explore the demo
                  </a>
                </li>
              ) : null}
              {decision.homeHref ? (
                <li>
                  <a className="app-Entry__link" href={decision.homeHref}>
                    {SITE.homeLabel}
                  </a>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      );
  }
}

export function SignInScreen({ decision, reason = null, demo, site, clock }: SignInScreenProps): ReactNode {
  return (
    <SignInLayout
      {...(site ? { productHref: site } : {})}
      {...(demo ? { systemBar: <DemoBarSlot variant="public" clock={clock} {...(site ? { links: { home: site } } : {})} /> } : {})}
    >
      <Column decision={decision} reason={decision.row === 'I1' ? reason : null} />
    </SignInLayout>
  );
}
