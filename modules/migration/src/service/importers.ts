import { userService } from '@itsm/module-identity';
import { catalogueService } from '@itsm/module-catalogue';
import { tenantService } from '@itsm/module-tenancy';
import { ticketService } from '@itsm/module-ticket';
import { ConflictError, logger, newId, transaction, type TenantContext, type Tx } from '@itsm/platform';
import { looksLikeEmail, slugify, type Entity, type MappedRecord, type Reference } from '../domain/mapping.js';

/**
 * One importer per entity. Each resolves the row's references, decides
 * whether the row is new, and writes through the module that owns the
 * record — never through the table. A user made by an import is a user made
 * by `userService.createUser`, with the same audit row and the same event as
 * one made by hand, so nothing downstream can tell the difference and
 * nothing has to.
 *
 * The link table is the memory. Every row written is remembered by its
 * external key, so the next run finds it and leaves it alone (or updates it,
 * if asked), and a ticket row's `caller_id` finds the user a previous job
 * created.
 */

export type Outcome = 'would_create' | 'would_update' | 'would_skip' | 'created' | 'updated' | 'unchanged' | 'failed';

export interface ImportOptions {
  createMissingUsers: boolean;
  overwrite: boolean;
  jobId: string;
  commit: boolean;
}

export interface Applied {
  outcome: Outcome;
  entityId: string | null;
  problems: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// The link table
// ---------------------------------------------------------------------------

export async function findLink(tx: Tx, entity: Entity, externalKey: string): Promise<string | null> {
  const link = await tx.importLink.findFirst({ where: { entity, externalKey }, select: { entityId: true } });
  return link?.entityId ?? null;
}

export async function remember(tx: Tx, ctx: TenantContext, entity: Entity, externalKey: string, entityId: string, jobId: string): Promise<void> {
  const existing = await tx.importLink.findFirst({ where: { entity, externalKey } });
  if (existing) {
    if (existing.entityId !== entityId) await tx.importLink.update({ where: { id: existing.id }, data: { entityId, jobId } });
    return;
  }
  await tx.importLink.create({ data: { id: newId(), tenantId: ctx.tenantId, entity, externalKey, entityId, jobId } });
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * A reference resolved in order: the link table, then the natural key, then
 * — for a user named by an email nobody has — a new external user, when the
 * mapping allows it. Returns null with a warning when nothing matched.
 */
async function resolveUser(
  ctx: TenantContext,
  tx: Tx,
  reference: Reference | undefined,
  field: string,
  options: ImportOptions,
  warnings: string[],
): Promise<string | null> {
  if (!reference) return null;
  for (const candidate of reference.candidates) {
    const linked = await findLink(tx, 'users', candidate);
    if (linked) return linked;
    if (looksLikeEmail(candidate)) {
      const user = await tx.user.findFirst({ where: { email: candidate.toLowerCase() }, select: { id: true } });
      if (user) return user.id;
    }
  }
  const email = reference.candidates.find(looksLikeEmail);
  if (email && options.createMissingUsers) {
    if (!options.commit) return PLACEHOLDER;
    const created = await userService.createUser(ctx, { email, displayName: email.split('@')[0] ?? email, isExternal: true }, 'import');
    await remember(tx, ctx, 'users', email, created.id, options.jobId);
    warnings.push(`${field} ${email} was not known, so an external user was created for them`);
    return created.id;
  }
  warnings.push(`${field} ${reference.candidates.join(' / ')} matched nobody, so it was left empty`);
  return null;
}

/** What a dry run reports for a user it would create: not an id, but not nothing. */
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

async function resolveByKey(
  tx: Tx,
  entity: 'teams' | 'services',
  reference: Reference | undefined,
  field: string,
  warnings: string[],
): Promise<string | null> {
  if (!reference) return null;
  for (const candidate of reference.candidates) {
    const linked = await findLink(tx, entity, candidate);
    if (linked) return linked;
    const row =
      entity === 'teams'
        ? await tx.team.findFirst({ where: { key: candidate }, select: { id: true } })
        : await tx.service.findFirst({ where: { key: candidate }, select: { id: true } });
    if (row) return row.id;
  }
  warnings.push(`${field} ${reference.candidates.join(' / ')} matched no ${entity === 'teams' ? 'team' : 'service'}, so it was left empty`);
  return null;
}

function text(values: MappedRecord['values'], field: string): string | undefined {
  const value = values[field];
  return typeof value === 'string' ? value : undefined;
}

function date(values: MappedRecord['values'], field: string): Date | undefined {
  const value = values[field];
  return value instanceof Date ? value : undefined;
}

function reference(values: MappedRecord['values'], field: string): Reference | undefined {
  const value = values[field];
  return value && typeof value === 'object' && 'candidates' in value ? (value as Reference) : undefined;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function importUser(ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  const warnings = [...row.warnings];
  const email = text(row.values, 'email')!.toLowerCase();
  const displayName = text(row.values, 'displayName')!;
  const teams = (row.values.teams as string[] | undefined) ?? [];

  const linked = await findLink(tx, 'users', row.externalKey);
  const byEmail = linked ? null : await tx.user.findFirst({ where: { email }, select: { id: true } });
  const existingId = linked ?? byEmail?.id ?? null;

  if (!options.commit) {
    return { outcome: existingId ? (options.overwrite ? 'would_update' : 'would_skip') : 'would_create', entityId: existingId, problems: [], warnings };
  }

  let userId = existingId;
  let outcome: Outcome = 'unchanged';
  if (!userId) {
    const created = await userService.createUser(
      ctx,
      {
        email,
        displayName,
        ...(text(row.values, 'locale') ? { locale: text(row.values, 'locale') } : {}),
        ...(text(row.values, 'timeZone') ? { timeZone: text(row.values, 'timeZone') } : {}),
        isExternal: row.values.isExternal === true,
      },
      'import',
    );
    userId = created.id;
    outcome = 'created';
  } else if (options.overwrite) {
    await tx.user.update({ where: { id: userId }, data: { displayName, updatedBy: ctx.actor.id } });
    outcome = 'updated';
  }
  await remember(tx, ctx, 'users', row.externalKey, userId, options.jobId);

  for (const teamKey of teams) {
    const teamId = await resolveByKey(tx, 'teams', { candidates: [teamKey] }, 'teams', warnings);
    if (teamId) await userService.addTeamMember(ctx, teamId, userId);
  }
  return { outcome, entityId: userId, problems: [], warnings };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

async function orgIdFor(ctx: TenantContext, tx: Tx, code: string | undefined, warnings: string[]): Promise<string | null> {
  if (code) {
    const org = await tx.organisation.findFirst({ where: { code }, select: { id: true } });
    if (org) return org.id;
    warnings.push(`orgCode ${code} matched no organisation, so the tenant's first was used`);
  }
  const organisations = await tenantService.listOrganisations(ctx);
  return organisations[0]?.id ?? null;
}

async function importTeam(ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  const warnings = [...row.warnings];
  const name = text(row.values, 'name')!;
  const key = text(row.values, 'key') ?? slugify(name);

  const linked = await findLink(tx, 'teams', row.externalKey);
  const byKey = linked ? null : await tx.team.findFirst({ where: { key }, select: { id: true } });
  const existingId = linked ?? byKey?.id ?? null;

  if (!options.commit) {
    return { outcome: existingId ? (options.overwrite ? 'would_update' : 'would_skip') : 'would_create', entityId: existingId, problems: [], warnings };
  }

  let teamId = existingId;
  let outcome: Outcome = 'unchanged';
  if (!teamId) {
    const orgId = await orgIdFor(ctx, tx, text(row.values, 'orgCode'), warnings);
    if (!orgId) return { outcome: 'failed', entityId: null, problems: ['the tenant has no organisation to put the team in'], warnings };
    const created = await userService.createTeam(ctx, { key, name, orgId });
    teamId = created.id;
    outcome = 'created';
  } else if (options.overwrite) {
    await tx.team.update({ where: { id: teamId }, data: { name } });
    outcome = 'updated';
  }
  await remember(tx, ctx, 'teams', row.externalKey, teamId, options.jobId);
  return { outcome, entityId: teamId, problems: [], warnings };
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

async function importService(ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  const warnings = [...row.warnings];
  const name = text(row.values, 'name')!;
  const key = text(row.values, 'key') ?? slugify(name);

  const linked = await findLink(tx, 'services', row.externalKey);
  const byKey = linked ? null : await tx.service.findFirst({ where: { key }, select: { id: true } });
  const existingId = linked ?? byKey?.id ?? null;

  if (!options.commit) {
    return { outcome: existingId ? (options.overwrite ? 'would_update' : 'would_skip') : 'would_create', entityId: existingId, problems: [], warnings };
  }

  const ownerId = await resolveUser(ctx, tx, reference(row.values, 'owner'), 'owner', { ...options, createMissingUsers: false }, warnings);
  let serviceId = existingId;
  let outcome: Outcome = 'unchanged';
  if (!serviceId) {
    const created = await catalogueService.createService(ctx, {
      key,
      name,
      ...(text(row.values, 'description') ? { description: text(row.values, 'description')!.slice(0, 1000) } : {}),
      ...(ownerId ? { ownerId } : {}),
    });
    serviceId = created.id;
    outcome = 'created';
  } else if (options.overwrite) {
    await tx.service.update({
      where: { id: serviceId },
      data: { name, ...(text(row.values, 'description') !== undefined ? { description: text(row.values, 'description')!.slice(0, 1000) } : {}), ...(ownerId ? { ownerId } : {}) },
    });
    outcome = 'updated';
  }
  await remember(tx, ctx, 'services', row.externalKey, serviceId, options.jobId);
  return { outcome, entityId: serviceId, problems: [], warnings };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function commentInputs(row: MappedRecord, authorIds: (string | null)[]) {
  return row.comments.map((comment, index) => ({
    body: text(comment.values, 'body')!,
    bodyFormat: (text(comment.values, 'bodyFormat') as 'text' | 'html' | undefined) ?? 'text',
    visibility: (text(comment.values, 'visibility') as 'public' | 'internal' | undefined) ?? 'public',
    authorId: authorIds[index] ?? null,
    ...(date(comment.values, 'createdAt') ? { createdAt: date(comment.values, 'createdAt') } : {}),
    ...(comment.externalKey ? { externalRef: comment.externalKey } : {}),
  }));
}

async function importTicket(ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  const warnings = [...row.warnings];
  const problems: string[] = [];

  const linked = await findLink(tx, 'tickets', row.externalKey);
  if (linked && !options.overwrite) {
    return { outcome: options.commit ? 'unchanged' : 'would_skip', entityId: linked, problems: [], warnings };
  }

  // Comments with their own problems are dropped from the ticket, not the
  // ticket from the import: a conversation with a hole is worth more than no
  // ticket, and the hole is reported.
  const usable = row.comments.filter((comment, index) => {
    if (comment.problems.length === 0) return true;
    warnings.push(`comment ${comment.externalKey ?? index + 1} was not imported: ${comment.problems.join('; ')}`);
    return false;
  });
  const rowForComments: MappedRecord = { ...row, comments: usable };

  if (!options.commit) {
    // References are resolved on a dry run too, so a mapping that names the
    // wrong field for the requester is a warning on every row of the preview
    // rather than a surprise on the commit.
    await resolveUser(ctx, tx, reference(row.values, 'requester'), 'requester', options, warnings);
    await resolveUser(ctx, tx, reference(row.values, 'assignee'), 'assignee', options, warnings);
    await resolveByKey(tx, 'teams', reference(row.values, 'team'), 'team', warnings);
    await resolveByKey(tx, 'services', reference(row.values, 'service'), 'service', warnings);
    return { outcome: linked ? 'would_update' : 'would_create', entityId: linked, problems, warnings };
  }

  const requesterId = await resolveUser(ctx, tx, reference(row.values, 'requester'), 'requester', options, warnings);
  const assigneeId = await resolveUser(ctx, tx, reference(row.values, 'assignee'), 'assignee', options, warnings);
  const groupId = await resolveByKey(tx, 'teams', reference(row.values, 'team'), 'team', warnings);
  const serviceId = await resolveByKey(tx, 'services', reference(row.values, 'service'), 'service', warnings);
  const authorIds: (string | null)[] = [];
  for (const comment of usable) {
    authorIds.push(await resolveUser(ctx, tx, reference(comment.values, 'author'), 'author', { ...options, createMissingUsers: false }, warnings));
  }

  const status = text(row.values, 'status')!;
  const resolvedAt = date(row.values, 'resolvedAt') ?? null;
  const closedAt = date(row.values, 'closedAt') ?? null;
  const createdAt = date(row.values, 'createdAt')!;
  if ((resolvedAt && resolvedAt < createdAt) || (closedAt && closedAt < createdAt)) {
    return { outcome: 'failed', entityId: null, problems: ['resolved or closed before it was raised; check the date fields'], warnings };
  }

  if (linked) {
    await tx.ticket.update({
      where: { id: linked },
      data: {
        title: text(row.values, 'title')!,
        description: text(row.values, 'description') ?? null,
        priority: text(row.values, 'priority') ?? 'P3',
        requesterId,
        assigneeId,
        groupId,
        serviceId,
        updatedBy: ctx.actor.id,
      },
    });
    if (usable.length > 0) await ticketService.importComments(ctx, linked, commentInputs(rowForComments, authorIds), options.jobId);
    return { outcome: 'updated', entityId: linked, problems, warnings };
  }

  try {
    const ticket = await ticketService.importTicket(ctx, {
      type: (text(row.values, 'type') as never) ?? 'incident',
      title: text(row.values, 'title')!,
      ...(text(row.values, 'description') ? { description: text(row.values, 'description') } : {}),
      status,
      priority: (text(row.values, 'priority') as never) ?? 'P3',
      requesterId,
      assigneeId,
      groupId,
      serviceId,
      externalRef: text(row.values, 'reference') ?? row.externalKey,
      createdAt,
      resolvedAt,
      closedAt,
      comments: commentInputs(rowForComments, authorIds),
      importJobId: options.jobId,
    });
    await remember(tx, ctx, 'tickets', row.externalKey, ticket.id, options.jobId);
    return { outcome: 'created', entityId: ticket.id, problems, warnings };
  } catch (error) {
    if (error instanceof ConflictError) {
      // Imported before this module remembered it (or by another route with
      // the same reference): remember it now, so the next run is quiet.
      const existing = await tx.ticket.findFirst({ where: { externalRef: text(row.values, 'reference') ?? row.externalKey, deletedAt: null }, select: { id: true } });
      if (existing) {
        await remember(tx, ctx, 'tickets', row.externalKey, existing.id, options.jobId);
        return { outcome: 'unchanged', entityId: existing.id, problems: [], warnings: [...warnings, error.message] };
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Comments, from a separate export
// ---------------------------------------------------------------------------

async function importComment(ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  const warnings = [...row.warnings];
  const ticketReference = reference(row.values, 'ticket');
  let ticketId: string | null = null;
  for (const candidate of ticketReference?.candidates ?? []) {
    ticketId = await findLink(tx, 'tickets', candidate);
    if (ticketId) break;
    const byRef = await tx.ticket.findFirst({ where: { externalRef: candidate, deletedAt: null }, select: { id: true } });
    if (byRef) {
      ticketId = byRef.id;
      break;
    }
  }
  if (!ticketId) {
    return { outcome: 'failed', entityId: null, problems: [`ticket ${ticketReference?.candidates.join(' / ') ?? '?'} was not imported, so there is nothing to put this on`], warnings };
  }

  const already = await findLink(tx, 'comments', row.externalKey);
  if (already) return { outcome: options.commit ? 'unchanged' : 'would_skip', entityId: already, problems: [], warnings };
  if (!options.commit) {
    await resolveUser(ctx, tx, reference(row.values, 'author'), 'author', { ...options, createMissingUsers: false }, warnings);
    return { outcome: 'would_create', entityId: null, problems: [], warnings };
  }

  const authorId = await resolveUser(ctx, tx, reference(row.values, 'author'), 'author', { ...options, createMissingUsers: false }, warnings);
  const result = await ticketService.importComments(
    ctx,
    ticketId,
    [
      {
        body: text(row.values, 'body')!,
        bodyFormat: (text(row.values, 'bodyFormat') as 'text' | 'html' | undefined) ?? 'text',
        visibility: (text(row.values, 'visibility') as 'public' | 'internal' | undefined) ?? 'public',
        authorId,
        ...(date(row.values, 'createdAt') ? { createdAt: date(row.values, 'createdAt') } : {}),
        externalRef: row.externalKey,
      },
    ],
    options.jobId,
  );
  const comment = await tx.ticketComment.findFirst({ where: { ticketId, externalRef: row.externalKey }, select: { id: true } });
  if (comment) await remember(tx, ctx, 'comments', row.externalKey, comment.id, options.jobId);
  return { outcome: result.added > 0 ? 'created' : 'unchanged', entityId: comment?.id ?? null, problems: [], warnings };
}

// ---------------------------------------------------------------------------

const IMPORTERS: Record<Entity, (ctx: TenantContext, tx: Tx, row: MappedRecord, options: ImportOptions) => Promise<Applied>> = {
  users: importUser,
  teams: importTeam,
  services: importService,
  tickets: importTicket,
  comments: importComment,
};

/**
 * Applies one mapped row. Runs the lookups on a transaction of its own and
 * the writes through the owning services, which open theirs — so a row that
 * fails half-way leaves that module's record whole and this module's link
 * unwritten, and the next run tries it again.
 */
export async function applyRow(ctx: TenantContext, entity: Entity, row: MappedRecord, options: ImportOptions): Promise<Applied> {
  if (row.problems.length > 0) return { outcome: 'failed', entityId: null, problems: row.problems, warnings: row.warnings };
  try {
    return await transaction(ctx, (tx) => IMPORTERS[entity](ctx, tx, row, options));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('an import row failed', { entity, externalKey: row.externalKey, error: message });
    return { outcome: 'failed', entityId: null, problems: [message], warnings: row.warnings };
  }
}
