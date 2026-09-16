import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { EmptyState } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { FlagList } from '../../../components/FlagList.js';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * What is switched on.
 *
 * Feature flags are the only thing here that this slice lets an administrator
 * change, and they are the right first one: a flag is a single boolean with a
 * single blast radius, and every other setting on this desk is a value whose
 * validity depends on what it is for.
 */
export default async function SettingsPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'admin.settings.manage');

  let flags: Awaited<ReturnType<typeof api.tenant.flags>>;
  try {
    flags = await api.tenant.flags();
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The settings could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Settings</h1>
        <p className="itsm-Admin__lede">
          What this desk has switched on. A flag takes effect for everybody on the tenant as soon as it is saved.
        </p>
      </header>

      {flags.length === 0 ? (
        <EmptyState title="No feature flags" description="Nothing on this deployment is behind one." />
      ) : (
        <FlagList flags={flags} canManage={canManage} />
      )}

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Tenant settings with typed values — the auto-close window, the default priority, the AI budget and its
          residency regions — are readable and writable through the API and have no controls here. Each needs a control
          shaped to its own value, and a text box that posts JSON would be a worse answer than none.
        </p>
      </section>
    </div>
  );
}
