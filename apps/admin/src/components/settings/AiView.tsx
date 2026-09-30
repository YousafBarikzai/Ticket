'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, EmptyState, StatusPill, type Problem } from '@itsm/ui';
import type { AiBudget } from '@itsm/sdk';
import { AI_CAPABILITIES, AI_FLAG, anchorId, type SearchEntry, type SettingsTabId } from '../../settings/catalogue.js';
import { BudgetCard } from '../ai-triage/BudgetCard.js';
import { FlagRow } from './FlagRow.js';
import { SettingHistory } from './SettingHistory.js';
import { SettingRow } from './SettingRow.js';
import { Elsewhere, SearchBar, elsewhereMatches, useJumpToRow, useSettingsSearch } from './SettingsSearch.js';
import { ReachableLinks } from './links.js';
import type { FlagItem, SettingItem, SettingsSearchState, TriageSummary } from './types.js';

export type { TriageSummary };

/**
 * Settings › AI (SPEC §6.1): the workspace's AI switch and the four
 * capability switches, each saying what stops when it is off; how drafted
 * replies read and how long prompts are kept; where triage is (with a link to
 * AI triage, which owns the mode) and the confidence it acts on; and this
 * month's spend against the budget.
 */

export interface AiViewProps {
  readonly flags: readonly FlagItem[] | null;
  readonly flagsProblem?: Problem;
  readonly settings: readonly SettingItem[] | null;
  readonly settingsProblem?: Problem;
  readonly triage: TriageSummary | null;
  readonly budget: AiBudget | null;
  readonly budgetProblem?: Problem;
  readonly showBudget: boolean;
  readonly canManageFlags: boolean;
  readonly canManageSettings: boolean;
  readonly canEditBudget: boolean;
  readonly index: readonly SearchEntry[];
  readonly initial: SettingsSearchState;
  readonly tabs: readonly SettingsTabId[];
  readonly reachable: readonly string[];
  readonly locale: string;
}

const REPLY_KEYS = ['ai.tone', 'ai.language', 'ai.retainDays'];
const TRIAGE_KEYS = ['ai.decision.triage.mode', 'ai.decision.suggestThreshold', 'ai.decision.autoThreshold'];
const NOUN = { one: 'setting', other: 'settings' };

export function AiView(props: AiViewProps): ReactNode {
  const { flags, settings, triage, canManageFlags, canManageSettings, index, initial, tabs, reachable } = props;
  const router = useRouter();
  const search = useSettingsSearch(initial);
  useJumpToRow();

  const entries = useMemo(() => new Map(index.map((entry) => [`${entry.kind}:${entry.key}`, entry])), [index]);
  const pass = (kind: 'setting' | 'flag', key: string): boolean => {
    const entry = entries.get(`${kind}:${key}`);
    return entry ? search.test(entry) : !search.active;
  };

  const featureKeys = [AI_FLAG, ...AI_CAPABILITIES];
  const features = (flags ?? []).filter((flag) => featureKeys.includes(flag.key)).sort((a, b) => featureKeys.indexOf(a.key) - featureKeys.indexOf(b.key));
  const aiOn = features.find((flag) => flag.key === AI_FLAG)?.value !== false;
  const aiSettings = settings ?? [];
  const replies = aiSettings.filter((item) => REPLY_KEYS.includes(item.key)).sort((a, b) => REPLY_KEYS.indexOf(a.key) - REPLY_KEYS.indexOf(b.key));
  const thresholds = aiSettings.filter((item) => TRIAGE_KEYS.includes(item.key) && item.key !== 'ai.decision.triage.mode');
  const others = aiSettings.filter((item) => !REPLY_KEYS.includes(item.key) && !TRIAGE_KEYS.includes(item.key));

  const shownFeatures = features.filter((flag) => pass('flag', flag.key));
  const shownReplies = [...replies, ...others].filter((item) => pass('setting', item.key));
  const shownThresholds = thresholds.filter((item) => pass('setting', item.key));
  const triageShown = triage !== null && (!search.active || pass('setting', 'ai.decision.triage.mode') || shownThresholds.length > 0);
  const shownHere = useMemo(() => new Set([...featureKeys, ...aiSettings.map((item) => item.key)]), [aiSettings]);
  const count = shownFeatures.length + shownReplies.length + shownThresholds.length + (triageShown && pass('setting', 'ai.decision.triage.mode') ? 1 : 0);
  const nothing = shownFeatures.length === 0 && shownReplies.length === 0 && !triageShown;

  return (
    <ReachableLinks hrefs={reachable}>
      <SearchBar search={search} shown={count} noun={NOUN} />
      <Elsewhere index={index} search={search} here="ai" shownHere={shownHere} tabs={tabs} />

      {flags === null ? (
        <Card title="AI features" titleAs="h2" {...(props.flagsProblem ? { problem: props.flagsProblem } : {})} onRetry={() => router.refresh()} />
      ) : shownFeatures.length > 0 ? (
        <Card
          title="AI features"
          titleAs="h2"
          className="app-SettingsSection"
          headerDivider
          footer={<p className="app-SettingsSection__footnote">Providers are only asked inside the AI regions your platform operator allowed for this workspace.</p>}
        >
          <div className="app-SettingsSection__rows">
            {shownFeatures.map((flag) => (
              <FlagRow
                key={flag.key}
                item={flag}
                canManage={canManageFlags}
                {...(flag.key !== AI_FLAG && !aiOn && flag.value ? { note: 'Paused: AI is off for this workspace.' } : {})}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {settings === null ? (
        <Card title="Replies" titleAs="h2" {...(props.settingsProblem ? { problem: props.settingsProblem } : {})} onRetry={() => router.refresh()} />
      ) : shownReplies.length > 0 ? (
        <Card title="Drafted replies" titleAs="h2" className="app-SettingsSection" headerDivider>
          <div className="app-SettingsSection__rows">
            {shownReplies.map((item) => (
              <SettingRow key={item.key} item={item} canManage={canManageSettings} />
            ))}
          </div>
        </Card>
      ) : null}

      {triageShown && triage ? (
        <Card
          title="Triage"
          titleAs="h2"
          className="app-SettingsSection"
          headerDivider
          actions={triage.href ? <Button size="sm" variant="secondary" href={triage.href} iconEnd="chevron-right">Open AI triage</Button> : undefined}
        >
          <div className="app-SettingsSection__rows">
            <div className="app-SettingRow app-TriageSummary" id={anchorId('setting', 'ai.decision.triage.mode')} tabIndex={-1}>
              <div className="app-SettingRow__text">
                <p className="app-SettingRow__label">
                  Mode <StatusPill size="sm" tone={triage.tone} label={triage.label} srPrefix="Triage mode" />
                </p>
                <p className="app-SettingRow__description">{triage.sentence}</p>
                <p className="app-SettingRow__note">The mode is chosen on AI triage, where the record it is judged on is shown beside it.</p>
              </div>
            </div>
            {shownThresholds.map((item) => (
              <SettingRow key={item.key} item={item} canManage={canManageSettings} />
            ))}
          </div>
        </Card>
      ) : null}

      {props.showBudget && !search.active ? (
        <section aria-label="Spending" className="app-SettingsBudget">
          <BudgetCard budget={props.budget} {...(props.budgetProblem ? { problem: props.budgetProblem } : {})} canEdit={props.canEditBudget} locale={props.locale} />
        </section>
      ) : null}

      {nothing && search.active && elsewhereMatches(index, search, 'ai', shownHere, tabs).length === 0 ? (
        <EmptyState
          size="sm"
          icon="search"
          title="No AI settings match"
          description="Try other words — a setting’s name, what it does, its value or its key."
          action={{ id: 'clear', label: 'Clear search', variant: 'secondary' }}
          onAction={() => {
            search.setQuery('');
            search.setChangedOnly(false);
          }}
        />
      ) : null}
      <SettingHistory items={aiSettings} canManage={canManageSettings} />
    </ReachableLinks>
  );
}
