import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button, Input } from '@itsm/ui';
import { safeRedirectTarget } from '@itsm/bff';
import { bff } from '../../bff.js';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * The development sign-in form.
 *
 * Answers 404 wherever an identity provider is configured, so the page does
 * not exist in a deployment rather than existing and refusing. It is also
 * honest about what it is: there is no password, because a development
 * database is not a secret, and a form that asked for one would suggest this
 * was ever meant to be reachable from outside a laptop.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!bff.developmentSignInAvailable()) notFound();

  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason : null;
  const redirectTo = safeRedirectTarget(
    typeof params.redirectTo === 'string' ? params.redirectTo : null,
    bff.config.defaultLanding,
  );

  return (
    <main className="itsm-SignIn">
      <h1 className="itsm-SignIn__heading">Sign in</h1>
      <p className="itsm-SignIn__note">
        No identity provider is configured, so this deployment is using the development sign-in. Any active account in
        the tenant will do — run <code>pnpm seed</code> if there are none.
      </p>

      {reason ? (
        <p className="itsm-SignIn__error" role="alert">
          {reason}
        </p>
      ) : null}

      <form className="itsm-SignIn__form" action="/api/session/dev" method="post">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label htmlFor="tenantSlug">Tenant</label>
        <Input id="tenantSlug" name="tenantSlug" defaultValue="acme" autoComplete="organization" required />
        <label htmlFor="email">Email address</label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
        <Button type="submit" variant="primary" fullWidth>
          Sign in
        </Button>
      </form>
    </main>
  );
}
