import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { RulesView } from '../../../../components/rules/RulesView.js';
import { scopeFrom } from '../../../../components/rules/presentation.js';
import type { RuleScope } from '../../../../components/rules/types.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { abilities, loadLastFired, loadLookups, ruleView } from './data.js';
import '../../../../components/rules/rules.css';

export const metadata: Metadata = { title: 'Rules' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

/** The scope links keep every other parameter (search, the event filter) and drop an open drawer. */
function scopeHrefs(search: Search): Record<RuleScope, string> {
  const href = (scope: RuleScope): string => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(search)) {
      if (name === 'status' || name === 'open' || value === undefined) continue;
      for (const entry of Array.isArray(value) ? value : [value]) params.append(name, entry);
    }
    if (scope !== 'all') params.set('status', scope);
    const query = params.toString();
    return query ? `/rules?${query}` : '/rules';
  };
  return { all: href('all'), live: href('live'), draft: href('draft'), archived: href('archived') };
}

/**
 * Rules (SPEC §6.1): the list of what happens automatically, by event and
 * in running order. The rules are one read; the names their actions refer to
 * (teams, workflows) and when each last fired (the audit trail) are read
 * beside it and degrade to fewer words, never to a broken page.
 */
export default async function RulesPage({ searchParams }: { readonly searchParams: Promise<Search> }): Promise<ReactNode> {
  const access = await pageAccess('/rules');
  if (!access.allowed) return <Forbidden route="/rules" />;
  const { me, api } = access;
  const search = await searchParams;
  // Links made while the builder was being built opened a drawer here (`?open=rule:<key>`); a rule has its own page now.
  if (typeof search.open === 'string' && search.open.startsWith('rule:') && search.open.length > 5) {
    redirect(`/rules/${encodeURIComponent(search.open.slice(5))}`);
  }
  const status = typeof search.status === 'string' ? search.status : undefined;
  const can = abilities(me, 'Rules');

  const [rules, lookups, lastFired] = await Promise.all([read(() => api.configure.rules.list()), loadLookups(api, me), loadLastFired(api, me)]);

  if (!rules.ok) {
    return (
      <div className="app-Page app-Rules">
        <PageHeader title="Rules" {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})} />
        <Card title="Rules" problem={rules.problem} />
      </div>
    );
  }

  return (
    <RulesView
      rules={rules.value.map(ruleView)}
      scope={scopeFrom(status)}
      scopeHrefs={scopeHrefs(search)}
      names={lookups.names}
      lastFired={lastFired}
      canManage={can.canManage}
      canPublish={can.canPublish}
      {...(can.viewOnly ? { viewOnly: can.viewOnly } : {})}
    />
  );
}
