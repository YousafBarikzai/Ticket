'use client';

import { useMemo, type ReactNode } from 'react';
import { Card, EmptyState, type Problem } from '@itsm/ui';
import { useRouter } from 'next/navigation';
import { FLAG_GROUPS, type SearchEntry, type SettingsTabId } from '../../settings/catalogue.js';
import { FlagRow } from './FlagRow.js';
import { Elsewhere, SearchBar, elsewhereMatches, useJumpToRow, useSettingsSearch } from './SettingsSearch.js';
import { ReachableLinks } from './links.js';
import type { FlagItem, SettingsSearchState } from './types.js';

/**
 * Settings › Features (SPEC §6.1): every feature flag, grouped by what it
 * belongs to, each with its title, what it does, its owner, whether it is
 * temporary, its default and a switch showing what this desk actually gets.
 */
export interface FeaturesViewProps {
  readonly flags: readonly FlagItem[] | null;
  readonly problem?: Problem;
  readonly index: readonly SearchEntry[];
  readonly initial: SettingsSearchState;
  readonly tabs: readonly SettingsTabId[];
  readonly canManage: boolean;
  readonly reachable: readonly string[];
}

const NOUN = { one: 'feature', other: 'features' };

export function FeaturesView({ flags, problem, index, initial, tabs, canManage, reachable }: FeaturesViewProps): ReactNode {
  const router = useRouter();
  const search = useSettingsSearch(initial);
  useJumpToRow();
  const entries = useMemo(() => new Map(index.filter((entry) => entry.kind === 'flag').map((entry) => [entry.key, entry])), [index]);
  const rows = flags ?? [];
  const shownHere = useMemo(() => new Set(rows.map((flag) => flag.key)), [rows]);
  const visible = rows.filter((flag) => {
    const entry = entries.get(flag.key);
    return entry ? search.test(entry) : !search.active;
  });
  const groups = FLAG_GROUPS.map((group) => ({ ...group, rows: visible.filter((flag) => flag.group === group.id) })).filter((group) => group.rows.length > 0);

  if (!flags) {
    return <Card title="Features" titleAs="h2" {...(problem ? { problem } : {})} onRetry={() => router.refresh()} />;
  }

  const onlyChanged = search.changedOnly && search.query.trim() === '';
  // Nothing on this tab: say why — unless the matches are on another tab, which the card above lists.
  const empty = !search.active ? (
    <EmptyState size="sm" icon="flag" title="No features to switch" description="Nothing on this desk is behind a feature switch." />
  ) : elsewhereMatches(index, search, 'features', shownHere, tabs).length > 0 ? null : (
    <EmptyState
      size="sm"
      icon="search"
      title={onlyChanged ? 'Nothing here has been changed' : 'No features here match'}
      description={onlyChanged ? 'No switch here differs from what the product ships with.' : 'Try other words — a feature’s name, what it does or its key.'}
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
      <Elsewhere index={index} search={search} here="features" shownHere={shownHere} tabs={tabs} />
      {groups.length === 0 ? (
        empty
      ) : (
        groups.map((group) => (
          <Card key={group.id} title={group.title} titleAs="h2" className="app-SettingsSection" headerDivider>
            <div className="app-SettingsSection__rows">
              {group.rows.map((flag) => (
                <FlagRow key={flag.key} item={flag} canManage={canManage} />
              ))}
            </div>
          </Card>
        ))
      )}
    </ReachableLinks>
  );
}
