import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertWithinLimit,
  authz,
  newId,
  publish,
  recordAudit,
  registerScopeResolver,
  transaction,
  invalidatePermissions,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { denySession, denySessions } from './session-denylist.js';
import { SYSTEM_ROLES } from '../seed/roles.js';

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
  /**
   * When the person joined, for a directory brought in from elsewhere: an
   * import or the seed (the shared demo's colleagues, A4 §2.3). Without it the
   * People page says that everybody joined the day the tenant was built.
   * Refused from any other source — an administrator adding somebody, a
   * sign-in or SCIM is the moment that person joins, and a back-dated account
   * would misstate when access began.
   */
  createdAt: z.coerce.date().optional(),
});
/** The caller supplies what they know; the schema fills in the defaults. */
export type CreateUserInput = z.input<typeof createUserSchema>;

/** The sources whose rows may say when the person joined (`createdAt`). */
export const HISTORY_SOURCES = ['import', 'seed'] as const;

export async function createUser(ctx: TenantContext, input: CreateUserInput, source: 'admin' | 'jit' | 'import' | 'seed' | 'scim' = 'admin') {
  const parsed = createUserSchema.parse(input);
  if (source === 'admin' || source === 'scim') authz.require(ctx, 'identity.user.manage');
  const joined = parsed.createdAt === undefined ? undefined : joinedAt(parsed.createdAt, source);

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
        // A joining date given by the source is also the row's last change:
        // nothing has happened to the account since it arrived. Omitted, both
        // columns keep the database's own clock, as before.
        ...(joined ? { createdAt: joined, updatedAt: joined } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: 'user.provisioned',
      targetType: 'user',
      targetId: id,
      // The audit row is written now whatever the account says, so a supplied
      // joining date is named in it: a reader can see the date came from the
      // source rather than from this moment.
      after: { email, displayName: parsed.displayName, source, ...(joined ? { createdAt: joined.toISOString() } : {}) },
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
 * The joining date a source supplied, once it is known to be one that may
 * supply it and to be in the past. A history records what already happened,
 * so a date after now is a mistake in the source, not a plan.
 */
function joinedAt(createdAt: Date, source: string): Date {
  if (!(HISTORY_SOURCES as readonly string[]).includes(source)) {
    throw new ValidationError('only an import or the seed can say when a person joined', [
      { field: 'createdAt', code: 'not_allowed', message: 'a person added here joins now' },
    ]);
  }
  if (createdAt.getTime() > Date.now()) {
    throw new ValidationError('a person cannot have joined in the future', [
      { field: 'createdAt', code: 'in_future', message: 'must not be later than now' },
    ]);
  }
  return createdAt;
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

/** The most ids one directory lookup resolves: a page of people, not the tenant. */
export const MAX_LOOKUP_IDS = 200;

/**
 * Lists people, narrowed by the caller's scope.
 *
 * `ids` resolves a known set of people at once — the names beside a page of
 * tickets or an audit trail — in place of one `GET /users/:id` per person.
 * It is a filter like any other, not a way round the scope: an id the caller
 * may not read is simply absent, as it would be from the directory, and
 * deactivated people are included, because the history they appear in still
 * needs their name.
 */
export async function listUsers(ctx: TenantContext, options: { search?: string; limit: number; status?: string; ids?: string[] }) {
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

  if (options.ids && options.ids.length > MAX_LOOKUP_IDS) {
    throw new ValidationError(`at most ${MAX_LOOKUP_IDS} ids can be looked up at once`);
  }

  return transaction(ctx, async (tx) =>
    tx.user.findMany({
      where: {
        deletedAt: null,
        // Each narrowing is its own element of `AND`. They used to be spread
        // into one object, and the search's `OR` then replaced the scope's
        // `OR` under the same key — so an agent limited to their own
        // organisations who typed a name was shown matching people from
        // every organisation in the tenant.
        AND: [
          scopeFilter,
          options.status ? { status: options.status } : {},
          options.ids ? { id: { in: options.ids } } : {},
          options.search
            ? {
                OR: [
                  { displayName: { contains: options.search, mode: 'insensitive' as const } },
                  { email: { contains: options.search, mode: 'insensitive' as const } },
                ],
              }
            : {},
        ],
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
    // The denylist first, for the same reason `revokeSession` does it first —
    // and this is where it mattered most. Marking `revoked_at` on a row that
    // nothing reads at request time left a deactivated person's token working
    // until it expired.
    const live = await tx.session.findMany({ where: { userId: id, revokedAt: null } });
    await denySessions(live.map((session) => ({ sid: session.sid, expiresAt: session.expiresAt })));
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
    // The resolved permission set is cached per user, and deactivation left it
    // there — `reactivateUser` invalidated and this did not. Nothing noticed
    // because every other caller resolves an actor from a request, and a
    // revoked session fails at the door first. Background work that resolves
    // an actor by id has no door: MOD-09's suggestion worker was the first,
    // and it would have run a deactivated person's job on their old rights
    // until the cache expired.
    await invalidatePermissions(ctx.tenantId, id);
    return updated;
  });
}

/**
 * Brings a deactivated user back. Sessions and keys are not restored — they
 * were revoked, and a person who is back signs in again — and role
 * assignments are not either: whoever reactivates decides what they get, or
 * SCIM does from their groups.
 *
 * Team memberships were never removed, so a person who comes back is back in
 * their teams. Returns whether anything changed: reactivating somebody who is
 * already active is not an error, and is not audited twice.
 */
export async function reactivateUser(ctx: TenantContext, id: string, reason?: string): Promise<boolean> {
  authz.require(ctx, 'identity.user.manage');
  return transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundError('user', id);
    if (user.status === 'active') return false;
    await tx.user.update({ where: { id }, data: { status: 'active', updatedBy: ctx.actor.id, version: { increment: 1 } } });
    await recordAudit(tx, ctx, {
      action: 'user.reactivated',
      targetType: 'user',
      targetId: id,
      before: { status: user.status },
      after: { status: 'active' },
      reason: reason ?? null,
    });
    await publish(tx, ctx, { definition: events.userUpdated, aggregateId: id, payload: { userId: id, changed: ['status'] } });
    await invalidatePermissions(ctx.tenantId, id);
    return true;
  });
}

/**
 * The grant itself, on a caller's transaction, for the SCIM reconciler that
 * grants and revokes several in one go. The caller has checked the
 * permission; this writes the row, the audit line and the event exactly as
 * `assignRole` does.
 */
export async function grantRoleOn(
  tx: Tx,
  ctx: TenantContext,
  input: { userId: string; roleKey: string; viaScimTeamId?: string | null },
) {
  const role = await tx.role.findFirst({ where: { key: input.roleKey } });
  if (!role) throw new NotFoundError('role', input.roleKey);
  const existing = await tx.roleAssignment.findFirst({ where: { userId: input.userId, roleId: role.id, scopeType: null, scopeId: null } });
  if (existing) {
    if (input.viaScimTeamId && !existing.viaScimTeamId) {
      // Held by hand already; SCIM does not take it over, so leaving the
      // group later will not remove something an administrator granted.
      return existing;
    }
    return existing;
  }
  const assignment = await tx.roleAssignment.create({
    data: { id: newId(), tenantId: ctx.tenantId, userId: input.userId, roleId: role.id, viaScimTeamId: input.viaScimTeamId ?? null, createdBy: ctx.actor.id },
  });
  await recordAudit(tx, ctx, {
    action: 'role.assignment.granted',
    targetType: 'user',
    targetId: input.userId,
    after: { roleKey: input.roleKey, scopeType: null, scopeId: null, viaScimTeamId: input.viaScimTeamId ?? null },
  });
  await publish(tx, ctx, { definition: events.roleAssignmentChanged, aggregateId: input.userId, payload: { userId: input.userId, roleId: role.id, action: 'granted' } });
  await invalidatePermissions(ctx.tenantId, input.userId);
  return assignment;
}

export async function revokeAssignmentOn(tx: Tx, ctx: TenantContext, assignment: { id: string; userId: string; roleId: string; scopeType: string | null; scopeId: string | null }) {
  await tx.roleAssignment.delete({ where: { id: assignment.id } });
  await recordAudit(tx, ctx, {
    action: 'role.assignment.revoked',
    targetType: 'user',
    targetId: assignment.userId,
    before: { roleId: assignment.roleId, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
  });
  await publish(tx, ctx, { definition: events.roleAssignmentChanged, aggregateId: assignment.userId, payload: { userId: assignment.userId, roleId: assignment.roleId, action: 'revoked' } });
  await invalidatePermissions(ctx.tenantId, assignment.userId);
}

export async function assignRole(
  ctx: TenantContext,
  input: { userId: string; roleKey: string; scopeType?: 'organisation' | 'team' | 'service'; scopeId?: string; validTo?: Date },
) {
  authz.require(ctx, 'identity.role.manage');
  // The agent meter counts people holding a role that works the desk, so
  // the act that grows it is this one — not creating a user, because a
  // requester is not an agent and a tenant must always be able to add one.
  if (input.roleKey !== 'requester') await assertWithinLimit(ctx, 'agents');
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates a team, optionally on a business calendar.
 *
 * The calendar is the team's working week. Analytics measures how long a
 * team takes against it (the ticket projector reads `team.calendarId`), and
 * an SLA policy in `group` mode clocks the team's tickets by it; without one
 * both measure around the clock, so a ticket raised at 17:30 on a Friday
 * reads as two days late on Monday morning. The shared demo's five teams are
 * all on the UK office calendar (A4 §1.2). A calendar that does not exist is
 * refused rather than stored: the readers fall back to 24/7 without a word,
 * so a wrong id would be a silent error in every report.
 */
export async function createTeam(
  ctx: TenantContext,
  input: { key: string; name: string; orgId: string; type?: string; calendarId?: string | null },
) {
  authz.require(ctx, 'identity.org.manage');
  const calendarId = input.calendarId ?? null;
  if (calendarId !== null && !UUID_PATTERN.test(calendarId)) {
    throw new ValidationError('the calendar must be given by its id', [
      { field: 'calendarId', code: 'invalid', message: 'not a calendar id' },
    ]);
  }
  return transaction(ctx, async (tx) => {
    const existing = await tx.team.findFirst({ where: { key: input.key } });
    if (existing) throw new ConflictError(`a team with the key ${input.key} already exists`);
    // Read under the tenant's row-level security, so another tenant's
    // calendar is simply not found.
    if (calendarId !== null && !(await tx.businessCalendar.findFirst({ where: { id: calendarId }, select: { id: true } }))) {
      throw new ValidationError('there is no business calendar with that id', [
        { field: 'calendarId', code: 'not_found', message: calendarId },
      ]);
    }
    const team = await tx.team.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: input.orgId,
        key: input.key,
        name: input.name,
        type: input.type ?? 'support_group',
        createdBy: ctx.actor.id,
        ...(calendarId !== null ? { calendarId } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'team.created',
      targetType: 'team',
      targetId: team.id,
      after: { key: input.key, name: input.name, ...(calendarId !== null ? { calendarId } : {}) },
    });
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

/** The most teams one listing returns. A tenant with more has a directory problem, not a paging one. */
export const MAX_TEAMS = 1000;

/**
 * How far a caller may see the team directory: every team, their own
 * organisations' teams, or none.
 *
 * Deliberately wider than `identity.org.read`, which only administrators
 * hold. An agent routes work between teams all day — the team on a ticket,
 * the team views in their inbox, "move to the network team" — and a
 * directory only administrators could read left the workbench showing team
 * ids. Anyone who works the desk (`ticket.read` beyond their own tickets) or
 * reads the tenant's structure (`tenant.read`) sees every team; a requester,
 * whose `ticket.read` is their own tickets only, sees none, because the portal
 * names "the service desk" and never a team or the people in it.
 */
function teamReach(ctx: TenantContext): 'all' | 'organisations' {
  if (authz.effectiveScope(ctx, 'identity.org.read') === 'any') return 'all';
  if (authz.effectiveScope(ctx, 'tenant.read') === 'any') return 'all';
  const tickets = authz.effectiveScope(ctx, 'ticket.read');
  if (tickets === 'team' || tickets === 'any') return 'all';
  if (authz.effectiveScope(ctx, 'identity.org.read') === 'own') return 'organisations';
  throw new ForbiddenError('identity.org.read', 'reading teams needs identity.org.read, tenant.read or ticket.read beyond your own tickets');
}

/**
 * A membership that counts today. The same test the actor resolver uses, so a
 * team's members here are exactly the people whose queues include it — and
 * only people who are active: a deactivated person keeps their membership
 * (reactivating brings them back into their teams) but cannot take work, so
 * they are neither counted nor listed.
 */
function currentMembership() {
  return {
    OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
    user: { status: 'active', deletedAt: null },
  };
}

export async function listTeams(ctx: TenantContext) {
  const reach = teamReach(ctx);
  return transaction(ctx, async (tx) => {
    const teams = await tx.team.findMany({
      where: { deletedAt: null, ...(reach === 'organisations' ? { orgId: { in: ctx.organisationIds } } : {}) },
      orderBy: [{ name: 'asc' }, { key: 'asc' }],
      take: MAX_TEAMS,
    });
    if (teams.length === 0) return [];

    const counts = await tx.teamMembership.groupBy({
      by: ['teamId'],
      where: { teamId: { in: teams.map((team) => team.id) }, ...currentMembership() },
      _count: { _all: true },
    });
    const countByTeam = new Map(counts.map((row) => [row.teamId, row._count._all]));
    return teams.map((team) => ({ ...team, memberCount: countByTeam.get(team.id) ?? 0 }));
  });
}

/**
 * A team's current members, leads first. Names only: this answers "who is in
 * the network team" for someone assigning work, and a person's address and
 * organisation stay behind `identity.user.read` and its scope.
 */
export async function listTeamMembers(ctx: TenantContext, teamId: string) {
  const reach = teamReach(ctx);
  return transaction(ctx, async (tx) => {
    const team = await tx.team.findFirst({ where: { id: teamId, deletedAt: null } });
    // Not found rather than forbidden for a team outside the caller's
    // organisations: the listing would not have shown it to them either.
    if (!team || (reach === 'organisations' && !ctx.organisationIds.includes(team.orgId))) {
      throw new NotFoundError('team', teamId);
    }
    const memberships = await tx.teamMembership.findMany({
      where: { teamId, ...currentMembership() },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return memberships
      .map((membership) => ({
        userId: membership.user.id,
        displayName: membership.user.displayName,
        isLead: membership.isLead,
        since: membership.validFrom,
      }))
      .sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.displayName.localeCompare(b.displayName));
  });
}

/**
 * The tenant's roles with what each grants, system roles first in the order
 * the seed declares them (least access to most), then the tenant's own by
 * name. Read with `identity.role.read`: the list is how an administrator
 * chooses what to grant, and it says exactly what every role can do.
 */
export async function listRoles(ctx: TenantContext) {
  authz.require(ctx, 'identity.role.read');
  const seedOrder = new Map(SYSTEM_ROLES.map((role, index) => [role.key, index]));
  const rank = (role: { key: string; isSystem: boolean }) => (role.isSystem ? (seedOrder.get(role.key) ?? SYSTEM_ROLES.length) : Number.MAX_SAFE_INTEGER);

  return transaction(ctx, async (tx) => {
    const roles = await tx.role.findMany({ include: { permissions: true } });
    return roles
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions
          .map((permission) => ({ key: permission.permissionKey, scope: permission.scope }))
          .sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope)),
      }));
  });
}

/**
 * One person's role assignments, with the assignment ids that
 * `DELETE /role-assignments/:id` takes — without them a role could be granted
 * from the console but never taken away again.
 *
 * Expired assignments are listed with their `validTo` rather than hidden:
 * one still occupies its slot, and granting the same role again returns it
 * unchanged, which is inexplicable if the list pretends it is not there.
 */
export async function listRoleAssignments(ctx: TenantContext, userId: string) {
  authz.require(ctx, 'identity.role.read');
  return transaction(ctx, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundError('user', userId);
    const assignments = await tx.roleAssignment.findMany({
      where: { userId },
      include: { role: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return assignments.map((assignment) => ({
      id: assignment.id,
      roleKey: assignment.role.key,
      roleName: assignment.role.name,
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
      // Granted by the identity provider's group mapping: removing it by hand
      // lasts only until the next sync, so the console should say so.
      viaScim: assignment.viaScimTeamId !== null,
    }));
  });
}

export async function recordSession(
  ctx: TenantContext,
  input: { userId: string; sid: string; expiresAt: Date; ip?: string; userAgent?: string; device?: string },
) {
  // The same check `revokeSession` makes, and deliberately the same expression.
  // With the `own` scope every role carries, this passes for your own session
  // and refuses somebody else's; only the `any` scope an administrator holds
  // records a session on another person's behalf. `authz.require` would not do:
  // every role has the key, so only the scope distinguishes the two.
  authz.requireVisible(
    ctx,
    'identity.session.manage',
    { aggregate: 'user', record: { id: input.userId, primaryOrgId: null, managerId: null } },
    'session',
  );

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

    // Before the update, deliberately. A rollback then leaves a deny entry for
    // a session that was not revoked after all — somebody signed out who did
    // not need to be, which is the safe direction. The other order commits a
    // revocation that never takes effect, and the token carries on working
    // until it expires.
    await denySession(session.sid, session.expiresAt);

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
