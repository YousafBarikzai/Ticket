'use client';

import { useMemo, type ReactNode } from 'react';
import { Card, EmptyState } from '@itsm/ui';
import { GENERAL_GROUPS, type SearchEntry, type SettingsTabId } from '../../settings/catalogue.js';
import { SettingHistory } from './SettingHistory.js';
import { SettingRow } from './SettingRow.js';
import { Elsewhere, SearchBar, elsewhereMatches, useJumpToRow, useSettingsSearch } from './SettingsSearch.js';
import { ReachableLinks } from './links.js';
import type { SettingItem, SettingsSearchState } from './types.js';

/**
 * Settings › General (SPEC §6.1): the search first, then the desk's settings
 * in sections — Tickets, Approvals, Knowledge, Notifications, Sign-in &
 * sessions, Email & chat, Assets & contracts, Change, Incidents, Problems,
 * Rules, Workflows, Workload — each row only its label, what it does and its
 * control. A search narrows the sections to the rows that match and lists
 * matches on the other tabs above them.
 */
export interface GeneralViewProps {
  readonly items: readonly SettingItem[];
  readonly index: readonly SearchEntry[];
  readonly initial: SettingsSearchState;
  readonly tabs: readonly SettingsTabId[];
  readonly canManage: boolean;
  readonly reachable: readonly string[];
}

const NOUN = { one: 'setting', other: 'settings' };

export function GeneralView({ items, index, initial, tabs, canManage, reachable }: GeneralViewProps): ReactNode {
  const search = useSettingsSearch(initial);
  useJumpToRow();
  const entries = useMemo(() => new Map(index.filter((entry) => entry.kind === 'setting').map((entry) => [entry.key, entry])), [index]);
  const shownHere = useMemo(() => new Set(items.map((item) => item.key)), [items]);
  const visible = items.filter((item) => {
    const entry = entries.get(item.key);
    return entry ? search.test(entry) : !search.active;
  });
  const sections = GENERAL_GROUPS.map((group) => ({ ...group, rows: visible.filter((item) => item.group === group.id) })).filter((group) => group.rows.length > 0);

  const onlyChanged = search.changedOnly && search.query.trim() === '';
  // Nothing on this tab: say why — unless the matches are on another tab, which the card above lists.
  const empty = !search.active ? (
    <EmptyState size="sm" icon="settings" title="No settings to show" description="This desk’s modules declare no settings of their own." />
  ) : elsewhereMatches(index, search, 'general', shownHere, tabs).length > 0 ? null : (
    <EmptyState
      size="sm"
      icon="search"
      title={onlyChanged ? 'Nothing here has been changed' : 'No settings here match'}
      description={onlyChanged ? 'Every setting on General is at its default.' : 'Try other words — a setting’s name, what it does, its value or its key.'}
      action={{ id: 'clear', label: 'Clear search', variant: 'secondary' }}
      onAction={() => {
        search.setQuery('');
        search.setChangedOnly(false);
      }}
    />
  );

  return (
    <ReachableLinks hrefs={reachable}>
      <SearchBar search={search} shown={visible.length} noun={NOUN} />
      <Elsewhere index={index} search={search} here="general" shownHere={shownHere} tabs={tabs} />
      {sections.length === 0 ? (
        empty
      ) : (
        sections.map((section) => (
          <Card key={section.id} title={section.title} titleAs="h2" className="app-SettingsSection" headerDivider>
            <div className="app-SettingsSection__rows">
              {section.rows.map((item) => (
                <SettingRow key={item.key} item={item} canManage={canManage} />
              ))}
            </div>
          </Card>
        ))
      )}
      <SettingHistory items={items} canManage={canManage} />
    </ReachableLinks>
  );
}
