import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { describeAction, fromExpression } from '../../../rules.js';
import { RuleEditor } from '../../../components/RuleEditor.js';

export const metadata: Metadata = { title: 'What happens automatically' };
export const dynamic = 'force-dynamic';

/** A stored expression as one line, or an honest admission that it is not one line. */
function describeConditions(conditions: unknown): string {
  const parsed = fromExpression(conditions);
  if (!parsed) return 'a condition too complex to summarise';
  if (parsed.conditions.length === 0) return 'every time';
  const joined = parsed.join === 'and' ? ' and ' : ' or ';
  return parsed.conditions.map((row) => `${row.fact} ${row.operator} ${row.value}`.trim()).join(joined);
}

/**
 * Business rules.
 *
 * The engine has been in the product since PH-2 and its closed action set
 * carries a comment reading "a rule is written by a tenant administrator
 * through the admin UI" — an admin UI that did not exist, so every rule this
 * platform has ever run was written with curl or by the seed.
 *
 * Draft rules are listed with published ones. A rule that is written and not
 * published does nothing at all, and that is the single most likely reason an
 * administrator is looking at this screen wondering why their rule has not
 * fired.
 */
export default async function RulesPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'rules.rule.manage');

  let rules: Awaited<ReturnType<typeof api.configure.rules.list>>;
  let facts: Awaited<ReturnType<typeof api.configure.rules.facts>>;
  try {
    [rules, facts] = await Promise.all([api.configure.rules.list(), api.configure.rules.facts()]);
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The rules could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  const live = rules.filter((rule) => rule.status === 'published').length;

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>What happens automatically</h1>
        <p className="itsm-Admin__lede">
          A rule watches for something happening to a ticket and does something about it.{' '}
          {live === 0
            ? 'None are published, so nothing is running yet.'
            : `${live} of ${rules.length} are published and running.`}{' '}
          Rules for one event run in order, lowest first.
        </p>
      </header>

      {rules.length === 0 ? (
        <EmptyState title="No rules" description="Nothing happens automatically on this desk yet." />
      ) : (
        <Table
          caption="Business rules, drafts included"
          columns={[
            { key: 'name', header: 'Name', cell: (row) => row.name },
            { key: 'event', header: 'When', cell: (row) => <code>{row.event}</code> },
            { key: 'conditions', header: 'If', cell: (row) => describeConditions(row.conditions) },
            {
              key: 'actions',
              header: 'Then',
              cell: (row) => (Array.isArray(row.actions) ? row.actions.map(describeAction).join('; ') : '—'),
            },
            { key: 'order', header: 'Order', cell: (row) => row.order },
            {
              key: 'status',
              header: 'Running',
              cell: (row) => (
                <Badge
                  intent={row.status === 'published' ? 'success' : row.status === 'archived' ? 'neutral' : 'warning'}
                  srPrefix="Running"
                >
                  {row.status === 'published' ? 'Yes' : row.status === 'archived' ? 'Archived' : 'Draft'}
                </Badge>
              ),
            },
          ]}
          rows={rules}
          rowKey={(row) => row.id}
        />
      )}

      {canManage ? (
        <RuleEditor
          facts={facts.facts}
          events={facts.events}
          existingKeys={rules.map((rule) => rule.key)}
          drafts={rules.filter((rule) => rule.status === 'draft').map((rule) => ({ key: rule.key, name: rule.name }))}
          publishedKeys={rules.filter((rule) => rule.status === 'published').map((rule) => rule.key)}
        />
      ) : (
        <p className="itsm-Admin__note">
          Your account can see these but not change them. Writing a rule needs <code>rules.rule.manage</code>.
        </p>
      )}
    </div>
  );
}
