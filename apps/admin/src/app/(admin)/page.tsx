import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState } from '@itsm/ui';
import { currentActor } from '../../server/session.js';
import { holds } from '../../permissions.js';

export const metadata: Metadata = { title: 'Overview' };
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
 */
export default async function OverviewPage(): Promise<ReactNode> {
  const { me } = await currentActor();

  const sections = [
    {
      href: '/people',
      title: 'People',
      description: 'Who is on this desk, which teams they are in, and what each role may do.',
      permission: 'identity.user.manage',
    },
    {
      href: '/fields',
      title: 'The shape of a ticket',
      description: 'The custom fields a ticket carries, who may see each one, and when it is required.',
      permission: 'ticket.config.manage',
    },
    {
      href: '/catalogue',
      title: 'What people can ask for',
      description: 'Services and request types, and whether each is on the portal yet.',
      permission: 'catalogue.manage',
    },
    {
      href: '/rules',
      title: 'What happens automatically',
      description: 'Rules that watch for something happening to a ticket and do something about it.',
      permission: 'rules.rule.manage',
    },
    {
      href: '/sla',
      title: 'What this desk promises',
      description: 'Service level targets, business calendars, and the grid that decides a priority.',
      permission: 'sla.policy.manage',
    },
    {
      href: '/workflows',
      title: 'What runs across several steps',
      description: 'Published workflows, and the runs that are waiting or have failed.',
      permission: 'workflow.manage',
    },
    {
      href: '/settings',
      title: 'Settings',
      description: 'Feature flags, the AI budget, and what this desk is allowed to use.',
      permission: 'admin.settings.manage',
    },
  ];

  const reachable = sections.filter((section) => holds(me, section.permission));
  const withheld = sections.filter((section) => !holds(me, section.permission));

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
                {section.title} <Badge emphasis="subtle">needs {section.permission}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
