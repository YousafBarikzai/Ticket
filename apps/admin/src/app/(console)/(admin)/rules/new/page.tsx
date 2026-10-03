import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card, EmptyState } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { RuleBuilder } from '../../../../../components/rules/RuleBuilder.js';
import { toRuleView } from '../../../../../components/rules/presentation.js';
import { breadcrumbsFor } from '../../../../../navigation.js';
import { currentAreas, pageAccess } from '../../../../../server/session.js';
import { abilities, loadBuilderContext, loadRule } from '../data.js';
import '../../../../../components/rules/rules.css';

export const metadata: Metadata = { title: 'New rule · Rules' };
export const dynamic = 'force-dynamic';

/**
 * A new rule (SPEC §6.1 `/rules/new`, also the palette's *New rule*):
 * the builder with an empty canvas, or a copy of another rule when the list's
 * *Duplicate* sent `?from=<key>`. Writing a rule needs `rules.rule.manage`;
 * someone who may only read rules is told so here, with the way back.
 */
export default async function NewRulePage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/rules/new');
  if (!access.allowed) return <Forbidden route="/rules/new" />;
  const { me, api } = access;
  const search = await searchParams;
  const crumbs = breadcrumbsFor('/rules/new');
  const can = abilities(me, 'Rules');

  if (!can.canManage) {
    return (
      <div className="app-Page app-RuleBuilder">
        <PageHeader title="New rule" breadcrumbs={crumbs} {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})} />
        <EmptyState
          icon="lock"
          title="Writing rules needs Manage rules"
          description="You can see this desk’s rules but not write new ones. Ask an administrator for Manage rules."
          action={{ id: 'rules', label: 'Back to rules', href: '/rules' }}
        />
      </div>
    );
  }

  const from = typeof search.from === 'string' && search.from !== '' ? search.from : null;
  const [context, seed] = await Promise.all([loadBuilderContext(api, me), from ? loadRule(api, from) : Promise.resolve(null)]);
  if (!context.ok) {
    return (
      <div className="app-Page app-RuleBuilder">
        <PageHeader title="New rule" breadcrumbs={crumbs} />
        <Card title="New rule" problem={context.problem} />
      </div>
    );
  }
  // Ticket links open in the Service Desk when it is listed for this person (A2 §3.7).
  const areas = await currentAreas();

  return (
    <RuleBuilder
      rule={null}
      seed={seed?.ok ? toRuleView(seed.value) : null}
      versions={[]}
      siblings={context.value.siblings}
      facts={context.value.facts.facts}
      events={context.value.facts.events}
      names={context.value.lookups.names}
      workflows={context.value.lookups.workflows}
      teams={context.value.lookups.teams}
      canManage={can.canManage}
      canPublish={can.canPublish}
      sampleSize={context.value.sampleSize}
      breadcrumbs={crumbs}
      areas={areas}
    />
  );
}
