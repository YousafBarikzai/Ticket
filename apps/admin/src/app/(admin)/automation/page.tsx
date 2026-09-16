import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';

export const metadata: Metadata = { title: 'Automation' };
export const dynamic = 'force-dynamic';

/**
 * The two ways this desk does something without being asked.
 *
 * Rules and workflows already have builders of their own; this is the landing
 * page the navigation needed and they did not have — one place that says which
 * of the two a thing belongs in, and how much of each is switched on right now.
 *
 * Counts rather than lists. Both builders are one click away and both list
 * their own contents better than a summary could; what is worth knowing here
 * is the split between what is published and what is still a draft, because a
 * draft rule does nothing and looks exactly like one that does.
 */
export default async function AutomationPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  const mayRules = holds(me, 'rules.rule.manage') || holds(me, 'rules.rule.read');
  const mayWorkflows = holds(me, 'workflow.manage') || holds(me, 'workflow.read');

  if (!mayRules && !mayWorkflows) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's automation"
        description="It needs rules.rule.manage for rules or workflow.manage for workflows."
      />
    );
  }

  const [rules, workflows, runs] = await Promise.all([
    mayRules ? read(() => api.configure.rules.list()) : null,
    mayWorkflows ? read(() => api.configure.workflows.list()) : null,
    mayWorkflows ? read(() => api.configure.workflows.runs({ limit: 50 })) : null,
  ]);

  const failing = runs?.ok ? runs.value.filter((run) => run.status === 'failed').length : 0;

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Automation</h1>
        <p className="itsm-Admin__lede">
          A rule reacts to one thing happening to one ticket. A workflow runs several steps in order and can wait —
          for an approval, for a person, for an integration to answer. If it needs to wait, it is a workflow.
        </p>
      </header>

      <div className="itsm-Admin__sections">
        {rules ? (
          <Card>
            <h2>
              <Link href="/rules">Business rules</Link>
            </h2>
            {rules.ok ? (
              <p>
                {rules.value.length === 0
                  ? 'None yet. Nothing on this desk happens automatically.'
                  : `${rules.value.filter((rule) => rule.status === 'published').length} published of ${rules.value.length}.`}
              </p>
            ) : (
              <p className="itsm-Admin__error">{rules.message}</p>
            )}
          </Card>
        ) : null}

        {workflows ? (
          <Card>
            <h2>
              <Link href="/workflows">Workflows</Link>
            </h2>
            {workflows.ok ? (
              <p>
                {workflows.value.length === 0
                  ? 'None yet.'
                  : `${workflows.value.filter((flow) => flow.status === 'published').length} published of ${workflows.value.length}.`}
              </p>
            ) : (
              <p className="itsm-Admin__error">{workflows.message}</p>
            )}
            {failing > 0 ? (
              <p>
                <Badge intent="danger" srPrefix="Warning">
                  {failing} failed {failing === 1 ? 'run' : 'runs'}
                </Badge>{' '}
                in the last fifty.
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      <section className="itsm-Admin__note" aria-label="Where else automation lives">
        <h2>Also automatic</h2>
        <p>
          Two more things act on their own and are configured elsewhere: SLA policies, which escalate when a target is
          about to be missed, live under <Link href="/sla">what this desk promises</Link>; outbound actions, which are
          what a workflow calls when it reaches out of the platform, live under{' '}
          <Link href="/integrations">integrations</Link>.
        </p>
      </section>
    </div>
  );
}
