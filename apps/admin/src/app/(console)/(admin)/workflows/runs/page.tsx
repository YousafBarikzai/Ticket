import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { RunsView } from '../../../../../components/workflows/RunsView.js';
import { RUN_SCOPES, runScope } from '../../../../../components/workflows/presentation.js';
import type { RunScope } from '../../../../../components/workflows/types.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { workbenchOrigin } from '../../rules/data.js';
import { graphsFrom, loadDetails, loadRuleNames, loadTicketNumbers, runView, workflowAbilities, workflowIndex, workflowTabs } from '../data.js';
import '../../../../../components/workflows/workflows.css';

export const metadata: Metadata = { title: 'Runs · Workflows' };
export const dynamic = 'force-dynamic';

const FIRST_PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = Record<string, string | string[] | undefined>;

function scopeHref(search: Search, scope: RunScope): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (name === 'status' || name === 'open' || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(name, entry);
  }
  if (scope !== 'all') params.set('status', scope);
  const query = params.toString();
  return query ? `/workflows/runs?${query}` : '/workflows/runs';
}

/**
 * Workflows › Runs (SPEC §6.1): runs by state, filtered by ticket number on
 * the server (the number is looked up and the API asked by the ticket's id)
 * and by workflow in the browser. Each run names its workflow and its current
 * step; the graphs that name them are read once for all the runs shown.
 */
export default async function RunsPage({ searchParams }: { readonly searchParams: Promise<Search> }): Promise<ReactNode> {
  const access = await pageAccess('/workflows/runs');
  if (!access.allowed) return <Forbidden route="/workflows/runs" />;
  const { me, api } = access;
  const search = await searchParams;
  const can = workflowAbilities(me, 'Workflows');
  const tabs = workflowTabs(me);
  const scope = runScope(typeof search.status === 'string' ? search.status : undefined);

  // The ticket filter takes a number (INC-000123) or an id; a number is looked up.
  const ticketText = typeof search.ticket === 'string' ? search.ticket.trim() : '';
  let ticketId: string | undefined;
  let unknownTicket: string | undefined;
  if (ticketText !== '') {
    if (UUID.test(ticketText)) ticketId = ticketText;
    else if (can.canReadTickets) {
      const ticket = await read(() => api.observe.ticket(ticketText));
      if (ticket.ok) ticketId = ticket.value.id;
      else unknownTicket = ticketText;
    } else unknownTicket = ticketText;
  }

  const query = { ...(scope !== 'all' ? { status: scope } : {}), ...(ticketId ? { ticketId } : {}) };
  const [list, runs, ruleNames, ticketNumbers] = await Promise.all([
    read(() => api.configure.workflows.list()),
    unknownTicket ? Promise.resolve(null) : read(() => api.configure.workflows.runs({ ...query, limit: FIRST_PAGE })),
    loadRuleNames(api, me),
    loadTicketNumbers(api, can.canReadTickets),
  ]);
  if (runs && !runs.ok) {
    return (
      <div className="app-Page app-Runs">
        <PageHeader title="Workflows" tabs={tabs} {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})} />
        <Card title="Runs" problem={runs.problem} />
      </div>
    );
  }

  const rows = list.ok ? list.value : [];
  const workflows = workflowIndex(rows);
  const involved = new Set((runs?.value ?? []).map((run) => run.definitionId));
  const graphs = graphsFrom(await loadDetails(api, rows.filter((row) => involved.has(row.id))));
  const origin = workbenchOrigin(me);

  return (
    <RunsView
      runs={(runs?.value ?? []).map((run) => runView(run, workflows, graphs))}
      limit={FIRST_PAGE}
      scope={scope}
      scopeHrefs={Object.fromEntries(RUN_SCOPES.map((entry) => [entry.value, scopeHref(search, entry.value)])) as Record<RunScope, string>}
      query={query}
      {...(unknownTicket ? { unknownTicket } : {})}
      workflows={workflows}
      graphs={graphs}
      ruleNames={ruleNames}
      canOperate={can.canOperate}
      canReadTickets={can.canReadTickets}
      ticketNumbers={ticketNumbers}
      tabs={tabs}
      renderedAt={new Date().toISOString()}
      {...(origin ? { workbenchOrigin: origin } : {})}
      {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})}
    />
  );
}
