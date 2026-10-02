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
  /** `native` or `import`: how the row arrived, not how the work did (ADR-0056). */
  origin: string;
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
  /**
   * Date windows (R2). Every window is half-open: `…After` is inclusive and
   * `…Before` exclusive, so consecutive windows ("yesterday", "today") share a
   * boundary without counting the ticket on it twice.
   */
  createdAfter?: Date;
  createdBefore?: Date;
  dueAfter?: Date;
  dueBefore?: Date;
  resolvedAfter?: Date;
  resolvedBefore?: Date;
  /** Open work that is past due, or due within the next hour (R2). */
  sla?: SlaFilter;
  /**
   * The instant `sla` is judged against. The service sets it once per call,
   * so the predicates of one request (a list and its count, or five grouped
   * buckets) all agree on what "now" was.
   */
  now?: Date;
}

/** The `filter[sla]` vocabulary (R6): `breached` and `due_soon`, nothing else. */
export type SlaFilter = 'breached' | 'due_soon';

/** "Due soon" is due within this of now: the amber window the desk works from. */
export const DUE_SOON_MS = 60 * 60 * 1000;

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

/**
 * The list grammar as a Prisma predicate.
 *
 * Every condition is its own entry in one `AND`, never a key of one object:
 * two conditions on the same column (an explicit `statusCategory` and the
 * `open` that `sla` implies, or a due window and `sla`'s due range) then
 * intersect, where assigning both to `where.statusCategory` would let the
 * second silently replace the first.
 */
export function buildWhere(filter: ListFilter, scope?: Prisma.TicketWhereInput): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [{ deletedAt: null }];
  if (filter.statusCategory?.length) and.push({ statusCategory: { in: filter.statusCategory } });
  if (filter.status?.length) and.push({ status: { in: filter.status } });
  if (filter.type?.length) and.push({ type: { in: filter.type } });
  if (filter.priority?.length) and.push({ priority: { in: filter.priority } });
  if (filter.assigneeId !== undefined) and.push({ assigneeId: filter.assigneeId });
  if (filter.groupId) and.push({ groupId: filter.groupId });
  if (filter.requesterId) and.push({ requesterId: filter.requesterId });
  if (filter.serviceId) and.push({ serviceId: filter.serviceId });
  if (filter.categoryId) and.push({ categoryId: filter.categoryId });

  const created = halfOpen(filter.createdAfter, filter.createdBefore);
  if (created) and.push({ createdAt: created });
  // A due window is about tickets that have a due time: `IS NOT NULL` is
  // implied by any comparison in SQL, and stated so the intent survives a
  // later change to the comparison.
  const due = halfOpen(filter.dueAfter, filter.dueBefore);
  if (due) and.push({ dueAt: { not: null, ...due } });
  const resolved = halfOpen(filter.resolvedAfter, filter.resolvedBefore);
  if (resolved) and.push({ resolvedAt: resolved });
  if (filter.sla) and.push(slaWhere(filter.sla, filter.now ?? new Date()));

  if (filter.search) {
    and.push({
      OR: [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { number: { contains: filter.search, mode: 'insensitive' } },
      ],
    });
  }
  if (scope) and.push(scope);
  return { AND: and };
}

/** A half-open `[after, before)` window, or nothing when neither bound is set. */
function halfOpen(after?: Date, before?: Date): { gte?: Date; lt?: Date } | undefined {
  if (!after && !before) return undefined;
  return { ...(after ? { gte: after } : {}), ...(before ? { lt: before } : {}) };
}

/**
 * `breached` is open work whose due time has come (`due_at <= now`); `due_soon`
 * is open work due after now and within the hour. Paused work is neither: its
 * clock is stopped, and R2a clears its `due_at` while it waits.
 */
function slaWhere(sla: SlaFilter, now: Date): Prisma.TicketWhereInput {
  return sla === 'breached'
    ? { statusCategory: 'open', dueAt: { not: null, lte: now } }
    : { statusCategory: 'open', dueAt: { gt: now, lte: new Date(now.getTime() + DUE_SOON_MS) } };
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

/**
 * Counts matching tickets. With `limit`, stops after that many rows — Prisma
 * turns `take` into a `LIMIT` inside the count's subquery — so a capped count
 * stops reading after `limit` matching rows however many tickets match.
 */
export async function countTickets(tx: Tx, filter: ListFilter, scope?: Prisma.TicketWhereInput, limit?: number): Promise<number> {
  return tx.ticket.count({ where: buildWhere(filter, scope), ...(limit !== undefined ? { take: limit } : {}) });
}

/** The columns a grouped count (R2g) can split by: the stored values themselves. */
export type GroupColumn = 'priority' | 'status' | 'statusCategory' | 'type' | 'groupId' | 'assigneeId' | 'serviceId';

/**
 * Matching tickets per stored value of one column, `null` for none
 * (unassigned, no service). Exact: callers bound the set before asking
 * (`countTicketsBy`'s guard), so there is no cap to apply.
 */
export async function countByColumn(
  tx: Tx,
  filter: ListFilter,
  column: GroupColumn,
  scope?: Prisma.TicketWhereInput,
): Promise<{ key: string | null; count: number }[]> {
  // Prisma types `groupBy` per literal column list; the column is a runtime
  // choice here, so the call is typed by hand at the one place it is made.
  const groupBy = tx.ticket.groupBy as unknown as (args: {
    by: GroupColumn[];
    where: Prisma.TicketWhereInput;
    _count: { _all: true };
  }) => Promise<(Record<GroupColumn, string | null> & { _count: { _all: number } })[]>;
  const rows = await groupBy({ by: [column], where: buildWhere(filter, scope), _count: { _all: true } });
  return rows.map((row) => ({ key: row[column] ?? null, count: row._count._all }));
}

/**
 * Matching tickets per bucket, where each bucket is a further predicate on the
 * filtered set. One `count` per bucket, all inside the caller's transaction,
 * so the buckets are read from one snapshot of the queue.
 */
export async function countByBuckets<K extends string>(
  tx: Tx,
  filter: ListFilter,
  buckets: readonly { key: K; where: Prisma.TicketWhereInput }[],
  scope?: Prisma.TicketWhereInput,
): Promise<{ key: K; count: number }[]> {
  const base = buildWhere(filter, scope);
  const counted: { key: K; count: number }[] = [];
  for (const bucket of buckets) {
    counted.push({ key: bucket.key, count: await tx.ticket.count({ where: { AND: [base, bucket.where] } }) });
  }
  return counted;
}

/** The age buckets of R2g, youngest first. */
export const AGE_BUCKETS = ['under_1d', '1d_3d', '3d_7d', '7d_30d', 'over_30d'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** The SLA buckets of R2g, most urgent first. */
export const SLA_BUCKETS = ['breached', 'due_soon', 'due_later', 'no_target', 'paused'] as const;
export type SlaBucket = (typeof SLA_BUCKETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Age by `created_at` against `now`, each bucket `[lower, upper)` in age: a
 * ticket exactly one day old is `1d_3d`, not `under_1d`. Together the buckets
 * cover every ticket exactly once, so they sum to the filtered total.
 */
export function ageBuckets(now: Date): { key: AgeBucket; where: Prisma.TicketWhereInput }[] {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return [
    { key: 'under_1d', where: { createdAt: { gt: ago(1) } } },
    { key: '1d_3d', where: { createdAt: { gt: ago(3), lte: ago(1) } } },
    { key: '3d_7d', where: { createdAt: { gt: ago(7), lte: ago(3) } } },
    { key: '7d_30d', where: { createdAt: { gt: ago(30), lte: ago(7) } } },
    { key: 'over_30d', where: { createdAt: { lte: ago(30) } } },
  ];
}

/**
 * Where each piece of open and paused work stands against its due time. The
 * first two are exactly `filter[sla]=breached` and `due_soon`, so a chip and
 * the breakdown beside it cannot disagree; the five cover `open` and `paused`
 * exactly once.
 */
export function slaBuckets(now: Date): { key: SlaBucket; where: Prisma.TicketWhereInput }[] {
  return [
    { key: 'breached', where: slaWhere('breached', now) },
    { key: 'due_soon', where: slaWhere('due_soon', now) },
    { key: 'due_later', where: { statusCategory: 'open', dueAt: { gt: new Date(now.getTime() + DUE_SOON_MS) } } },
    { key: 'no_target', where: { statusCategory: 'open', dueAt: null } },
    { key: 'paused', where: { statusCategory: 'paused' } },
  ];
}

/** Several tickets by id, skipping deleted ones; order is not preserved. */
export async function findManyById(tx: Tx, ids: string[]): Promise<TicketRow[]> {
  if (ids.length === 0) return [];
  return tx.ticket.findMany({ where: { id: { in: ids }, deletedAt: null } }) as Promise<TicketRow[]>;
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
  return tx.ticketWatcher.findMany({ where: { ticketId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/**
 * The links this ticket is the source of. Every link is stored from both ends
 * with the inverse type (`linkTickets`), so these are all of its relationships,
 * each once; reading the target side as well would list every one twice.
 */
export async function listLinks(tx: Tx, ticketId: string) {
  return tx.ticketLink.findMany({ where: { sourceId: ticketId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}
