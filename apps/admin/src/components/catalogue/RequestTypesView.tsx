'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, EmptyState, notify, Select, type ActionSpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { HierNav, PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import {
  catalogueMeta,
  PRIORITY_LOOK,
  REQUEST_STATE_LOOK,
  serviceCounts,
  type FormView,
  type RequestTypeView,
  type ServiceView,
} from './presentation.js';
import { applyMoves, planMove } from './reorder.js';
import { RequestTypeSheet, type SheetTarget } from './RequestTypeSheet.js';
import { runSteps } from './runSteps.js';
import { planSave, publishesQuestions, type Step, type TypeFields } from './save.js';
import { ServiceSheet } from './ServiceSheet.js';
import { useCreateParam } from './useCreate.js';

/**
 * Services & requests › Request types (SPEC §6.1, X-41): the services down
 * the side, the request types of the chosen one in a table, and one sheet
 * that takes a request from idea to live — questions and portal preview
 * included.
 *
 * The URL holds it all: `?service=<key>` chooses the service,
 * `?open=request-type:<key>` and `?open=service:<key>` open the sheets (the
 * command palette links to both), and `?new=request-type` / `?new=service`
 * open them empty. Rows reorder within a service (Move up / Move down,
 * Alt+↑/↓), which is the order the portal lists them in.
 */
export interface RequestTypesViewProps {
  readonly tabs: readonly { id: string; label: string; href: string; match?: 'exact' }[];
  readonly services: readonly ServiceView[];
  readonly types: readonly RequestTypeView[];
  /** Null when this person cannot read forms: questions show, but cannot be changed. */
  readonly forms: readonly FormView[] | null;
  readonly teams: readonly { readonly id: string; readonly name: string }[] | null;
  readonly canEditQuestions: boolean;
  readonly portalOrigin?: string;
  /** The request types could not be read; the services still show. */
  readonly problem?: Problem;
}

export function RequestTypesView(props: RequestTypesViewProps): ReactNode {
  const { tabs, services, forms, teams, canEditQuestions, portalOrigin, problem } = props;
  const router = useRouter();
  const params = useSearchParams();
  const typeDrawer = useDrawer('request-type');
  const serviceDrawer = useDrawer('service');
  const create = useCreateParam();
  const selectedKey = params.get('service');
  const selected = selectedKey ? services.find((service) => service.key === selectedKey) : undefined;
  const formsByKey = useMemo(() => new Map((forms ?? []).map((form) => [form.key, form])), [forms]);

  // Moves made here, until the server's order catches up.
  const [moves, setMoves] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => setMoves(new Map()), [props.types]);
  const types = useMemo(() => applyMoves(props.types, (type) => type.sortOrder, moves), [props.types, moves]);
  const counts = useMemo(() => serviceCounts(types), [types]);
  const shown = selected ? types.filter((type) => type.serviceKey === selected.key) : types;

  const openType = typeDrawer.key ? types.find((type) => type.key === typeDrawer.key) : undefined;
  const openService = serviceDrawer.key ? services.find((service) => service.key === serviceDrawer.key) : undefined;
  const fromKey = create.params.get('from');
  const from = fromKey ? types.find((type) => type.key === fromKey) : undefined;
  const target: SheetTarget | null = openType
    ? { kind: 'edit', type: openType }
    : create.value === 'request-type' || create.value === '1'
      ? { kind: 'new', ...(create.params.get('service') ? { serviceKey: create.params.get('service')! } : selected ? { serviceKey: selected.key } : {}), ...(from ? { from } : {}) }
      : null;

  const publish = useMutation((steps: readonly Step[]) => runSteps(steps), { failure: 'Couldn’t publish the request type' });
  const reorder = useMutation(
    async (changes: readonly { key: string; order: number }[]) => {
      for (const change of changes) await api.configure.catalogue.updateRequestType(change.key, { sortOrder: change.order });
    },
    { failure: 'Couldn’t save the new order' },
  );

  const publishSteps = (row: RequestTypeView): Step[] => {
    const own = row.questions.kind === 'own' ? formsByKey.get(row.key) : undefined;
    const fields: TypeFields = {
      name: row.name,
      key: row.key,
      serviceKey: row.serviceKey ?? '',
      summary: row.summary ?? '',
      description: row.description ?? '',
      priority: row.priority,
      groupId: row.groupId ?? '',
      questionsMode: row.questions.kind,
      formKey: row.questions.kind === 'form' ? row.questions.formKey : '',
    };
    return planSave({
      fields,
      existing: { ...row, summary: row.summary, serviceKey: row.serviceKey },
      ownForm: own ? { key: own.key, name: own.name, status: own.status, unpublished: own.state !== 'live' } : null,
      document: own ? own.document : null,
      questionsChanged: false,
      intent: 'publish',
    });
  };

  const rowActionsFor = (row: RequestTypeView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'edit', label: 'Edit', icon: 'pencil' }];
    if (row.state === 'draft') {
      const steps = publishSteps(row);
      const withQuestions = publishesQuestions(steps);
      actions.push({
        id: 'publish',
        label: 'Publish…',
        icon: 'upload',
        ...(withQuestions && !canEditQuestions ? { disabled: true, disabledReason: 'Publishing its questions needs Manage forms.' } : {}),
        confirm: {
          title: `Publish ${row.name}?`,
          body: 'Requesters will see this in the portal immediately.',
          confirmLabel: 'Publish',
          ...(withQuestions && row.questions.kind === 'own'
            ? { consequences: [{ label: `Its ${row.questions.count === 1 ? 'question goes' : `${row.questions.count} questions go`} live too` }] }
            : {}),
        },
      });
    }
    actions.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy' });
    return actions;
  };

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Request type', field: 'name', kind: 'title', secondaryField: 'summary', width: '3fr', minWidth: 220, truncate: 2 },
      ...(selected ? [] : [{ id: 'service', header: 'Service', field: 'serviceName', kind: 'text' as const, width: '1fr' as const, hideBelow: 'lg' as const }]),
      { id: 'questions', header: 'Questions', field: 'questionsLabel', kind: 'text', width: '2fr', hideBelow: 'md' },
      { id: 'priority', header: 'Priority', field: 'priority', kind: 'status', map: PRIORITY_LOOK, srPrefix: 'Priority', width: 132, hideBelow: 'sm' },
      { id: 'state', header: 'Status', field: 'state', kind: 'status', map: REQUEST_STATE_LOOK, srPrefix: 'Status', width: 176, cardRole: 'badge' },
      { id: 'published', header: 'Live since', field: 'publishedAt', kind: 'relative', empty: 'Not yet', width: 120, hideBelow: 'xl' },
      { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, width: 160 },
    ],
    [selected],
  );

  const navItems = [
    { id: 'all', label: 'All services', href: '/catalogue', count: types.length },
    ...services.map((service) => ({ id: service.key, label: service.name, href: `/catalogue?service=${encodeURIComponent(service.key)}`, count: counts.get(service.key)?.total ?? 0 })),
  ];

  const onAction = async (id: string, rows: RequestTypeView[]): Promise<void> => {
    if (id === 'new-request-type') create.open('request-type', selected ? { service: selected.key } : {});
    const row = rows[0];
    if (!row) return;
    if (id === 'edit') typeDrawer.open(row.key);
    if (id === 'duplicate') create.open('request-type', { from: row.key });
    if (id === 'publish') {
      const result = await publish.run(publishSteps(row));
      if (result.ok) {
        notify(`${row.name} is live`, {
          tone: 'success',
          ...(portalOrigin ? { action: { label: 'Open portal', onClick: () => window.location.assign(`${portalOrigin}/catalogue/${encodeURIComponent(row.key)}`) } } : {}),
        });
      }
    }
  };

  const hasServices = services.length > 0;

  return (
    <div className="app-Page app-Catalogue">
      <PageHeader
        title="Services & requests"
        tabs={[...tabs]}
        {...(catalogueMeta(types) ? { meta: catalogueMeta(types)! } : {})}
        {...(hasServices
          ? { primaryAction: { id: 'new-request-type', label: 'New request type', icon: 'plus', variant: 'primary', shortcut: 'c' } as ActionSpec }
          : {})}
        secondaryActions={[{ id: 'new-service', label: 'New service', icon: 'plus' }]}
        onAction={(id) => {
          if (id === 'new-request-type') create.open('request-type', selected ? { service: selected.key } : {});
          if (id === 'new-service') create.open('service');
        }}
      />

      {!hasServices ? (
        <EmptyState
          size="lg"
          illustration="catalogue"
          title="No services yet"
          description="Start with a service, such as “Business applications”. Request types live inside services."
          action={{ id: 'new-service', label: 'New service', icon: 'plus', variant: 'primary' }}
          onAction={() => create.open('service')}
        />
      ) : (
        <div className="app-Catalogue__panes">
          <div className="app-Catalogue__nav">
            <HierNav label="Services" items={navItems} />
          </div>
          <div className="app-Catalogue__picker">
            <Select
              aria-label="Service"
              value={selected?.key ?? ''}
              options={[{ value: '', label: `All services (${types.length})` }, ...services.map((service) => ({ value: service.key, label: `${service.name} (${counts.get(service.key)?.total ?? 0})` }))]}
              onChange={(event) => {
                const key = event.currentTarget.value;
                router.push(key ? `/catalogue?service=${encodeURIComponent(key)}` : '/catalogue');
              }}
            />
          </div>
          <section className="app-Catalogue__main" aria-labelledby="catalogue-list-title">
            <header className="app-Catalogue__head">
              <div>
                <h2 id="catalogue-list-title" className="app-Catalogue__title">
                  {selected ? selected.name : 'All services'}
                </h2>
                {selected ? (
                  <p className="app-Catalogue__lede">
                    {selected.description ?? 'No description.'}
                    {selected.owner ? ` Owned by ${selected.owner.name}.` : ''}
                    {selected.teamName ? ` Requests go to ${selected.teamName}.` : ''}
                  </p>
                ) : (
                  <p className="app-Catalogue__lede">Everything people can ask for in the portal, by service.</p>
                )}
              </div>
              {selected ? (
                <Button variant="secondary" size="sm" iconStart="pencil" onClick={() => serviceDrawer.open(selected.key)}>
                  Edit service
                </Button>
              ) : null}
            </header>
            <DataTable<RequestTypeView>
              caption={selected ? `Request types in ${selected.name}` : 'Request types'}
              captionHidden
              columns={columns}
              rows={shown}
              rowKey="key"
              search={{ placeholder: 'Search request types', mode: 'client', shortcut: '/' }}
              activate={{ kind: 'drawer', openKind: 'request-type', keyField: 'key' }}
              onActivate={(row) => typeDrawer.open(row.key)}
              {...(openType ? { currentKeys: [openType.key] } : {})}
              rowActionsFor={rowActionsFor}
              onAction={onAction}
              {...(selected && shown.length > 1
                ? {
                    reorderable: {
                      onMove: async (key: string, direction: 'up' | 'down') => {
                        const changes = planMove(
                          shown.map((type) => ({ key: type.key, order: types.find((entry) => entry.key === type.key)?.sortOrder ?? type.sortOrder })),
                          key,
                          direction,
                        );
                        if (changes.length === 0) return;
                        const previous = moves;
                        setMoves((current) => new Map([...current, ...changes.map((change) => [change.key, change.order] as const)]));
                        const result = await reorder.run(changes);
                        if (!result.ok) setMoves(previous);
                      },
                    },
                  }
                : {})}
              countNoun={{ one: 'request type', other: 'request types' }}
              {...(problem ? { problem } : {})}
              empty={{
                title: selected ? `Nothing in ${selected.name} yet` : 'Nothing to ask for yet',
                description: selected ? 'Add the first thing people can ask for under this service.' : 'Add a request type to put something in the portal.',
                icon: 'catalogue',
                action: { id: 'new-request-type', label: 'New request type', icon: 'plus', variant: 'primary' },
              }}
            />
          </section>
        </div>
      )}

      <RequestTypeSheet
        target={target}
        missing={typeDrawer.key !== null && !openType}
        onClose={() => {
          if (typeDrawer.key !== null) typeDrawer.close();
          else create.close();
        }}
        services={services}
        types={types}
        forms={forms}
        teams={teams}
        canEditQuestions={canEditQuestions}
        {...(portalOrigin ? { portalOrigin } : {})}
      />
      <ServiceSheet
        open={create.value === 'service' || serviceDrawer.key !== null}
        {...(openService ? { service: openService } : {})}
        missing={serviceDrawer.key !== null && !openService}
        services={services}
        teams={teams}
        onClose={() => {
          if (serviceDrawer.key !== null) serviceDrawer.close();
          else create.close();
        }}
      />
    </div>
  );
}
