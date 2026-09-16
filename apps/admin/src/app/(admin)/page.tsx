import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState } from '@itsm/ui';
import { currentActor } from '../../server/session.js';
import { holds } from '../../permissions.js';

export const metadata: Metadata = { title: 'Command centre' };
export const dynamic = 'force-dynamic';

/**
 * What this desk is, and what an administrator can reach.
 *
 * Deliberately not a dashboard of counts. An administration console is opened
 * to change something, and a wall of numbers is a wall between somebody and
 * the thing they came to do. What is worth saying on arrival is which tenant
 * they are configuring — because the console for the wrong tenant looks
 * exactly like the console for the right one — and what they are permitted to
 * change, so a missing section is explained rather than merely absent.
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
  const { me } = await currentActor();

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
