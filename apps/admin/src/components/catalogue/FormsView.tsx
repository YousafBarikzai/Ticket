'use client';

import { useMemo, type ReactNode } from 'react';
import { useItsm, type ActionSpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useMutation } from '../../client/useMutation.js';
import { NewFormDialog } from './NewFormDialog.js';
import { FORM_STATE_LOOK, formStateLabel, type FormState, type FormView } from './presentation.js';
import { useCreateParam } from './useCreate.js';

/**
 * Services & requests › Forms (SPEC §6.1): every form, whether it is live
 * (and at which version) or has changes nobody has published, and which
 * request types ask it. A row opens the form editor. *New form* starts one
 * blank or from a copy; *Publish* on a row with unpublished changes puts
 * them live after a confirmation.
 */
export interface FormRowView extends Record<string, unknown> {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: FormState;
  readonly stateLabel: string;
  readonly version: number;
  readonly questionCount: number;
  readonly usedBy: readonly { readonly key: string; readonly name: string }[];
  /** A draft that is the questions of a request type not yet live. */
  readonly draftFor: string | null;
  readonly updatedAt: string;
}

export function FormsView({
  tabs,
  forms,
  rows,
  canManage,
  canSeeRequestTypes,
  viewOnly,
  problem,
}: {
  readonly tabs: readonly { id: string; label: string; href: string; match?: 'exact' }[];
  readonly forms: readonly FormView[];
  readonly rows: readonly FormRowView[];
  readonly canManage: boolean;
  /** May open request types (`catalogue.manage`): "Used by" links to them. */
  readonly canSeeRequestTypes: boolean;
  readonly viewOnly?: { readonly label: string; readonly permission: string; readonly key: string };
  readonly problem?: Problem;
}): ReactNode {
  const create = useCreateParam();
  const { Link } = useItsm();
  const fromKey = create.params.get('from');
  const from = fromKey ? forms.find((form) => form.key === fromKey) : undefined;

  const publish = useMutation((key: string) => api.configure.catalogue.publishForm(key), {
    success: (form) => `${form.name} published as version ${form.version}`,
    failure: 'Couldn’t publish the form',
  });

  const stateMap = useMemo(() => {
    const map: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning'; icon: 'circle-dashed' | 'circle-check' | 'pencil' }> = {};
    // Keyed by the words the cell shows ("Live · v3"), with the state's tone and icon.
    for (const row of rows) map[row.stateLabel] = { ...FORM_STATE_LOOK[row.state], label: row.stateLabel } as (typeof map)[string];
    return map;
  }, [rows]);

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Form', field: 'name', kind: 'title', secondaryField: 'description', href: '/catalogue/forms/{key}', width: '3fr', minWidth: 220, truncate: 2 },
      { id: 'state', header: 'Status', field: 'stateLabel', kind: 'status', map: stateMap, srPrefix: 'Status', width: 196, cardRole: 'badge' },
      { id: 'questions', header: 'Questions', field: 'questionCount', kind: 'number', width: 112, hideBelow: 'md' },
      { id: 'used', header: 'Used by', field: 'usedBy', kind: 'text', width: '2fr', hideBelow: 'sm' },
      { id: 'updated', header: 'Updated', field: 'updatedAt', kind: 'relative', width: 120, hideBelow: 'lg' },
      { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, width: 160 },
    ],
    [stateMap],
  );

  const rowActionsFor = (row: FormRowView): ActionSpec[] => {
    const actions: ActionSpec[] = [{ id: 'open', label: canManage ? 'Edit' : 'Open', icon: canManage ? 'pencil' : 'eye', href: '/catalogue/forms/{key}' }];
    if (!canManage) return actions;
    if (row.state !== 'live') {
      actions.push({
        id: 'publish',
        label: 'Publish…',
        icon: 'upload',
        confirm: {
          title: `Publish ${row.name}?`,
          body:
            row.state === 'draft'
              ? `Publishes its questions.${row.usedBy.length > 0 ? ' Requesters see them immediately.' : ' No request type asks them yet.'}`
              : `Publishes the saved changes as version ${row.version + 1}. People who already started keep the version they opened.`,
          confirmLabel: 'Publish',
          ...(row.usedBy.length > 0 ? { consequences: row.usedBy.map((type) => ({ label: `Asked by ${type.name}`, ...(canSeeRequestTypes ? { href: `/catalogue?open=request-type:${encodeURIComponent(type.key)}` } : {}) })) } : {}),
        },
      });
    }
    actions.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy' });
    return actions;
  };

  return (
    <div className="app-Page app-Catalogue">
      <PageHeader
        title="Services & requests"
        tabs={[...tabs]}
        {...(viewOnly ? { viewOnly } : {})}
        {...(canManage ? { primaryAction: { id: 'new-form', label: 'New form', icon: 'plus', variant: 'primary', shortcut: 'c' } as ActionSpec } : {})}
        onAction={(id) => {
          if (id === 'new-form') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">Forms</h2>
      <DataTable<FormRowView>
        caption="Forms"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="key"
        search={{ placeholder: 'Search forms', mode: 'client', shortcut: '/' }}
        activate={{ kind: 'link' }}
        rowActionsFor={rowActionsFor}
        onAction={async (id, targets) => {
          if (id === 'new-form') create.open('1');
          const row = targets[0];
          if (!row) return;
          if (id === 'publish') await publish.run(row.key);
          if (id === 'duplicate') create.open('1', { from: row.key });
        }}
        cells={{
          used: (row) =>
            row.usedBy.length === 0 ? (
              <span className="app-Muted">{row.draftFor ? `Being written for ${row.draftFor}` : 'Not used yet'}</span>
            ) : (
              <span className="app-UsedBy">
                {row.usedBy.slice(0, 2).map((type, index) => (
                  <span key={type.key}>
                    {index > 0 ? ', ' : ''}
                    {canSeeRequestTypes ? <Link href={`/catalogue?open=request-type:${encodeURIComponent(type.key)}`}>{type.name}</Link> : type.name}
                  </span>
                ))}
                {row.usedBy.length > 2 ? ` and ${row.usedBy.length - 2} more` : ''}
              </span>
            ),
        }}
        countNoun={{ one: 'form', other: 'forms' }}
        {...(problem ? { problem } : {})}
        empty={{
          title: 'No forms yet',
          description: 'A form is the questions a request type asks. Most are written in the request type itself; make one here to share it between several.',
          icon: 'forms',
          ...(canManage ? { action: { id: 'new-form', label: 'New form', icon: 'plus', variant: 'primary' } } : {}),
        }}
      />
      {canManage ? <NewFormDialog open={create.value !== null} onClose={create.close} forms={forms} {...(from ? { from } : {})} /> : null}
    </div>
  );
}
