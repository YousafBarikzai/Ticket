import type { Prisma, Tx, TenantContext } from '@itsm/platform';
import { newId } from '@itsm/platform';

/**
 * The only place ticket tables are touched. Services own transactions and
 * business rules; this layer owns queries (module contract, docs/architecture/04 §3).
 */

export interface TicketRow {
  id: string;
  tenantId: string;
  orgId: string | null;
  number: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  statusCategory: string;
  priority: string;
  impact: string | null;
  urgency: string | null;
  requesterId: string | null;
  affectedUserId: string | null;
  assigneeId: string | null;
  groupId: string | null;
  serviceId: string | null;
  categoryId: string | null;
  sourceChannel: string;
  parentId: string | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenCount: number;
  custom: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListFilter {
  statusCategory?: string[];
  status?: string[];
  type?: string[];
  priority?: string[];
  assigneeId?: string | null;
  groupId?: string;
  requesterId?: string;
  serviceId?: string;
  categoryId?: string;
  search?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface ListOptions {
  limit: number;
  cursor?: { createdAt: Date; id: string };
  sort: 'createdAt' | '-createdAt' | 'dueAt' | '-dueAt';
  /** Additional predicate from the permission layer's scope filter. */
  scope?: Prisma.TicketWhereInput;
}

export async function insertTicket(tx: Tx, data: Prisma.TicketUncheckedCreateInput): Promise<TicketRow> {
  return tx.ticket.create({ data }) as Promise<TicketRow>;
}

export async function findById(tx: Tx, id: string): Promise<TicketRow | null> {
  return tx.ticket.findFirst({ where: { id, deletedAt: null } }) as Promise<TicketRow | null>;
}

export async function findByNumber(tx: Tx, number: string): Promise<TicketRow | null> {
  return tx.ticket.findFirst({ where: { number, deletedAt: null } }) as Promise<TicketRow | null>;
}

/** Resolves either form of identifier, so `/tickets/INC-000123` works. */
export async function findByIdOrNumber(tx: Tx, idOrNumber: string): Promise<TicketRow | null> {
  return idOrNumber.includes('-') && !/^[0-9a-f]{8}-/i.test(idOrNumber)
    ? findByNumber(tx, idOrNumber)
    : findById(tx, idOrNumber);
}

export function buildWhere(filter: ListFilter, scope?: Prisma.TicketWhereInput): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = { deletedAt: null };
  if (filter.statusCategory?.length) where.statusCategory = { in: filter.statusCategory };
  if (filter.status?.length) where.status = { in: filter.status };
  if (filter.type?.length) where.type = { in: filter.type };
  if (filter.priority?.length) where.priority = { in: filter.priority };
  if (filter.assigneeId !== undefined) where.assigneeId = filter.assigneeId;
  if (filter.groupId) where.groupId = filter.groupId;
  if (filter.requesterId) where.requesterId = filter.requesterId;
  if (filter.serviceId) where.serviceId = filter.serviceId;
  if (filter.categoryId) where.categoryId = filter.categoryId;
  if (filter.createdAfter || filter.createdBefore) {
    where.createdAt = {
      ...(filter.createdAfter ? { gte: filter.createdAfter } : {}),
      ...(filter.createdBefore ? { lte: filter.createdBefore } : {}),
    };
  }
  if (filter.search) {
    where.OR = [
      { title: { contains: filter.search, mode: 'insensitive' } },
      { number: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  return scope ? { AND: [where, scope] } : where;
}

export async function listTickets(tx: Tx, filter: ListFilter, options: ListOptions): Promise<TicketRow[]> {
  const descending = options.sort.startsWith('-');
  const field = options.sort.replace('-', '') as 'createdAt' | 'dueAt';
  const where = buildWhere(filter, options.scope);

  // Keyset pagination on (sort field, id): stable under concurrent inserts in a
  // way offset pagination is not, which is why the API offers no offset option.
  const cursorClause = options.cursor
    ? descending
      ? { OR: [{ [field]: { lt: options.cursor.createdAt } }, { [field]: options.cursor.createdAt, id: { lt: options.cursor.id } }] }
      : { OR: [{ [field]: { gt: options.cursor.createdAt } }, { [field]: options.cursor.createdAt, id: { gt: options.cursor.id } }] }
    : undefined;

  return tx.ticket.findMany({
    where: cursorClause ? { AND: [where, cursorClause as Prisma.TicketWhereInput] } : where,
    orderBy: [{ [field]: descending ? 'desc' : 'asc' }, { id: descending ? 'desc' : 'asc' }],
    take: options.limit,
  }) as Promise<TicketRow[]>;
}

export async function countTickets(tx: Tx, filter: ListFilter, scope?: Prisma.TicketWhereInput): Promise<number> {
  return tx.ticket.count({ where: buildWhere(filter, scope) });
}

/**
 * Optimistic update: the WHERE clause carries the version the caller read, so a
 * concurrent change makes this affect zero rows and the service raises 409
 * rather than silently overwriting the other person's work.
 */
export async function updateWithVersion(
  tx: Tx,
  id: string,
  expectedVersion: number,
  data: Prisma.TicketUncheckedUpdateInput,
): Promise<number> {
  const result = await tx.ticket.updateMany({
    where: { id, version: expectedVersion, deletedAt: null },
    data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
  });
  return result.count;
}

export async function insertTicketEvent(
  tx: Tx,
  ctx: TenantContext,
  ticketId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.ticketEvent.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      ticketId,
      type,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      payload: payload as never,
    },
  });
}

export async function insertComment(tx: Tx, data: Prisma.TicketCommentUncheckedCreateInput) {
  return tx.ticketComment.create({ data });
}

export async function listComments(tx: Tx, ticketId: string, includeInternal: boolean) {
  return tx.ticketComment.findMany({
    where: { ticketId, deletedAt: null, ...(includeInternal ? {} : { visibility: 'public' }) },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listEvents(tx: Tx, ticketId: string) {
  return tx.ticketEvent.findMany({ where: { ticketId }, orderBy: { occurredAt: 'asc' } });
}

export async function listTasks(tx: Tx, ticketId: string) {
  return tx.ticketTask.findMany({ where: { ticketId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
}

export async function listAttachments(tx: Tx, ticketId: string, onlyClean: boolean) {
  return tx.attachment.findMany({
    where: { ticketId, deletedAt: null, ...(onlyClean ? { scanStatus: 'clean' } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listWatchers(tx: Tx, ticketId: string) {
  return tx.ticketWatcher.findMany({ where: { ticketId } });
}

export async function listLinks(tx: Tx, ticketId: string) {
  return tx.ticketLink.findMany({ where: { OR: [{ sourceId: ticketId }, { targetId: ticketId }] } });
}
