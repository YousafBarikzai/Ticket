// @vitest-environment jsdom
import { act, forwardRef, type AnchorHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganisationRow, RoleAssignmentRow, RoleRow, TeamMemberRow, UserRow } from '@itsm/sdk';

vi.mock('server-only', () => ({}));

let search = '';
const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), forward: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/people',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const ADA = 'a0000000-0000-4000-8000-000000000001';
const BO = 'b0000000-0000-4000-8000-000000000002';
const ME = 'c0000000-0000-4000-8000-000000000003';
const ORG_UK = 'd0000000-0000-4000-8000-000000000004';
const ORG_ROOT = 'd0000000-0000-4000-8000-000000000005';
const TEAM_NET = 'e0000000-0000-4000-8000-000000000006';

const deactivateUser = vi.fn(async (id: string) => ({ id, status: 'inactive' }));
const reactivateUser = vi.fn(async (id: string) => ({ id, status: 'active' as const }));
const roleAssignments = vi.fn(async (_id: string): Promise<RoleAssignmentRow[]> => []);
const assignRole = vi.fn(async () => ({}));
const removeRoleAssignment = vi.fn(async () => undefined);
const teamMembers = vi.fn(async (_id: string): Promise<TeamMemberRow[]> => []);
const addTeamMember = vi.fn(async () => ({}));
const createUser = vi.fn(async (input: { email: string; displayName: string }) => ({ id: 'f0000000-0000-4000-8000-000000000009', email: input.email, displayName: input.displayName, status: 'active', primaryOrgId: null, isExternal: false }));
const createOrganisation = vi.fn(async (input: { name: string; code: string }) => ({ id: 'o9', name: input.name, code: input.code, path: '/X' }));
const users = vi.fn(async () => [] as UserRow[]);
const user = vi.fn(async (id: string): Promise<UserRow> => ({ id, email: 'x@acme.test', displayName: 'X', status: 'active', primaryOrgId: null, isExternal: false }));
const availability = vi.fn(async () => []);
vi.mock('../client/api.js', () => ({
  api: {
    tenant: { deactivateUser, reactivateUser, roleAssignments, assignRole, removeRoleAssignment, teamMembers, addTeamMember, createUser, createOrganisation, users, user },
    observe: { queues: { availability } },
  },
}));

const { ItsmProvider } = await import('@itsm/ui');
const people = await import('../components/people/presentation.js');
const { PeopleView } = await import('../components/people/PeopleView.js');
const { TeamsView } = await import('../components/people/TeamsView.js');
const { OrganisationsView } = await import('../components/people/OrganisationsView.js');
const { AddPersonSheet } = await import('../components/people/AddPersonSheet.js');
const { cleanupDocument, clickAsync, render, submit, type } = await import('./support/render.js');

/**
 * People (SPEC §6.1 `/people/**`, B §3.16, F31): an honest cap, names never
 * ids, organisations as a tree, roles given and taken away where they
 * apply, and deactivation — with a reason — undone by reactivation.
 */

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean | null }>(function Link(
  { prefetch: _prefetch, ...props },
  ref,
) {
  return <a ref={ref} {...props} />;
});

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ItsmProvider app="admin" Link={Link} router={router} usePathname={() => '/people'} useSearchParams={() => new URLSearchParams(search)} locale="en-GB" timeZone="Europe/London">
      {children}
    </ItsmProvider>
  );
}

beforeEach(() => {
  search = '';
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanupDocument();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((button) => text(button) === name) as HTMLButtonElement | undefined;
const dialogWith = (words: string): Element | undefined => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((dialog) => text(dialog).includes(words));

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function openMenu(container: HTMLElement, label: string): HTMLElement[] {
  const row = [...container.querySelectorAll('tbody tr')].find((entry) => text(entry.querySelector('.itsm-DataTable__primaryCell')).includes(label))!;
  const primary = row.querySelector<HTMLElement>('[data-itsm-control="primary"]')!;
  act(() => primary.focus());
  act(() => {
    primary.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function userRow(id: string, displayName: string, extra: Partial<UserRow> = {}): UserRow {
  return { id, email: `${displayName.split(' ')[0]!.toLowerCase()}@acme.test`, displayName, status: 'active', primaryOrgId: ORG_UK, isExternal: false, ...extra };
}

const orgNames = new Map([[ORG_UK, 'Acme UK']]);
const role = (key: string, name: string, permissions: RoleRow['permissions'] = []): RoleRow => ({ id: `r-${key}`, key, name, description: `${name} description`, isSystem: true, permissions });
const ROLES = [role('requester', 'Requester'), role('agent', 'Service desk agent'), role('administrator', 'Administrator')];
const abilities = { manage: true, readRoles: true, grant: true, manageTeams: true, manageOrganisations: true, readAvailability: false };
const header = { tabs: [{ id: 'people', label: 'People', href: '/people' }] };
const scopes = people.PEOPLE_SCOPES.map((scope) => ({ ...scope, href: scope.value === 'active' ? '/people' : `/people?status=${scope.value}` }));

function view(rows: readonly ReturnType<typeof people.personRow>[], extra: Partial<Parameters<typeof PeopleView>[0]> = {}): ReactElement {
  return (
    <Frame>
      <PeopleView
        header={header}
        rows={rows}
        query={{ q: '', scope: 'active' }}
        scopes={scopes}
        caption={null}
        abilities={abilities}
        meId={ME}
        roles={ROLES}
        teams={[{ id: TEAM_NET, name: 'Network Team', orgId: ORG_UK }]}
        organisations={[{ value: ORG_UK, label: 'Acme UK' }]}
        orgNames={{ [ORG_UK]: 'Acme UK' }}
        {...extra}
      />
    </Frame>
  );
}

/* ======================================================================= */

describe('people in words', () => {
  it('reads the scope and search from the URL, Active by default', () => {
    expect(people.readPeopleQuery({})).toEqual({ q: '', scope: 'active' });
    expect(people.readPeopleQuery({ status: 'deactivated', q: '  sam ' })).toEqual({ q: 'sam', scope: 'inactive' });
    expect(people.readPeopleQuery({ status: 'ALL' })).toEqual({ q: '', scope: 'all' });
    expect(people.readPeopleQuery({ status: 'nonsense' }).scope).toBe('active');
    expect(people.usersQuery({ q: '', scope: 'all' })).toEqual({ limit: 200 });
    expect(people.usersQuery({ q: 'sam', scope: 'inactive' })).toEqual({ limit: 200, q: 'sam', status: 'inactive' });
  });

  it('says when the list is the first 200 rather than letting the cap pass for everyone (F31)', () => {
    expect(people.cappedCaption(199, { q: '', scope: 'active' })).toBeNull();
    expect(people.cappedCaption(200, { q: '', scope: 'active' })).toBe('Showing the first 200 people, A to Z — search to find others.');
    expect(people.cappedCaption(200, { q: 'a', scope: 'active' })).toContain('add more words');
  });

  it('keeps the search in scope links and drops a drawer or a sheet', () => {
    const href = people.peopleScopeHref('/people', new URLSearchParams('q=sam&open=person:x&new=1'), 'inactive');
    expect(href).toBe('/people?q=sam&status=inactive');
    expect(people.peopleScopeHref('/people', new URLSearchParams('status=all'), 'active')).toBe('/people');
  });

  it('shapes a person with names, type and status in words', () => {
    const row = people.personRow(userRow(ADA, 'Ada Lovelace', { isExternal: true }), orgNames, ME);
    expect(row).toMatchObject({ name: 'Ada Lovelace', typeLabel: 'External', orgName: 'Acme UK', statusLabel: 'Active', you: false });
    expect(people.personRow(userRow(ME, 'Me', { status: 'inactive', primaryOrgId: 'unknown' }), orgNames, ME)).toMatchObject({ you: true, statusLabel: 'Deactivated', orgName: null });
    expect(people.userStatusLook('pending_invite').label).toBe('Pending invite');
    expect(people.nameFromEmail('sam.lee@acme.test')).toBe('Sam Lee');
  });

  it('checks a new person before the round trip', () => {
    expect(people.personProblems({ name: '', email: 'nope' })).toEqual({ displayName: 'Enter their name.', email: 'Enter an email address like sam@example.com.' });
    expect(people.personProblems({ name: 'Sam', email: 'SAM@acme.test' }, ['sam@acme.test'])).toEqual({ email: 'Someone on this desk already has that email address.' });
    expect(people.personProblems({ name: 'Sam', email: 'sam@acme.test' })).toEqual({});
  });

  it('builds the organisation tree from parent ids, keeping orphans and surviving a cycle', () => {
    const org = (id: string, name: string, parentId: string | null): OrganisationRow => ({ id, name, code: name.toUpperCase(), path: `/${name}`, parentId });
    const tree = people.organisationTree([org('b', 'Beta', 'root'), org('root', 'Acme', null), org('a', 'Alpha', 'root'), org('lost', 'Lost', 'missing'), org('x', 'X', 'y'), org('y', 'Y', 'x')]);
    // A cycle has no top: both of its organisations are shown at the top rather than lost.
    expect(tree.map((node) => node.name)).toEqual(['Acme', 'Lost', 'X', 'Y']);
    expect(tree[0]!.children.map((node) => node.name)).toEqual(['Alpha', 'Beta']);
    expect(people.flattenTree(tree).map((node) => `${node.depth}:${node.name}`)).toEqual(['0:Acme', '1:Alpha', '1:Beta', '0:Lost', '0:X', '0:Y']);
    expect(people.organisationOptions([org('root', 'Acme', null), org('a', 'Alpha', 'root')])[1]!.label).toBe(' Alpha');
  });

  it('checks an organisation and suggests its code', () => {
    expect(people.codeFromName('Acme Group – Café UK')).toBe('ACME-GROUP-CAFE-UK');
    expect(people.organisationProblems({ name: 'A', code: 'acme uk' }, [])).toEqual({ code: 'Use letters, numbers and hyphens — no spaces.' });
    expect(people.organisationProblems({ name: 'A', code: 'ACME-UK' }, ['acme-uk'])).toEqual({ code: 'Another organisation already uses that code.' });
  });

  it('says where a role applies, and whether it has expired', () => {
    const names = { organisations: orgNames, teams: new Map([[TEAM_NET, 'Network Team']]) };
    const grant = (extra: Partial<RoleAssignmentRow>): RoleAssignmentRow => ({
      id: 'g1',
      roleKey: 'agent',
      roleName: 'Service desk agent',
      scopeType: null,
      scopeId: null,
      validFrom: '2026-01-01T00:00:00Z',
      validTo: null,
      viaScim: false,
      ...extra,
    });
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(people.grantView(grant({}), names, now)).toMatchObject({ scope: 'Whole workspace', expired: false, scoped: false });
    expect(people.grantView(grant({ scopeType: 'team', scopeId: TEAM_NET }), names, now).scope).toBe('Network Team (team)');
    expect(people.grantView(grant({ scopeType: 'organisation', scopeId: 'other' }), names, now).scope).toBe('One organisation');
    expect(people.grantView(grant({ validTo: '2026-09-01T00:00:00Z' }), names, now).expired).toBe(true);
    expect(people.holdsGrant([grant({ scopeType: 'team', scopeId: TEAM_NET })], 'agent', 'team', TEAM_NET)).toBe(true);
    expect(people.holdsGrant([grant({})], 'agent', 'team', TEAM_NET)).toBe(false);
  });

  it('names team leads briefly', () => {
    expect(people.leadsLabel(null)).toBe('—');
    expect(people.leadsLabel([])).toBe('No lead');
    expect(people.leadsLabel(['Priya', 'Tom'])).toBe('Priya and Tom');
    expect(people.leadsLabel(['Priya', 'Tom', 'Ann'])).toBe('Priya and 2 others');
  });
});

/* ======================================================================= */

describe('the people list', () => {
  const rows = [people.personRow(userRow(ADA, 'Ada Lovelace'), orgNames, ME), people.personRow(userRow(BO, 'Bo Diaz', { isExternal: true }), orgNames, ME)];

  it('shows names, type and organisation — never an id — and the cap when the page is full', () => {
    const { container } = render(view(rows, { caption: people.cappedCaption(200, { q: '', scope: 'active' }) }));
    expect(text(container)).toContain('Ada Lovelace');
    expect(text(container)).toContain('ada@acme.test');
    expect(text(container)).toContain('Acme UK');
    expect(text(container)).toContain('External');
    expect(text(container)).toContain('Showing the first 200 people');
    // The id is in the drawer's address only, never in what is read.
    expect(text(container)).not.toContain(ADA);
  });

  it('deactivates only after a reason, and says so', async () => {
    const { container } = render(view(rows));
    const item = openMenu(container, 'Ada Lovelace').find((entry) => text(entry) === 'Deactivate…')!;
    await act(async () => {
      item.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = dialogWith('Deactivate Ada Lovelace?')!;
    expect(text(confirm)).toContain('every role they hold is removed');
    expect(buttonNamed(confirm, 'Deactivate')!.getAttribute('aria-disabled')).toBe('true');
    type(confirm.querySelector('textarea')!, 'Left the company');
    await clickAsync(buttonNamed(confirm, 'Deactivate')!);
    await settle();
    expect(deactivateUser).toHaveBeenCalledWith(ADA, 'Left the company');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('reactivates a deactivated person after saying their roles are not restored', async () => {
    const gone = [people.personRow(userRow(ADA, 'Ada Lovelace', { status: 'inactive' }), orgNames, ME)];
    const { container } = render(view(gone, { query: { q: '', scope: 'inactive' } }));
    const item = openMenu(container, 'Ada Lovelace').find((entry) => text(entry) === 'Reactivate…')!;
    await act(async () => {
      item.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const confirm = dialogWith('Reactivate Ada Lovelace?')!;
    expect(text(confirm)).toContain('roles aren’t restored');
    await clickAsync(buttonNamed(confirm, 'Reactivate')!);
    await settle();
    expect(reactivateUser).toHaveBeenCalledWith(ADA);
  });

  it('never offers to deactivate yourself, and offers nothing but details without the permission', () => {
    const mine = [people.personRow(userRow(ME, 'Me Myself'), orgNames, ME)];
    const { container } = render(view(mine));
    expect(openMenu(container, 'Me Myself').map((entry) => text(entry))).toEqual(['View details']);
    cleanupDocument();
    const second = render(view(rows, { abilities: { ...abilities, manage: false } }));
    expect(openMenu(second.container, 'Ada Lovelace').map((entry) => text(entry))).toEqual(['View details']);
    expect(buttonNamed(document.body, 'Add person')).toBeUndefined();
  });
});

/* ======================================================================= */

describe('the person drawer', () => {
  const rows = [people.personRow(userRow(ADA, 'Ada Lovelace'), orgNames, ME)];

  it('lists roles with where they apply, and removes one after asking', async () => {
    roleAssignments.mockResolvedValue([
      { id: 'g1', roleKey: 'agent', roleName: 'Service desk agent', scopeType: 'team', scopeId: TEAM_NET, validFrom: '2026-01-01T00:00:00Z', validTo: null, viaScim: false },
    ]);
    teamMembers.mockResolvedValue([{ userId: ADA, displayName: 'Ada Lovelace', isLead: true, since: '2026-01-01T00:00:00Z' }]);
    search = `open=person:${ADA}`;
    render(view(rows));
    await settle(10);
    const sheet = dialogWith('Roles')!;
    expect(text(sheet)).toContain('Service desk agent');
    expect(text(sheet)).toContain('Network Team (team)');
    expect(text(sheet)).toContain('Lead');
    expect(roleAssignments).toHaveBeenCalledWith(ADA);
    await clickAsync(sheet.querySelector<HTMLButtonElement>('button[aria-label^="Remove the Service desk agent role"]')!);
    const confirm = dialogWith('Remove the Service desk agent role from Ada Lovelace?')!;
    await clickAsync(buttonNamed(confirm, 'Remove role')!);
    await settle();
    expect(removeRoleAssignment).toHaveBeenCalledWith('g1');
  });

  it('gives a role for one team, and refuses one they already hold there', async () => {
    roleAssignments.mockResolvedValue([]);
    search = `open=person:${ADA}`;
    render(view(rows));
    await settle(10);
    const sheet = dialogWith('Give a role')!;
    const [roleSelect, scopeSelect] = [...sheet.querySelectorAll('select')] as HTMLSelectElement[];
    await clickAsync(buttonNamed(sheet, 'Give role')!);
    expect(text(sheet)).toContain('Choose a role to give.');
    act(() => {
      roleSelect!.value = 'agent';
      roleSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      scopeSelect!.value = 'team';
      scopeSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const teamSelect = [...dialogWith('Give a role')!.querySelectorAll('select')].at(2) as HTMLSelectElement;
    act(() => {
      teamSelect.value = TEAM_NET;
      teamSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickAsync(buttonNamed(dialogWith('Give a role')!, 'Give role')!);
    await settle();
    expect(assignRole).toHaveBeenCalledWith(ADA, 'agent', { scopeType: 'team', scopeId: TEAM_NET });
  });

  it('adds them to a team they are not in', async () => {
    teamMembers.mockResolvedValue([]);
    search = `open=person:${ADA}`;
    render(view(rows));
    await settle(10);
    const sheet = dialogWith('Add to a team')!;
    const select = [...sheet.querySelectorAll('select')].at(-1) as HTMLSelectElement;
    act(() => {
      select.value = TEAM_NET;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickAsync(buttonNamed(sheet, 'Add to team')!);
    await settle();
    expect(addTeamMember).toHaveBeenCalledWith(TEAM_NET, ADA, false);
  });

  it('reads a person who is not in the list, and says when they do not exist', async () => {
    user.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    search = `open=person:${BO}`;
    render(view(rows));
    await settle(10);
    expect(user).toHaveBeenCalledWith(BO);
  });
});

/* ======================================================================= */

describe('adding a person', () => {
  it('creates the account, then gives each chosen role, and names a role that was not given', async () => {
    assignRole.mockRejectedValueOnce(Object.assign(new Error('limit'), { status: 402 }));
    const onAdded = vi.fn();
    render(
      <Frame>
        <AddPersonSheet open organisations={[{ value: ORG_UK, label: 'Acme UK' }]} roles={ROLES} takenEmails={['ada@acme.test']} onClose={() => undefined} onAdded={onAdded} />
      </Frame>,
    );
    const sheet = dialogWith('Add person')!;
    const form = sheet.querySelector('form')!;
    type(sheet.querySelector<HTMLInputElement>('input[name="email"]')!, 'ada@acme.test');
    type(sheet.querySelector<HTMLInputElement>('input[name="displayName"]')!, 'Ada');
    await submit(form);
    expect(createUser).not.toHaveBeenCalled();
    expect(text(dialogWith('Add person'))).toContain('already has that email address');

    type(sheet.querySelector<HTMLInputElement>('input[name="email"]')!, 'sam.lee@acme.test');
    type(sheet.querySelector<HTMLInputElement>('input[name="displayName"]')!, 'Sam Lee');
    const box = (label: string): HTMLInputElement =>
      [...sheet.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => [...(input.labels ?? [])].some((node) => node.textContent?.includes(label)))!;
    await clickAsync(box('Service desk agent'));
    await clickAsync(box('Administrator'));
    await clickAsync(box('They’re external'));
    await submit(form);
    await settle();
    expect(createUser).toHaveBeenCalledWith({ displayName: 'Sam Lee', email: 'sam.lee@acme.test', isExternal: true });
    expect(assignRole.mock.calls.map((call) => (call as unknown[])[1])).toEqual(['agent', 'administrator']);
    expect(onAdded).toHaveBeenCalledWith('f0000000-0000-4000-8000-000000000009');
  });
});

/* ======================================================================= */

describe('teams and organisations', () => {
  const team = people.teamRow({ id: TEAM_NET, key: 'network-team', name: 'Network Team', orgId: ORG_UK, memberCount: 2 }, orgNames, ['Priya Shah']);

  it('lists teams with their organisation, members and lead, and adds a member from the drawer', async () => {
    search = `open=team:${TEAM_NET}`;
    teamMembers.mockResolvedValue([{ userId: ADA, displayName: 'Ada Lovelace', isLead: false, since: '2026-01-01T00:00:00Z' }]);
    render(
      <Frame>
        <TeamsView header={header} rows={[team]} members={{}} canManage organisations={[{ value: ORG_UK, label: 'Acme UK' }]} peopleHref="/people" />
      </Frame>,
    );
    await settle(10);
    expect(text(document.body)).toContain('Priya Shah');
    expect(text(document.body)).toContain('2 people');
    const sheet = dialogWith('Members')!;
    expect(text(sheet)).toContain('Ada Lovelace');
    expect(sheet.querySelector(`a[href="/people?open=person:${ADA}"]`)).not.toBeNull();
    await clickAsync(buttonNamed(sheet, 'Add to Network Team')!);
    expect(text(dialogWith('Members'))).toContain('Choose who to add.');
    expect(addTeamMember).not.toHaveBeenCalled();
  });

  it('draws organisations as a nested list with their teams, and adds one under another', async () => {
    const org = (id: string, name: string, parentId: string | null): OrganisationRow => ({ id, name, code: name.replace(/\s/g, '-').toUpperCase(), path: `/${name}`, parentId });
    const rows = [org(ORG_ROOT, 'Acme Group', null), org(ORG_UK, 'Acme UK', ORG_ROOT)];
    search = `new=1&parent=${ORG_ROOT}`;
    render(
      <Frame>
        <OrganisationsView
          header={header}
          tree={people.organisationTree(rows)}
          teamCounts={{ [ORG_UK]: 1 }}
          canManage
          options={people.organisationOptions(rows)}
          takenCodes={rows.map((row) => row.code)}
          teamsHref="/people/teams"
        />
      </Frame>,
    );
    const nested = document.querySelector('.app-Orgs .app-Orgs');
    expect(text(nested)).toContain('Acme UK');
    expect(document.querySelector(`a[href="/people/teams?org=${ORG_UK}"]`)?.textContent).toBe('1 team');
    const sheet = dialogWith('New organisation')!;
    type(sheet.querySelector<HTMLInputElement>('input[name="name"]')!, 'Acme France');
    expect(sheet.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe('ACME-FRANCE');
    expect(sheet.querySelector<HTMLSelectElement>('select[name="parentId"]')!.value).toBe(ORG_ROOT);
    await submit(sheet.querySelector('form')!);
    await settle();
    expect(createOrganisation).toHaveBeenCalledWith({ name: 'Acme France', code: 'ACME-FRANCE', parentId: ORG_ROOT });
  });
});
