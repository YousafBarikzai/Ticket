'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Button, StatusPill, type ActionSpec } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { eventInfo } from '../../rules/events.js';
import { ActionChips, ConditionChips } from './RuleChips.js';
import {
  RULE_STATES,
  actionChip,
  conditionText,
  eventRank,
  groupHeading,
  headerMeta,
  inScope,
  positions,
  ruleState,
} from './presentation.js';
import type { RuleNames, RuleScope, RuleView } from './types.js';

/**
 * Rules (SPEC §6.1 `/rules`): what happens automatically, grouped by the
 * event that sets it off and in the order it runs.
 *
 * - **No Running switch** (X-42). A draft's primary row action is
 *   **Publish** (with `rules.rule.publish`, after a confirmation); a live
 *   rule's menu has **Archive**, whose toast offers *Undo* — which publishes
 *   it again — when the person may publish; an archived rule has
 *   **Restore**. Edit, Test, Duplicate and View history open the builder.
 * - **No reordering here** (R1): changing a live rule's order through the
 *   API takes it offline, so order is set in the builder, one rule at a time.
 * - "Unpublished changes" is said plainly — *not running until published* —
 *   because that is what the API does to an edited live rule.
 * - *Last fired* comes from the audit trail for people who may read it, and
 *   is left out for everyone else rather than guessed.
 */
export interface RulesViewProps {
  readonly rules: readonly RuleView[];
  readonly scope: RuleScope;
  readonly scopeHrefs: Readonly<Record<RuleScope, string>>;
  readonly names: RuleNames;
  readonly lastFired: Readonly<Record<string, string>> | null;
  readonly canManage: boolean;
  readonly canPublish: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

type Row = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly event: string;
  readonly eventRank: number;
  readonly position: string;
  readonly order: number;
  readonly state: string;
  readonly ifText: string;
  readonly thenText: string;
  readonly updatedAt: string;
  readonly lastFiredAt: string | null;
  readonly rule: RuleView;
} & Record<string, unknown>;

const SCOPES: readonly { readonly value: RuleScope; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
];

export function RulesView({ rules, scope, scopeHrefs, names, lastFired, canManage, canPublish, viewOnly }: RulesViewProps): ReactNode {
  const online = useOnline();
  const [confirmPublish, setConfirmPublish] = useState<RuleView | null>(null);
  const offline = online ? {} : { disabled: true, disabledReason: 'You’re offline — changes can’t be saved.' };

  const publish = useMutation((rule: RuleView) => api.configure.rules.publish(rule.key), {
    success: (row) => `“${row.name}” is live`,
    failure: 'Couldn’t publish the rule',
  });
  const archive = useMutation((rule: RuleView) => api.configure.rules.archive(rule.key), {
    success: (row) => `“${row.name}” archived`,
    failure: 'Couldn’t archive the rule',
  });
  // A live rule archived by someone who may publish comes back from the toast's Undo, which publishes it again.
  const archiveLive = useMutation((rule: RuleView) => api.configure.rules.archive(rule.key), {
    success: (row) => `“${row.name}” archived`,
    failure: 'Couldn’t archive the rule',
    undo: async (row) => {
      await api.configure.rules.publish(row.key);
    },
  });
  const restore = useMutation((rule: RuleView) => api.configure.rules.publish(rule.key), {
    success: (row) => `“${row.name}” restored and live`,
    failure: 'Couldn’t restore the rule',
  });

  const places = useMemo(() => positions(rules), [rules]);
  const rows = useMemo<Row[]>(
    () =>
      rules
        .filter((rule) => inScope(rule, scope))
        .map((rule) => {
          const place = places.get(rule.key);
          return {
            key: rule.key,
            name: rule.name,
            description: rule.description ?? '',
            event: rule.event,
            eventRank: eventRank(rule.event),
            position: place ? String(place.position) : '',
            order: rule.order,
            state: ruleState(rule),
            ifText: conditionText(rule.conditions, names),
            thenText: rule.actions.map((action) => actionChip(action, names).label).join(', '),
            updatedAt: rule.updatedAt,
            lastFiredAt: lastFired?.[rule.key] ?? null,
            rule,
          };
        })
        .sort((a, b) => a.eventRank - b.eventRank || a.event.localeCompare(b.event) || (a.state === 'archived' ? 1 : 0) - (b.state === 'archived' ? 1 : 0) || a.order - b.order || a.name.localeCompare(b.name)),
    [rules, scope, places, names, lastFired],
  );

  const counts: Record<RuleScope, number> = {
    all: rules.length,
    live: rules.filter((rule) => inScope(rule, 'live')).length,
    draft: rules.filter((rule) => inScope(rule, 'draft')).length,
    archived: rules.filter((rule) => inScope(rule, 'archived')).length,
  };

  const events = [...new Set(rules.map((rule) => rule.event))].sort((a, b) => eventRank(a) - eventRank(b));
  const filters: FilterSpec[] = [
    {
      id: 'event',
      label: 'When',
      type: 'select',
      pinned: true,
      options: events.map((event) => ({ value: event, label: eventInfo(event).label, icon: eventInfo(event).icon })),
    },
  ];

  const columns: ColumnSpec[] = [
    { id: 'position', header: '#', field: 'position', kind: 'number', width: 48, align: 'end', empty: '—', cardRole: 'hidden' },
    { id: 'name', header: 'Rule', field: 'name', kind: 'title', secondaryField: 'description', href: '/rules/{key}', truncate: 2, minWidth: 220 },
    { id: 'if', header: 'If', field: 'ifText', minWidth: 200, hideBelow: 'md' },
    { id: 'then', header: 'Then', field: 'thenText', minWidth: 180 },
    { id: 'state', header: 'Status', field: 'state', width: 190, cardRole: 'badge' },
    ...(lastFired ? [{ id: 'lastFired', header: 'Last fired', field: 'lastFiredAt', kind: 'relative', empty: 'Not recently', hideBelow: 'lg', width: 130 } satisfies ColumnSpec] : []),
    { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', hideBelow: 'lg', width: 120 },
    { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true },
  ];

  const actionsFor = (row: Row): ActionSpec[] => {
    const rule = row.rule;
    const state = ruleState(rule);
    const list: ActionSpec[] = [];
    if (canPublish && (state === 'draft' || state === 'changes')) {
      list.push({ id: 'publish', label: state === 'changes' ? 'Publish changes' : 'Publish', icon: 'send', ...offline, confirm: publishConfirm(rule) });
    }
    list.push({ id: 'edit', label: canManage && state !== 'archived' ? 'Edit' : 'Open', icon: canManage ? 'pencil' : 'eye', href: `/rules/${encodeURIComponent(rule.key)}` });
    if (canManage && state !== 'archived') list.push({ id: 'test', label: 'Test', icon: 'play', href: `/rules/${encodeURIComponent(rule.key)}?test=1` });
    if (canManage) list.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', href: `/rules/new?from=${encodeURIComponent(rule.key)}` });
    list.push({ id: 'history', label: 'View history', icon: 'history', href: `/rules/${encodeURIComponent(rule.key)}?tab=history` });
    if (canManage && state !== 'archived') {
      // A live rule archived by someone who may publish can be put back from the toast; anything else asks first.
      const undoable = state === 'live' && canPublish;
      list.push({
        id: 'archive',
        label: 'Archive',
        icon: 'archive',
        tone: 'danger',
        ...offline,
        ...(undoable
          ? {}
          : {
              confirm: {
                title: `Archive “${rule.name}”?`,
                body:
                  state === 'draft'
                    ? 'It hasn’t been published, so nothing changes on tickets. Restoring it later publishes it.'
                    : 'It stops acting on tickets. Restoring it later publishes it again, which needs publish permission.',
                confirmLabel: 'Archive rule',
                tone: 'danger' as const,
              },
            }),
      });
    }
    if (canPublish && state === 'archived') {
      list.push({
        id: 'restore',
        label: 'Restore',
        icon: 'undo-2',
        ...offline,
        confirm: {
          title: `Restore “${rule.name}”?`,
          body: `It goes live again as version ${rule.version + 1} and acts on new events straight away.`,
          confirmLabel: 'Restore and publish',
        },
      });
    }
    return list;
  };

  const handle = async (id: string, targets: Row[]): Promise<void> => {
    const rule = targets[0]?.rule;
    if (!rule) return;
    if (id === 'publish') await publish.run(rule);
    else if (id === 'restore') await restore.run(rule);
    else if (id === 'archive') await (ruleState(rule) === 'live' && canPublish ? archiveLive : archive).run(rule);
  };

  const meta = headerMeta(rules);
  const empty = rules.length === 0;

  return (
    <div className="app-Page app-Rules">
      <PageHeader
        title="Rules"
        {...(empty ? { subtitle: 'Automatic changes when something happens to a ticket.' } : {})}
        {...(meta ? { meta } : {})}
        {...(viewOnly ? { viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-rule', label: 'New rule', icon: 'plus', variant: 'primary', href: '/rules/new', shortcut: 'c' } } : {})}
      />

      <DataTable<Row>
        caption="Rules, grouped by the event that sets them off"
        captionHidden
        urlKey=""
        rows={rows}
        rowKey="key"
        columns={columns}
        search={{ placeholder: 'Search rules', mode: 'client', shortcut: '/' }}
        filters={filters}
        scope={{
          label: 'Show',
          value: scope,
          options: SCOPES.map((entry) => ({ value: entry.value, label: entry.label, href: scopeHrefs[entry.value], count: counts[entry.value] })),
        }}
        groupBy={{ field: 'event', label: (row) => groupHeading(row.event) }}
        rowActionsFor={actionsFor}
        onAction={handle}
        countNoun={{ one: 'rule', other: 'rules' }}
        cells={{
          if: (row) => <ConditionChips conditions={row.rule.conditions} names={names} />,
          then: (row) => <ActionChips actions={row.rule.actions} names={names} />,
          state: (row) => (
            <StateCell
              rule={row.rule}
              canPublish={canPublish}
              online={online}
              onPublish={() => setConfirmPublish(row.rule)}
            />
          ),
        }}
        empty={{
          title: 'No rules yet',
          description: 'Rules make routine changes for you — like raising priority for VIPs.',
          icon: 'automation',
          ...(canManage ? { action: { id: 'new-rule', label: 'New rule', icon: 'plus', variant: 'primary', href: '/rules/new' } } : {}),
        }}
        noResults={{ title: 'No rules match', description: 'Try another word, or clear the filters.' }}
        emptyContent={
          !empty && rows.length === 0 ? (
            <ScopeEmpty scope={scope} allHref={scopeHrefs.all} />
          ) : undefined
        }
      />

      {confirmPublish ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmPublish(null);
          }}
          spec={publishConfirm(confirmPublish)}
          onConfirm={async () => {
            await publish.run(confirmPublish);
            setConfirmPublish(null);
          }}
        />
      ) : null}
    </div>
  );
}

function publishConfirm(rule: RuleView): { title: string; body: string; confirmLabel: string } {
  const changes = ruleState(rule) === 'changes';
  return {
    title: changes ? `Publish the changes to “${rule.name}”?` : `Publish “${rule.name}”?`,
    body: `It acts on new events straight away as version ${rule.version + 1}. Open it first to try it on recent tickets.`,
    confirmLabel: changes ? 'Publish changes' : 'Publish',
  };
}

/** The status pill, what it means for tickets, and a draft's Publish. */
function StateCell({ rule, canPublish, online, onPublish }: { readonly rule: RuleView; readonly canPublish: boolean; readonly online: boolean; readonly onPublish: () => void }): ReactNode {
  const state = ruleState(rule);
  const look = RULE_STATES[state];
  return (
    <span className="app-RuleState">
      <StatusPill size="sm" label={look.label} tone={look.tone} icon={look.icon} srPrefix="Status" />
      {state === 'changes' ? <span className="app-RuleState__note">Not running until published</span> : null}
      {canPublish && (state === 'draft' || state === 'changes') ? (
        <Button
          size="sm"
          variant="tinted"
          onClick={onPublish}
          aria-label={`${state === 'changes' ? 'Publish changes to' : 'Publish'} ${rule.name}`}
          {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}
        >
          {state === 'changes' ? 'Publish changes' : 'Publish'}
        </Button>
      ) : null}
    </span>
  );
}

function ScopeEmpty({ scope, allHref }: { readonly scope: RuleScope; readonly allHref: string }): ReactNode {
  const words: Record<RuleScope, string> = {
    all: 'No rules yet.',
    live: 'No rule is live, so nothing happens automatically yet.',
    draft: 'No drafts. Everything written has been published or archived.',
    archived: 'Nothing has been archived.',
  };
  return (
    <div className="app-Rules__scopeEmpty">
      <p>{words[scope]}</p>
      <Button variant="secondary" size="sm" href={allHref}>
        Show all rules
      </Button>
    </div>
  );
}
