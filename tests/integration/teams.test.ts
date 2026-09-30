import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, transaction, withContext } from '@itsm/platform';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /teams` and `GET /teams/:id/members` (A6), readable by an agent.
 *
 * Teams could be created and given members but not listed, and the only
 * permission that could have gated a listing, `identity.org.read`, is an
 * administrator's. So the workbench showed a ticket's team as an id and could
 * offer no team views and no "move to team". The directory is now readable by
 * anyone who works the desk; a requester still sees none of it.
 */

let tenant: TestTenant;
let otherTenant: TestTenant;
let subsidiaryTeamId: string;
let retiredTeamId: string;
let orgViewer: { id: string; token: string };

interface Team {
  id: string;
  key: string;
  name: string;
  orgId: string;
  memberCount: number;
}

interface Member {
  userId: string;
  displayName: string;
  isLead: boolean;
  since: string;
}

const asAdmin = () => tenant.people.admin!.token;
const asAgent = () => tenant.people.agent!.token;

async function teams(token = asAgent()): Promise<Team[]> {
  const response = await request<{ data: Team[] }>('/api/v1/teams', { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}

async function team(key: string, token = asAgent()): Promise<Team | undefined> {
  return (await teams(token)).find((row) => row.key === key);
}

const members = (teamId: string, token = asAgent()) => request<{ data: Member[] }>(`/api/v1/teams/${teamId}/members`, { token });

async function createUser(displayName: string, email: string, orgId = tenant.orgId): Promise<{ id: string }> {
  const response = await request<{ id: string }>('/api/v1/users', { method: 'POST', token: asAdmin(), body: { email, displayName, primaryOrgId: orgId } });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function addMember(teamId: string, userId: string) {
  expect((await request(`/api/v1/teams/${teamId}/members`, { method: 'POST', token: asAdmin(), body: { userId } })).status).toBe(201);
}

async function inTenant<T>(fn: Parameters<typeof transaction<T>>[1]): Promise<T> {
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () => transaction(ctx, fn));
}

beforeAll(async () => {
  tenant = await createTestTenant('teams');
  otherTenant = await createTestTenant('teams-other');

  // A team in another organisation, which only a tenant-wide reader sees.
  const subsidiary = await request<{ id: string }>('/api/v1/organisations', {
    method: 'POST',
    token: asAdmin(),
    body: { name: 'Subsidiary', code: 'SUB' },
  });
  expect(subsidiary.status).toBe(201);
  const created = await request<{ id: string }>('/api/v1/teams', {
    method: 'POST',
    token: asAdmin(),
    body: { key: 'subsidiary-desk', name: 'Subsidiary Desk', orgId: subsidiary.body.id },
  });
  expect(created.status).toBe(201);
  subsidiaryTeamId = created.body.id;

  // A team that has been deleted, which nobody sees.
  const retired = await request<{ id: string }>('/api/v1/teams', {
    method: 'POST',
    token: asAdmin(),
    body: { key: 'old-helpdesk', name: 'Old Helpdesk', orgId: tenant.orgId },
  });
  retiredTeamId = retired.body.id;
  await inTenant((tx) => tx.team.update({ where: { id: retiredTeamId }, data: { deletedAt: new Date() } }));

  // Somebody who may read the organisation structure of their own
  // organisation only: a tenant's own role, since no system role is that.
  const viewer = await createUser('Vic Viewer', 'vic.viewer@teams.test');
  await inTenant(async (tx) => {
    const roleId = newId();
    await tx.role.create({ data: { id: roleId, tenantId: tenant.id, key: 'org_viewer', name: 'Organisation viewer' } });
    await tx.rolePermission.create({ data: { id: newId(), tenantId: tenant.id, roleId, permissionKey: 'identity.org.read', scope: 'own' } });
  });
  expect((await request('/api/v1/role-assignments', { method: 'POST', token: asAdmin(), body: { userId: viewer.id, roleKey: 'org_viewer' } })).status).toBe(201);
  orgViewer = {
    id: viewer.id,
    token: signDevelopmentToken({
      sub: viewer.id,
      itsm_user_id: viewer.id,
      tenant_id: tenant.id,
      email: 'vic.viewer@teams.test',
      name: 'Vic Viewer',
      sid: `test-${viewer.id}`,
    }),
  };
}, 240_000);

afterAll(async () => {
  await deleteTestTenant('teams');
  await deleteTestTenant('teams-other');
  await closeHarness();
});

describe('GET /teams', () => {
  it('lets an agent read the directory, with how many people are in each team', async () => {
    const rows = await teams();
    expect(rows.map((row) => row.key)).toEqual(['network-team', 'service-desk', 'subsidiary-desk']);
    expect(rows.find((row) => row.key === 'service-desk')).toEqual({
      id: tenant.teamId,
      key: 'service-desk',
      name: 'Service Desk',
      orgId: tenant.orgId,
      memberCount: 2,
    });
    expect((await team('network-team'))!.memberCount).toBe(1);
    expect((await team('subsidiary-desk'))!.memberCount).toBe(0);
  });

  it('gives a lead, the other team’s agent and an administrator the same directory', async () => {
    const expected = (await teams()).map((row) => row.id);
    for (const persona of ['lead', 'otherAgent', 'admin'] as const) {
      expect((await teams(tenant.people[persona]!.token)).map((row) => row.id), persona).toEqual(expected);
    }
  });

  it('refuses a requester', async () => {
    const response = await request('/api/v1/teams', { token: tenant.people.requester!.token });
    expect(response.status).toBe(403);
  });

  it('shows someone who reads only their own organisation just its teams', async () => {
    expect((await teams(orgViewer.token)).map((row) => row.key)).toEqual(['network-team', 'service-desk']);
  });

  it('never shows a deleted team or another tenant’s', async () => {
    const ids = (await teams(asAdmin())).map((row) => row.id);
    expect(ids).not.toContain(retiredTeamId);
    expect(ids).not.toContain(otherTenant.teamId);
  });
});

describe('who counts as a member', () => {
  it('counts somebody added, not somebody deactivated, and counts them again when they are back', async () => {
    const dee = await createUser('Dee Departing', 'dee.departing@teams.test');
    await addMember(tenant.otherTeamId, dee.id);
    expect((await team('network-team'))!.memberCount).toBe(2);

    expect((await request(`/api/v1/users/${dee.id}/deactivate`, { method: 'POST', token: asAdmin(), body: {} })).status).toBe(200);
    expect((await team('network-team'))!.memberCount).toBe(1);
    expect((await members(tenant.otherTeamId)).body.data.map((row) => row.userId)).not.toContain(dee.id);

    expect((await request(`/api/v1/users/${dee.id}/reactivate`, { method: 'POST', token: asAdmin(), body: {} })).status).toBe(200);
    expect((await team('network-team'))!.memberCount).toBe(2);
    expect((await members(tenant.otherTeamId)).body.data.map((row) => row.userId)).toContain(dee.id);
  });

  it('does not count a membership that has ended', async () => {
    const tam = await createUser('Tam Temporary', 'tam.temporary@teams.test');
    await addMember(tenant.otherTeamId, tam.id);
    const before = (await team('network-team'))!.memberCount;
    await inTenant((tx) =>
      tx.teamMembership.updateMany({ where: { userId: tam.id }, data: { validTo: new Date(Date.now() - 60_000) } }),
    );
    expect((await team('network-team'))!.memberCount).toBe(before - 1);
    expect((await members(tenant.otherTeamId)).body.data.map((row) => row.userId)).not.toContain(tam.id);
  });
});

describe('GET /teams/:id/members', () => {
  it('lists the team’s people for an agent, leads first, by name only', async () => {
    const response = await members(tenant.teamId);
    expect(response.status).toBe(200);
    expect(response.body.data.map(({ userId, displayName, isLead }) => ({ userId, displayName, isLead }))).toEqual([
      { userId: tenant.people.lead!.id, displayName: 'Priya Lead', isLead: true },
      { userId: tenant.people.agent!.id, displayName: 'Sam Agent', isLead: false },
    ]);
    for (const member of response.body.data) {
      expect(Object.keys(member).sort()).toEqual(['displayName', 'isLead', 'since', 'userId']);
      expect(Date.parse(member.since)).not.toBeNaN();
    }
  });

  it('matches the count in the directory', async () => {
    for (const row of await teams(asAdmin())) {
      expect((await members(row.id, asAdmin())).body.data, row.key).toHaveLength(row.memberCount);
    }
  });

  it('refuses a requester', async () => {
    expect((await members(tenant.teamId, tenant.people.requester!.token)).status).toBe(403);
  });

  it('404s for a team the caller cannot see: deleted, another tenant’s, outside their organisation, or nobody', async () => {
    expect((await members(retiredTeamId, asAdmin())).status).toBe(404);
    expect((await members(otherTenant.teamId, asAdmin())).status).toBe(404);
    expect((await members(subsidiaryTeamId, orgViewer.token)).status).toBe(404);
    expect((await members(subsidiaryTeamId, asAgent())).status).toBe(200);
    expect((await members(randomUUID(), asAdmin())).status).toBe(404);
    expect((await request('/api/v1/teams/not-an-id/members', { token: asAdmin() })).status).toBe(422);
  });
});
