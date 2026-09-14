import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  registerScopeResolver,
  transaction,
  invalidatePermissions,
} from '@itsm/platform';
import { events } from '@itsm/contracts';

/** MOD-01 user, team and role administration, plus just-in-time provisioning. */

interface UserRecord {
  id: string;
  primaryOrgId: string | null;
  managerId: string | null;
  orgId?: string | null;
}

registerScopeResolver<UserRecord>({
  aggregate: 'user',
  isOwn: (ctx, user) => user.id === ctx.actor.id,
  isTeam: (ctx, user) => Boolean(user.primaryOrgId && ctx.organisationIds.includes(user.primaryOrgId)),
  orgId: (user) => user.primaryOrgId,
});

export const createUserSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(200),
  primaryOrgId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  idpSubject: z.string().max(255).optional(),
  locale: z.string().max(20).default('en-GB'),
  timeZone: z.string().max(60).default('Europe/London'),
  isExternal: z.boolean().default(false),
});
/** The caller supplies what they know; the schema fills in the defaults. */
export type CreateUserInput = z.input<typeof createUserSchema>;

export async function createUser(ctx: TenantContext, input: CreateUserInput, source: 'admin' | 'jit' | 'import' | 'seed' = 'admin') {
  const parsed = createUserSchema.parse(input);
  if (source === 'admin') authz.require(ctx, 'identity.user.manage');

  return transaction(ctx, async (tx) => {
    const email = parsed.email.toLowerCase();
    const existing = await tx.user.findFirst({ where: { email } });
    if (existing) throw new ConflictError(`a user with the email ${email} already exists`);

    const id = newId();
    const user = await tx.user.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        email,
        displayName: parsed.displayName,
        primaryOrgId: parsed.primaryOrgId ?? null,
        managerId: parsed.managerId ?? null,
        idpSubject: parsed.idpSubject ?? null,
        locale: parsed.locale,
        timeZone: parsed.timeZone,
        isExternal: parsed.isExternal,
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'user.provisioned',
      targetType: 'user',
      targetId: id,
      after: { email, displayName: parsed.displayName, source },
    });
    await publish(tx, ctx, {
      definition: events.userProvisioned,
      aggregateId: id,
      payload: { userId: id, email, source },
    });

    return user;
  });
}

/**
 * Creates or refreshes a user from a verified identity token on first login
 * (MOD-01-E1-S1). Runs before any permission check, because the point of it is
 * to establish who the caller is.
 */
export async function provisionFromToken(
  ctx: TenantContext,
  claims: { sub: string; email: string; name?: string; locale?: string; zoneinfo?: string },
): Promise<{ userId: string; created: boolean }> {
  const email = claims.email.toLowerCase();

  return transaction(ctx, async (tx) => {
    const bySubject = await tx.user.findFirst({ where: { idpSubject: claims.sub } });
    if (bySubject) {
      if (bySubject.status !== 'active') throw new ValidationError('this account is not active');
      const changes: Record<string, unknown> = {};
      if (claims.name && claims.name !== bySubject.displayName) changes.displayName = claims.name;
      if (email !== bySubject.email) changes.email = email;
      if (Object.keys(changes).length > 0) {
        await tx.user.update({ where: { id: bySubject.id }, data: { ...changes, lastSeenAt: new Date() } });
        await publish(tx, ctx, {
          definition: events.userUpdated,
          aggregateId: bySubject.id,
          payload: { userId: bySubject.id, changed: Object.keys(changes) },
        });
      } else {
        await tx.user.update({ where: { id: bySubject.id }, data: { lastSeenAt: new Date() } });
      }
      return { userId: bySubject.id, created: false };
    }

    // An account may already exist from an import or an invitation; link it to
    // the identity provider rather than creating a duplicate person.
    const byEmail = await tx.user.findFirst({ where: { email } });
    if (byEmail) {
      await tx.user.update({
        where: { id: byEmail.id },
        data: { idpSubject: claims.sub, lastSeenAt: new Date(), status: byEmail.status === 'invited' ? 'active' : byEmail.status },
      });
      await recordAudit(tx, ctx, {
        action: 'user.linked_to_idp',
        targetType: 'user',
        targetId: byEmail.id,
        after: { idpSubject: claims.sub },
      });
      return { userId: byEmail.id, created: false };
    }

    const id = newId();
    await tx.user.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        email,
        displayName: claims.name ?? email,
        idpSubject: claims.sub,
        locale: claims.locale ?? 'en-GB',
        timeZone: claims.zoneinfo ?? 'Europe/London',
        lastSeenAt: new Date(),
      },
    });
    await recordAudit(tx, ctx, { action: 'user.provisioned', targetType: 'user', targetId: id, after: { email, source: 'jit' } });
    await publish(tx, ctx, { definition: events.userProvisioned, aggregateId: id, payload: { userId: id, email, source: 'jit' } });

    return { userId: id, created: true };
  });
}

export async function getUser(ctx: TenantContext, id: string) {
  return transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundError('user', id);
    authz.requireVisible(ctx, 'identity.user.read', { aggregate: 'user', record: user }, 'user');
    return user;
  });
}

export async function listUsers(ctx: TenantContext, options: { search?: string; limit: number; status?: string }) {
  authz.require(ctx, 'identity.user.read');

  // A directory listing must honour the caller's scope, not merely the fact
  // that they hold the permission at all: a requester holds `identity.user.read`
  // so they can read their own profile, which is not licence to enumerate
  // everyone in the tenant (Appendix B: Requester → own profile).
  const scope = authz.effectiveScope(ctx, 'identity.user.read');
  const scopeFilter =
    scope === 'any'
      ? {}
      : scope === 'team'
        ? { OR: [{ id: ctx.actor.id ?? '' }, ...(ctx.organisationIds.length ? [{ primaryOrgId: { in: ctx.organisationIds } }] : [])] }
        : { id: ctx.actor.id ?? '' };

  return transaction(ctx, async (tx) =>
    tx.user.findMany({
      where: {
        deletedAt: null,
        ...scopeFilter,
        ...(options.status ? { status: options.status } : {}),
        ...(options.search
          ? {
              OR: [
                { displayName: { contains: options.search, mode: 'insensitive' as const } },
                { email: { contains: options.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      take: options.limit,
    }),
  );
}

export async function deactivateUser(ctx: TenantContext, id: string, reason?: string) {
  authz.require(ctx, 'identity.user.manage');
  return transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundError('user', id);
    if (user.status === 'inactive') return user;

    const updated = await tx.user.update({
      where: { id },
      data: { status: 'inactive', updatedBy: ctx.actor.id, version: { increment: 1 } },
    });
    // Access ends immediately: sessions, keys and assignments all go at once.
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.apiKey.updateMany({ where: { serviceUserId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.roleAssignment.deleteMany({ where: { userId: id } });

    await recordAudit(tx, ctx, {
      action: 'user.deactivated',
      targetType: 'user',
      targetId: id,
      before: { status: user.status },
      after: { status: 'inactive' },
      reason: reason ?? null,
    });
    await publish(tx, ctx, {
      definition: events.userDeactivated,
      aggregateId: id,
      payload: { userId: id, reason: reason ?? null },
    });
    return updated;
  });
}

export async function assignRole(
  ctx: TenantContext,
  input: { userId: string; roleKey: string; scopeType?: 'organisation' | 'team' | 'service'; scopeId?: string; validTo?: Date },
) {
  authz.require(ctx, 'identity.role.manage');
  return transaction(ctx, async (tx) => {
    const [user, role] = await Promise.all([
      tx.user.findFirst({ where: { id: input.userId, deletedAt: null } }),
      tx.role.findFirst({ where: { key: input.roleKey } }),
    ]);
    if (!user) throw new NotFoundError('user', input.userId);
    if (!role) throw new NotFoundError('role', input.roleKey);

    const existing = await tx.roleAssignment.findFirst({
      where: { userId: input.userId, roleId: role.id, scopeType: input.scopeType ?? null, scopeId: input.scopeId ?? null },
    });
    if (existing) return existing;

    const assignment = await tx.roleAssignment.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        userId: input.userId,
        roleId: role.id,
        scopeType: input.scopeType ?? null,
        scopeId: input.scopeId ?? null,
        validTo: input.validTo ?? null,
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'role.assignment.granted',
      targetType: 'user',
      targetId: input.userId,
      after: { roleKey: input.roleKey, scopeType: input.scopeType ?? null, scopeId: input.scopeId ?? null },
    });
    await publish(tx, ctx, {
      definition: events.roleAssignmentChanged,
      aggregateId: input.userId,
      payload: { userId: input.userId, roleId: role.id, action: 'granted' },
    });

    await invalidatePermissions(ctx.tenantId, input.userId);
    return assignment;
  });
}

export async function revokeRole(ctx: TenantContext, assignmentId: string) {
  authz.require(ctx, 'identity.role.manage');
  return transaction(ctx, async (tx) => {
    const assignment = await tx.roleAssignment.findFirst({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError('role assignment', assignmentId);

    await tx.roleAssignment.delete({ where: { id: assignmentId } });
    await recordAudit(tx, ctx, {
      action: 'role.assignment.revoked',
      targetType: 'user',
      targetId: assignment.userId,
      before: { roleId: assignment.roleId, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
    });
    await publish(tx, ctx, {
      definition: events.roleAssignmentChanged,
      aggregateId: assignment.userId,
      payload: { userId: assignment.userId, roleId: assignment.roleId, action: 'revoked' },
    });
    await invalidatePermissions(ctx.tenantId, assignment.userId);
  });
}

export async function createTeam(ctx: TenantContext, input: { key: string; name: string; orgId: string; type?: string }) {
  authz.require(ctx, 'identity.org.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.team.findFirst({ where: { key: input.key } });
    if (existing) throw new ConflictError(`a team with the key ${input.key} already exists`);
    const team = await tx.team.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: input.orgId,
        key: input.key,
        name: input.name,
        type: input.type ?? 'support_group',
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, { action: 'team.created', targetType: 'team', targetId: team.id, after: { key: input.key, name: input.name } });
    return team;
  });
}

export async function addTeamMember(ctx: TenantContext, teamId: string, userId: string, isLead = false) {
  authz.require(ctx, 'identity.org.manage');
  return transaction(ctx, async (tx) => {
    const existing = await tx.teamMembership.findFirst({ where: { teamId, userId } });
    if (existing) return existing;
    const membership = await tx.teamMembership.create({
      data: { id: newId(), tenantId: ctx.tenantId, teamId, userId, isLead },
    });
    await recordAudit(tx, ctx, { action: 'team.member.added', targetType: 'team', targetId: teamId, after: { userId, isLead } });
    await invalidatePermissions(ctx.tenantId, userId);
    return membership;
  });
}

export async function recordSession(
  ctx: TenantContext,
  input: { userId: string; sid: string; expiresAt: Date; ip?: string; userAgent?: string; device?: string },
) {
  return transaction(ctx, async (tx) => {
    const existing = await tx.session.findFirst({ where: { sid: input.sid } });
    if (existing) {
      return tx.session.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), expiresAt: input.expiresAt } });
    }
    const session = await tx.session.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        userId: input.userId,
        sid: input.sid,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        device: input.device ?? null,
        expiresAt: input.expiresAt,
      },
    });
    await publish(tx, ctx, {
      definition: events.authLoginSucceeded,
      aggregateId: session.id,
      payload: { userId: input.userId, sessionId: session.id, method: 'oidc', ip: input.ip ?? null },
    });
    return session;
  });
}

export async function revokeSession(ctx: TenantContext, sessionId: string) {
  return transaction(ctx, async (tx) => {
    const session = await tx.session.findFirst({ where: { id: sessionId } });
    if (!session) throw new NotFoundError('session', sessionId);
    authz.requireVisible(
      ctx,
      'identity.session.manage',
      { aggregate: 'user', record: { id: session.userId, primaryOrgId: null, managerId: null } },
      'session',
    );
    if (session.revokedAt) return session;

    const updated = await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await recordAudit(tx, ctx, { action: 'session.revoked', targetType: 'session', targetId: sessionId, after: { revoked: true } });
    await publish(tx, ctx, {
      definition: events.sessionRevoked,
      aggregateId: sessionId,
      payload: { userId: session.userId, sessionId, by: ctx.actor },
    });
    return updated;
  });
}

export async function listSessions(ctx: TenantContext, userId: string) {
  authz.requireVisible(
    ctx,
    'identity.session.manage',
    { aggregate: 'user', record: { id: userId, primaryOrgId: null, managerId: null } },
    'user',
  );
  return transaction(ctx, (tx) =>
    tx.session.findMany({ where: { userId, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 50 }),
  );
}
