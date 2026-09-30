'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, Kbd, type Problem } from '@itsm/ui';
import { SplitView } from '@itsm/ui/shell';
import { useDeskSkipLinks } from '../components/DeskShell.js';
import { TicketWorkspace } from '../workspace/TicketWorkspace.js';
import type { PeopleMap } from './presentation.js';
import { ListHeader } from './ListHeader.js';
import type { ListRow } from './queries.js';
import { canChangeFromList } from './InboxBulkBar.js';
import { TicketList, type InboxPermissions, type ListCount, type OpenHow } from './TicketList.js';
import {
  INBOX_REGIONS,
  clearedHref,
  inboxHref,
  inboxViewFrom,
  type InboxParam,
  type SearchParams,
  type TeamSummary,
  type ViewRef,
} from './views.js';

export type { InboxPermissions } from './TicketList.js';

/**
 * The inbox (SPEC §6.2, D12, D16): the list pane and the ticket beside it.
 *
 * The URL is the state. Filters, sort and search are written with
 * `history.replaceState` and the ticket open beside the list with
 * `pushState` (`?t=INC-000123`), which the router folds into
 * `useSearchParams` without asking the server to render the page again: the
 * list refetches only its own data through `/api/desk/list`, and `j`/`k`
 * swaps the ticket instantly.
 *
 * Two panes from 768 px (the list resizable 300–520 px, remembered on this
 * device); below that the list alone, and opening a ticket goes to its page.
 */

export interface InboxPageProps {
  readonly viewRef: ViewRef;
  readonly me: { readonly id: string | null; readonly name: string };
  readonly can: InboxPermissions;
  /** The person's teams, for the Team filter. */
  readonly teams: readonly TeamSummary[];
  /** Every team's name by id, for the team on a row. */
  readonly teamNames: Readonly<Record<string, string>>;
  /** Names for the people the URL filters by. */
  readonly people: PeopleMap;
  readonly problem: Problem | null;
  readonly renderedAt: number;
}

/** The detail pane's id: `Enter` on a row moves focus here, and F6 lands here. */
export const DETAIL_PANE_ID = 'inbox-detail';

/** How long the keyboard must rest on a row before the ticket beside the list follows it (SPEC §5.6). */
export const FOLLOW_DELAY_MS = 120;

/** The query string as the page's `searchParams` holds it: the first value of each name wins. */
function recordOf(params: URLSearchParams): SearchParams {
  const record: Record<string, string> = {};
  for (const [key, value] of params) if (!(key in record)) record[key] = value;
  return record;
}

function isShowing(id: string): boolean {
  const element = document.getElementById(id);
  return element !== null && element.getClientRects().length > 0;
}

/**
 * Skip links to the conversation and the reply exist only while their
 * targets do: a skip link to nothing is worse than none.
 */
function useTargetsPresent(ids: readonly string[], active: boolean): boolean {
  const [present, setPresent] = useState(false);
  const key = ids.join(',');
  useEffect(() => {
    if (!active) {
      setPresent(false);
      return;
    }
    const check = (): void => setPresent(key.split(',').every((id) => document.getElementById(id) !== null));
    check();
    const pane = document.getElementById(DETAIL_PANE_ID);
    if (!pane || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(check);
    observer.observe(pane, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [key, active]);
  return present;
}

export function InboxPage({ viewRef, me, can, teams, teamNames, people, problem, renderedAt }: InboxPageProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useMemo(() => inboxViewFrom(viewRef, recordOf(searchParams)), [viewRef, searchParams]);
  const [count, setCount] = useState<ListCount | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const selectable = can.read && canChangeFromList(can);

  /* The URL: read back from the address bar at the moment of writing, so two changes in one event both land. */
  const hrefWith = useCallback(
    (change: Partial<Record<InboxParam, string>>): string => {
      const now = inboxViewFrom(viewRef, recordOf(new URLSearchParams(window.location.search)));
      return inboxHref(now, change);
    },
    [viewRef],
  );
  const replaceUrl = useCallback((href: string) => {
    if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
  }, []);
  const changeFilters = useCallback(
    (change: Partial<Record<InboxParam, string>>) => {
      replaceUrl(hrefWith(change));
      // A new list starts at its top.
      document.getElementById(INBOX_REGIONS.list)?.scrollTo?.({ top: 0 });
    },
    [hrefWith, replaceUrl],
  );

  /* The ticket beside the list. */
  const select = useCallback(
    (number: string, mode: 'push' | 'replace') => {
      const href = hrefWith({ t: number });
      if (href === `${window.location.pathname}${window.location.search}`) return;
      if (mode === 'push') window.history.pushState(null, '', href);
      else window.history.replaceState(null, '', href);
    },
    [hrefWith],
  );
  const paneVisible = useCallback(() => isShowing(DETAIL_PANE_ID), []);

  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (followTimer.current) clearTimeout(followTimer.current);
    },
    [],
  );
  const follow = useCallback(
    (row: ListRow) => {
      if (followTimer.current) clearTimeout(followTimer.current);
      if (!paneVisible()) return;
      followTimer.current = setTimeout(() => {
        followTimer.current = null;
        select(row.number, 'replace');
      }, FOLLOW_DELAY_MS);
    },
    [paneVisible, select],
  );

  const open = useCallback(
    (row: ListRow, how: OpenHow) => {
      const page = `/tickets/${encodeURIComponent(row.number)}`;
      if (how === 'newTab') {
        window.open(page, '_blank', 'noopener');
        return;
      }
      if (how === 'page' || !paneVisible()) {
        router.push(page);
        return;
      }
      if (followTimer.current) clearTimeout(followTimer.current);
      select(row.number, 'push');
      // Enter moves into the ticket; the list keeps its place for coming back (F6, Shift+F6).
      // A click leaves focus on the row, so j and k carry on from there.
      if (how === 'pane') requestAnimationFrame(() => document.getElementById(DETAIL_PANE_ID)?.focus());
    },
    [paneVisible, router, select],
  );

  /* Skip links: the list always; the conversation and the reply while a ticket is open beside it. */
  const ticketTargets = useTargetsPresent([INBOX_REGIONS.conversation, INBOX_REGIONS.reply], view.selected !== null);
  useDeskSkipLinks([
    { label: 'Skip to ticket list', targetId: INBOX_REGIONS.list },
    ...(ticketTargets
      ? [
          { label: 'Skip to conversation', targetId: INBOX_REGIONS.conversation },
          { label: 'Skip to reply', targetId: INBOX_REGIONS.reply },
        ]
      : []),
  ]);

  const listPane = (
    <div className="app-InboxList">
      <ListHeader
        view={view}
        count={count}
        teams={teams}
        people={people}
        me={me.id}
        can={can}
        onChange={changeFilters}
        selectable={selectable}
        selectMode={selectMode}
        onSelectModeChange={setSelectMode}
      />
      <TicketList
        view={view}
        me={me.id}
        meName={me.name}
        can={can}
        teamNames={teamNames}
        people={people}
        selected={view.selected}
        problem={problem}
        renderedAt={renderedAt}
        storageScope={me.id}
        selectMode={selectMode}
        onOpen={open}
        onFollow={follow}
        paneVisible={paneVisible}
        onCount={setCount}
        onClearFilters={() => replaceUrl(clearedHref(view))}
      />
    </div>
  );

  const detailPane = view.selected ? (
    <TicketWorkspace key={view.selected} ticketId={view.selected} mode="pane" />
  ) : count === null || count.shown === 0 ? (
    // Nothing to pick from: no hint about moving through a list that is empty.
    <div className="app-InboxEmpty" />
  ) : (
    <div className="app-InboxEmpty">
      <EmptyState
        size="md"
        icon="inbox"
        title="Select a ticket"
        description={
          <>
            Use <Kbd keys="j" /> and <Kbd keys="k" /> to move through the list, and <Kbd keys="Enter" /> to open one here.
          </>
        }
      />
    </div>
  );

  return (
    <div className="app-Inbox" data-selected={view.selected !== null || undefined}>
      <SplitView
        className="app-Inbox__split"
        persistKey="inbox"
        panes={[
          { id: INBOX_REGIONS.list, label: `Tickets, ${view.title}`, as: 'section', min: 300, max: 520, defaultSize: 360, children: listPane },
          { id: DETAIL_PANE_ID, label: view.selected ?? 'Ticket', as: 'article', min: 360, children: detailPane },
        ]}
      />
    </div>
  );
}
