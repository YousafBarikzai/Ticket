import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, Metric, MetricGrid } from '@itsm/ui';
import { currentActor } from '../../server/session.js';
import { read } from '../../server/read.js';
import { holds } from '../../permissions.js';

export const metadata: Metadata = { title: 'Command centre' };
export const dynamic = 'force-dynamic';

/**
 * What this desk is, and what an administrator can reach.
 *
 * Four numbers, and then the way in to everything else. The four are chosen
 * against the brief's warning about decorative dashboard cards: each one is a
 * thing that is *wrong right now* and that somebody can act on, each opens the
 * screen where it is acted on, and a desk in good order shows four zeros.
 * Cycle time and ticket volume are not here — they are reporting, they belong
 * under Insights, and a number nobody can act on this morning is decoration
 * however real it is.
 *
 * Everything else on the page is the way in: which tenant is being configured
 * — because the console for the wrong tenant looks exactly like the console
 * for the right one — and what this account may change, so a missing section
 * is explained rather than merely absent.
 *
 * Every count fails softly and on its own. A desk whose workflow module is
 * unavailable must still be able to reach the eleven sections below it.
 *
 * Every section in the navigation appears here, plus the two that do not have
 * their own navigation entry: the people on the desk and the shape of a
 * ticket. A screen reachable only by typing its URL is a screen nobody uses.
 */

interface Section {
  readonly href: string;
  readonly title: string;
  readonly description: string;
  /** Any one of these opens it. The first is what the "not available" note names. */
  readonly permissions: readonly string[];
}

const SECTIONS: readonly Section[] = [
  {
    href: '/queues',
    title: 'Queues',
    description: 'Who is available, the shifts they work, who is on call, and what routing can ask for.',
    permissions: ['workload.read', 'workload.manage'],
  },
  {
    href: '/tickets',
    title: 'Tickets',
    description: 'Everything raised on this desk, across every team — the shape of the workload, not a queue to work.',
    permissions: ['ticket.read'],
  },
  {
    href: '/cmdb',
    title: 'Services and CMDB',
    description: 'The configuration items and assets a ticket can point at, and the classes they belong to.',
    permissions: ['cmdb.read', 'cmdb.manage', 'asset.read', 'asset.manage'],
  },
  {
    href: '/automation',
    title: 'Automation',
    description: 'Rules that react to one thing, and workflows that run several steps and can wait.',
    permissions: ['rules.rule.manage', 'rules.rule.read', 'workflow.manage', 'workflow.read'],
  },
  {
    href: '/sla',
    title: 'SLA management',
    description: 'Service level targets, business calendars, and the grid that decides a priority.',
    permissions: ['sla.policy.manage', 'sla.policy.read'],
  },
  {
    href: '/insights',
    title: 'Insights',
    description: 'What this desk measures, where those numbers are shown, and what goes out on a schedule.',
    permissions: ['analytics.read', 'analytics.manage'],
  },
  {
    href: '/integrations',
    title: 'Integrations',
    description: 'Outbound actions, the credentials behind them, and the queue of calls that failed.',
    permissions: ['integration.action.read', 'integration.action.manage', 'integration.credential.read'],
  },
  {
    href: '/catalogue',
    title: 'What people can ask for',
    description: 'Services and request types, and whether each is on the portal yet.',
    permissions: ['catalogue.manage'],
  },
  {
    href: '/fields',
    title: 'The shape of a ticket',
    description: 'The custom fields a ticket carries, who may see each one, and when it is required.',
    permissions: ['ticket.config.manage'],
  },
  {
    href: '/settings',
    title: 'Configuration',
    description: 'Feature flags, the AI budget, and what this desk is allowed to use.',
    permissions: ['admin.setting.manage', 'admin.setting.read'],
  },
  {
    href: '/people',
    title: 'People',
    description: 'Who is on this desk, and what the platform holds for each of them.',
    permissions: ['identity.user.read', 'identity.user.manage'],
  },
  {
    href: '/security',
    title: 'Security',
    description: 'What the audit pipeline has flagged, and the full vocabulary a role can be built from.',
    permissions: ['security.alert.read', 'identity.role.manage', 'identity.user.read'],
  },
  {
    href: '/audit',
    title: 'Audit',
    description: 'Every change recorded on this desk, in the order it happened.',
    permissions: ['audit.read'],
  },
];

export default async function CommandCentrePage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  // Counted, not estimated: the list routes answer with rows rather than a
  // total, so the ceiling is the page size and anything at it is shown as
  // "200+" rather than as a number that is quietly wrong.
  const [open, unassigned, failedRuns, failedCalls] = await Promise.all([
    holds(me, 'ticket.read') ? read(() => api.observe.tickets({ statusCategory: 'open', limit: 200 })) : null,
    holds(me, 'ticket.read')
      ? read(() => api.observe.tickets({ statusCategory: 'open', assignee: 'none', limit: 200 }))
      : null,
    holds(me, 'workflow.manage') || holds(me, 'workflow.read')
      ? read(() => api.configure.workflows.runs({ status: 'failed', limit: 200 }))
      : null,
    holds(me, 'integration.action.read') || holds(me, 'integration.action.manage')
      ? read(() => api.observe.integrations.errorQueue('open'))
      : null,
  ]);

  type Counted = { readonly value: string; readonly count: number | null };

  const countOf = (result: { ok: true; value: { data: unknown[]; nextCursor: string | null } } | { ok: false } | null): Counted =>
    result === null || !result.ok
      ? { value: '—', count: null }
      : { value: `${result.value.data.length}${result.value.nextCursor ? '+' : ''}`, count: result.value.data.length };
  const lengthOf = (result: { ok: true; value: unknown[] } | { ok: false } | null): Counted =>
    result === null || !result.ok ? { value: '—', count: null } : { value: String(result.value.length), count: result.value.length };

  /*
   * A count that could not be loaded is neutral and says so. Colouring an
   * unknown green is the worst of the three outcomes: it is the one that reads
   * as "all clear" to somebody scanning the row, which is the only way this
   * page is ever read.
   */
  const say = (counted: Counted, wrong: string, right: string): { note: string; tone: 'neutral' | 'good' | 'bad' } =>
    counted.count === null
      ? { note: 'This could not be loaded just now.', tone: 'neutral' }
      : counted.count > 0
        ? { note: wrong, tone: 'bad' }
        : { note: right, tone: 'good' };

  const openTickets = countOf(open);
  const unassignedTickets = countOf(unassigned);
  const runs = lengthOf(failedRuns);
  const calls = lengthOf(failedCalls);

  const shown = [open, unassigned, failedRuns, failedCalls].some((result) => result !== null);

  const may = (section: Section): boolean => section.permissions.some((permission) => holds(me, permission));
  const reachable = SECTIONS.filter(may);
  const withheld = SECTIONS.filter((section) => !may(section));

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>{me.tenant?.name ?? 'This desk'}</h1>
        <p className="itsm-Admin__lede">
          You are configuring <strong>{me.tenant?.slug ?? 'this tenant'}</strong>
          {me.tenant ? <> in {me.tenant.region}</> : null}. Changes here take effect for everybody on it.
        </p>
      </header>

      {shown ? (
        <MetricGrid>
          <Metric
            label="Open tickets"
            value={openTickets.value}
            note={
              openTickets.count === null
                ? 'This could not be loaded just now.'
                : 'Everything still being worked, across every team.'
            }
            href="/tickets?status=open"
          />
          <Metric
            label="Nobody assigned"
            value={unassignedTickets.value}
            {...say(unassignedTickets, 'Open, and waiting on nobody in particular.', 'Every open ticket has somebody on it.')}
            href="/tickets?status=open&assignee=none"
          />
          <Metric
            label="Failed workflow runs"
            value={runs.value}
            {...say(runs, 'Something stopped part way and did not finish.', 'Nothing has stopped part way.')}
            href="/workflows"
          />
          <Metric
            label="Failed outbound calls"
            value={calls.value}
            {...say(calls, 'Each of these is something that did not happen elsewhere.', 'Every call this desk made has landed.')}
            href="/integrations"
          />
        </MetricGrid>
      ) : null}

      {reachable.length === 0 ? (
        <EmptyState
          tone="error"
          title="Your account cannot configure anything here"
          description="Ask an administrator for a role that grants it. Nothing on this console is readable without one."
        />
      ) : (
        <div className="itsm-Admin__sections">
          {reachable.map((section) => (
            <Card key={section.href}>
              <h2>
                <Link href={section.href}>{section.title}</Link>
              </h2>
              <p>{section.description}</p>
            </Card>
          ))}
        </div>
      )}

      {withheld.length > 0 ? (
        <section className="itsm-Admin__withheld" aria-label="Not available to you">
          <h2>Not available to you</h2>
          {/*
            Named rather than hidden. An administrator who cannot find a screen
            asks a colleague, who tells them it is missing; an administrator
            told which permission it needs asks for the permission.
          */}
          <ul>
            {withheld.map((section) => (
              <li key={section.href}>
                {section.title} <Badge emphasis="subtle">needs {section.permissions[0]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
