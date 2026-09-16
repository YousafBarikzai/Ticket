import { z } from 'zod';
import { NotFoundError, ValidationError, authz, invalidatePermissions, newId, recordAudit, transaction, type TenantContext, type Tx } from '@itsm/platform';
import { tenantService } from '@itsm/module-tenancy';
import * as users from '../service/user-service.js';
import { ScimError } from './errors.js';
import { parseFilter } from './filter.js';
import { asBoolean, memberIds, normalisePatch, type Operation } from './patch.js';
import { fromScimGroup, fromScimUser, listResponse, toScimGroup, toScimUser, type ScimUserInput } from './resources.js';

/**
 * What an identity provider may do through /scim/v2, in terms of the
 * platform's own records.
 *
 * A SCIM user is a user; a SCIM group is a team; a group's members are the
 * team's members; and a tenant-configured map from a group's name to a role
 * turns membership into access. Every write goes through the same service
 * functions an administrator's click would, so the audit trail and the
 * events are the same — with the actor `scim`, which is the point of an
 * audit trail.
 *
 * Deactivation is `deactivateUser`, which revokes every session and key at
 * once: a leaver loses access the moment the provider says so (doc 09).
 */

export const MAX_PAGE = 200;

export interface Page {
  startIndex: number;
  count: number;
}

export type Location = (path: string) => string;

export const pageSchema = z.object({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(MAX_PAGE).default(100),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function groupsOf(tx: Tx, userId: string) {
  const memberships = await tx.teamMembership.findMany({ where: { userId, validTo: null }, include: { team: { select: { id: true, name: true, deletedAt: true } } } });
  return memberships.filter((membership) => !membership.team.deletedAt).map((membership) => ({ id: membership.team.id, name: membership.team.name }));
}

async function shapeUser(tx: Tx, user: Parameters<typeof toScimUser>[0], location: Location) {
  return toScimUser(user, await groupsOf(tx, user.id), location);
}

export async function listUsers(ctx: TenantContext, query: z.infer<typeof pageSchema>, location: Location) {
  authz.require(ctx, 'identity.user.read');
  const filter = parseFilter(query.filter);
  const where: Record<string, unknown> = { deletedAt: null };
  if (filter) {
    if (filter.attribute === 'userName' || filter.attribute === 'emails.value') where.email = filter.value.toLowerCase();
    else if (filter.attribute === 'externalId') where.scimExternalId = filter.value;
    else if (filter.attribute === 'displayName') where.displayName = filter.value;
    else where.id = filter.value;
  }
  return transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.user.count({ where }),
      tx.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: query.startIndex - 1, take: query.count }),
    ]);
    const resources = [];
    for (const row of rows) resources.push(await shapeUser(tx, row, location));
    return listResponse(resources, total, query.startIndex);
  });
}

export async function getUser(ctx: TenantContext, id: string, location: Location) {
  authz.require(ctx, 'identity.user.read');
  return transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new ScimError(404, `no user ${id}`);
    return shapeUser(tx, user, location);
  });
}

/** Applies what a provider said about a user to the record, through the services. */
async function applyUser(ctx: TenantContext, userId: string, input: Partial<ScimUserInput>) {
  await transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new ScimError(404, `no user ${userId}`);
    const data: Record<string, unknown> = {};
    if (input.userName !== undefined && input.userName !== user.email) {
      const taken = await tx.user.findFirst({ where: { email: input.userName, id: { not: userId } }, select: { id: true } });
      if (taken) throw new ScimError(409, `another user already has the address ${input.userName}`, 'uniqueness');
      data.email = input.userName;
    }
    if (input.displayName !== undefined && input.displayName !== user.displayName) data.displayName = input.displayName;
    if (input.externalId !== undefined && input.externalId !== user.scimExternalId) data.scimExternalId = input.externalId;
    if (input.locale && input.locale !== user.locale) data.locale = input.locale;
    if (input.timeZone && input.timeZone !== user.timeZone) data.timeZone = input.timeZone;
    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: userId }, data: { ...data, updatedBy: ctx.actor.id, version: { increment: 1 } } });
      await recordAudit(tx, ctx, { action: 'user.updated', targetType: 'user', targetId: userId, before: { email: user.email, displayName: user.displayName }, after: data });
    }
  });
  if (input.active === false) await users.deactivateUser(ctx, userId, 'deactivated by the identity provider');
  if (input.active === true) {
    const reactivated = await users.reactivateUser(ctx, userId);
    if (reactivated) await transaction(ctx, (tx) => reconcileRoles(ctx, tx, [userId]));
  }
}

export async function createUser(ctx: TenantContext, body: unknown, location: Location) {
  authz.require(ctx, 'identity.user.manage');
  const input = fromScimUser(body);

  const existing = await transaction(ctx, (tx) => tx.user.findFirst({ where: { email: input.userName, deletedAt: null } }));
  if (existing) {
    // An account from an import, an invitation or a first login: the
    // provider adopts it rather than being told it exists. One the provider
    // already owns is a genuine duplicate.
    if (existing.scimExternalId && existing.scimExternalId !== input.externalId) {
      throw new ScimError(409, `a user with userName ${input.userName} already exists`, 'uniqueness');
    }
    await applyUser(ctx, existing.id, input);
    return { created: false, resource: await getUser(ctx, existing.id, location) };
  }

  const user = await users.createUser(
    ctx,
    { email: input.userName, displayName: input.displayName, ...(input.locale ? { locale: input.locale } : {}), ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
    'scim',
  );
  await applyUser(ctx, user.id, { externalId: input.externalId, active: input.active });
  return { created: true, resource: await getUser(ctx, user.id, location) };
}

export async function replaceUser(ctx: TenantContext, id: string, body: unknown, location: Location) {
  authz.require(ctx, 'identity.user.manage');
  const input = fromScimUser(body);
  await applyUser(ctx, id, input);
  return getUser(ctx, id, location);
}

export async function patchUser(ctx: TenantContext, id: string, body: unknown, location: Location) {
  authz.require(ctx, 'identity.user.manage');
  const operations = normalisePatch(body);
  const changes: Partial<ScimUserInput> = {};
  let given: string | undefined;
  let family: string | undefined;

  for (const operation of operations) {
    if (operation.op === 'remove') {
      if (operation.path === 'externalId') changes.externalId = null;
      continue;
    }
    const value = operation.value;
    switch (operation.path) {
      case 'active':
        changes.active = asBoolean(value);
        break;
      case 'userName':
      case 'emails.value':
        if (typeof value === 'string' && value.includes('@')) changes.userName = value.toLowerCase();
        break;
      case 'emails': {
        const list = Array.isArray(value) ? (value as { value?: unknown; primary?: unknown }[]) : [];
        const primary = list.find((email) => email.primary === true) ?? list[0];
        if (typeof primary?.value === 'string' && primary.value.includes('@')) changes.userName = primary.value.toLowerCase();
        break;
      }
      case 'displayName':
      case 'name.formatted':
        if (typeof value === 'string' && value.trim()) changes.displayName = value.trim();
        break;
      case 'name.givenName':
        given = typeof value === 'string' ? value.trim() : undefined;
        break;
      case 'name.familyName':
        family = typeof value === 'string' ? value.trim() : undefined;
        break;
      case 'externalId':
        changes.externalId = typeof value === 'string' ? value : null;
        break;
      case 'locale':
        changes.locale = typeof value === 'string' ? value : null;
        break;
      case 'timezone':
        changes.timeZone = typeof value === 'string' ? value : null;
        break;
      default:
        // Attributes this platform does not keep (title, department) are
        // accepted and ignored: a provider that gets a 400 for a title stops
        // sending everything else too.
        break;
    }
  }
  if (changes.displayName === undefined && (given || family)) {
    const user = await transaction(ctx, (tx) => tx.user.findFirst({ where: { id }, select: { displayName: true } }));
    const [currentGiven, ...rest] = (user?.displayName ?? '').split(' ');
    changes.displayName = [given ?? currentGiven, family ?? rest.join(' ')].filter(Boolean).join(' ');
  }

  await applyUser(ctx, id, changes);
  return getUser(ctx, id, location);
}

/** DELETE is deactivation: the record stays, for the tickets that name it. */
export async function deleteUser(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'identity.user.manage');
  try {
    await users.deactivateUser(ctx, id, 'deleted by the identity provider');
  } catch (error) {
    if (error instanceof NotFoundError) throw new ScimError(404, `no user ${id}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function membersOf(tx: Tx, teamId: string) {
  const memberships = await tx.teamMembership.findMany({ where: { teamId, validTo: null }, include: { user: { select: { id: true, displayName: true } } } });
  return memberships.map((membership) => ({ id: membership.user.id, displayName: membership.user.displayName }));
}

async function shapeGroup(tx: Tx, team: Parameters<typeof toScimGroup>[0], location: Location) {
  return toScimGroup(team, await membersOf(tx, team.id), location);
}

export async function listGroups(ctx: TenantContext, query: z.infer<typeof pageSchema>, location: Location) {
  authz.require(ctx, 'identity.org.read');
  const filter = parseFilter(query.filter);
  const where: Record<string, unknown> = { deletedAt: null };
  if (filter) {
    if (filter.attribute === 'displayName') where.name = filter.value;
    else if (filter.attribute === 'externalId') where.scimExternalId = filter.value;
    else if (filter.attribute === 'id') where.id = filter.value;
    else throw new ScimError(400, `groups cannot be filtered on ${filter.attribute}`, 'invalidFilter');
  }
  return transaction(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.team.count({ where }),
      tx.team.findMany({ where, orderBy: { createdAt: 'asc' }, skip: query.startIndex - 1, take: query.count }),
    ]);
    const resources = [];
    for (const row of rows) resources.push(await shapeGroup(tx, row, location));
    return listResponse(resources, total, query.startIndex);
  });
}

export async function getGroup(ctx: TenantContext, id: string, location: Location) {
  authz.require(ctx, 'identity.org.read');
  return transaction(ctx, async (tx) => {
    const team = await tx.team.findFirst({ where: { id, deletedAt: null } });
    if (!team) throw new ScimError(404, `no group ${id}`);
    return shapeGroup(tx, team, location);
  });
}

function keyFor(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return /^[a-z]/.test(slug) ? slug : `g-${slug}`.slice(0, 60);
}

/**
 * Sets a team's membership to exactly these users, or adds or removes some,
 * writing the same rows and audit lines `addTeamMember` does. Returns every
 * user whose membership changed, so their roles can be looked at again.
 */
async function setMembers(ctx: TenantContext, tx: Tx, teamId: string, change: { add?: string[]; remove?: string[]; replace?: string[] }): Promise<string[]> {
  const current = await tx.teamMembership.findMany({ where: { teamId, validTo: null }, select: { id: true, userId: true } });
  const currentIds = new Set(current.map((membership) => membership.userId));
  const wanted = change.replace ? new Set(change.replace) : new Set([...currentIds, ...(change.add ?? [])]);
  for (const id of change.remove ?? []) wanted.delete(id);

  const affected: string[] = [];
  for (const userId of wanted) {
    if (currentIds.has(userId)) continue;
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!user) throw new ScimError(400, `no user ${userId} to add as a member`, 'invalidValue');
    await tx.teamMembership.create({ data: { id: newId(), tenantId: ctx.tenantId, teamId, userId } });
    await recordAudit(tx, ctx, { action: 'team.member.added', targetType: 'team', targetId: teamId, after: { userId, isLead: false } });
    affected.push(userId);
  }
  for (const membership of current) {
    if (wanted.has(membership.userId)) continue;
    await tx.teamMembership.delete({ where: { id: membership.id } });
    await recordAudit(tx, ctx, { action: 'team.member.removed', targetType: 'team', targetId: teamId, before: { userId: membership.userId } });
    affected.push(membership.userId);
  }
  for (const userId of affected) await invalidatePermissions(ctx.tenantId, userId);
  return affected;
}

export async function createGroup(ctx: TenantContext, body: unknown, location: Location) {
  authz.require(ctx, 'identity.org.manage');
  const input = fromScimGroup(body);

  const existing = await transaction(ctx, (tx) =>
    tx.team.findFirst({
      where: {
        deletedAt: null,
        OR: [...(input.externalId ? [{ scimExternalId: input.externalId }] : []), { name: { equals: input.displayName, mode: 'insensitive' } }],
      },
    }),
  );
  if (existing?.scimExternalId && input.externalId && existing.scimExternalId !== input.externalId) {
    throw new ScimError(409, `a group named ${input.displayName} already exists`, 'uniqueness');
  }

  let teamId = existing?.id ?? null;
  if (!teamId) {
    const organisations = await tenantService.listOrganisations(ctx);
    const orgId = organisations[0]?.id;
    if (!orgId) throw new ScimError(500, 'the tenant has no organisation to put a team in');
    let key = keyFor(input.displayName);
    const clash = await transaction(ctx, (tx) => tx.team.findFirst({ where: { key }, select: { id: true } }));
    if (clash) key = `${key}-${newId().slice(0, 8)}`;
    const team = await users.createTeam(ctx, { key, name: input.displayName, orgId });
    teamId = team.id;
  }

  await transaction(ctx, async (tx) => {
    await tx.team.update({ where: { id: teamId! }, data: { name: input.displayName, ...(input.externalId ? { scimExternalId: input.externalId } : {}), updatedBy: ctx.actor.id } });
    const affected = await setMembers(ctx, tx, teamId!, { replace: input.memberIds });
    await reconcileRoles(ctx, tx, affected);
  });
  return { created: !existing, resource: await getGroup(ctx, teamId, location) };
}

export async function replaceGroup(ctx: TenantContext, id: string, body: unknown, location: Location) {
  authz.require(ctx, 'identity.org.manage');
  const input = fromScimGroup(body);
  await transaction(ctx, async (tx) => {
    const team = await tx.team.findFirst({ where: { id, deletedAt: null } });
    if (!team) throw new ScimError(404, `no group ${id}`);
    await tx.team.update({ where: { id }, data: { name: input.displayName, ...(input.externalId !== null ? { scimExternalId: input.externalId } : {}), updatedBy: ctx.actor.id } });
    const affected = await setMembers(ctx, tx, id, { replace: input.memberIds });
    // A rename can change which mapping applies to every member.
    const members = await tx.teamMembership.findMany({ where: { teamId: id, validTo: null }, select: { userId: true } });
    await reconcileRoles(ctx, tx, [...new Set([...affected, ...members.map((member) => member.userId)])]);
  });
  return getGroup(ctx, id, location);
}

export async function patchGroup(ctx: TenantContext, id: string, body: unknown, location: Location) {
  authz.require(ctx, 'identity.org.manage');
  const operations = normalisePatch(body);
  await transaction(ctx, async (tx) => {
    const team = await tx.team.findFirst({ where: { id, deletedAt: null } });
    if (!team) throw new ScimError(404, `no group ${id}`);
    const affected = new Set<string>();
    let renamed = false;
    for (const operation of operations) {
      if (operation.path === 'members') {
        const ids = memberIds(operation);
        const change: Parameters<typeof setMembers>[3] =
          operation.op === 'add' ? { add: ids } : operation.op === 'remove' ? { remove: operation.selector ? ids : ids.length ? ids : (await membersOf(tx, id)).map((member) => member.id) } : { replace: ids };
        for (const userId of await setMembers(ctx, tx, id, change)) affected.add(userId);
      } else if (operation.path === 'displayName' && operation.op !== 'remove' && typeof operation.value === 'string' && operation.value.trim()) {
        await tx.team.update({ where: { id }, data: { name: operation.value.trim(), updatedBy: ctx.actor.id } });
        renamed = true;
      } else if (operation.path === 'externalId') {
        await tx.team.update({ where: { id }, data: { scimExternalId: operation.op === 'remove' ? null : String(operation.value ?? '') || null } });
      }
    }
    if (renamed) {
      const members = await tx.teamMembership.findMany({ where: { teamId: id, validTo: null }, select: { userId: true } });
      for (const member of members) affected.add(member.userId);
    }
    await reconcileRoles(ctx, tx, [...affected]);
  });
  return getGroup(ctx, id, location);
}

/** A deleted group is a team nobody is in any more; the team's history stays. */
export async function deleteGroup(ctx: TenantContext, id: string): Promise<void> {
  authz.require(ctx, 'identity.org.manage');
  await transaction(ctx, async (tx) => {
    const team = await tx.team.findFirst({ where: { id, deletedAt: null } });
    if (!team) throw new ScimError(404, `no group ${id}`);
    const affected = await setMembers(ctx, tx, id, { replace: [] });
    await tx.team.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: ctx.actor.id } });
    await recordAudit(tx, ctx, { action: 'team.deleted', targetType: 'team', targetId: id, before: { name: team.name, scimExternalId: team.scimExternalId } });
    await reconcileRoles(ctx, tx, affected);
  });
}

// ---------------------------------------------------------------------------
// Roles from group names
// ---------------------------------------------------------------------------

export const roleMappingsSchema = z.array(z.object({ groupName: z.string().min(1).max(200), roleKey: z.string().min(1).max(100) })).max(200);

export async function listRoleMappings(ctx: TenantContext) {
  authz.require(ctx, 'identity.scim.manage');
  return transaction(ctx, (tx) => tx.scimRoleMapping.findMany({ orderBy: [{ groupName: 'asc' }, { roleKey: 'asc' }] }));
}

/** Replaces the map, then looks again at everybody a SCIM group touches. */
export async function setRoleMappings(ctx: TenantContext, input: z.input<typeof roleMappingsSchema>) {
  authz.require(ctx, 'identity.scim.manage');
  const parsed = roleMappingsSchema.parse(input);
  return transaction(ctx, async (tx) => {
    const roles = await tx.role.findMany({ select: { key: true } });
    const known = new Set(roles.map((role) => role.key));
    const unknown = parsed.filter((mapping) => !known.has(mapping.roleKey)).map((mapping) => mapping.roleKey);
    if (unknown.length > 0) throw new ValidationError(`no such role(s): ${[...new Set(unknown)].join(', ')}`);

    await tx.scimRoleMapping.deleteMany({ where: { tenantId: ctx.tenantId } });
    for (const mapping of parsed) {
      await tx.scimRoleMapping.create({ data: { id: newId(), tenantId: ctx.tenantId, groupName: mapping.groupName, roleKey: mapping.roleKey, createdBy: ctx.actor.id } });
    }
    await recordAudit(tx, ctx, { action: 'scim.role_mappings.replaced', targetType: 'scim_role_mapping', targetId: ctx.tenantId, after: { mappings: parsed } });

    const members = await tx.teamMembership.findMany({ where: { validTo: null, team: { scimExternalId: { not: null }, deletedAt: null } }, select: { userId: true } });
    await reconcileRoles(ctx, tx, [...new Set(members.map((member) => member.userId))]);
    return tx.scimRoleMapping.findMany({ orderBy: [{ groupName: 'asc' }, { roleKey: 'asc' }] });
  });
}

/**
 * Makes each user's SCIM-granted roles match the groups they are in: a role
 * for every mapping whose group they belong to, and no other role this
 * module granted. Roles assigned by hand are not this module's and are not
 * touched.
 */
export async function reconcileRoles(ctx: TenantContext, tx: Tx, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const mappings = await tx.scimRoleMapping.findMany();
  const byGroup = new Map<string, string[]>();
  for (const mapping of mappings) {
    const key = mapping.groupName.toLowerCase();
    byGroup.set(key, [...(byGroup.get(key) ?? []), mapping.roleKey]);
  }

  for (const userId of new Set(userIds)) {
    const user = await tx.user.findFirst({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== 'active') continue;

    const memberships = await tx.teamMembership.findMany({
      where: { userId, validTo: null, team: { scimExternalId: { not: null }, deletedAt: null } },
      include: { team: { select: { id: true, name: true } } },
    });
    const wanted = new Map<string, { roleKey: string; teamId: string }>();
    for (const membership of memberships) {
      for (const roleKey of byGroup.get(membership.team.name.toLowerCase()) ?? []) {
        if (!wanted.has(roleKey)) wanted.set(roleKey, { roleKey, teamId: membership.team.id });
      }
    }

    const current = await tx.roleAssignment.findMany({ where: { userId, viaScimTeamId: { not: null } }, include: { role: { select: { key: true } } } });
    for (const assignment of current) {
      if (!wanted.has(assignment.role.key)) await users.revokeAssignmentOn(tx, ctx, assignment);
    }
    const held = new Set(current.map((assignment) => assignment.role.key));
    for (const grant of wanted.values()) {
      if (!held.has(grant.roleKey)) await users.grantRoleOn(tx, ctx, { userId, roleKey: grant.roleKey, viaScimTeamId: grant.teamId });
    }
  }
}

export type { Operation };
