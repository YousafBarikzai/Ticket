import type { ReactNode } from 'react';
import type { SignInDecision } from '@itsm/bff';
import { AREAS } from '@itsm/contracts/areas';
import { Banner, Button, FormField, Input } from '@itsm/ui';
import { EntryLink, EntryTitle, type Home } from '../demo/entry.js';

/**
 * The column of `/sign-in` for one I-row decision (§4.5, A3 §6.6). `reason` is
 * the development form's own refusal, shown back to it; `home` is the site
 * (D18), offered to a returning demo visitor.
 */
export function SignInContent({ decision, reason, home }: { readonly decision: SignInDecision; readonly reason: string | null; readonly home: Home | null }): ReactNode {
  const signInTo = `Sign in to ${AREAS.admin.name}`;

  if (decision.kind === 'chooser') {
    const { persona } = decision;
    return (
      <>
        <EntryTitle>Welcome back</EntryTitle>
        <div className="app-Entry__body">
          <p>
            This browser was exploring the demo as{' '}
            <strong>
              {persona.name}, {persona.title}
            </strong>
            .
          </p>
        </div>
        <div className="app-Entry__actions">
          <EntryLink href={decision.continueHref} primary>
            Continue the demo as {persona.name}
          </EntryLink>
          <EntryLink href={decision.workAccountHref}>Sign in with your work account</EntryLink>
        </div>
        {home ? (
          <a href={home.href} className="app-Entry__link">
            {home.label}
          </a>
        ) : null}
      </>
    );
  }

  if (decision.kind === 'sign-in') {
    return (
      <>
        <EntryTitle>{signInTo}</EntryTitle>
        <div className="app-Entry__actions">
          <EntryLink href={decision.workAccountHref} primary>
            Sign in with your work account
          </EntryLink>
        </div>
        {decision.exploreHref ? (
          <p className="app-Entry__note">
            New here?{' '}
            <a href={decision.exploreHref} className="app-Entry__link">
              Explore the demo
            </a>
          </p>
        ) : null}
      </>
    );
  }

  // I1: the development form. Posts to `/api/session/dev`, carrying where the person was going.
  return (
    <>
      <EntryTitle>{signInTo}</EntryTitle>
      <div className="app-SignIn">
        <Banner tone="info" icon="info" live={false}>
          Development sign-in — any active account in the workspace will do. Run <code>pnpm seed</code> if there are none.
        </Banner>
        {reason ? (
          <Banner tone="danger" live="assertive">
            {reason}
          </Banner>
        ) : null}
        <form className="app-SignIn__form" action="/api/session/dev" method="post">
          <input type="hidden" name="redirectTo" value={decision.redirectTo} />
          <FormField label="Workspace" hint="The workspace’s short name, e.g. acme.">
            <Input name="tenantSlug" defaultValue="acme" autoComplete="organization" required spellCheck={false} autoCapitalize="off" />
          </FormField>
          <FormField label="Email address">
            <Input name="email" type="email" autoComplete="username" required autoFocus />
          </FormField>
          <Button type="submit" variant="primary" size="lg" fullWidth>
            Sign in
          </Button>
        </form>
      </div>
      {decision.continueDemo ? (
        <div className="app-Entry__actions">
          <EntryLink href={decision.continueDemo.href}>Continue the demo as {decision.continueDemo.persona.name}</EntryLink>
        </div>
      ) : null}
    </>
  );
}
