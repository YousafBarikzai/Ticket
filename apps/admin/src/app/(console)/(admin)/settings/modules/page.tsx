import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ModulesView } from '../../../../../components/settings/ModulesView.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { moduleViews, settingsTabs } from '../data.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/settings/settings.css';

export const metadata: Metadata = { title: 'Modules · Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings › Modules [Plus] (SPEC §6.1): what is installed for this desk and
 * whether it is on. The tab is gated on `admin.module.manage`, so everyone
 * who sees it may switch; what cannot be switched (a foundation module, one
 * others are built on) says why instead.
 */
export default async function ModulesPage(): Promise<ReactNode> {
  const access = await pageAccess('/settings/modules');
  if (!access.allowed) return <Forbidden route="/settings/modules" />;
  const { me, api } = access;
  const modules = await read(() => api.tenant.modules());

  return (
    <div className="app-Page app-Settings">
      <PageHeader title="Settings" tabs={settingsTabs(me)} />
      {modules.ok ? <ModulesView modules={moduleViews(modules.value)} /> : <Card title="Modules" titleAs="h2" problem={modules.problem} />}
    </div>
  );
}
