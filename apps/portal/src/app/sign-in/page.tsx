import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DEMO_COOKIE, type SignInDecision } from '@itsm/bff';
import { Banner, Button, FormField, Input } from '@itsm/ui';
import { bff } from '../../bff.js';
import { AREA_IN_SENTENCE, EntryActions, EntryBody, EntryLayout, EntryLink, EntryTitle, HOME_LABEL } from '../demo/entry.js';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * `/sign-in` (SPEC v3 §4.5 rows I1–I3, A3 §6.6), on the sign-in layout.
 *
 * The public site's chooser is where people normally start; this page exists
 * for someone who lands on a Help Portal address without a session, and for
 * a browser that was in the demo today (the re-entry cookie, D22):
 *
 *   - **I1, development.** No identity provider is configured: the
 *     development form — honest about what it is, with no password, because a
 *     development database is not a secret — and, when this browser was in
 *     the demo today, "Continue the demo as Emma Clarke".
 *   - **I2, welcome back.** The demo is on and this browser was exploring it
 *     today: continue the demo, or sign in with a work account (which always
 *     wins, L1). The cookie decides, never a query parameter.
 *   - **I3, sign in.** "Sign in to the Help Portal" with a work account, and,
 *     with the demo on, "New here? Explore the demo".
 *
 * Every control is a plain link or a plain form post, never the router's
 * link: nothing prefetches a sign-in.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const jar = await cookies();
  const decision = bff.signInPage({
    demoCookie: jar.get(DEMO_COOKIE)?.value,
    redirectTo: typeof params.redirectTo === 'string' ? params.redirectTo : null,
  });
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;

  return (
    <EntryLayout>
      <SignInContent decision={decision} reason={reason} />
    </EntryLayout>
  );
}

function SignInContent({ decision, reason }: { readonly decision: SignInDecision; readonly reason: string | null }): ReactNode {
  switch (decision.row) {
    case 'I1':
      return (
        <>
          <EntryTitle>{`Sign in to ${AREA_IN_SENTENCE}`}</EntryTitle>
          <Banner tone="info" title="Development sign-in">
            No identity provider is configured. Any active account in the workspace will do — run <code>pnpm seed</code> if there are none.
          </Banner>
          {reason ? (
            // `/api/session/dev` puts its own sentence here; nothing from a link reaches a page as markup.
            <Banner tone="danger" title="That didn't work">
              {reason}
            </Banner>
          ) : null}
          <form className="app-SignIn__form" action="/api/session/dev" method="post">
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
            <EntryActions>
              <EntryLink href={decision.continueDemo.href}>{`Continue the demo as ${decision.continueDemo.persona.name}`}</EntryLink>
            </EntryActions>
          ) : null}
        </>
      );
    case 'I2':
      return (
        <>
          <EntryTitle>Welcome back</EntryTitle>
          <EntryBody>
            This browser was exploring the demo as <strong>{`${decision.persona.name}, ${decision.persona.title}`}</strong>.
          </EntryBody>
          <EntryActions>
            <EntryLink href={decision.continueHref} primary>
              {`Continue the demo as ${decision.persona.name}`}
            </EntryLink>
            <EntryLink href={decision.workAccountHref}>Sign in with your work account</EntryLink>
            {decision.homeHref ? <EntryLink href={decision.homeHref}>{HOME_LABEL}</EntryLink> : null}
          </EntryActions>
        </>
      );
    case 'I3':
      return (
        <>
          <EntryTitle>{`Sign in to ${AREA_IN_SENTENCE}`}</EntryTitle>
          <EntryActions>
            <EntryLink href={decision.workAccountHref} primary>
              Sign in with your work account
            </EntryLink>
            {decision.exploreHref ? <EntryLink href={decision.exploreHref}>New here? Explore the demo</EntryLink> : null}
            {decision.homeHref ? <EntryLink href={decision.homeHref}>{HOME_LABEL}</EntryLink> : null}
          </EntryActions>
        </>
      );
  }
}
