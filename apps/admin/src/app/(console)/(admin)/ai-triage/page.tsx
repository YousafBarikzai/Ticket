import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Banner, Card, Stepper } from '@itsm/ui';
import { StatCard } from '@itsm/ui/charts';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { BudgetCard } from '../../../../components/ai-triage/BudgetCard.js';
import { ModeControl, OffState, type ModeContext } from '../../../../components/ai-triage/ModeControl.js';
import { holds } from '../../../../permissions.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import {
  AI_OFF_REASON,
  acceptedShare,
  lastStepDownText,
  leadText,
  providerLabel,
  readiness,
  residencySkips,
  stepDownText,
} from '../../../../triage.js';
import { mayChangeMode, modeState, modeViewOnly, reachable, triageTabs } from './data.js';
import '../../../../components/ai-triage/ai-triage.css';

export const metadata: Metadata = { title: 'AI triage' };
export const dynamic = 'force-dynamic';

/** The overview reads the last 30 days; Quality and Decisions have the range control. */
const DAYS = 30;

/**
 * AI triage › Overview (SPEC §6.1, X-31; ADR-0051): the mode the desk is in,
 * as a control that confirms before it changes anything; where the desk is
 * on Shadow → Suggest → Auto and what the record says about the next step;
 * who answers first; and three numbers — decisions, how often agents took a
 * suggestion, and this month's spend against the budget.
 *
 * One banner at most, for the thing that matters most right now: AI
 * switched off for the whole workspace, Auto having stepped itself back,
 * how close Auto is to doing so, no provider able to answer, or a provider
 * passed over because it is outside the workspace's regions.
 */
export default async function AiTriagePage(): Promise<ReactNode> {
  const access = await pageAccess('/ai-triage');
  if (!access.allowed) return <Forbidden route="/ai-triage" />;
  const { me, api } = access;
  const tabs = triageTabs(me);
  const viewOnly = modeViewOnly(me);
  const header = <PageHeader title="AI triage" tabs={tabs} {...(viewOnly ? { viewOnly } : {})} />;

  const [score, budget] = await Promise.all([read(() => api.observe.ai.score({ purpose: 'triage', days: DAYS })), read(() => api.observe.ai.budget())]);
  if (!score.ok) {
    return (
      <div className="app-Page app-Triage">
        {header}
        <Card title="AI triage" problem={score.problem} />
      </div>
    );
  }

  const value = score.value;
  const state = await modeState(me, api, value.mode);
  const ready = readiness(value);
  const settingsHref = reachable(me, '/settings/ai');
  const context: ModeContext = {
    state,
    readiness: ready,
    suggestAt: Math.round(value.thresholds.suggest * 100),
    stepDown: { limit: value.stepDown.limit, window: value.stepDown.window },
    ...(settingsHref ? { settingsHref } : {}),
  };
  const canChange = mayChangeMode(me);
  const format = { locale: me.locale, timeZone: me.timeZone };

  // The one banner, most important first.
  const residency = residencySkips(value.skips);
  const recentStepDown = value.lastStepDown && Date.parse(value.lastStepDown.at) >= Date.now() - DAYS * 86_400_000 ? value.lastStepDown : null;
  const banner: { tone: 'warning' | 'info'; title?: string; text: string; href?: string; hrefLabel?: string } | null =
    state.aiEnabled === false
      ? { tone: 'warning', title: 'AI is off for this workspace', text: AI_OFF_REASON, ...(settingsHref ? { href: settingsHref, hrefLabel: 'Open Settings › AI' } : {}) }
      : recentStepDown
        ? { tone: 'warning', title: 'Auto switched itself back to Suggest', text: lastStepDownText(recentStepDown, format)! }
        : value.mode === 'auto' && stepDownText(value.stepDown)
          ? { tone: 'info', text: stepDownText(value.stepDown)! }
          : value.mode !== 'off' && value.gateProvider === null
            ? { tone: 'warning', title: 'No provider can answer', text: leadText(null) }
            : residency > 0
              ? {
                  tone: 'info',
                  text: `A provider was passed over ${residency} ${residency === 1 ? 'time' : 'times'} in the last ${DAYS} days because it is outside this workspace’s allowed AI regions. Those tickets kept what intake gave them.`,
                }
              : null;

  const bannerNode = banner ? (
    <Banner
      tone={banner.tone}
      {...(banner.title ? { title: banner.title } : {})}
      {...(banner.href ? { action: { id: 'settings', label: banner.hrefLabel ?? 'Open', href: banner.href, variant: 'secondary' as const } } : {})}
    >
      {banner.text}
    </Banner>
  ) : null;

  if (value.mode === 'off' && value.decisions === 0) {
    return (
      <div className="app-Page app-Triage">
        {header}
        {bannerNode}
        <OffState context={context} canChange={canChange && state.aiEnabled !== false} />
      </div>
    );
  }

  const accepted = acceptedShare(value.questions);
  const decisionsHref = reachable(me, '/ai-triage/decisions') ?? reachable(me, '/ai-triage/quality');
  const region = me.tenant?.region;
  const answeredBy = Object.keys(value.byProvider)
    .filter((provider) => provider !== 'rules')
    .map(providerLabel);

  return (
    <div className="app-Page app-Triage">
      {header}
      {bannerNode}
      <Card title="Mode" className="app-TriageMode">
        <div className="app-TriageMode__body">
          <ModeControl context={context} canChange={canChange} />
          <Stepper label="From Shadow to Auto" steps={ready.steps.map((step) => ({ id: step.id, label: step.label, status: step.status, description: step.description }))} size="sm" />
          <p className="app-TriageMode__lead">
            {value.mode === 'off' ? 'When it’s on: ' : ''}
            {leadText(value.gateProvider)}
            {region ? ` This workspace is hosted in ${region}.` : ''} Providers are asked only inside the AI regions your platform operator allowed for it; one outside them is passed over, and the record says so.
          </p>
        </div>
      </Card>
      <section aria-label="The last 30 days" className="app-TriageStats">
        {/* A grid of its own rather than `StatGrid`: one column on a phone, where the budget's meter needs the width. */}
          <StatCard
            label={`Decisions · last ${DAYS} days`}
            value={value.decisions}
            icon="ai"
            secondary={`· ${value.settled} scored`}
            status={value.fellToRules > 0 && value.fellToRules === value.decisions ? 'attention' : 'default'}
            footnote={
              value.fellToRules > 0
                ? `${value.fellToRules} with nobody to answer — those kept what intake gave them`
                : answeredBy.length > 0
                  ? `Answered by ${answeredBy.join(' and ')}`
                  : 'Nothing decided yet'
            }
            {...(decisionsHref ? { href: decisionsHref } : {})}
            locale={me.locale}
          />
          <StatCard
            label="Suggestions accepted"
            value={accepted.rate}
            format={{ style: 'percent', maximumFractionDigits: 0 }}
            icon="check"
            footnote={
              accepted.total > 0
                ? `${accepted.accepted} of ${accepted.total} answered by agents`
                : value.mode === 'suggest' || value.mode === 'auto'
                  ? 'No suggestion answered yet'
                  : 'Counted once agents see suggestions'
            }
            locale={me.locale}
          />
          <BudgetCard budget={budget.ok ? budget.value : null} {...(budget.ok ? {} : { problem: budget.problem })} canEdit={holds(me, 'ai.manage')} locale={me.locale} />
      </section>
    </div>
  );
}
