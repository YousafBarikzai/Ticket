'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { RoleRow } from '@itsm/sdk';
import { InlineAlert, StatusPill, notify, type ActionSpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { ConfirmDialog } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { AddPersonSheet } from './AddPersonSheet.js';
import { PersonDrawer } from './PersonDrawer.js';
import { firstName, isActive, userStatusLook, type PeopleQuery, type PeopleScope, type PersonRowView } from './presentation.js';
import type { NamedOption, PeopleAbilities, PeopleHeader, TeamOption } from './types.js';

/**
 * People (SPEC §6.1 `/people`, B §3.16, F31): everyone who can sign in to
 * this desk, A to Z.
 *
 * The search and the Active · Deactivated · All scope are asked of the API
 * (up to its 200 per call, and the page says when it is showing the first
 * 200 rather than letting a cap pass for the whole directory); Type and
 * Organisation narrow the loaded rows. A row opens the person
 * (`?open=person:<id>`); *Add person* opens its sheet (`?new=1`, also ⌘K).
 */
export interface PeopleViewProps {
  readonly header: PeopleHeader;
  readonly rows: readonly PersonRowView[];
  readonly query: PeopleQuery;
  readonly scopes: readonly { readonly value: PeopleScope; readonly label: string; readonly href: string }[];
  /** "Showing the first 200 people…", when the API's page is full. */
  readonly caption: string | null;
  readonly problem?: Problem;
  readonly abilities: PeopleAbilities;
  readonly meId: string | null;
  readonly roles: readonly RoleRow[] | null;
  readonly teams: readonly TeamOption[] | null;
  /** Organisations for selects, indented by depth; null when they cannot be read. */
  readonly organisations: readonly NamedOption[] | null;
  readonly orgNames: Readonly<Record<string, string>>;
  readonly workforceHref?: string;
  /** The drawer's person on a hard load, when the list does not include them. */
  readonly initialPerson?: PersonRowView;
}

const NOUN = { one: 'person', other: 'people' } as const;
const OFFLINE = 'You’re offline — changes can’t be saved.';

export function PeopleView(props: PeopleViewProps): ReactNode {
  const { header, rows, query, abilities } = props;
  const router = useRouter();
  const online = useOnline();
  const drawer = useDrawer('person');
  const create = useCreateParam();
  const [flash, setFlash] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<{ kind: 'deactivate' | 'reactivate'; row: PersonRowView } | null>(null);

  useEffect(() => {
    if (flash.length === 0) return;
    const timer = window.setTimeout(() => setFlash([]), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const open = drawer.key ? (rows.find((row) => row.id === drawer.key) ?? (props.initialPerson?.id === drawer.key ? props.initialPerson : undefined)) : undefined;

  const deactivate = useMutation((id: string, reason?: string) => api.tenant.deactivateUser(id, reason), { failure: 'Couldn’t deactivate them' });
  const reactivate = useMutation((id: string) => api.tenant.reactivateUser(id), { failure: 'Couldn’t reactivate them' });

  const statusMap = useMemo(() => {
    const map: Record<string, { label: string; tone: 'success' | 'neutral' | 'info' | 'warning' | 'danger'; icon: 'circle-check' | 'circle-dashed' | 'dot' }> = {};
    for (const row of rows) if (!map[row.status]) map[row.status] = userStatusLook(row.status) as (typeof map)[string];
    return map;
  }, [rows]);

  const anyOrganisation = rows.some((row) => row.orgName !== null);
  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Person', field: 'name', kind: 'person', secondaryField: 'email', minWidth: 220, width: '3fr' },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: statusMap, srPrefix: 'Status', width: 140, minWidth: 130, cardRole: 'badge' },
      { id: 'type', header: 'Type', field: 'typeLabel', width: 110, minWidth: 100, hideBelow: 'md' },
      ...(anyOrganisation ? [{ id: 'org', header: 'Organisation', field: 'orgName', width: '2fr' as const, minWidth: 160, hideBelow: 'sm' as const, empty: 'None' }] : []),
    ],
    [statusMap, anyOrganisation],
  );

  const orgFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (row.orgId && row.orgName) seen.set(row.orgId, row.orgName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'type',
        label: 'Type',
        type: 'select',
        pinned: true,
        field: 'typeLabel',
        options: [
          { value: 'Internal', label: 'Internal' },
          { value: 'External', label: 'External' },
        ],
      },
      ...(orgFilterOptions.length > 1 ? [{ id: 'org', label: 'Organisation', type: 'select' as const, field: 'orgId', options: orgFilterOptions }] : []),
    ],
    [orgFilterOptions],
  );

  const rowActionsFor = (row: PersonRowView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'view', label: 'View details', icon: 'eye' }];
    if (!abilities.manage || row.you) return actions;
    const gate = online ? {} : { disabled: true, disabledReason: OFFLINE };
    actions.push(
      isActive(row.status)
        ? { id: 'deactivate', label: 'Deactivate…', icon: 'ban', tone: 'danger', ...gate }
        : { id: 'reactivate', label: 'Reactivate…', icon: 'undo-2', ...gate },
    );
    return actions;
  };

  const primaryAction: ActionSpec | undefined = abilities.manage ? { id: 'add-person', label: 'Add person', icon: 'user-plus', variant: 'primary', shortcut: 'c' } : undefined;
  const scopeLabel = props.scopes.find((scope) => scope.value === query.scope)?.label.toLowerCase() ?? 'active';

  return (
    <div className="app-Page app-People">
      <PageHeader
        title="People"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(rows.length === 0 && !query.q && query.scope !== 'inactive' ? { subtitle: 'Everyone who can sign in to this desk.' } : {})}
        {...(primaryAction ? { primaryAction } : {})}
        onAction={(id) => {
          if (id === 'add-person') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">People on this desk</h2>
      {props.caption ? (
        <InlineAlert tone="info" className="app-People__caption">
          {props.caption}
        </InlineAlert>
      ) : null}
      <DataTable<PersonRowView>
        caption="People"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        urlKey=""
        search={{ placeholder: 'Search by name or email', mode: 'server', param: 'q', shortcut: '/' }}
        scope={{ label: 'Status', value: query.scope, options: props.scopes }}
        filters={filters}
        dataComplete={props.caption === null}
        activate={{ kind: 'drawer', openKind: 'person', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        {...(open ? { currentKeys: [open.id] } : {})}
        highlightKeys={flash}
        rowActionsFor={rowActionsFor}
        onAction={(id, targets) => {
          if (id === 'add-person') {
            create.open('1');
            return;
          }
          const row = targets[0];
          if (!row) return;
          if (id === 'view') drawer.open(row.id);
          if (id === 'deactivate' || id === 'reactivate') setConfirming({ kind: id, row });
        }}
        cells={{
          type: (row) =>
            row.external ? <StatusPill size="sm" tone="neutral" icon="globe" label="External" /> : <span className="app-People__quiet">Internal</span>,
        }}
        countNoun={NOUN}
        {...(props.problem ? { problem: props.problem, onRetry: () => router.refresh() } : {})}
        empty={
          query.q
            ? { title: `Nobody matches “${query.q}”`, description: 'Search looks at names and email addresses. Try part of either.', icon: 'search' }
            : query.scope === 'inactive'
              ? { title: 'Nobody is deactivated', description: 'People you deactivate appear here, and can be reactivated.', icon: 'people' }
              : {
                  title: query.scope === 'all' ? 'Nobody yet' : `No ${scopeLabel} people`,
                  description: 'People appear here the first time they sign in, when your identity provider adds them, or when you add them.',
                  icon: 'people',
                  ...(primaryAction ? { action: primaryAction } : {}),
                }
        }
        noResults={{ title: 'Nobody matches these filters', description: 'Type and organisation narrow the people loaded here.' }}
      />

      <PersonDrawer
        personId={drawer.key}
        row={open}
        abilities={abilities}
        meId={props.meId}
        roles={props.roles}
        teams={props.teams}
        organisations={props.organisations}
        orgNames={props.orgNames}
        {...(props.workforceHref ? { workforceHref: props.workforceHref } : {})}
        onClose={() => drawer.close()}
      />

      <AddPersonSheet
        open={abilities.manage && create.value !== null}
        organisations={props.organisations}
        roles={abilities.grant ? props.roles : null}
        takenEmails={rows.map((row) => row.email)}
        onClose={() => create.close()}
        onAdded={(id) => {
          setFlash([id]);
          create.close();
        }}
      />

      {confirming?.kind === 'deactivate' ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          spec={{
            title: `Deactivate ${confirming.row.name}?`,
            body: `${firstName(confirming.row.name)} is signed out everywhere at once, their API keys stop working and every role they hold is removed. Their history stays, and they keep their team places for when they come back.`,
            confirmLabel: 'Deactivate',
            tone: 'danger',
            requireReason: { label: 'Reason', hint: 'Recorded in the audit log, like “Left the company on 30 September”.' },
          }}
          onConfirm={async (reason) => {
            const result = await deactivate.run(confirming.row.id, reason);
            if (!result.ok) throw new Error(result.problem.detail ?? 'They weren’t deactivated.');
            notify(`${confirming.row.name} deactivated`, { tone: 'success' });
          }}
        />
      ) : null}
      {confirming?.kind === 'reactivate' ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          spec={{
            title: `Reactivate ${confirming.row.name}?`,
            body: `${firstName(confirming.row.name)} can sign in again and is back in their teams. Their roles aren’t restored — deactivating removed them — so give them the roles they need next.`,
            confirmLabel: 'Reactivate',
          }}
          onConfirm={async () => {
            const result = await reactivate.run(confirming.row.id);
            if (!result.ok) throw new Error(result.problem.detail ?? 'They weren’t reactivated.');
            notify(`${confirming.row.name} reactivated`, {
              tone: 'success',
              description: 'Give them the roles they need from their details.',
              action: { label: 'Open details', onClick: () => drawer.open(confirming.row.id) },
            });
          }}
        />
      ) : null}
    </div>
  );
}
