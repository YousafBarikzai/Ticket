import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { ApiError, type Me } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { InboxPage, type InboxPermissions } from '../../../../inbox/InboxPage.js';
import { problemOf, type PeopleMap } from '../../../../inbox/presentation.js';
import { listKey, peopleIdsOf, seedPages, toListRow, type ListPage } from '../../../../inbox/queries.js';
import { inboxViewFrom, isUuid, type InboxView, type SearchParams, type TeamSummary, type ViewRef } from '../../../../inbox/views.js';
import { resolvePeople } from '../../../../server/people.js';
import { apiFor, currentMe, currentTeams, heldPermissions, loginHref, requireSession } from '../../../../server/session.js';
import './inbox.css';

/**
 * The inbox, server side (SPEC §6.2, D16): both routes — a view and a team —
 * render this.
 *
 * It reads the URL once (`inboxViewFrom`, every sanitising rule), asks the
 * API for the view's first page and seeds the client's query cache with it,
 * so the list paints with real rows and the client takes over from there:
 * filters, paging, `j`/`k` and live refreshes all happen in the browser
 * without another server render. Plain data crosses to the client — the
 * view's reference, the person, permission booleans, team and people names —
 * and nothing that is a function.
 *
 * A failure is handed over as a `Problem` rather than thrown, so the list
 * pane can show it in place (with the frame, the filters and Retry still
 * there); a suspended workspace and an ended session are the frame's.
 */

function permissionsOf(me: Me): InboxPermissions {
  const held = heldPermissions(me);
  return {
    read: held.has('ticket.read'),
    assign: held.has('ticket.assign'),
    transition: held.has('ticket.transition'),
    update: held.has('ticket.update'),
    readPeople: held.has('identity.user.read'),
  };
}

/** The first page, as the list handler would answer it — without the URL's cursor, which belonged to another list. */
async function firstPage(view: InboxView): Promise<ListPage> {
  const session = await requireSession();
  const { cursor: _cursor, ...filter } = view.filter;
  const page = await apiFor(session).tickets(filter);
  const rows = page.data.map(toListRow);
  return { rows, nextCursor: page.nextCursor, people: await resolvePeople(peopleIdsOf(rows)) };
}

export async function InboxRoute({ viewRef, params }: { readonly viewRef: ViewRef; readonly params: SearchParams }): Promise<ReactNode> {
  const [me, tenantTeams] = await Promise.all([currentMe(), currentTeams()]);
  const can = permissionsOf(me);
  const view = inboxViewFrom(viewRef, params);

  // Names for people the URL filters by ("Requester: Ada"), fetched beside the list.
  const filterPeople = [view.filters.requester, isUuid(view.filters.assignee) ? view.filters.assignee : ''].filter(Boolean);
  const [listResult, knownPeople] = await Promise.all([
    can.read ? firstPage(view).then((page) => ({ page }), (error: unknown) => ({ error })) : Promise.resolve({ error: null }),
    filterPeople.length > 0 ? resolvePeople(filterPeople) : Promise.resolve<PeopleMap>({}),
  ]);

  let problem: Problem | null = null;
  const queryClient = new QueryClient();
  if ('page' in listResult) {
    queryClient.setQueryData(listKey(view), seedPages(listResult.page));
  } else if (listResult.error instanceof ApiError && listResult.error.status === 401) {
    redirect(await loginHref());
  } else {
    problem = listResult.error === null ? { status: 403 } : problemOf(listResult.error);
  }

  const allTeams: TeamSummary[] = (tenantTeams ?? []).map((team) => ({ id: team.id.toLowerCase(), name: team.name }));
  const names = new Map(allTeams.map((team) => [team.id, team.name]));
  const myTeams = me.teamIds
    .map((id) => ({ id: id.toLowerCase(), name: names.get(id.toLowerCase()) }))
    .filter((team): team is TeamSummary => typeof team.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name, me.locale));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InboxPage
        viewRef={viewRef}
        me={{ id: me.actor.id?.toLowerCase() ?? null, name: me.actor.displayName ?? 'You' }}
        can={can}
        teams={myTeams}
        teamNames={Object.fromEntries(names)}
        people={knownPeople}
        problem={problem}
        renderedAt={Date.now()}
      />
    </HydrationBoundary>
  );
}
