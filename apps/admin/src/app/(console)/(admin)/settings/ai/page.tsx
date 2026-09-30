import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { AiView } from '../../../../../components/settings/AiView.js';
import { holds, viewOnlyFor } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { loadSettings, reachable, searchState, searchableTabs, settingsTabs, triageSummary } from '../data.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/ai-triage/ai-triage.css';
import '../../../../../components/settings/settings.css';

export const metadata: Metadata = { title: 'AI · Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings › AI (SPEC §6.1): the workspace's AI switch — a kill switch that
 * asks first — and the four capabilities, each saying what stops when it is
 * off; reply tone, language and how long prompts are kept; triage (the mode
 * lives on AI triage, linked) and the confidence it acts on; this month's
 * spend against the budget.
 *
 * The regions a workspace's prompts may be processed in are the platform
 * operator's to set and not readable here (WP19's note); the page says they
 * apply instead of listing them.
 */
export default async function AiSettingsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/settings/ai');
  if (!access.allowed) return <Forbidden route="/settings/ai" />;
  const { me, api } = access;
  const canManageFlags = holds(me, 'admin.flag.manage');
  const canManageSettings = holds(me, 'admin.setting.manage');
  const viewOnly = viewOnlyFor(me, 'the AI settings', ['admin.setting.manage', 'admin.flag.manage']);
  const readsSettings = holds(me, 'admin.setting.read');
  const showBudget = holds(me, 'ai.read');

  const [data, budget, params] = await Promise.all([
    loadSettings(me, api, { settings: readsSettings, flags: true }),
    showBudget ? read(() => api.observe.ai.budget()) : Promise.resolve(null),
    searchParams,
  ]);
  const aiSettings = data.settings ? data.settings.filter((item) => item.group === 'ai') : readsSettings ? null : [];
  const triageHref = reachable(me, '/ai-triage');

  return (
    <div className="app-Page app-Settings">
      <PageHeader title="Settings" tabs={settingsTabs(me)} {...(viewOnly ? { viewOnly } : {})} />
      <AiView
        flags={data.flags}
        {...(data.flagsProblem ? { flagsProblem: data.flagsProblem } : {})}
        settings={aiSettings}
        {...(data.settingsProblem ? { settingsProblem: data.settingsProblem } : {})}
        triage={triageSummary(data.flags, aiSettings, triageHref)}
        budget={budget?.ok ? budget.value : null}
        {...(budget && !budget.ok ? { budgetProblem: budget.problem } : {})}
        showBudget={showBudget}
        canManageFlags={canManageFlags}
        canManageSettings={canManageSettings}
        canEditBudget={holds(me, 'ai.manage')}
        index={data.index}
        initial={searchState(params)}
        tabs={searchableTabs(me)}
        reachable={triageHref ? [triageHref] : []}
        locale={me.locale}
      />
    </div>
  );
}
