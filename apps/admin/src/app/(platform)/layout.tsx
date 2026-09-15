import type { ReactNode } from 'react';
import { AppShell } from '@itsm/ui';
import { SignOutButton } from '../../components/SignOutButton.js';
import { requirePlatformOperator } from '../../server/session.js';

/**
 * The platform operator's section, and the gate on it.
 *
 * These screens are not a tenant's. They list every tenant on the deployment
 * and the price list every one of them is sold against, and the audience is
 * whoever runs the platform rather than whoever runs a desk.
 *
 * The gate is here, in the *layout*, rather than on each page. A per-page
 * check is one page away from being forgotten, and the page somebody forgets
 * is the one that enumerates every customer. Next renders a segment's layout
 * before any page inside it, so a route added to this directory later is
 * behind the check by construction rather than by remembering.
 *
 * `requirePlatformOperator` calls `notFound()` rather than returning a 403.
 * "You may not see this" tells somebody there is a platform section and that
 * they are one permission away from it; a 404 tells them nothing they did not
 * already know.
 *
 * None of this is the security boundary. The API refuses these calls without
 * `platform.tenant.manage` whatever this layout does — no role in the shipped
 * role seed holds it. This is the console not offering what it cannot deliver.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { me } = await requirePlatformOperator();

  return (
    <AppShell
      brand={
        <span>
          <strong>Platform</strong>
          <span className="itsm-AppShell__tenant"> · every tenant</span>
        </span>
      }
      navItems={[
        { id: 'tenants', label: 'Tenants', href: '/tenants' },
        { id: 'plans', label: 'Plans', href: '/plans' },
        { id: 'back', label: 'Back to this desk', href: '/' },
      ]}
      navLabel="Platform operations"
      headerEnd={
        <>
          <span className="itsm-AppShell__who">{me.actor.displayName ?? 'Operator'}</span>
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
