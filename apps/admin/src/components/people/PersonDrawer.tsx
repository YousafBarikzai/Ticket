'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AvailabilityRow, RoleAssignmentRow, RoleRow } from '@itsm/sdk';
import {
  Button,
  Checkbox,
  DescriptionList,
  EmptyState,
  FormField,
  IconButton,
  InlineAlert,
  Select,
  SkeletonText,
  StatusPill,
  notify as toast,
  useItsm,
  type Problem,
} from '@itsm/ui';
import { ConfirmDialog, Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { STATUS_LOOK as AVAILABILITY_LOOK, statusNote } from '../workforce/presentation.js';
import {
  firstName,
  grantView,
  holdsGrant,
  isActive,
  personRow,
  sortGrants,
  userStatusLook,
  type GrantScopeType,
  type GrantView,
  type PersonRowView,
  type ScopeNames,
} from './presentation.js';
import type { NamedOption, PeopleAbilities, TeamOption } from './types.js';

/**
 * One person (`?open=person:<id>`, SPEC §6.1 `/people`, B §3.16): who they
 * are, the roles they hold and where, the teams they are in, whether they
 * are available — and, for people who manage the directory, *Deactivate…*
 * or *Reactivate*.
 *
 * Each section loads for itself when the drawer opens and fails on its own,
 * so a person whose teams could not be checked still shows their roles.
 * Every change goes through `useMutation` (the console's one write path) and
 * re-reads only the section it changed.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';
/** Teams checked for membership, at most: one request each, so a directory of hundreds is checked in part and says so. */
const MAX_TEAM_CHECKS = 60;

type Section<T> = { readonly kind: 'idle' } | { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly value: T } | { readonly kind: 'failed'; readonly problem: Problem };

interface Membership {
  readonly teamId: string;
  readonly name: string;
  readonly isLead: boolean;
}

function useSection<T>(load: (() => Promise<T>) | null, deps: readonly unknown[]): [Section<T>, () => void] {
  const [state, setState] = useState<Section<T>>({ kind: 'idle' });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!load) {
      setState({ kind: 'idle' });
      return;
    }
    let live = true;
    setState({ kind: 'loading' });
    load().then(
      (value) => {
        if (live) setState({ kind: 'ready', value });
      },
      (error: unknown) => {
        if (live) setState({ kind: 'failed', problem: problemFrom(error) });
      },
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt every render; the caller's deps say when it means something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, generation]);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return [state, reload];
}

export interface PersonDrawerProps {
  /** The open person's id, or null when the drawer is closed. */
  readonly personId: string | null;
  /** Their row, when the list has it (the instant placeholder, D12). */
  readonly row: PersonRowView | undefined;
  readonly abilities: PeopleAbilities;
  readonly meId: string | null;
  /** Roles to give, least access to most; null when roles cannot be read. */
  readonly roles: readonly RoleRow[] | null;
  /** Teams by name; null when the team directory cannot be read. */
  readonly teams: readonly TeamOption[] | null;
  /** Organisations for scoped roles, indented; null when they cannot be read. */
  readonly organisations: readonly NamedOption[] | null;
  readonly orgNames: Readonly<Record<string, string>>;
  /** Where availability is changed, when this person may open it. */
  readonly workforceHref?: string;
  onClose(): void;
}

export function PersonDrawer(props: PersonDrawerProps): ReactNode {
  const { personId, abilities, roles, teams, organisations, onClose } = props;
  const online = useOnline();
  const { Link, locale, timeZone } = useItsm();
  const gate = online ? {} : { disabledReason: OFFLINE };
  const orgNames = useMemo(() => new Map(Object.entries(props.orgNames)), [props.orgNames]);
  const names: ScopeNames = useMemo(
    () => ({ organisations: orgNames, teams: new Map((teams ?? []).map((team) => [team.id, team.name])) }),
    [orgNames, teams],
  );

  // The person: the list's row at once; otherwise (a pasted link, a person outside the list) read them.
  const [fetched, reloadPerson] = useSection<PersonRowView | null>(
    personId && !props.row
      ? () =>
          api.tenant.user(personId).then(
            (user) => personRow(user, orgNames, props.meId),
            (error: unknown) => {
              if (problemFrom(error).status === 404) return null;
              throw error;
            },
          )
      : null,
    [personId, Boolean(props.row)],
  );
  const person = props.row ?? (fetched.kind === 'ready' ? fetched.value : null);
  const [statusOverride, setStatusOverride] = useState<{ id: string; status: string } | null>(null);
  const status = person && statusOverride?.id === person.id ? statusOverride.status : person?.status;
  const active = status ? isActive(status) : false;

  const [grants, reloadGrants] = useSection<RoleAssignmentRow[]>(
    personId && abilities.readRoles ? () => api.tenant.roleAssignments(personId) : null,
    [personId, abilities.readRoles],
  );

  const checked = useMemo(() => (teams ?? []).slice(0, MAX_TEAM_CHECKS), [teams]);
  const [memberships, reloadMemberships] = useSection<Membership[]>(
    personId && teams
      ? async () => {
          const found = await Promise.all(
            checked.map(async (team) => {
              const members = await api.tenant.teamMembers(team.id);
              const member = members.find((entry) => entry.userId === personId);
              return member ? { teamId: team.id, name: team.name, isLead: member.isLead } : null;
            }),
          );
          return found.filter((entry): entry is Membership => entry !== null).sort((a, b) => a.name.localeCompare(b.name));
        }
      : null,
    [personId, checked],
  );

  const [availability] = useSection<AvailabilityRow | null>(
    personId && abilities.readAvailability ? () => api.observe.queues.availability().then((rows) => rows.find((row) => row.userId === personId) ?? null) : null,
    [personId, abilities.readAvailability],
  );

  useEffect(() => {
    setStatusOverride(null);
  }, [personId]);

  /* ---- Deactivate and reactivate -------------------------------------------- */

  const [confirming, setConfirming] = useState<'deactivate' | 'reactivate' | null>(null);
  const deactivate = useMutation((id: string, reason?: string) => api.tenant.deactivateUser(id, reason), { failure: 'Couldn’t deactivate them' });
  const reactivate = useMutation((id: string) => api.tenant.reactivateUser(id), { failure: 'Couldn’t reactivate them' });

  /* ---- Roles ---------------------------------------------------------------- */

  const [removing, setRemoving] = useState<GrantView | null>(null);
  const removeGrant = useMutation((id: string) => api.tenant.removeRoleAssignment(id), { failure: 'Couldn’t remove the role', refresh: false });
  const [roleKey, setRoleKey] = useState('');
  const [scopeType, setScopeType] = useState<'workspace' | GrantScopeType>('workspace');
  const [scopeId, setScopeId] = useState('');
  const [roleError, setRoleError] = useState<string | null>(null);
  const assign = useMutation(
    (userId: string, key: string, scope?: { scopeType: GrantScopeType; scopeId: string }) => api.tenant.assignRole(userId, key, scope),
    { failure: 'Couldn’t give the role', refresh: false },
  );

  /* ---- Teams ---------------------------------------------------------------- */

  const [teamId, setTeamId] = useState('');
  const [lead, setLead] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const addToTeam = useMutation((team: string, userId: string, isLead: boolean) => api.tenant.addTeamMember(team, userId, isLead), {
    failure: 'Couldn’t add them to the team',
    refresh: false,
  });

  useEffect(() => {
    setRoleKey('');
    setScopeType('workspace');
    setScopeId('');
    setRoleError(null);
    setTeamId('');
    setLead(false);
    setTeamError(null);
  }, [personId]);

  if (personId === null) {
    return <Sheet open={false} onOpenChange={() => undefined} title="Person" size="md">{null}</Sheet>;
  }

  const first = person ? firstName(person.name) : 'them';
  const look = status ? userStatusLook(status) : null;
  const grantViews = grants.kind === 'ready' ? sortGrants(grants.value.map((row) => grantView(row, names, Date.now()))) : [];
  const roleName = (key: string): string => roles?.find((role) => role.key === key)?.name ?? key;

  const giveRole = async (): Promise<void> => {
    if (!person) return;
    setRoleError(null);
    if (!roleKey) {
      setRoleError('Choose a role to give.');
      return;
    }
    const scoped = scopeType !== 'workspace';
    if (scoped && !scopeId) {
      setRoleError(scopeType === 'team' ? 'Choose the team it applies to.' : 'Choose the organisation it applies to.');
      return;
    }
    if (grants.kind === 'ready' && holdsGrant(grants.value, roleKey, scoped ? scopeType : null, scoped ? scopeId : null)) {
      setRoleError(`${first} already has that role there.`);
      return;
    }
    const result = await assign.run(person.id, roleKey, scoped ? { scopeType: scopeType as GrantScopeType, scopeId } : undefined);
    if (!result.ok) {
      if (result.problem.status === 422 || result.problem.status === 404) setRoleError(result.problem.detail ?? 'That role couldn’t be given.');
      return;
    }
    setRoleKey('');
    setScopeType('workspace');
    setScopeId('');
    reloadGrants();
    notify(`${roleName(roleKey)} role given to ${first}`);
  };

  const joinTeam = async (): Promise<void> => {
    if (!person) return;
    setTeamError(null);
    if (!teamId) {
      setTeamError('Choose a team.');
      return;
    }
    const result = await addToTeam.run(teamId, person.id, lead);
    if (!result.ok) {
      if (result.problem.status === 422 || result.problem.status === 404) setTeamError(result.problem.detail ?? 'They couldn’t be added to that team.');
      return;
    }
    const name = teams?.find((team) => team.id === teamId)?.name ?? 'the team';
    setTeamId('');
    setLead(false);
    reloadMemberships();
    notify(`${first} added to ${name}${lead ? ' as a lead' : ''}`);
  };

  const memberOf = memberships.kind === 'ready' ? new Set(memberships.value.map((entry) => entry.teamId)) : new Set<string>();
  const joinable = (teams ?? []).filter((team) => !memberOf.has(team.id));

  const footer =
    person && abilities.manage && status ? (
      person.you ? (
        <p className="app-PersonDrawer__note">You can’t deactivate your own account here.</p>
      ) : active ? (
        <Button variant="dangerTinted" iconStart="ban" onClick={() => setConfirming('deactivate')} {...gate}>
          Deactivate…
        </Button>
      ) : (
        <Button variant="primary" iconStart="undo-2" onClick={() => setConfirming('reactivate')} {...gate}>
          Reactivate…
        </Button>
      )
    ) : undefined;

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        size="md"
        title={person?.name ?? (fetched.kind === 'loading' ? 'Loading…' : 'Person')}
        {...(person ? { description: person.email } : {})}
        {...(look ? { headerMeta: <StatusPill size="sm" tone={look.tone} icon={look.icon} label={look.label} srPrefix="Status" /> } : {})}
        {...(footer ? { footer } : {})}
      >
        {!person ? (
          fetched.kind === 'failed' ? (
            <InlineAlert tone="danger">
              <span className="app-PersonDrawer__retry">
                Couldn’t load this person.
                <Button size="sm" variant="ghost" onClick={reloadPerson}>
                  Try again
                </Button>
              </span>
            </InlineAlert>
          ) : fetched.kind === 'ready' && fetched.value === null ? (
            <EmptyState
              size="sm"
              title="That person isn’t on this desk"
              description="They may have been removed, or the link is from another workspace."
              action={{ id: 'close', label: 'Close', variant: 'secondary' }}
              onAction={onClose}
            />
          ) : (
            <SkeletonText lines={5} />
          )
        ) : (
          <div className="app-PersonDrawer">
            <section className="app-PersonDrawer__section" aria-labelledby="app-person-details">
              <h3 id="app-person-details" className="app-PersonDrawer__heading">
                Details
              </h3>
              <DescriptionList
                layout="inline"
                dense
                items={[
                  { id: 'email', label: 'Email', value: person.email },
                  {
                    id: 'type',
                    label: 'Type',
                    value: person.typeLabel,
                    hint: person.external ? 'From outside the organisation: a supplier or a customer’s contact.' : 'Part of the organisation.',
                  },
                  { id: 'org', label: 'Organisation', value: person.orgName ?? (person.orgId ? 'One you can’t see' : 'None') },
                  ...(abilities.readAvailability
                    ? [
                        {
                          id: 'availability',
                          label: 'Availability',
                          value:
                            availability.kind === 'loading' || availability.kind === 'idle' ? (
                              <SkeletonText lines={1} />
                            ) : availability.kind === 'failed' ? (
                              'Couldn’t load'
                            ) : availability.value === null ? (
                              'Not set — routing treats them as available'
                            ) : (
                              <span className="app-PersonDrawer__availability">
                                <StatusPill
                                  size="sm"
                                  tone={AVAILABILITY_LOOK[availability.value.effectiveStatus]?.tone ?? 'neutral'}
                                  label={AVAILABILITY_LOOK[availability.value.effectiveStatus]?.label ?? availability.value.effectiveStatus}
                                />
                                {statusNote(availability.value, locale, timeZone) ? (
                                  <span className="app-PersonDrawer__quiet">{statusNote(availability.value, locale, timeZone)}</span>
                                ) : null}
                                {props.workforceHref ? (
                                  <Link href={props.workforceHref} className="app-People__link">
                                    Change on Workforce
                                  </Link>
                                ) : null}
                              </span>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            </section>

            {abilities.readRoles ? (
              <section className="app-PersonDrawer__section" aria-labelledby="app-person-roles">
                <h3 id="app-person-roles" className="app-PersonDrawer__heading">
                  Roles
                </h3>
                {grants.kind === 'loading' || grants.kind === 'idle' ? (
                  <SkeletonText lines={2} />
                ) : grants.kind === 'failed' ? (
                  <InlineAlert tone="danger">
                    <span className="app-PersonDrawer__retry">
                      Couldn’t load their roles.
                      <Button size="sm" variant="ghost" onClick={reloadGrants}>
                        Try again
                      </Button>
                    </span>
                  </InlineAlert>
                ) : grantViews.length === 0 ? (
                  <p className="app-PersonDrawer__quiet">
                    {active ? `${first} has no roles, so they can sign in but can’t do anything yet.` : 'None. Deactivating removed their roles; give them again after reactivating.'}
                  </p>
                ) : (
                  <ul className="app-Grants" aria-label={`Roles ${person.name} holds`}>
                    {grantViews.map((grant) => (
                      <li key={grant.id} className="app-Grant" data-expired={grant.expired ? '' : undefined}>
                        <span className="app-Grant__text">
                          <span className="app-Grant__role">{grant.roleName}</span>
                          <span className="app-Grant__scope">
                            {grant.scope}
                            {grant.viaScim ? ' · from your identity provider' : ''}
                            {grant.expired ? ' · expired' : ''}
                          </span>
                        </span>
                        {abilities.grant ? (
                          <IconButton
                            icon="x"
                            size="sm"
                            variant="ghost"
                            label={`Remove the ${grant.roleName} role (${grant.scope})`}
                            onClick={() => setRemoving(grant)}
                            {...(online ? {} : { disabled: true })}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {abilities.grant && roles && roles.length > 0 && active ? (
                  <div className="app-PersonDrawer__form" role="group" aria-labelledby="app-person-give">
                    <h4 id="app-person-give" className="app-PersonDrawer__subheading">
                      Give a role
                    </h4>
                    <div className="app-PersonDrawer__row">
                      <FormField label="Role">
                        <Select
                          value={roleKey}
                          placeholder="Choose a role"
                          options={roles.map((role) => ({ value: role.key, label: role.name }))}
                          onChange={(event) => {
                            setRoleKey(event.currentTarget.value);
                            setRoleError(null);
                          }}
                        />
                      </FormField>
                      <FormField label="Applies to">
                        <Select
                          value={scopeType}
                          options={[
                            { value: 'workspace', label: 'Whole workspace' },
                            ...(organisations && organisations.length > 0 ? [{ value: 'organisation', label: 'One organisation' }] : []),
                            ...(teams && teams.length > 0 ? [{ value: 'team', label: 'One team' }] : []),
                          ]}
                          onChange={(event) => {
                            setScopeType(event.currentTarget.value as 'workspace' | GrantScopeType);
                            setScopeId('');
                            setRoleError(null);
                          }}
                        />
                      </FormField>
                      {scopeType === 'organisation' && organisations ? (
                        <FormField label="Organisation">
                          <Select value={scopeId} placeholder="Choose an organisation" options={organisations} onChange={(event) => setScopeId(event.currentTarget.value)} />
                        </FormField>
                      ) : null}
                      {scopeType === 'team' && teams ? (
                        <FormField label="Team">
                          <Select
                            value={scopeId}
                            placeholder="Choose a team"
                            options={teams.map((team) => ({ value: team.id, label: team.name }))}
                            onChange={(event) => setScopeId(event.currentTarget.value)}
                          />
                        </FormField>
                      ) : null}
                    </div>
                    {roleKey ? <p className="app-PersonDrawer__quiet">{roles.find((role) => role.key === roleKey)?.description ?? ''}</p> : null}
                    {roleError ? (
                      <p className="app-PersonDrawer__error" role="alert">
                        {roleError}
                      </p>
                    ) : null}
                    <div>
                      <Button size="sm" variant="secondary" iconStart="plus" loading={assign.pending} loadingLabel="Giving…" onClick={() => void giveRole()} {...gate}>
                        Give role
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {teams ? (
              <section className="app-PersonDrawer__section" aria-labelledby="app-person-teams">
                <h3 id="app-person-teams" className="app-PersonDrawer__heading">
                  Teams
                </h3>
                {!active ? (
                  <p className="app-PersonDrawer__quiet">Their team places are kept while they’re deactivated and come back when they’re reactivated.</p>
                ) : memberships.kind === 'loading' || memberships.kind === 'idle' ? (
                  <SkeletonText lines={2} />
                ) : memberships.kind === 'failed' ? (
                  <InlineAlert tone="danger">
                    <span className="app-PersonDrawer__retry">
                      Couldn’t check their teams.
                      <Button size="sm" variant="ghost" onClick={reloadMemberships}>
                        Try again
                      </Button>
                    </span>
                  </InlineAlert>
                ) : memberships.value.length === 0 ? (
                  <p className="app-PersonDrawer__quiet">{teams.length === 0 ? 'This desk has no teams yet.' : `${first} isn’t in a team.`}</p>
                ) : (
                  <ul className="app-Grants" aria-label={`Teams ${person.name} is in`}>
                    {memberships.value.map((entry) => (
                      <li key={entry.teamId} className="app-Grant">
                        <span className="app-Grant__text">
                          <Link href={`/people/teams?open=team:${entry.teamId}`} className="app-People__link">
                            {entry.name}
                          </Link>
                        </span>
                        {entry.isLead ? <StatusPill size="sm" tone="info" icon="star" label="Lead" /> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {teams.length > MAX_TEAM_CHECKS && active ? (
                  <p className="app-PersonDrawer__quiet">Checked the first {MAX_TEAM_CHECKS} teams, A to Z. Open a team to see everyone in it.</p>
                ) : null}

                {abilities.manageTeams && active && joinable.length > 0 && memberships.kind === 'ready' ? (
                  <div className="app-PersonDrawer__form" role="group" aria-labelledby="app-person-join">
                    <h4 id="app-person-join" className="app-PersonDrawer__subheading">
                      Add to a team
                    </h4>
                    <div className="app-PersonDrawer__row">
                      <FormField label="Team">
                        <Select
                          value={teamId}
                          placeholder="Choose a team"
                          options={joinable.map((team) => ({ value: team.id, label: team.name }))}
                          onChange={(event) => {
                            setTeamId(event.currentTarget.value);
                            setTeamError(null);
                          }}
                        />
                      </FormField>
                    </div>
                    <Checkbox label="Make them a lead of the team" checked={lead} onChange={(event) => setLead(event.currentTarget.checked)} />
                    {teamError ? (
                      <p className="app-PersonDrawer__error" role="alert">
                        {teamError}
                      </p>
                    ) : null}
                    <div>
                      <Button size="sm" variant="secondary" iconStart="plus" loading={addToTeam.pending} loadingLabel="Adding…" onClick={() => void joinTeam()} {...gate}>
                        Add to team
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
      </Sheet>

      {person && confirming === 'deactivate' ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          spec={{
            title: `Deactivate ${person.name}?`,
            body: `${first} is signed out everywhere at once, their API keys stop working and every role they hold is removed. Their history stays, and they keep their team places for when they come back.`,
            confirmLabel: 'Deactivate',
            tone: 'danger',
            requireReason: { label: 'Reason', hint: 'Recorded in the audit log, like “Left the company on 30 September”.' },
          }}
          onConfirm={async (reason) => {
            const result = await deactivate.run(person.id, reason);
            if (!result.ok) throw new Error(result.problem.detail ?? 'They weren’t deactivated.');
            setStatusOverride({ id: person.id, status: 'inactive' });
            reloadGrants();
            notify(`${person.name} deactivated`);
          }}
        />
      ) : null}
      {person && confirming === 'reactivate' ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(null);
          }}
          spec={{
            title: `Reactivate ${person.name}?`,
            body: `${first} can sign in again and is back in their teams. Their roles aren’t restored — deactivating removed them — so give them the roles they need next.`,
            confirmLabel: 'Reactivate',
          }}
          onConfirm={async () => {
            const result = await reactivate.run(person.id);
            if (!result.ok) throw new Error(result.problem.detail ?? 'They weren’t reactivated.');
            setStatusOverride({ id: person.id, status: 'active' });
            reloadGrants();
            reloadMemberships();
            notify(`${person.name} reactivated — give them the roles they need`);
          }}
        />
      ) : null}
      {person && removing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setRemoving(null);
          }}
          spec={{
            title: `Remove the ${removing.roleName} role from ${person.name}?`,
            body: removing.viaScim
              ? 'Your identity provider gave this role, so it comes back at the next sync unless their group changes there.'
              : `${first} loses what it allows straight away (${removing.scope.toLowerCase()}).`,
            confirmLabel: 'Remove role',
            tone: 'danger',
          }}
          onConfirm={async () => {
            const result = await removeGrant.run(removing.id);
            if (!result.ok) throw new Error(result.problem.detail ?? 'The role wasn’t removed.');
            setRemoving(null);
            reloadGrants();
            notify(`${removing.roleName} role removed from ${first}`);
          }}
        />
      ) : null}
    </>
  );
}

function notify(message: string): void {
  toast(message, { tone: 'success' });
}
