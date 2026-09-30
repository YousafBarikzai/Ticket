'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, type ActionSpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { Popover } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { applyMoves, planMove } from '../catalogue/reorder.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { FieldSheet, type FieldSheetProps } from './FieldSheet.js';
import { payloadOf, STATUS_LOOK, typeInfo, VISIBILITY, type FieldView } from './presentation.js';

/**
 * Ticket fields (SPEC §6.1 `/fields`, §6.4 "Fields"; F27): the custom fields
 * a ticket can carry — what each is, who sees it, which tickets carry it,
 * when it is required — with Active, Retired and All in the URL.
 *
 * A row opens its sheet (`?open=field:<key>`; *New field* is `?new=1`).
 * Move up / Move down (and Alt+↑/↓) set the order the desk sees them in,
 * writing each moved field whole. *Retire* stops a field being set on new
 * tickets and keeps every value already recorded; *Reactivate* brings it
 * back (A11), and each is the other's *Undo*.
 */
export type FieldScope = 'active' | 'retired' | 'all';

export interface FieldsViewProps {
  readonly fields: readonly FieldView[];
  /** Every field, whatever the scope: keys are unique across all of them. */
  readonly allFields: readonly FieldView[];
  readonly scope: FieldScope;
  readonly scopes: readonly { readonly value: FieldScope; readonly label: string; readonly href: string; readonly count?: number }[];
  readonly canManage: boolean;
  readonly permissions: FieldSheetProps['permissions'];
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  readonly problem?: Problem;
}

const statusMap = {
  active: { label: STATUS_LOOK.active.label, tone: STATUS_LOOK.active.tone, icon: STATUS_LOOK.active.icon },
  retired: { label: STATUS_LOOK.retired.label, tone: STATUS_LOOK.retired.tone, icon: STATUS_LOOK.retired.icon },
};

export function FieldsView({ fields, allFields, scope, scopes, canManage, permissions, viewOnly, problem }: FieldsViewProps): ReactNode {
  const drawer = useDrawer('field');
  const create = useCreateParam();
  const [flash, setFlash] = useState<string[]>([]);
  const [moves, setMoves] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => setMoves(new Map()), [fields]);
  const rows = useMemo(() => applyMoves(fields, (field) => field.order, moves), [fields, moves]);
  const open = drawer.key ? allFields.find((field) => field.key === drawer.key) : undefined;

  useEffect(() => {
    if (flash.length === 0) return;
    const timer = window.setTimeout(() => setFlash([]), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const retire = useMutation((field: FieldView) => api.tenant.deactivateField(field.key), {
    success: (row) => `${row.label} retired`,
    undo: async (row) => {
      await api.tenant.reactivateField(row.key);
    },
    failure: 'Couldn’t retire the field',
  });
  const reactivate = useMutation((field: FieldView) => api.tenant.reactivateField(field.key), {
    success: (row) => `${row.label} is active again`,
    undo: async (row) => {
      await api.tenant.deactivateField(row.key);
    },
    failure: 'Couldn’t reactivate the field',
  });
  const reorder = useMutation(
    async (changes: readonly { key: string; order: number }[]) => {
      for (const change of changes) {
        const field = allFields.find((entry) => entry.key === change.key);
        // The whole row, with only its position changed: nothing else is reset.
        if (field) await api.tenant.saveField(field.key, payloadOf(field, { order: change.order }));
      }
    },
    { failure: 'Couldn’t save the new order' },
  );

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'label', header: 'Field', field: 'label', kind: 'title', width: '2fr', minWidth: 180 },
      { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, width: 160 },
      { id: 'type', header: 'Type', field: 'typeLabel', kind: 'text', width: 140, hideBelow: 'sm' },
      { id: 'visibility', header: 'Visible to', field: 'visibilityLabel', kind: 'text', width: 150 },
      { id: 'applies', header: 'Applies to', field: 'appliesLabel', kind: 'text', width: '1fr', hideBelow: 'lg' },
      { id: 'required', header: 'Required', field: 'requiredLabel', kind: 'text', width: '1fr', hideBelow: 'md', truncate: 2 },
      ...(scope === 'all' ? [{ id: 'status', header: 'Status', field: 'status', kind: 'status' as const, map: statusMap, srPrefix: 'Status', width: 120, cardRole: 'badge' as const }] : []),
    ],
    [scope],
  );

  const rowActionsFor = (row: FieldView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'edit', label: canManage ? 'Edit' : 'Open', icon: canManage ? 'pencil' : 'eye' }];
    if (!canManage) return actions;
    if (row.isActive) {
      actions.push({
        id: 'retire',
        label: 'Retire…',
        icon: 'archive',
        tone: 'danger',
        confirm: {
          title: `Retire ${row.label}?`,
          body: 'Stops it being set on new tickets. Existing values stay, and you can reactivate it later.',
          confirmLabel: 'Retire field',
          tone: 'danger',
          ...(row.usedByRules.length > 0
            ? { consequences: [{ label: `Read by ${row.usedByRules.length === 1 ? 'a rule' : `${row.usedByRules.length} rules`}: ${row.usedByRules.join(', ')}`, href: '/rules' }] }
            : {}),
        },
      });
    } else actions.push({ id: 'reactivate', label: 'Reactivate', icon: 'undo-2' });
    return actions;
  };

  const emptyTitle = scope === 'retired' ? 'No retired fields' : 'No custom fields yet';
  const emptyText =
    scope === 'retired'
      ? 'Fields you retire are listed here, with their values kept.'
      : 'Tickets have the standard fields only. Add one to collect more, such as a cost centre.';

  return (
    <div className="app-Page app-Fields">
      <PageHeader
        title="Ticket fields"
        {...(viewOnly ? { viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-field', label: 'New field', icon: 'plus', variant: 'primary', shortcut: 'c' } as ActionSpec } : {})}
        onAction={(id) => {
          if (id === 'new-field') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">Custom fields</h2>
      <DataTable<FieldView>
        caption="Ticket fields"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="key"
        search={{ placeholder: 'Search fields', mode: 'client', shortcut: '/' }}
        scope={{ label: 'Show', value: scope, options: scopes }}
        activate={{ kind: 'drawer', openKind: 'field', keyField: 'key' }}
        onActivate={(row) => drawer.open(row.key)}
        {...(open ? { currentKeys: [open.key] } : {})}
        highlightKeys={flash}
        rowActionsFor={rowActionsFor}
        onAction={async (id, targets) => {
          if (id === 'new-field') create.open('1');
          const row = targets[0];
          if (!row) return;
          if (id === 'edit') drawer.open(row.key);
          if (id === 'retire') await retire.run(row);
          if (id === 'reactivate') await reactivate.run(row);
        }}
        {...(canManage && scope === 'active' && rows.length > 1
          ? {
              reorderable: {
                onMove: async (key: string, direction: 'up' | 'down') => {
                  const changes = planMove(
                    rows.map((row) => ({ key: row.key, order: moves.get(row.key) ?? row.order })),
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
        cells={{
          type: (row) => (
            <span className="app-FieldType">
              <Icon name={typeInfo(row.type).icon} size="sm" />
              <span>{row.typeLabel}</span>
            </span>
          ),
          visibility: (row) =>
            row.classification === 'restricted' ? (
              <Popover
                title={`Who sees ${row.label}`}
                width="sm"
                trigger={
                  <button type="button" className="app-VisibilityPill" aria-label={`Restricted: see who can see ${row.label}`}>
                    <Icon name="lock" size="xs" />
                    <span>Restricted</span>
                  </button>
                }
              >
                <p className="app-VisibilityPill__intro">People who work tickets and hold any one of:</p>
                <ul className="app-VisibilityPill__list">
                  {row.visibleToLabels.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </Popover>
            ) : (
              <span className="app-FieldVisibility">
                <Icon name={VISIBILITY[row.classification].icon} size="xs" />
                <span>{row.visibilityLabel}</span>
              </span>
            ),
        }}
        countNoun={{ one: 'field', other: 'fields' }}
        {...(problem ? { problem } : {})}
        empty={{
          title: emptyTitle,
          description: emptyText,
          icon: 'fields',
          ...(canManage && scope !== 'retired' ? { action: { id: 'new-field', label: 'New field', icon: 'plus', variant: 'primary' } } : {}),
        }}
      />
      <FieldSheet
        open={open !== undefined || (canManage && create.value !== null)}
        {...(open ? { field: open } : {})}
        missing={drawer.key !== null && !open}
        fields={allFields}
        permissions={permissions}
        onClose={() => {
          if (drawer.key !== null) drawer.close();
          else create.close();
        }}
        onSaved={(key) => setFlash([key])}
      />
    </div>
  );
}
