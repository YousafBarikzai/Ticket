import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { crossAreaTicketHref } from '@itsm/contracts/areas';
import { Card, SegmentedControl } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { DecisionsView, type DecisionRowView } from '../../../../../components/ai-triage/DecisionsView.js';
import { decisionView, decisionsCsvFileName, decisionsWithin, rangeFrom } from '../../../../../components/ai-triage/decisions.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { currentAreas, pageAccess } from '../../../../../server/session.js';
import { modeViewOnly, rangeOptions, reachable, triageTabs } from '../data.js';
import '../../../../../components/ai-triage/ai-triage.css';
import '../../../../../components/integrations/integrations.css';

export const metadata: Metadata = { title: 'Decisions · AI triage' };
export const dynamic = 'force-dynamic';

/** The API's page: the newest this many decisions, with no cursor behind them. */
const PAGE = 100;

/**
 * AI triage › Decisions (SPEC §6.1; `ai.manage`, because a list of every
 * decision is a list of every triaged ticket). The newest decisions, within
 * the range, with the ticket each was about named by its number: the newest
 * 200 tickets are read once for their numbers and titles (triage decides new
 * tickets, so these are the ones decisions name); one older than that shows
 * as "A ticket" and still opens.
 */
export default async function DecisionsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/ai-triage/decisions');
  if (!access.allowed) return <Forbidden route="/ai-triage/decisions" />;
  const { me, api } = access;
  const days = rangeFrom((await searchParams).days);
  const viewOnly = modeViewOnly(me);
  const header = <PageHeader title="AI triage" tabs={triageTabs(me)} {...(viewOnly ? { viewOnly } : {})} />;
  const range = (
    <div className="app-TriageRange">
      <SegmentedControl label="Period" mode="nav" value={String(days)} options={rangeOptions('/ai-triage/decisions')} size="sm" />
    </div>
  );

  const [decisions, tickets, areas] = await Promise.all([
    read(() => api.observe.ai.decisions({ purpose: 'triage', limit: PAGE })),
    holds(me, 'ticket.read') ? read(() => api.observe.tickets({ limit: 200, sort: '-createdAt' })) : Promise.resolve(null),
    currentAreas(),
  ]);
  if (!decisions.ok) {
    return (
      <div className="app-Page app-Triage">
        {header}
        {range}
        <Card title="Decisions" problem={decisions.problem} />
      </div>
    );
  }

  const now = Date.now();
  const byId = new Map(tickets?.ok ? tickets.value.data.map((ticket) => [ticket.id, { number: ticket.number, title: ticket.title }] as const) : []);
  const teamOf = new Map(tickets?.ok ? tickets.value.data.map((ticket) => [ticket.id, ticket.groupId] as const) : []);
  const rows: DecisionRowView[] = decisionsWithin(decisions.value, days, now).map((row) => {
    const view = decisionView(row, byId);
    // The Service Desk when it is listed (in a demo, only for Alex's teams, X-B2); else the console's drawer.
    const href =
      crossAreaTicketHref(areas, { number: view.ticketNumber ?? view.ticketId, groupId: teamOf.get(view.ticketId) ?? null }) ??
      (view.ticketNumber ? reachable(me, `/tickets?open=ticket:${encodeURIComponent(view.ticketNumber)}`) : undefined);
    return { ...view, ...(href ? { ticketHref: href } : {}) };
  });

  return (
    <div className="app-Page app-Triage">
      {header}
      {range}
      <h2 className="itsm-visually-hidden">Decisions</h2>
      <DecisionsView
        rows={rows}
        days={days}
        // A full page whose oldest decision is still inside the range may have more behind it.
        capped={decisions.value.length >= PAGE && rows.length === decisions.value.length}
        fileName={decisionsCsvFileName({ workspace: me.tenant?.slug ?? null, days, now, timeZone: me.timeZone })}
      />
    </div>
  );
}
