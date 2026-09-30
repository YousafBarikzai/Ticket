'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Icon, RelativeTime, useNow, type EmptySpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useLoadMore } from '../../client/useLoadMore.js';
import { TicketDetailView, type TicketDetail } from './TicketDetail.js';
import {
  PRIORITY_LOOK,
  SCOPES,
  TYPE_ICONS,
  statusLook,
  ticketFilter,
  ticketRow,
  type Scope,
  type TicketQuery,
  type TicketRowView,
} from './presentation.js';
import { TICKET_TYPES } from '../../rules/facts.js';

/** A choice the server worked out: a team or a service by name. */
export interface NamedOption {
  readonly value: string;
  readonly label: string;
}

export interface TicketsViewProps {
  readonly rows: readonly TicketRowView[];
  readonly nextCursor: string | null;
  readonly problem?: Problem;
  readonly query: TicketQuery;
  /** The scope links, worked out on the server with the rest of the query kept. */
  readonly scopes: readonly { readonly value: Scope; readonly label: string; readonly href: string }[];
  /** Teams by name (A6); absent when the directory would not list them, and the Team filter and column are hidden. */
  readonly teams?: readonly NamedOption[];
  /** Services by name; absent when this person cannot list them. */
  readonly services?: readonly NamedOption[];
  /** The person the URL's `assignee` names, so its chip reads a name. */
  readonly assigneeOption?: NamedOption;
  /** Names the server already resolved, by person id, so appended pages rarely ask again. */
  readonly people: Readonly<Record<string, string | null>>;
  readonly workbenchOrigin?: string;
  /** The drawer's ticket on a hard load of `?open=ticket:<number>`. */
  readonly initialDetail?: TicketDetail;
  readonly filtered: boolean;
}

const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1 · Critical', tone: 'danger' as const },
  { value: 'P2', label: 'P2 · High', tone: 'warning' as const },
  { value: 'P3', label: 'P3 · Medium', tone: 'info' as const },
  { value: 'P4', label: 'P4 · Low', tone: 'neutral' as const },
];

/**
 * Tickets (SPEC §6.1, X-13): a tenant-wide, read-only finder that hands off
 * to the workbench. Search, scope and filters live in the URL and are asked
 * of the API (D12); the table appends fifty at a time (D13); a row opens a
 * summary drawer (`?open=ticket:<number>`) whose one action is *Open in
 * Workbench*. Nothing here writes — changing a ticket belongs where its
 * conversation and clocks are.
 */
export function TicketsView(props: TicketsViewProps): ReactNode {
  const { query, teams, services, workbenchOrigin, filtered } = props;
  const drawer = useDrawer('ticket');
  // Names learnt while appending pages, beside the server's.
  const known = useRef(new Map<string, string | null>(Object.entries(props.people)));
  const teamNames = useMemo(() => new Map((teams ?? []).map((team) => [team.value, team.label])), [teams]);

  const loadPage = useCallback(
    async (cursor: string) => {
      const page = await api.observe.tickets({ ...ticketFilter(query), cursor });
      const unknown = [...new Set(page.data.map((ticket: Ticket) => ticket.assigneeId).filter((id): id is string => !!id && !known.current.has(id)))];
      if (unknown.length > 0) {
        try {
          const found = await api.tenant.users({ ids: unknown, limit: Math.min(200, unknown.length) });
          for (const person of found) known.current.set(person.id, person.displayName || person.email);
        } catch {
          // Names are a courtesy: a row still reads "Unknown person" with its ticket intact.
        }
        for (const id of unknown) if (!known.current.has(id)) known.current.set(id, null);
      }
      return {
        data: page.data.map((ticket: Ticket) =>
          ticketRow(
            ticket,
            (id) => (id ? (known.current.get(id) ?? null) : null),
            (id) => (id ? (teamNames.get(id) ?? null) : null),
          ),
        ),
        nextCursor: page.nextCursor,
      };
    },
    [query, teamNames],
  );

  const list = useLoadMore<TicketRowView>({ rows: props.rows, nextCursor: props.nextCursor, load: loadPage, keyOf: (row) => row.id });
  const open = drawer.key ? list.rows.find((row) => row.number === drawer.key) : undefined;

  const statusMap = useMemo(() => {
    const map: Record<string, { label: string; tone: 'info' | 'neutral' | 'success'; icon: 'dot' | 'pause' | 'circle-check' | 'archive' }> = {};
    for (const row of list.rows) {
      if (!map[row.status]) map[row.status] = statusLook(row.status, row.statusCategory) as (typeof map)[string];
    }
    return map;
  }, [list.rows]);

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'number', header: 'Number', field: 'number', kind: 'mono', width: 128, cardRole: 'subtitle' },
      { id: 'title', header: 'Title', field: 'title', kind: 'title', truncate: 2, width: '3fr', minWidth: 220 },
      { id: 'priority', header: 'Priority', field: 'priority', kind: 'status', map: PRIORITY_LOOK, srPrefix: 'Priority', width: 96, cardRole: 'badge' },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: statusMap, srPrefix: 'Status', width: '1fr', cardRole: 'meta' },
      { id: 'assignee', header: 'Assignee', field: 'assignee', kind: 'person', empty: 'Unassigned', width: '1fr', hideBelow: 'sm' },
      ...(teams ? [{ id: 'team', header: 'Team', field: 'teamName', kind: 'text' as const, hideBelow: 'lg' as const, width: '1fr' as const }] : []),
      { id: 'channel', header: 'Channel', field: 'channel', kind: 'channel', hideBelow: 'xl', width: 128 },
      { id: 'raised', header: 'Raised', field: 'createdAt', kind: 'relative', sortable: 'server', sortField: 'createdAt', width: 120, cardRole: 'meta' },
      { id: 'due', header: 'Due', field: 'dueAt', kind: 'relative', sortable: 'server', sortField: 'dueAt', hideBelow: 'md', width: 140, empty: '—' },
    ],
    [statusMap, teams],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      { id: 'priority', label: 'Priority', type: 'multiselect', mode: 'server', pinned: true, options: PRIORITY_OPTIONS },
      {
        id: 'type',
        label: 'Type',
        type: 'multiselect',
        mode: 'server',
        pinned: true,
        options: TICKET_TYPES.map((type) => ({ value: type.value, label: type.label, icon: TYPE_ICONS[type.value] ?? 'ticket' })),
      },
      {
        id: 'assignee',
        label: 'Assignee',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: [
          { value: 'none', label: 'Unassigned' },
          { value: 'me', label: 'Me' },
          ...(props.assigneeOption ? [props.assigneeOption] : []),
        ],
      },
      ...(teams && teams.length > 0 ? [{ id: 'team', label: 'Team', type: 'select' as const, mode: 'server' as const, options: teams }] : []),
      ...(services && services.length > 0 ? [{ id: 'service', label: 'Service', type: 'select' as const, mode: 'server' as const, options: services }] : []),
    ],
    [props.assigneeOption, services, teams],
  );

  const scopeLabel = SCOPES.find((entry) => entry.value === query.scope)?.label.toLowerCase() ?? 'open';
  const empty: EmptySpec =
    query.scope === 'all'
      ? { title: 'No tickets yet', description: 'Tickets appear here as requesters raise them.', icon: 'ticket' }
      : { title: `No ${scopeLabel} tickets`, description: query.scope === 'open' ? 'Nothing is waiting on this desk right now.' : 'Try another scope, or All.', icon: 'ticket' };

  return (
    <>
      <DataTable<TicketRowView>
        caption="Tickets"
        captionHidden
        columns={columns}
        rows={list.rows}
        rowKey="id"
        urlKey=""
        sort={{ columnId: 'raised', direction: 'descending' }}
        search={{ placeholder: 'Search tickets', mode: 'server', param: 'q', shortcut: '/' }}
        filters={filters}
        scope={{ label: 'Status', value: query.scope, options: props.scopes }}
        viewMenu={{ sort: true, density: true, columns: true }}
        pagination={{ mode: 'loadMore', ...list.pagination }}
        dataComplete={!list.hasMore}
        activate={{ kind: 'drawer', openKind: 'ticket', keyField: 'number' }}
        onActivate={(row) => drawer.open(row.number)}
        {...(drawer.key && open ? { currentKeys: [open.id] } : {})}
        countNoun={{ one: 'ticket', other: 'tickets' }}
        cells={{
          title: (row) => (
            <span className="app-TicketTitle">
              <Icon name={TYPE_ICONS[row.type] ?? 'ticket'} size="sm" className="app-TicketTitle__icon" />
              <span className="itsm-visually-hidden">{row.typeLabel}: </span>
              <span className="app-TicketTitle__text">{row.title}</span>
            </span>
          ),
          number: (row) => <code className="app-TicketNumber">{row.number}</code>,
          due: (row) => <DueCell dueAt={row.dueAt} category={row.statusCategory} />,
        }}
        empty={empty}
        noResults={{ title: 'No tickets match these filters', description: filtered ? 'Clear a filter, or search for something else.' : 'Try another search.' }}
        {...(props.problem ? { problem: props.problem } : {})}
        {...(list.problem ? { problem: list.problem, onRetry: () => void list.loadMore() } : {})}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.title ?? props.initialDetail?.ticket.title ?? drawer.key ?? 'Ticket'}
        description={open ? `${open.number} · ${open.typeLabel}` : drawer.key ?? undefined}
      >
        {drawer.key ? (
          <TicketDetailView
            key={drawer.key}
            number={drawer.key}
            row={open}
            {...(props.initialDetail && props.initialDetail.ticket.number === drawer.key ? { initial: props.initialDetail } : {})}
            teamNames={teamNames}
            serviceNames={new Map((services ?? []).map((service) => [service.value, service.label]))}
            known={known.current}
            {...(workbenchOrigin ? { workbenchOrigin } : {})}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/** Due, relative — and "Overdue" in words (not colour alone) once it has passed on a ticket still being worked. */
function DueCell({ dueAt, category }: { readonly dueAt: string | null; readonly category: string }): ReactNode {
  if (!dueAt) {
    return (
      <span className="itsm-DataTable__empty">
        <span aria-hidden="true">—</span>
        <span className="itsm-visually-hidden">No due date</span>
      </span>
    );
  }
  // The shared clock: null on the server and the first client render, so the
  // two agree, then ticking — a row turns overdue while the page is open.
  const now = useNow();
  const worked = category !== 'resolved' && category !== 'closed';
  const overdue = worked && now !== null && new Date(dueAt).getTime() < now;
  return (
    <span className="app-TicketDue" data-overdue={overdue ? '' : undefined}>
      {overdue ? (
        <>
          <Icon name="circle-alert" size="xs" />
          <span>Overdue ·</span>{' '}
        </>
      ) : null}
      <RelativeTime date={dueAt} />
    </span>
  );
}
