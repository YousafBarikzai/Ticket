import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { userService } from '@itsm/module-identity';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * SCIM provisioning (MOD-01).
 *
 * The unit tests prove the grammar. This proves the contract with an identity
 * provider, in the shapes Entra ID sends: a token issued by an administrator
 * and nothing else opens the door; a user is created, found by the filter
 * the provider uses, adopted when an account already exists, deactivated
 * with every session revoked and brought back; a group becomes a team whose
 * members hold the role the tenant mapped to its name, and lose it when they
 * leave; a role an administrator granted by hand is not the provider's to
 * take; a first login through the provider lands on the SCIM-made account;
 * and a rotated token overlaps, a revoked one does not.
 */

let tenant: TestTenant;
let token: string;

beforeAll(async () => {
  tenant = await createTestTenant('scim');
  const issued = await request<{ token: string; endpoint: string }>('/api/v1/scim/token', { method: 'POST', token: tenant.people.admin!.token, body: {} });
  expect(issued.status).toBe(201);
  expect(issued.body.endpoint).toMatch(/\/scim\/v2$/);
  token = issued.body.token;
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('scim');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = contextFor(tenant.id);
  return withContext(context, () => transaction(context, fn));
}

interface ScimResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

async function scim<T = Record<string, unknown>>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; bearer?: string } = {}): Promise<ScimResponse<T>> {
  return request<T>(`/scim/v2${path}`, {
    method: options.method ?? 'GET',
    headers: { authorization: `Bearer ${options.bearer ?? token}`, 'content-type': 'application/scim+json' },
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

interface ScimUser {
  id: string;
  userName: string;
  externalId: string | null;
  displayName: string;
  active: boolean;
  groups: { value: string; display: string }[];
  meta: { location: string };
}

interface ScimList<T> {
  totalResults: number;
  itemsPerPage: number;
  Resources: T[];
}

interface ScimGroup {
  id: string;
  displayName: string;
  externalId: string | null;
  members: { value: string; display: string }[];
}

async function rolesOf(userId: string): Promise<string[]> {
  const rows = await read((tx) => tx.roleAssignment.findMany({ where: { userId }, include: { role: { select: { key: true } } } }));
  return rows.map((row) => row.role.key).sort();
}

describe('the door', () => {
  it('describes itself', async () => {
    const config = await scim<{ patch: { supported: boolean }; filter: { supported: boolean } }>('/ServiceProviderConfig');
    expect(config.status).toBe(200);
    expect(String(config.headers['content-type'])).toContain('application/scim+json');
    expect(config.body.patch.supported).toBe(true);
    expect(config.body.filter.supported).toBe(true);
  });

  it('opens only to the token, in the SCIM error shape when it does not', async () => {
    const wrong = await scim<{ schemas: string[]; status: string }>('/Users', { bearer: `scim_${tenant.slug}_${'x'.repeat(43)}` });
    expect(wrong.status).toBe(401);
    expect(wrong.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(wrong.body.status).toBe('401');

    const session = await request('/scim/v2/Users', { token: asAdmin(), headers: { 'content-type': 'application/scim+json' } });
    expect(session.status).toBe(401);
  });

  it('refuses a filter it would otherwise have to ignore', async () => {
    const response = await scim<{ scimType: string }>('/Users?filter=userName%20co%20%22ada%22');
    expect(response.status).toBe(400);
    expect(response.body.scimType).toBe('invalidFilter');
  });
});

describe('users', () => {
  let adaId: string;

  it('creates a user from what Entra sends, and finds them by the filter it uses', async () => {
    const created = await scim<ScimUser>('/Users', {
      method: 'POST',
      body: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'Ada.Lovelace@scim.test',
        externalId: 'entra-obj-1',
        name: { givenName: 'Ada', familyName: 'Lovelace' },
        emails: [{ primary: true, type: 'work', value: 'ada.lovelace@scim.test' }],
        active: true,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    adaId = created.body.id;
    expect(created.body.userName).toBe('ada.lovelace@scim.test');
    expect(created.body.displayName).toBe('Ada Lovelace');
    expect(created.body.externalId).toBe('entra-obj-1');
    expect(created.body.meta.location).toMatch(new RegExp(`/scim/v2/Users/${adaId}$`));

    const byName = await scim<ScimList<ScimUser>>('/Users?filter=userName%20eq%20%22ada.lovelace%40scim.test%22');
    expect(byName.body.totalResults).toBe(1);
    expect(byName.body.Resources[0]!.id).toBe(adaId);
    const byExternal = await scim<ScimList<ScimUser>>('/Users?filter=externalId%20eq%20%22entra-obj-1%22');
    expect(byExternal.body.totalResults).toBe(1);

    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'user.provisioned', targetId: adaId } }));
    expect(audit?.actorType).toBe('integration');
  });

  it('refuses a second user with the same address once the provider owns the first', async () => {
    const duplicate = await scim<{ scimType: string }>('/Users', { method: 'POST', body: { userName: 'ada.lovelace@scim.test', externalId: 'entra-obj-other' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.scimType).toBe('uniqueness');
  });

  it('adopts an account that already exists rather than reporting it', async () => {
    const byHand = await request<{ id: string }>('/api/v1/users', { method: 'POST', token: asAdmin(), body: { email: 'grace@scim.test', displayName: 'G. Hopper' } });
    expect(byHand.status).toBe(201);
    const adopted = await scim<ScimUser>('/Users', { method: 'POST', body: { userName: 'grace@scim.test', externalId: 'entra-obj-2', displayName: 'Grace Hopper' } });
    expect(adopted.status).toBe(201);
    expect(adopted.body.id).toBe(byHand.body.id);
    expect(adopted.body.displayName).toBe('Grace Hopper');
    expect(adopted.body.externalId).toBe('entra-obj-2');
  });

  it('deactivates on the PATCH Entra sends, revoking every session, and brings back on the opposite', async () => {
    const ctx = contextFor(tenant.id);
    await withContext(ctx, () => userService.recordSession(ctx, { userId: adaId, sid: 'sid-ada-1', expiresAt: new Date(Date.now() + 3600_000) }));

    const off = await scim<ScimUser>(`/Users/${adaId}`, { method: 'PATCH', body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] } });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.active).toBe(false);
    const user = await read((tx) => tx.user.findFirst({ where: { id: adaId } }));
    expect(user?.status).toBe('inactive');
    const session = await read((tx) => tx.session.findFirst({ where: { userId: adaId, sid: 'sid-ada-1' } }));
    expect(session?.revokedAt).not.toBeNull();

    const on = await scim<ScimUser>(`/Users/${adaId}`, { method: 'PATCH', body: { Operations: [{ op: 'replace', value: { active: true } }] } });
    expect(on.status).toBe(200);
    expect(on.body.active).toBe(true);
    expect((await read((tx) => tx.user.findFirst({ where: { id: adaId } })))?.status).toBe('active');
  });

  it('replaces a user wholesale and patches a name by its parts', async () => {
    const replaced = await scim<ScimUser>(`/Users/${adaId}`, { method: 'PUT', body: { userName: 'ada@scim.test', externalId: 'entra-obj-1', displayName: 'Ada King', active: true } });
    expect(replaced.status).toBe(200);
    expect(replaced.body.userName).toBe('ada@scim.test');
    expect(replaced.body.displayName).toBe('Ada King');

    const patched = await scim<ScimUser>(`/Users/${adaId}`, { method: 'PATCH', body: { Operations: [{ op: 'replace', path: 'name.familyName', value: 'Lovelace' }] } });
    expect(patched.body.displayName).toBe('Ada Lovelace');
  });

  it('pages', async () => {
    const page = await scim<ScimList<ScimUser>>('/Users?startIndex=1&count=2');
    expect(page.status).toBe(200);
    expect(page.body.itemsPerPage).toBe(2);
    expect(page.body.totalResults).toBeGreaterThanOrEqual(2);
  });

  it('is nobody at an id that is not a user', async () => {
    const missing = await scim<{ status: string }>('/Users/11111111-1111-4111-8111-111111111111');
    expect(missing.status).toBe(404);
    expect(missing.body.status).toBe('404');
  });
});

describe('groups, teams and the roles their names grant', () => {
  let groupId: string;
  let adaId: string;
  let graceId: string;
  let byHandId: string;

  beforeAll(async () => {
    const ada = await scim<ScimList<ScimUser>>('/Users?filter=externalId%20eq%20%22entra-obj-1%22');
    adaId = ada.body.Resources[0]!.id;
    const grace = await scim<ScimList<ScimUser>>('/Users?filter=externalId%20eq%20%22entra-obj-2%22');
    graceId = grace.body.Resources[0]!.id;
    const third = await scim<ScimUser>('/Users', { method: 'POST', body: { userName: 'linus@scim.test', displayName: 'Linus', externalId: 'entra-obj-3' } });
    byHandId = third.body.id;
    // An administrator gave Linus the agent role before any group did.
    const granted = await request('/api/v1/role-assignments', { method: 'POST', token: asAdmin(), body: { userId: byHandId, roleKey: 'agent' } });
    expect(granted.status).toBe(201);
  });

  it('takes the tenant\'s map from group names to roles, refusing a role that does not exist', async () => {
    const bad = await request('/api/v1/scim/role-mappings', { method: 'PUT', token: asAdmin(), body: { data: [{ groupName: 'Desk', roleKey: 'wizard' }] } });
    expect(bad.status).toBe(422);
    const set = await request<{ data: { groupName: string; roleKey: string }[] }>('/api/v1/scim/role-mappings', {
      method: 'PUT',
      token: asAdmin(),
      body: { data: [{ groupName: 'Service Desk Agents', roleKey: 'agent' }, { groupName: 'Desk Leads', roleKey: 'team_lead' }] },
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toHaveLength(2);
  });

  it('makes a team of a group and gives its members the mapped role', async () => {
    const created = await scim<ScimGroup>('/Groups', {
      method: 'POST',
      body: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Service Desk Agents', externalId: 'entra-grp-1', members: [{ value: adaId }, { value: byHandId }] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    groupId = created.body.id;
    expect(created.body.members.map((member) => member.value).sort()).toEqual([adaId, byHandId].sort());

    const team = await read((tx) => tx.team.findFirst({ where: { id: groupId } }));
    expect(team?.key).toBe('service-desk-agents');
    expect(team?.scimExternalId).toBe('entra-grp-1');
    expect(await rolesOf(adaId)).toEqual(['agent']);
    const adaGrant = await read((tx) => tx.roleAssignment.findFirst({ where: { userId: adaId } }));
    expect(adaGrant?.viaScimTeamId).toBe(groupId);

    const found = await scim<ScimList<ScimGroup>>('/Groups?filter=displayName%20eq%20%22Service%20Desk%20Agents%22');
    expect(found.body.totalResults).toBe(1);
    const ada = await scim<ScimUser>(`/Users/${adaId}`);
    expect(ada.body.groups.map((group) => group.display)).toEqual(['Service Desk Agents']);
  });

  it('adds and removes members the way Entra patches, and the role follows', async () => {
    const added = await scim<ScimGroup>(`/Groups/${groupId}`, { method: 'PATCH', body: { Operations: [{ op: 'Add', path: 'members', value: [{ value: graceId }] }] } });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body.members.map((member) => member.value)).toContain(graceId);
    expect(await rolesOf(graceId)).toEqual(['agent']);

    const removed = await scim<ScimGroup>(`/Groups/${groupId}`, { method: 'PATCH', body: { Operations: [{ op: 'remove', path: `members[value eq "${graceId}"]` }] } });
    expect(removed.status).toBe(200);
    expect(removed.body.members.map((member) => member.value)).not.toContain(graceId);
    expect(await rolesOf(graceId)).toEqual([]);
  });

  it('does not take away what an administrator gave by hand', async () => {
    const removed = await scim<ScimGroup>(`/Groups/${groupId}`, { method: 'PATCH', body: { Operations: [{ op: 'remove', path: `members[value eq "${byHandId}"]` }] } });
    expect(removed.status).toBe(200);
    expect(await rolesOf(byHandId)).toEqual(['agent']);
  });

  it('follows a rename to a different mapping', async () => {
    const renamed = await scim<ScimGroup>(`/Groups/${groupId}`, { method: 'PATCH', body: { Operations: [{ op: 'replace', path: 'displayName', value: 'Desk Leads' }] } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.displayName).toBe('Desk Leads');
    expect(await rolesOf(adaId)).toEqual(['team_lead']);
  });

  it('re-applies the map to everybody when the map changes', async () => {
    const set = await request('/api/v1/scim/role-mappings', { method: 'PUT', token: asAdmin(), body: { data: [{ groupName: 'Desk Leads', roleKey: 'agent' }] } });
    expect(set.status).toBe(200);
    expect(await rolesOf(adaId)).toEqual(['agent']);
  });

  it('empties and retires the team when the group is deleted, keeping its history', async () => {
    const deleted = await scim(`/Groups/${groupId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    const team = await read((tx) => tx.team.findFirst({ where: { id: groupId } }));
    expect(team?.deletedAt).not.toBeNull();
    expect(await read((tx) => tx.teamMembership.count({ where: { teamId: groupId } }))).toBe(0);
    expect(await rolesOf(adaId)).toEqual([]);
    expect((await scim(`/Groups/${groupId}`)).status).toBe(404);
  });
});

describe('first login through the provider', () => {
  it('lands on the account SCIM made, and is refused once SCIM deactivates it', async () => {
    const made = await scim<ScimUser>('/Users', { method: 'POST', body: { userName: 'newstarter@scim.test', displayName: 'New Starter', externalId: 'entra-obj-9' } });
    expect(made.status).toBe(201);

    // A token as the identity provider would mint it: a subject the platform
    // has never seen, and an email it has.
    const idp = signDevelopmentToken({ sub: 'idp-subject-9', tenant_id: tenant.id, email: 'newstarter@scim.test', name: 'New Starter', sid: 'sid-new-9' });
    const me = await request<{ actor: { id: string } }>('/api/v1/me', { token: idp });
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.actor.id).toBe(made.body.id);
    const user = await read((tx) => tx.user.findFirst({ where: { id: made.body.id } }));
    expect(user?.idpSubject).toBe('idp-subject-9');
    expect(await read((tx) => tx.user.count({ where: { email: 'newstarter@scim.test' } }))).toBe(1);

    const gone = await scim(`/Users/${made.body.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(204);
    expect((await request('/api/v1/me', { token: idp })).status).toBe(401);
  });
});

describe('the token\'s life', () => {
  it('overlaps on rotation and stops on revocation', async () => {
    const rotated = await request<{ token: string; previousValidUntil: string }>('/api/v1/scim/token', { method: 'POST', token: asAdmin(), body: {} });
    expect(rotated.status).toBe(201);
    expect((await scim('/ServiceProviderConfig')).status).toBe(200);
    expect((await scim('/ServiceProviderConfig', { bearer: rotated.body.token })).status).toBe(200);

    const listed = await request<{ data: { hint: string; expiresAt: string | null }[] }>('/api/v1/scim/token', { token: asAdmin() });
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data.filter((row) => row.expiresAt !== null)).toHaveLength(1);

    const revoked = await request<{ revoked: number }>('/api/v1/scim/token', { method: 'DELETE', token: asAdmin() });
    expect(revoked.body.revoked).toBe(2);
    expect((await scim('/ServiceProviderConfig')).status).toBe(401);
    expect((await scim('/ServiceProviderConfig', { bearer: rotated.body.token })).status).toBe(401);
  });
});
