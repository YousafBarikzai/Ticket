'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CiClassRow } from '@itsm/sdk';
import { Button, EmptyState, InlineAlert, Select, type ActionSpec, type EmptySpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { HierNav, PageHeader, type HierNavItem } from '@itsm/ui/shell';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { PersonCell } from '../PersonCell.js';
import { CiDrawer } from './CiDrawer.js';
import { CiForm } from './CiForm.js';
import { ClassSheet } from './ClassSheet.js';
import {
  CI_LIMIT,
  CI_STATUSES,
  CI_STATUS_LOOK,
  CRITICALITIES,
  CRITICALITY_LOOK,
  SOURCE_LOOK,
  classAndDescendants,
  classHref,
  classOptions,
  classPath,
  classTree,
  isCiFiltered,
  type CiQuery,
  type CiView,
  type ClassNode,
} from './presentation.js';
import { useNewParam } from './useNewParam.js';

/**
 * Configuration items (SPEC §6.1 `/cmdb`, B §3.12): the classes down the side
 * as links (`?class=`, a `Select` on phones), the items of the chosen class —
 * and the classes below it — in a table searched and filtered on the server,
 * and one drawer per item (`?open=ci:<id>`).
 *
 * The API returns at most a hundred items and has no cursor, so the table
 * says so and asks for a search or a filter rather than pretending to page.
 * People who manage the CMDB get *New item* (`c`, `?new=1`), *New class*
 * (`?new=class`) and *Edit class*; everyone else sees the *View only* pill.
 */

export interface CisViewProps {
  readonly classes: readonly CiClassRow[];
  readonly classesProblem?: Problem;
  readonly rows: readonly CiView[];
  readonly problem?: Problem;
  readonly query: CiQuery;
  readonly unknownClass: boolean;
  readonly capped: boolean;
  readonly services: readonly { readonly id: string; readonly name: string }[] | null;
  /** The drawer's item, read on the server for a hard load. */
  readonly detail?: CiView;
  readonly detailMissing?: boolean;
  readonly canManage: boolean;
  readonly canAudit: boolean;
  readonly canReadTickets: boolean;
  /** The Tickets and Audit log pages, when this person may open them (for links out of the drawer). */
  readonly mayOpenTickets: boolean;
  readonly mayOpenAudit: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
}

function navItems(nodes: readonly ClassNode[], search: string): HierNavItem[] {
  return nodes.map((node) => ({
    id: node.key,
    label: node.name,
    href: classHref(search, node.key),
    ...(node.children.length > 0 ? { children: navItems(node.children, search) } : {}),
  }));
}

export function CisView(props: CisViewProps): ReactNode {
  const { classes, rows, query, services, canManage, capped } = props;
  const router = useRouter();
  const params = useSearchParams();
  const search = params.toString();
  const drawer = useDrawer('ci');
  const classDrawer = useDrawer('class');
  const create = useNewParam();
  const online = useOnline();
  const listTitle = useId();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();

  const tree = useMemo(() => classTree(classes), [classes]);
  const selected = query.classKey && !props.unknownClass ? classes.find((row) => row.key === query.classKey) : undefined;
  const below = useMemo(() => (selected ? classAndDescendants(tree, selected.key).filter((key) => key !== selected.key) : []), [selected, tree]);
  const filtered = isCiFiltered(query);
  const hasClasses = classes.length > 0;
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Name', field: 'name', kind: 'title', secondaryField: 'className', width: '3fr', minWidth: 220, truncate: 2, sortable: 'page' },
      { id: 'criticality', header: 'Criticality', field: 'criticality', kind: 'status', map: CRITICALITY_LOOK, srPrefix: 'Criticality', width: 132, sortable: 'page', sortField: 'criticalityRank', cardRole: 'badge' },
      { id: 'status', header: 'Status', field: 'status', kind: 'status', map: CI_STATUS_LOOK, srPrefix: 'Status', width: 148, cardRole: 'meta' },
      { id: 'environment', header: 'Environment', field: 'environment', kind: 'text', width: '1fr', hideBelow: 'md', sortable: 'page', cardRole: 'hidden' },
      ...(services ? [{ id: 'service', header: 'Service', field: 'serviceName', kind: 'text' as const, width: '1fr' as const, hideBelow: 'xl' as const, sortable: 'page' as const, cardRole: 'hidden' as const }] : []),
      { id: 'owner', header: 'Owner', field: 'ownerName', kind: 'text', width: '1fr', hideBelow: 'lg', sortable: 'page', cardRole: 'hidden' },
      { id: 'source', header: 'Source', field: 'source', kind: 'badge', map: SOURCE_LOOK, width: 128, hideBelow: 'xl', cardRole: 'hidden' },
      { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', width: 128, sortable: 'page', cardRole: 'meta' },
    ],
    [services],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: CI_STATUSES.map((value) => ({ value, label: CI_STATUS_LOOK[value]!.label, tone: CI_STATUS_LOOK[value]!.tone, ...(CI_STATUS_LOOK[value]!.icon ? { icon: CI_STATUS_LOOK[value]!.icon } : {}) })),
      },
      {
        id: 'criticality',
        label: 'Criticality',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: [...CRITICALITIES].reverse().map((value) => ({ value, label: CRITICALITY_LOOK[value]!.label, tone: CRITICALITY_LOOK[value]!.tone })),
      },
      { id: 'retired', label: 'Include retired', type: 'boolean', mode: 'server', pinned: true },
    ],
    [],
  );

  const primary: ActionSpec | undefined = canManage
    ? hasClasses
      ? { id: 'new-item', label: 'New item', icon: 'plus', variant: 'primary', shortcut: 'c', ...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' }) }
      : { id: 'new-class', label: 'New class', icon: 'plus', variant: 'primary', shortcut: 'c' }
    : undefined;

  const onAction = (id: string): void => {
    if (id === 'new-item') create.open('1');
    if (id === 'new-class') create.open('class');
  };

  const empty: EmptySpec = !hasClasses
    ? {
        title: 'No classes yet',
        description: 'Every item belongs to a class — a server, an application, a database. Add a class, then record what the desk runs on.',
        icon: 'cmdb',
        ...(canManage ? { action: { id: 'new-class', label: 'New class', icon: 'plus', variant: 'primary' } as ActionSpec } : {}),
      }
    : selected
      ? {
          title: `Nothing in ${selected.name} yet`,
          description: 'Record the first one, or choose another class.',
          icon: 'cmdb',
          ...(canManage ? { action: { id: 'new-item', label: 'New item', icon: 'plus', variant: 'primary' } as ActionSpec } : {}),
        }
      : {
          title: 'No configuration items yet',
          description: 'Record the services and systems tickets can affect, and how they depend on each other — or let discovery find them.',
          icon: 'cmdb',
          ...(canManage ? { action: { id: 'new-item', label: 'New item', icon: 'plus', variant: 'primary' } as ActionSpec } : {}),
        };

  const items: HierNavItem[] = [{ id: 'all', label: 'All classes', href: classHref(search, null) }, ...navItems(tree, search)];
  const firstRun = !hasClasses && !props.classesProblem && rows.length === 0 && !filtered && !props.problem;

  return (
    <div className="app-Page app-Cmdb">
      <PageHeader
        title="Configuration items"
        {...(firstRun || (rows.length === 0 && !filtered && !selected && !props.problem) ? { subtitle: 'The services and systems tickets can affect, and what depends on what.' } : {})}
        {...(primary ? { primaryAction: primary } : {})}
        {...(canManage && hasClasses ? { secondaryActions: [{ id: 'new-class', label: 'New class', icon: 'plus' } as ActionSpec] } : {})}
        {...(props.viewOnly ? { viewOnly: props.viewOnly } : {})}
        onAction={onAction}
      />

      {props.unknownClass ? <InlineAlert tone="warning">That class no longer exists, so every class is shown.</InlineAlert> : null}

      {firstRun ? (
        <EmptyState size="lg" illustration="setup" {...empty} {...(empty.action ? { onAction } : {})} />
      ) : (
        <div className="app-Cmdb__panes">
          <div className="app-Cmdb__nav">
            {props.classesProblem ? <InlineAlert tone="warning">Couldn’t load the classes. The list shows every class.</InlineAlert> : <HierNav label="Classes" items={items} />}
          </div>
          {hasClasses ? (
            <div className="app-Cmdb__picker">
              <Select
                aria-label="Class"
                value={selected?.key ?? ''}
                options={[{ value: '', label: 'All classes' }, ...classOptions(tree)]}
                onChange={(event) => router.push(classHref(search, event.currentTarget.value || null))}
              />
            </div>
          ) : null}
          <section className="app-Cmdb__main" aria-labelledby={listTitle}>
            <header className="app-Cmdb__head">
              <div>
                <h2 id={listTitle} className="app-Cmdb__title">
                  {selected ? selected.name : 'All classes'}
                </h2>
                {selected ? (
                  <p className="app-Cmdb__lede">
                    {selected.parentId ? `${classPath(classes, selected.id)}. ` : ''}
                    {below.length > 0 ? `Includes ${below.map((key) => classes.find((row) => row.key === key)?.name ?? key).join(', ')}.` : ''}
                  </p>
                ) : null}
              </div>
              {selected && canManage ? (
                <Button variant="secondary" size="sm" iconStart="pencil" onClick={() => classDrawer.open(selected.key)}>
                  Edit class
                </Button>
              ) : null}
            </header>
            <DataTable<CiView>
              caption={selected ? `Configuration items in ${selected.name}` : 'Configuration items'}
              captionHidden
              columns={columns}
              rows={rows}
              rowKey="id"
              urlKey=""
              sort={{ columnId: 'name', direction: 'ascending' }}
              search={{ placeholder: 'Search by name or identifier', mode: 'server', param: 'q', shortcut: '/' }}
              filters={filters}
              viewMenu={{ density: true, columns: true }}
              dataComplete={!capped}
              activate={{ kind: 'drawer', openKind: 'ci', keyField: 'id' }}
              onActivate={(row) => drawer.open(row.id)}
              {...(drawer.key ? { currentKeys: [drawer.key] } : {})}
              countNoun={{ one: 'item', other: 'items' }}
              cells={{
                owner: (row) => <PersonCell person={row.owner} empty="—" />,
                service: (row) => (row.serviceId ? (row.serviceName ?? <span className="app-CmdbMuted">A service you can’t see</span>) : <span className="app-CmdbMuted">—</span>),
              }}
              empty={empty}
              onAction={(id) => onAction(id)}
              noResults={{ title: 'No items match these filters', description: 'Clear a filter, or search for something else. Retired items are left out unless you include them.' }}
              {...(props.problem ? { problem: props.problem, onRetry: () => router.refresh() } : {})}
            />
            {capped ? (
              <p className="app-Cmdb__caption" role="note">
                Showing the first {CI_LIMIT} — search or filter to narrow.
              </p>
            ) : null}
          </section>
        </div>
      )}

      <CiDrawer
        id={drawer.key}
        {...(open ? { row: open } : {})}
        {...(props.detail ? { initial: props.detail } : {})}
        {...(props.detailMissing && drawer.key ? { missing: true } : {})}
        classes={classes}
        services={services}
        canManage={canManage}
        canAudit={props.canAudit}
        canReadTickets={props.canReadTickets}
        ticketHref={(number) => (props.mayOpenTickets ? `/tickets?status=all&open=${encodeURIComponent(`ticket:${number}`)}` : null)}
        auditHref={(id) => (props.mayOpenAudit ? `/audit?targetType=configuration_item&targetId=${encodeURIComponent(id)}` : null)}
        onClose={drawer.close}
        onOpenCi={drawer.open}
      />

      <Sheet
        open={create.value === '1' && canManage}
        onOpenChange={(next) => {
          if (!next) {
            setDirty(false);
            create.close();
          }
        }}
        size="md"
        title="New configuration item"
        description="Choose its class first: the class decides the details it carries."
        dirty={dirty}
        footer={
          <div className="app-CmdbActions">
            <Button
              variant="secondary"
              onClick={() => {
                setDirty(false);
                create.close();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
              Add item
            </Button>
          </div>
        }
      >
        {create.value === '1' && canManage ? (
          hasClasses ? (
            <CiForm
              formId={formId}
              classes={classes}
              initialClassKey={selected?.key ?? null}
              services={services}
              onDirtyChange={setDirty}
              onBusyChange={setBusy}
              onDone={(saved) => {
                setDirty(false);
                if (saved) {
                  create.finish(`ci:${saved.id}`);
                  router.refresh();
                } else create.close();
              }}
            />
          ) : (
            <EmptyState
              size="sm"
              headingLevel={3}
              icon="cmdb"
              title="Add a class first"
              description="Every item belongs to a class, and this CMDB has none yet."
              action={{ id: 'new-class', label: 'New class', icon: 'plus', variant: 'primary' }}
              onAction={() => create.open('class')}
            />
          )
        ) : null}
      </Sheet>

      {canManage ? (
        <ClassSheet
          open={create.value === 'class' || classDrawer.key !== null}
          editKey={classDrawer.key}
          classes={classes}
          onClose={() => (classDrawer.key !== null ? classDrawer.close() : create.close())}
          onSaved={(key) => {
            if (classDrawer.key !== null) classDrawer.close();
            else router.replace(classHref(new URLSearchParams(search).toString(), key));
          }}
        />
      ) : null}
    </div>
  );
}
