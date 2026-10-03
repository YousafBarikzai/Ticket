import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { crossAreaHref } from '@itsm/contracts/areas';
import type { Ticket } from '@itsm/sdk';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { TicketsView, type NamedOption } from '../../../../components/tickets/TicketsView.js';
import {
  SCOPES,
  detailOf,
  drawerTicket,
  isFiltered,
  readTicketQuery,
  scopeHref,
  ticketFilter,
  ticketRow,
  type TicketDetail,
} from '../../../../components/tickets/presentation.js';
import { holds } from '../../../../permissions.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import { currentAreas, pageAccess } from '../../../../server/session.js';
import '../../../../components/tickets/tickets.css';

export const metadata: Metadata = { title: 'Tickets' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Tickets (SPEC §6.1, X-13): every ticket on the desk, across every team —
 * an administrator's question the Service Desk does not answer — read-only
 * and one click from the Service Desk, where tickets are worked.
 *
 * The query string is the state: `status` (the scope, Open by default; the
 * legacy `open|paused|resolved|closed` values unchanged), `q`, `priority`,
 * `type`, `assignee` (`none`, `me` or a person), `team`, `service`, `sort`,
 * and `open=ticket:<number>` for the drawer. Old links such as
 * `/tickets?status=open&assignee=none` land on exactly what they meant.
 *
 * Names, not ids: assignees are resolved in one call for the page, teams from
 * the directory (A6) and services from the catalogue when this person can
 * list them — each allowed to fail without taking the list with it.
 */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const access = await pageAccess('/tickets');
  if (!access.allowed) return <Forbidden route="/tickets" />;
  const { me, api } = access;

  const params = await searchParams;
  const query = readTicketQuery(params);
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string') search.set(name, value);
  }
  const drawerNumber = drawerTicket(params.open);

  const [page, teams, services, detail, areas] = await Promise.all([
    read(() => api.observe.tickets(ticketFilter(query))),
    read(() => api.tenant.teams()),
    holds(me, 'catalogue.manage') ? read(() => api.configure.catalogue.services()) : Promise.resolve(null),
    drawerNumber
      ? read(async () => {
          const [ticket, sla] = await Promise.all([
            api.observe.ticket(drawerNumber),
            api.observe.ticketSla(drawerNumber).then(
              (value) => value.timers,
              () => null,
            ),
          ]);
          return { ticket, sla };
        })
      : Promise.resolve(null),
    currentAreas(),
  ]);

  const tickets: readonly Ticket[] = page.ok ? page.value.data : [];
  const ids = [
    ...tickets.map((ticket) => ticket.assigneeId),
    ...(detail?.ok ? [detail.value.ticket.assigneeId, detail.value.ticket.requesterId] : []),
    query.assignee && query.assignee !== 'me' && query.assignee !== 'none' ? query.assignee : null,
  ];
  const people = await resolvePeople(api, ids);
  const nameOf = (id: string | null | undefined): string | null => (id ? (people.get(id)?.name ?? null) : null);

  const teamOptions: NamedOption[] | undefined = teams.ok ? teams.value.map((team) => ({ value: team.id, label: team.name })) : undefined;
  const teamName = new Map((teamOptions ?? []).map((team) => [team.value, team.label]));
  const serviceOptions: NamedOption[] | undefined = services?.ok ? services.value.map((service) => ({ value: service.id, label: service.name })) : undefined;
  const namesById = Object.fromEntries([...people.entries()].map(([id, ref]) => [id, ref.name]));

  let initialDetail: TicketDetail | undefined;
  if (detail?.ok) {
    const { ticket, sla } = detail.value;
    const involved = [ticket.assigneeId, ticket.requesterId].filter((id): id is string => !!id);
    initialDetail = detailOf(ticket, Object.fromEntries(involved.map((id) => [id, nameOf(id)])), sla);
  }

  // The Service Desk is where tickets are worked: listed only for people who work there, or in a demo (A2 §3.2).
  const inbox = crossAreaHref(areas, 'workbench', '/inbox');
  const assigneeOption =
    query.assignee && query.assignee !== 'me' && query.assignee !== 'none' ? { value: query.assignee, label: nameOf(query.assignee) ?? 'Unknown person' } : undefined;

  return (
    <div className="app-Page app-Tickets">
      <PageHeader
        title="Tickets"
        {...(page.ok && tickets.length === 0 && query.scope === 'all' && !isFiltered(query) ? { subtitle: 'Every ticket on the desk. Open one to work it in the Service Desk.' } : {})}
        {...(inbox ? { primaryAction: { id: 'workbench', label: 'Open Service Desk', href: inbox, variant: 'primary' as const, icon: 'inbox' as const } } : {})}
      />
      <TicketsView
        rows={tickets.map((ticket) => ticketRow(ticket, nameOf, (id) => (id ? (teamName.get(id) ?? null) : null)))}
        nextCursor={page.ok ? page.value.nextCursor : null}
        {...(page.ok ? {} : { problem: page.problem })}
        query={query}
        scopes={SCOPES.map((scope) => ({ value: scope.value, label: scope.label, href: scopeHref(search, scope.value) }))}
        {...(teamOptions ? { teams: teamOptions } : {})}
        {...(serviceOptions ? { services: serviceOptions } : {})}
        {...(assigneeOption ? { assigneeOption } : {})}
        people={namesById}
        areas={areas}
        {...(initialDetail ? { initialDetail } : {})}
        filtered={isFiltered(query)}
      />
    </div>
  );
}
