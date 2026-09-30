'use client';

import { useId, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, EmptyState, Form, FormField, Input, Select, useItsm, type ActionSpec, type Problem } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { codeFromName, organisationProblems, type OrgNode } from './presentation.js';
import type { NamedOption, PeopleHeader } from './types.js';

/**
 * People › Organisations (SPEC §6.1 `/people/organisations`): the
 * organisation structure as a nested list — the tree people, teams and
 * scoped roles hang from — with how many teams each holds (a link to them).
 * *New organisation* (`?new=1`, or *Add under…* on a row for a
 * sub-organisation) needs `tenant.org.manage`, the API's own gate for it.
 */
export interface OrganisationsViewProps {
  readonly header: PeopleHeader;
  readonly tree: readonly OrgNode[];
  /** Teams per organisation, when the team directory could be read. */
  readonly teamCounts: Readonly<Record<string, number>> | null;
  readonly problem?: Problem;
  readonly canManage: boolean;
  /** Every organisation, indented, for the parent select. */
  readonly options: readonly NamedOption[];
  readonly takenCodes: readonly (string | null)[];
  readonly teamsHref?: string;
}

const OFFLINE = 'You’re offline — changes can’t be saved.';

export function OrganisationsView(props: OrganisationsViewProps): ReactNode {
  const { header, tree, canManage } = props;
  const router = useRouter();
  const create = useCreateParam();
  const primaryAction: ActionSpec | undefined = canManage ? { id: 'new-org', label: 'New organisation', icon: 'plus', variant: 'primary', shortcut: 'c' } : undefined;

  return (
    <div className="app-Page app-People">
      <PageHeader
        title="People"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(primaryAction ? { primaryAction } : {})}
        onAction={(id) => {
          if (id === 'new-org') create.open('1');
        }}
      />
      {props.problem ? (
        <Card title="Organisations" problem={props.problem} onRetry={() => router.refresh()} />
      ) : tree.length === 0 ? (
        <EmptyState
          title="No organisations yet"
          description="Organisations are the structure people, teams and scoped roles belong to."
          icon="people"
          {...(primaryAction ? { action: primaryAction, onAction: () => create.open('1') } : {})}
        />
      ) : (
        <Card title="Organisations" subtitle="The structure people, teams and scoped roles belong to." headerDivider>
          <OrgList
            nodes={tree}
            depth={0}
            teamCounts={props.teamCounts}
            {...(props.teamsHref ? { teamsHref: props.teamsHref } : {})}
            canManage={canManage}
            onAddUnder={(id) => create.open('1', { parent: id })}
          />
        </Card>
      )}
      {canManage ? (
        <NewOrganisationSheet
          open={create.value !== null}
          parent={create.params.get('parent') ?? ''}
          options={props.options}
          takenCodes={props.takenCodes}
          onClose={() => create.close()}
        />
      ) : null}
    </div>
  );
}

function OrgList({
  nodes,
  depth,
  teamCounts,
  teamsHref,
  canManage,
  onAddUnder,
}: {
  readonly nodes: readonly OrgNode[];
  readonly depth: number;
  readonly teamCounts: Readonly<Record<string, number>> | null;
  readonly teamsHref?: string;
  readonly canManage: boolean;
  onAddUnder(id: string): void;
}): ReactNode {
  const { Link } = useItsm();
  const online = useOnline();
  return (
    <ul className="app-Orgs" data-depth={depth} {...(depth === 0 ? { 'aria-label': 'Organisations' } : {})}>
      {nodes.map((node) => {
        const teams = teamCounts ? (teamCounts[node.id] ?? 0) : null;
        return (
          <li key={node.id} className="app-Org">
            <div className="app-Org__row">
              <span className="app-Org__text">
                <span className="app-Org__name">{node.name}</span>
                {node.code ? <code className="app-Org__code">{node.code}</code> : null}
              </span>
              <span className="app-Org__meta">
                {teams === null ? null : teams === 0 ? (
                  <span className="app-People__quiet">No teams</span>
                ) : teamsHref ? (
                  <Link href={`${teamsHref}?org=${node.id}`} className="app-People__link">
                    {teams === 1 ? '1 team' : `${teams} teams`}
                  </Link>
                ) : (
                  <span className="app-People__quiet">{teams === 1 ? '1 team' : `${teams} teams`}</span>
                )}
                {canManage ? (
                  <Button size="sm" variant="ghost" iconStart="plus" onClick={() => onAddUnder(node.id)} aria-label={`Add an organisation under ${node.name}`} {...(online ? {} : { disabledReason: OFFLINE })}>
                    Add under…
                  </Button>
                ) : null}
              </span>
            </div>
            {node.children.length > 0 ? (
              <OrgList nodes={node.children} depth={depth + 1} teamCounts={teamCounts} {...(teamsHref ? { teamsHref } : {})} canManage={canManage} onAddUnder={onAddUnder} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NewOrganisationSheet({
  open,
  parent,
  options,
  takenCodes,
  onClose,
}: {
  readonly open: boolean;
  readonly parent: string;
  readonly options: readonly NamedOption[];
  readonly takenCodes: readonly (string | null)[];
  onClose(): void;
}): ReactNode {
  const formId = useId();
  const online = useOnline();
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const create = useMutation((input: { name: string; code: string; parentId?: string }) => api.tenant.createOrganisation(input), {
    success: (org) => `${org.name} added`,
    failure: 'Couldn’t add the organisation',
  });
  const shownCode = codeEdited ? code : codeFromName(name);

  const close = (): void => {
    setDirty(false);
    setName('');
    setCode('');
    setCodeEdited(false);
    create.reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="sm"
      title="New organisation"
      description="A part of the organisation people and teams belong to, such as a company, a country or a department."
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={create.pending} loadingLabel="Adding…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Add organisation
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="New organisation"
          onDirtyChange={setDirty}
          onSubmit={async (data) => {
            const parentId = String(data.get('parentId') ?? '');
            const errors = organisationProblems({ name, code: shownCode }, takenCodes);
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const result = await create.run({ name: name.trim(), code: shownCode.trim(), ...(parentId ? { parentId } : {}) });
            if (!result.ok) {
              if (result.problem.status === 409) return { fieldErrors: { code: 'Another organisation already uses that code.' } };
              return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The organisation wasn’t added.' };
            }
            close();
            return undefined;
          }}
        >
          <FormField label="Name" required>
            <Input name="name" autoComplete="off" maxLength={200} value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </FormField>
          <FormField label="Code" required hint="Short and unique, such as ACME-UK: how integrations and your identity provider name it.">
            <Input
              name="code"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              value={shownCode}
              onChange={(event) => {
                setCodeEdited(true);
                setCode(event.currentTarget.value);
              }}
            />
          </FormField>
          <FormField label="Part of" optional hint="Leave empty for a top-level organisation.">
            <Select name="parentId" defaultValue={parent} options={[{ value: '', label: 'Nothing — top level' }, ...options]} />
          </FormField>
        </Form>
      ) : null}
    </Sheet>
  );
}
