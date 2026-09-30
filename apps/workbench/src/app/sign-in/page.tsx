import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { safeRedirectTarget } from '@itsm/bff';
import { Banner, Button, FormField, Input, StatusScreen } from '@itsm/ui';
import { bff } from '../../bff.js';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * The development sign-in form (SPEC §6.1, §6.2).
 *
 * Answers 404 wherever an identity provider is configured, so the page does
 * not exist in a deployment rather than existing and refusing. It is also
 * honest about what it is: there is no password, because a development
 * database is not a secret, and a form that asked for one would suggest this
 * was ever meant to be reachable from outside a laptop.
 *
 * A plain form post, no client code: `/api/session/dev` answers with a
 * redirect to where the person was going (or back here with a reason).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!bff.developmentSignInAvailable()) notFound();

  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;
  const redirectTo = safeRedirectTarget(
    typeof params.redirectTo === 'string' ? params.redirectTo : null,
    bff.config.defaultLanding,
  );

  return (
    <StatusScreen
      brand="workbench"
      title="Sign in to Workbench"
      body={
        <div className="app-SignIn">
          <Banner tone="info" title="Development sign-in">
            No identity provider is configured. Any active account in the workspace will do — run <code>pnpm seed</code> if there are none.
          </Banner>
          {reason ? (
            <Banner tone="danger" title="That didn’t work">
              {reason}
            </Banner>
          ) : null}
          <form className="app-SignIn__form" action="/api/session/dev" method="post">
            <input type="hidden" name="redirectTo" value={redirectTo} />
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
        </div>
      }
    />
  );
}
