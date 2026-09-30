'use client';

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamMemberRow } from '@itsm/sdk';
import {
  Avatar,
  Button,
  Checkbox,
  EmptyState,
  Form,
  FormField,
  InlineAlert,
  Input,
  RelativeTime,
  Select,
  SkeletonText,
  StatusPill,
  notify,
  useItsm,
  type ActionSpec,
  type Problem,
} from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { PersonPicker, Sheet, type PersonOption } from '@itsm/ui/overlays';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useDrawer } from '../../client/useDrawer.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { useCreateParam } from '../catalogue/useCreate.js';
import { KeyField } from '../KeyField.js';
import type { KeyState } from '../../keys.js';
import { firstName, leadsLabel, type TeamRowView } from './presentation.js';
import type { NamedOption, PeopleHeader } from './types.js';

/**
 * People › Teams (SPEC §6.1 `/people/teams`, A6): the groups work is routed
 * to — each with its organisation, how many people are in it and who leads
 * it. A row opens the team (`?open=team:<id>`) with its members and, for
 * people who manage teams, *Add member*; *New team* opens its sheet
 * (`?new=1`). The API has no way to take someone out of a team yet, so the
 * page does not offer one.
 */
export interface TeamsViewProps {
  readonly header: PeopleHeader;
  readonly rows: readonly TeamRowView[];
  /** Members by team, when the page read them (small directories): the drawer shows them at once. */
  readonly members: Readonly<Record<string, readonly TeamMemberRow[]>>;
  readonly problem?: Problem;
  readonly canManage: boolean;
  /** Organisations for the New team sheet; null when they cannot be read (and New team is not offered). */
  readonly organisations: readonly NamedOption[] | null;
  /** Links to a person's details, when this person may open People. */
  readonly peopleHref?: string;
}

const NOUN = { one: 'team', other: 'teams' } as const;
const OFFLINE = 'You’re offline — changes can’t be saved.';

type Members = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly rows: readonly TeamMemberRow[] } | { readonly kind: 'failed'; readonly problem: Problem };

export function TeamsView(props: TeamsViewProps): ReactNode {
  const { header, rows, canManage, organisations } = props;
  const router = useRouter();
  const online = useOnline();
  const { Link } = useItsm();
  const drawer = useDrawer('team');
  const create = useCreateParam();
  const [flash, setFlash] = useState<string[]>([]);
  const [members, setMembers] = useState<Members>({ kind: 'loading' });
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [lead, setLead] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;

  useEffect(() => {
    if (flash.length === 0) return;
    const timer = window.setTimeout(() => setFlash([]), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const loadMembers = useCallback(async (teamId: string) => {
    setMembers({ kind: 'loading' });
    try {
      setMembers({ kind: 'ready', rows: await api.tenant.teamMembers(teamId) });
    } catch (error) {
      setMembers({ kind: 'failed', problem: problemFrom(error) });
    }
  }, []);

  useEffect(() => {
    setPerson(null);
    setLead(false);
    setMemberError(null);
    if (!drawer.key) return;
    const known = props.members[drawer.key];
    if (known) setMembers({ kind: 'ready', rows: known });
    else void loadMembers(drawer.key);
  }, [drawer.key, props.members, loadMembers]);

  const add = useMutation((teamId: string, userId: string, isLead: boolean) => api.tenant.addTeamMember(teamId, userId, isLead), {
    failure: 'Couldn’t add them to the team',
  });

  const addMember = async (): Promise<void> => {
    if (!open) return;
    setMemberError(null);
    if (!person) {
      setMemberError('Choose who to add.');
      return;
    }
    if (members.kind === 'ready' && members.rows.some((row) => row.userId === person.id)) {
      setMemberError(`${person.name} is already in ${open.name}.`);
      return;
    }
    const result = await add.run(open.id, person.id, lead);
    if (!result.ok) {
      if (result.problem.status === 422 || result.problem.status === 404) setMemberError(result.problem.detail ?? 'They couldn’t be added.');
      return;
    }
    notify(`${firstName(person.name)} added to ${open.name}${lead ? ' as a lead' : ''}`, { tone: 'success' });
    setPerson(null);
    setLead(false);
    void loadMembers(open.id);
  };

  const anyLeads = rows.some((row) => row.leads !== null);
  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'name', header: 'Team', field: 'name', kind: 'title', secondaryField: 'orgName', minWidth: 200, width: '2fr' },
      { id: 'org', header: 'Organisation', field: 'orgName', minWidth: 160, width: '2fr', hideBelow: 'md', empty: 'One you can’t see' },
      { id: 'members', header: 'Members', field: 'memberCount', kind: 'number', sortable: 'page', width: 120, minWidth: 110, cardRole: 'badge' },
      ...(anyLeads ? [{ id: 'leads', header: 'Lead', field: 'leads', minWidth: 160, width: '2fr' as const, hideBelow: 'sm' as const }] : []),
    ],
    [anyLeads],
  );

  const orgOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (row.orgName) seen.set(row.orgId, row.orgName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  }, [rows]);
  const filters = useMemo<FilterSpec[]>(
    () => (orgOptions.length > 1 ? [{ id: 'org', label: 'Organisation', type: 'select', pinned: true, field: 'orgId', options: orgOptions }] : []),
    [orgOptions],
  );

  const mayCreate = canManage && organisations !== null && organisations.length > 0;
  const primaryAction: ActionSpec | undefined = mayCreate ? { id: 'new-team', label: 'New team', icon: 'plus', variant: 'primary', shortcut: 'c' } : undefined;

  return (
    <div className="app-Page app-People">
      <PageHeader
        title="People"
        tabs={header.tabs}
        {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})}
        {...(primaryAction ? { primaryAction } : {})}
        onAction={(id) => {
          if (id === 'new-team') create.open('1');
        }}
      />
      <h2 className="itsm-visually-hidden">Teams</h2>
      <DataTable<TeamRowView>
        caption="Teams"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="id"
        urlKey=""
        search={{ placeholder: 'Search teams', mode: 'client', shortcut: '/' }}
        filters={filters}
        activate={{ kind: 'drawer', openKind: 'team', keyField: 'id' }}
        onActivate={(row) => drawer.open(row.id)}
        {...(open ? { currentKeys: [open.id] } : {})}
        highlightKeys={flash}
        onAction={(id) => {
          if (id === 'new-team') create.open('1');
        }}
        cells={{
          members: (row) => <span className="app-People__count">{row.membersLabel}</span>,
          leads: (row) => <span className={row.leads && row.leads.length > 0 ? undefined : 'app-People__quiet'}>{leadsLabel(row.leads)}</span>,
        }}
        countNoun={NOUN}
        {...(props.problem ? { problem: props.problem, onRetry: () => router.refresh() } : {})}
        empty={{
          title: 'No teams yet',
          description: 'Teams are where work is routed: each ticket can belong to one, and people see their teams’ work.',
          icon: 'people',
          ...(primaryAction ? { action: primaryAction } : {}),
        }}
        noResults={{ title: 'No teams match', description: 'Try other words, or clear the filters.' }}
      />

      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.name ?? 'Team'}
        {...(open ? { description: open.orgName ?? 'An organisation you can’t see' } : {})}
        {...(open ? { headerMeta: <span className="app-People__count">{open.membersLabel}</span> } : {})}
      >
        {drawer.key !== null && !open ? (
          <EmptyState
            size="sm"
            title="That team isn’t on this desk"
            description="It may have been removed, or the link is from another workspace."
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={() => drawer.close()}
          />
        ) : open ? (
          <div className="app-PersonDrawer">
            <section className="app-PersonDrawer__section" aria-labelledby="app-team-members">
              <h3 id="app-team-members" className="app-PersonDrawer__heading">
                Members
              </h3>
              {members.kind === 'loading' ? (
                <SkeletonText lines={3} />
              ) : members.kind === 'failed' ? (
                <InlineAlert tone="danger">
                  <span className="app-PersonDrawer__retry">
                    Couldn’t load the members.
                    <Button size="sm" variant="ghost" onClick={() => void loadMembers(open.id)}>
                      Try again
                    </Button>
                  </span>
                </InlineAlert>
              ) : members.rows.length === 0 ? (
                <p className="app-PersonDrawer__quiet">Nobody is in {open.name} yet{canManage ? ' — add the first member below.' : '.'}</p>
              ) : (
                <ul className="app-Members" aria-label={`Members of ${open.name}`}>
                  {members.rows.map((member) => (
                    <li key={member.userId} className="app-Member">
                      <Avatar name={member.displayName} size="sm" decorative />
                      <span className="app-Member__text">
                        {props.peopleHref ? (
                          <Link href={`${props.peopleHref}?open=person:${member.userId}`} className="app-People__link">
                            {member.displayName}
                          </Link>
                        ) : (
                          <span>{member.displayName}</span>
                        )}
                        <span className="app-People__quiet">
                          Since <RelativeTime date={member.since} mode="absolute" absoluteStyle="date" />
                        </span>
                      </span>
                      {member.isLead ? <StatusPill size="sm" tone="info" icon="star" label="Lead" /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canManage ? (
              <section className="app-PersonDrawer__section app-PersonDrawer__form" aria-labelledby="app-team-add">
                <h3 id="app-team-add" className="app-PersonDrawer__heading">
                  Add member
                </h3>
                <FormField label="Person">
                  {(control) => (
                    <PersonPicker
                      {...control}
                      value={person}
                      onChange={(next) => {
                        setPerson(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null));
                        setMemberError(null);
                      }}
                      loadPeople={async (typed) => {
                        const found = await api.tenant.users({ q: typed || undefined, limit: 20, status: 'active' });
                        return found.map((row) => ({ id: row.id, name: row.displayName || row.email, detail: row.email }));
                      }}
                      placeholder="Search people"
                    />
                  )}
                </FormField>
                <Checkbox label="Make them a lead of the team" checked={lead} onChange={(event) => setLead(event.currentTarget.checked)} />
                {memberError ? (
                  <p className="app-PersonDrawer__error" role="alert">
                    {memberError}
                  </p>
                ) : null}
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    iconStart="user-plus"
                    loading={add.pending}
                    loadingLabel="Adding…"
                    onClick={() => void addMember()}
                    {...(online ? {} : { disabledReason: OFFLINE })}
                  >
                    Add to {open.name}
                  </Button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {mayCreate ? (
        <NewTeamSheet
          open={create.value !== null}
          organisations={organisations!}
          taken={rows.map((row) => row.key)}
          onClose={() => create.close()}
          onCreated={(id) => {
            setFlash([id]);
            create.close();
          }}
        />
      ) : null}
    </div>
  );
}

function NewTeamSheet({
  open,
  organisations,
  taken,
  onClose,
  onCreated,
}: {
  readonly open: boolean;
  readonly organisations: readonly NamedOption[];
  readonly taken: readonly string[];
  onClose(): void;
  onCreated(id: string): void;
}): ReactNode {
  const formId = useId();
  const online = useOnline();
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyState, setKeyState] = useState<KeyState>('empty');
  const create = useMutation((input: { key: string; name: string; orgId: string }) => api.tenant.createTeam(input), {
    success: (team) => `${team.name} created`,
    failure: 'Couldn’t create the team',
  });

  const close = (): void => {
    setDirty(false);
    setName('');
    setKey('');
    setKeyState('empty');
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
      title="New team"
      description="A group work can be routed to. Add its people from the team once it exists."
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={create.pending} loadingLabel="Creating…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Create team
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="New team"
          onDirtyChange={setDirty}
          onSubmit={async (data) => {
            const orgId = String(data.get('orgId') ?? '');
            const errors: Record<string, string> = {};
            if (name.trim() === '') errors.name = 'Enter the team’s name.';
            else if (name.trim().length > 200) errors.name = 'Keep the name to 200 characters.';
            if (keyState !== 'ok') errors.key = keyState === 'taken' ? 'Another team already uses this key. Edit the key or change the name.' : 'Edit the key by hand: this name can’t make one.';
            if (!orgId) errors.orgId = 'Choose the organisation it belongs to.';
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const result = await create.run({ key, name: name.trim(), orgId });
            if (!result.ok) {
              if (result.problem.status === 409) return { fieldErrors: { key: 'Another team already uses that key.' } };
              return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'The team wasn’t created.' };
            }
            setDirty(false);
            onCreated(result.value.id);
            return undefined;
          }}
        >
          <FormField label="Name" required>
            <Input name="name" autoComplete="off" maxLength={200} value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </FormField>
          <KeyField source={name} rule="slug" value={key} onChange={setKey} onStateChange={setKeyState} taken={taken} noun="team" />
          <FormField label="Organisation" required>
            <Select name="orgId" defaultValue={organisations.length === 1 ? organisations[0]!.value : ''} placeholder="Choose an organisation" options={organisations} />
          </FormField>
        </Form>
      ) : null}
    </Sheet>
  );
}
