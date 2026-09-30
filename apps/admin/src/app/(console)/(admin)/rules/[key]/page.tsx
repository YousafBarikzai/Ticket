import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { RuleBuilder } from '../../../../../components/rules/RuleBuilder.js';
import { toRuleView } from '../../../../../components/rules/presentation.js';
import { breadcrumbsFor } from '../../../../../navigation.js';
import { pageAccess } from '../../../../../server/session.js';
import { abilities, loadBuilderContext, loadRule, versionViews, workbenchOrigin } from '../data.js';
import '../../../../../components/rules/rules.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ key: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  const { key } = await params;
  const access = await pageAccess('/rules/[key]');
  if (!access.allowed) return { title: 'Rule · Rules' };
  const rule = await loadRule(access.api, key);
  return { title: `${rule.ok ? rule.value.name : 'Rule'} · Rules` };
}

/**
 * One rule in the builder (SPEC §6.1 `/rules/[key]`): the canvas, *Try it*
 * and the version history. A key that names no rule is the in-frame 404; a
 * rule that cannot be read for another reason keeps the header and says why.
 * `?tab=history` opens the history, `?test=1` (the list's *Test*) runs the
 * test on arrival.
 */
export default async function RulePage({ params, searchParams }: { readonly params: Params; readonly searchParams: Search }): Promise<ReactNode> {
  const access = await pageAccess('/rules/[key]');
  if (!access.allowed) return <Forbidden route="/rules/[key]" />;
  const { me, api } = access;
  const { key } = await params;
  const search = await searchParams;
  const crumbs = breadcrumbsFor('/rules/[key]');

  const [rule, context] = await Promise.all([loadRule(api, key), loadBuilderContext(api, me)]);
  if (!rule.ok) {
    if (rule.problem.status === 404) notFound();
    return (
      <div className="app-Page app-RuleBuilder">
        <PageHeader title="Rule" breadcrumbs={crumbs} />
        <Card title="Rule" problem={rule.problem} />
      </div>
    );
  }
  if (!context.ok) {
    return (
      <div className="app-Page app-RuleBuilder">
        <PageHeader title={rule.value.name} breadcrumbs={crumbs} />
        <Card title="Rule" problem={context.problem} />
      </div>
    );
  }

  const view = toRuleView(rule.value);
  const can = abilities(me, view.name);
  const versions = await versionViews(api, rule.value.versions);
  const origin = workbenchOrigin(me);

  return (
    <RuleBuilder
      key={view.key}
      rule={view}
      versions={versions}
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
      initialTab={search.tab === 'history' ? 'history' : 'rule'}
      autoTest={search.test === '1'}
      {...(origin ? { workbenchOrigin: origin } : {})}
      {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})}
    />
  );
}
