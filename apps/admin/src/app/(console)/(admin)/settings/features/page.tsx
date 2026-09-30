import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { FeaturesView } from '../../../../../components/settings/FeaturesView.js';
import { holds, viewOnlyFor } from '../../../../../permissions.js';
import { pageAccess } from '../../../../../server/session.js';
import { loadSettings, reachable, searchState, searchableTabs, settingsTabs } from '../data.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/settings/settings.css';

export const metadata: Metadata = { title: 'Features · Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings › Features (SPEC §6.1, §6.4 "Feature flags"; F3, F30): every
 * feature switch, with the value this desk actually gets (A1). Reading needs
 * `admin.setting.read`; switching needs `admin.flag.manage` — the old page
 * checked a permission that does not exist and wrote a body the API refused.
 */
export default async function FeaturesPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/settings/features');
  if (!access.allowed) return <Forbidden route="/settings/features" />;
  const { me, api } = access;
  const viewOnly = viewOnlyFor(me, 'these features', 'admin.flag.manage');
  const [data, params] = await Promise.all([loadSettings(me, api, { settings: holds(me, 'admin.setting.read'), flags: true }), searchParams]);

  return (
    <div className="app-Page app-Settings">
      <PageHeader title="Settings" tabs={settingsTabs(me)} {...(viewOnly ? { viewOnly } : {})} />
      <FeaturesView
        flags={data.flags}
        {...(data.flagsProblem ? { problem: data.flagsProblem } : {})}
        index={data.index}
        initial={searchState(params)}
        tabs={searchableTabs(me)}
        canManage={holds(me, 'admin.flag.manage')}
        reachable={['/ai-triage'].filter((href) => reachable(me, href) !== undefined)}
      />
    </div>
  );
}
