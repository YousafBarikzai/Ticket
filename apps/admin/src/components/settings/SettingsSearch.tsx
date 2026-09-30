'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Button, Card, SearchField, StatusPill, useItsm } from '@itsm/ui';
import { TAB_LABELS, anchorId, hrefFor, matches, type SearchEntry, type SettingsTabId } from '../../settings/catalogue.js';
import type { SettingsSearchState } from './types.js';

/**
 * The search at the top of Settings (SPEC §6.1, MOD-13-E1-S1): one field that
 * filters settings and flags by label, key, value and description, a
 * "Changed from default" toggle, and — for matches on another tab — links
 * that jump straight to the row there.
 *
 * The words live in the URL (`?q=`, `?changed=1`) so a link can carry a
 * search (the Command centre sends `/settings?q=email`; the palette sends a
 * setting's key) and Back returns to it. Written with `replaceState`: typing
 * is not a history of places.
 */

export interface SettingsSearch {
  readonly query: string;
  readonly changedOnly: boolean;
  setQuery(query: string): void;
  setChangedOnly(on: boolean): void;
  /** Whether a search entry passes both filters. */
  test(entry: Pick<SearchEntry, 'label' | 'key' | 'description' | 'value' | 'section' | 'changed'>): boolean;
  readonly active: boolean;
}

function writeUrl(query: string, changedOnly: boolean): void {
  const url = new URL(window.location.href);
  if (query.trim() === '') url.searchParams.delete('q');
  else url.searchParams.set('q', query.trim());
  if (changedOnly) url.searchParams.set('changed', '1');
  else url.searchParams.delete('changed');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useSettingsSearch(initial: SettingsSearchState): SettingsSearch {
  const [query, setQueryState] = useState(initial.query);
  const [changedOnly, setChangedState] = useState(initial.changedOnly);

  // A new address for the same page (a jump link from another tab) brings its own words.
  const signature = `${initial.query}\u0000${String(initial.changedOnly)}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setQueryState(initial.query);
    setChangedState(initial.changedOnly);
  }

  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      writeUrl(next, changedOnly);
    },
    [changedOnly],
  );
  const setChangedOnly = useCallback(
    (on: boolean) => {
      setChangedState(on);
      writeUrl(query, on);
    },
    [query],
  );
  const test = useCallback(
    (entry: Pick<SearchEntry, 'label' | 'key' | 'description' | 'value' | 'section' | 'changed'>) =>
      (!changedOnly || entry.changed) && matches({ kind: 'setting', tab: 'general', ...entry }, query),
    [changedOnly, query],
  );
  return { query, changedOnly, setQuery, setChangedOnly, test, active: query.trim() !== '' || changedOnly };
}

/** "3 settings match" / "Nothing here matches" — said once the words settle. */
export function SearchBar({
  search,
  shown,
  noun,
  placeholder = 'Search settings, features and values',
}: {
  readonly search: SettingsSearch;
  /** How many rows on this tab pass the filters. */
  readonly shown: number;
  readonly noun: { readonly one: string; readonly other: string };
  readonly placeholder?: string;
}): ReactNode {
  const statusId = useId();
  const summary = !search.active ? '' : shown === 0 ? `No ${noun.other} on this tab match` : `${shown} ${shown === 1 ? noun.one : noun.other} ${shown === 1 ? 'matches' : 'match'}`;
  return (
    <div className="app-SettingsSearch" role="search" aria-label="Settings">
      <div className="app-SettingsSearch__field">
        <SearchField label="Search settings" labelHidden placeholder={placeholder} value={search.query} onValueChange={search.setQuery} shortcut="/" />
      </div>
      <Button
        variant={search.changedOnly ? 'tinted' : 'secondary'}
        size="sm"
        iconStart={search.changedOnly ? 'check' : 'list-filter'}
        aria-pressed={search.changedOnly}
        onClick={() => search.setChangedOnly(!search.changedOnly)}
      >
        Changed from default
      </Button>
      <p id={statusId} className="app-SettingsSearch__status" role="status">
        {summary}
      </p>
    </div>
  );
}

/**
 * Matches on the other tabs, as links that open the row there with the same
 * words. Nothing when there is no search, and never a tab the person cannot
 * open or a row this tab already shows.
 */
/** Matches on the other tabs this person may open, leaving out what this tab already lists. */
export function elsewhereMatches(
  index: readonly SearchEntry[],
  search: Pick<SettingsSearch, 'active' | 'test'>,
  here: SettingsTabId,
  shownHere: ReadonlySet<string>,
  tabs: readonly SettingsTabId[],
): SearchEntry[] {
  if (!search.active) return [];
  return index.filter((entry) => entry.tab !== here && tabs.includes(entry.tab) && !shownHere.has(entry.key) && search.test(entry));
}

export function Elsewhere({
  index,
  search,
  here,
  shownHere,
  tabs,
}: {
  readonly index: readonly SearchEntry[];
  readonly search: SettingsSearch;
  readonly here: SettingsTabId;
  /** Keys this tab lists, so a flag repeated on AI is not also offered as elsewhere. */
  readonly shownHere: ReadonlySet<string>;
  readonly tabs: readonly SettingsTabId[];
}): ReactNode {
  const found = elsewhereMatches(index, search, here, shownHere, tabs);
  const { Link } = useItsm();
  if (found.length === 0) return null;
  const shown = found.slice(0, 12);
  return (
    <Card title={found.length === 1 ? 'On another tab' : 'On other tabs'} titleAs="h2" className="app-SettingsElsewhere" headerDivider>
      <ul className="app-SettingsElsewhere__list">
        {shown.map((entry) => (
          <li key={`${entry.kind}:${entry.key}`} className="app-SettingsElsewhere__item">
            <Link href={hrefFor(entry, search.query, search.changedOnly)} className="app-SettingsElsewhere__link">
              {entry.label}
            </Link>
            <span className="app-SettingsElsewhere__meta">
              {entry.section === TAB_LABELS[entry.tab] ? TAB_LABELS[entry.tab] : `${TAB_LABELS[entry.tab]} · ${entry.section}`} · {entry.value}
            </span>
            {entry.changed ? <StatusPill size="sm" tone="neutral" label="Changed" /> : null}
          </li>
        ))}
      </ul>
      {found.length > shown.length ? <p className="app-SettingsElsewhere__more">{found.length - shown.length} more — add a word to narrow the search.</p> : null}
    </Card>
  );
}

/**
 * Takes a person to the row a link named (`#setting-ticket-autoClose-days`):
 * scrolls it to the middle, marks it for a moment and puts focus on its
 * control, so "jump to it" ends where the person can act.
 */
export function useJumpToRow(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const jump = (): void => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const row = document.getElementById(id);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.setAttribute('data-jumped', '');
      const control = row.querySelector<HTMLElement>('[data-row-control] :is(button, input, select, textarea, a[href]):not([disabled])');
      (control ?? row).focus({ preventScroll: true });
      clearTimeout(timer);
      timer = setTimeout(() => row.removeAttribute('data-jumped'), 2400);
    };
    // After the first paint, so the rows exist.
    const frame = requestAnimationFrame(jump);
    window.addEventListener('hashchange', jump);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('hashchange', jump);
    };
  }, []);
}

export { anchorId };
