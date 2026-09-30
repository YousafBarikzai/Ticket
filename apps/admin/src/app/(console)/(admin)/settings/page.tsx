import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { GeneralView } from '../../../../components/settings/GeneralView.js';
import { holds, viewOnlyFor } from '../../../../permissions.js';
import { pageAccess } from '../../../../server/session.js';
import { loadSettings, reachable, searchState, searchableTabs, settingsTabs } from './data.js';
import '../../../../components/command-centre/shared.css';
import '../../../../components/settings/settings.css';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings › General (SPEC §6.1 `/settings`, X-11, MOD-13-E1-S1): how this
 * desk behaves, one typed control per setting, grouped by what it is about,
 * with the search first. Every change is a new version: History in a row's ⋯
 * shows them and restores one; Undo in the toast takes a change back.
 *
 * `?q=` is the search (the Command centre sends `/settings?q=email`, the
 * palette a setting's key) and `?changed=1` shows only what differs from the
 * default. `?open=setting:<key>` is the history sheet.
 */
export default async function SettingsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/settings');
  if (!access.allowed) return <Forbidden route="/settings" />;
  const { me, api } = access;
  const viewOnly = viewOnlyFor(me, 'these settings', 'admin.setting.manage');
  const header = <PageHeader title="Settings" tabs={settingsTabs(me)} {...(viewOnly ? { viewOnly } : {})} />;

  const [data, params] = await Promise.all([loadSettings(me, api, { settings: true, flags: holds(me, 'admin.setting.read') }), searchParams]);
  if (!data.settings) {
    return (
      <div className="app-Page app-Settings">
        {header}
        <Card title="General" titleAs="h2" {...(data.settingsProblem ? { problem: data.settingsProblem } : {})} />
      </div>
    );
  }

  return (
    <div className="app-Page app-Settings">
      {header}
      <GeneralView
        items={data.settings.filter((item) => item.group !== 'ai')}
        index={data.index}
        initial={searchState(params)}
        tabs={searchableTabs(me)}
        canManage={holds(me, 'admin.setting.manage')}
        reachable={['/ai-triage'].filter((href) => reachable(me, href) !== undefined)}
      />
    </div>
  );
}
