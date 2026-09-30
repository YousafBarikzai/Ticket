import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Banner, Button, FormField, Input, StatusScreen } from '@itsm/ui';
import { safeRedirectTarget } from '@itsm/bff';
import { bff } from '../../bff.js';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/**
 * The development sign-in form (SPEC §6.1 "/sign-in").
 *
 * Answers 404 wherever an identity provider is configured, so the page does
 * not exist in a deployment rather than existing and refusing. It is also
 * honest about what it is: there is no password, because a development
 * database is not a secret, and a form that asked for one would suggest this
 * was ever meant to be reachable from outside a laptop.
 *
 * Outside the console's frame and its providers — a branded card on the
 * canvas — so it renders without a session and without client JavaScript:
 * the form posts to `/api/session/dev`, carrying the page the person was
 * going to (`redirectTo`), so signing in lands them there.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!bff.developmentSignInAvailable()) notFound();

  const params = await searchParams;
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 300) : null;
  const redirectTo = safeRedirectTarget(typeof params.redirectTo === 'string' ? params.redirectTo : null, bff.config.defaultLanding);

  return (
    <StatusScreen
      brand="admin"
      title="Sign in to Administration"
      body={
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
            <input type="hidden" name="redirectTo" value={redirectTo} />
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
      }
    />
  );
}
