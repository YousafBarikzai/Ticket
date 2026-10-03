import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionRequiredError,
  ValidationError,
  assertWithinLimit,
  authz,
  jsonEquals,
  newId,
  nextNumber,
  publish,
  recordAudit,
  registerScopeResolver,
  transaction,
  presignUpload,
  MAX_ATTACHMENT_BYTES,
  publishNotice,
  topicForEntity,
  topicForGroup,
  topicForUser,
  getSetting,
  enqueue,
} from '@itsm/platform';
import {
  canonicalStateSchema,
  channelSchema,
  events,
  numberPrefix,
  prioritySchema,
  statusCategorySchema,
  ticketTypeSchema,
  type CanonicalState,
  type TicketType,
  inverseLinkType,
  type LinkType,
} from '@itsm/contracts';
import {
  assertTransition,
  canTransition,
  categoryOf,
  effectsOf,
  isRequesterTransition,
  requiresAdministratorOverride,
  STATES,
} from '../domain/state-machine.js';
import { fieldsInTx, validateCustom } from './field-service.js';
import * as repo from '../repo/ticket-repo.js';

/**
 * MOD-04 ticket service.
 *
 * Every mutating method follows the same shape, which is the module contract in
 * one place: open a transaction, check permission against the loaded record,
 * write the row, write the audit event and write the outbox event — all or
 * nothing (docs/architecture/04 §3).
 */

// ---------------------------------------------------------------------------
// Scope resolution: how "own" and "team" apply to a ticket. Registered here
// because only this module knows which of its columns mean those things.
// ---------------------------------------------------------------------------
registerScopeResolver<repo.TicketRow>({
  aggregate: 'ticket',
  isOwn: (ctx, ticket) =>
    Boolean(ctx.actor.id) &&
    (ticket.requesterId === ctx.actor.id || ticket.affectedUserId === ctx.actor.id || ticket.assigneeId === ctx.actor.id),
  isTeam: (ctx, ticket) => {
    if (ticket.groupId) return ctx.teamIds.includes(ticket.groupId);
    // A ticket that no rule has routed yet belongs to its organisation's triage
    // pool: without this, a newly raised ticket would be invisible to every
    // agent and could never be picked up.
    return Boolean(ticket.orgId && ctx.organisationIds.includes(ticket.orgId));
  },
  orgId: (ticket) => ticket.orgId,
});

/**
 * The channels a ticket can be raised on: every channel except `import`.
 *
 * `import` used to be accepted here too, and the ticket meter leaves that
 * channel out, so any caller of `POST /tickets` could raise live work the
 * meter never counted. How a row arrived is now `ticket.origin`, which only
 * the import path writes; a creation that claims the channel is refused with
 * 422 and told where imports go (ADR-0056).
 */
export const creatableChannelSchema = channelSchema.exclude(['import'], {
  errorMap: (issue, context) =>
    issue.code === 'invalid_enum_value' && issue.received === 'import'
      ? { message: 'import is not a channel a new ticket can claim; tickets brought in from another tool go through the import API' }
      : { message: context.defaultError },
});

export const createTicketSchema = z.object({
  type: z.enum(['incident', 'request', 'problem', 'change', 'task', 'question']).default('incident'),
  title: z.string().min(1).max(500),
  description: z.string().max(100_000).optional(),
  descriptionFormat: z.enum(['text', 'html']).default('text'),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  impact: z.enum(['high', 'medium', 'low']).optional(),
  urgency: z.enum(['high', 'medium', 'low']).optional(),
  requesterId: z.string().uuid().optional(),
  affectedUserId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  sourceChannel: creatableChannelSchema.default('api'),
  channelRef: z.string().max(500).optional(),
  externalRef: z.string().max(200).optional(),
  custom: z.record(z.unknown()).default({}),
});
/** The caller supplies what they know; the schema fills in the defaults. */
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(100_000).nullable(),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']),
    impact: z.enum(['high', 'medium', 'low']).nullable(),
    urgency: z.enum(['high', 'medium', 'low']).nullable(),
    serviceId: z.string().uuid().nullable(),
    categoryId: z.string().uuid().nullable(),
    affectedUserId: z.string().uuid().nullable(),
    custom: z.record(z.unknown()),
  })
  .partial();
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

const MUTABLE_FIELDS = ['title', 'description', 'priority', 'impact', 'urgency', 'serviceId', 'categoryId', 'affectedUserId', 'custom'] as const;

/** Derives priority from the impact/urgency matrix, per specification §11.3. */
export async function derivePriority(tx: Tx, ctx: TenantContext, impact?: string | null, urgency?: string | null): Promise<string | undefined> {
  if (!impact || !urgency) return undefined;
  const row = await tx.priorityMatrix.findFirst({
    where: { impact, urgency, OR: [{ orgId: { in: ctx.organisationIds } }, { orgId: null }] },
    orderBy: { orgId: 'desc' },
  });
  return row?.priority;
}

export async function createTicket(ctx: TenantContext, input: CreateTicketInput): Promise<repo.TicketRow> {
  const parsed = createTicketSchema.parse(input);
  authz.require(ctx, 'ticket.create');
  // A tenant over its plan's ticket limit cannot raise another one. Reading,
  // resolving and closing what is already here are never refused: a limit
  // that stopped a desk finishing its work would be a limit nobody could
  // sell. One cache read, never a count (ADR-0038).
  await assertWithinLimit(ctx, 'tickets');

  // A requester with only "own" scope may raise a ticket for themselves.
  const requesterId = parsed.requesterId ?? ctx.actor.id;
  if (parsed.requesterId && parsed.requesterId !== ctx.actor.id && !ctx.permissions.has('ticket.create', 'any')) {
    throw new ForbiddenError('ticket.create', 'raising a ticket on behalf of someone else needs tenant-wide permission');
  }

  return transaction(ctx, (tx) => insertTicketOn(ctx, tx, parsed, requesterId ?? null));
}

/**
 * The insert itself, on a caller's transaction.
 *
 * Split out so a channel adapter can raise a ticket inside the transaction that
 * recorded the message it came from: the inbound row, the ticket, its audit
 * entry and its outbox event commit together, or the provider retries and
 * nothing was half-done.
 */
async function insertTicketOn(
  ctx: TenantContext,
  tx: Tx,
  parsed: z.infer<typeof createTicketSchema>,
  requesterId: string | null,
  /**
   * Keys in `custom` that another validator has already accepted.
   *
   * There is exactly one: a catalogue submission, whose answers were checked
   * against the request type's form schema (MOD-02) — a stricter check than
   * the field definitions would apply, because a form knows which of its own
   * questions were required and what each one accepts. Refusing them here
   * would mean every request type's questions had to be duplicated as field
   * definitions before the portal worked at all.
   *
   * Named keys rather than a boolean bypass, so the exemption is visible, is
   * exactly as wide as the form that earned it, and cannot be reached by a
   * caller that simply sets a flag.
   */
  preValidatedKeys: readonly string[] = [],
): Promise<repo.TicketRow> {
  const type = parsed.type as TicketType;
  const number = await nextNumber(tx, ctx, type, numberPrefix[type]);
  const status: CanonicalState = 'new';

  const derived = await derivePriority(tx, ctx, parsed.impact, parsed.urgency);
  const priority = parsed.priority ?? derived ?? (await getSetting<string>(ctx, 'ticket.defaultPriority'));

  // Checked against the tenant's field definitions before anything is written.
  // The schema comment on `field_definition` has claimed since Phase 1 that
  // "the ticket API validates `custom` against them from the start"; until this
  // line it did not, and `custom` was whatever a caller sent.
  const submitted = (parsed.custom ?? {}) as Record<string, unknown>;
  const answered = new Set(preValidatedKeys);
  const fromForm: Record<string, unknown> = {};
  const toCheck: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (answered.has(key)) fromForm[key] = value;
    else toCheck[key] = value;
  }

  const custom = {
    ...fromForm,
    ...validateCustom(
      await fieldsInTx(tx),
      type,
      toCheck,
      {
        type,
        priority,
        impact: parsed.impact ?? null,
        urgency: parsed.urgency ?? null,
        serviceId: parsed.serviceId ?? null,
        categoryId: parsed.categoryId ?? null,
        sourceChannel: parsed.sourceChannel,
      },
      // The form's answers count towards a required field being satisfied. A
      // request type that asks for a cost centre and a field definition that
      // requires one are the same question asked twice, and the person filling
      // the form answered it.
      fromForm,
    ),
  };

  const id = newId();
  const ticket = await repo.insertTicket(tx, {
    id,
    tenantId: ctx.tenantId,
    orgId: parsed.orgId ?? ctx.organisationIds[0] ?? null,
    number,
    type,
    title: parsed.title,
    description: parsed.description ?? null,
    descriptionFormat: parsed.descriptionFormat,
    status,
    statusCategory: categoryOf(status),
    priority,
    impact: parsed.impact ?? null,
    urgency: parsed.urgency ?? null,
    requesterId: requesterId ?? null,
    affectedUserId: parsed.affectedUserId ?? requesterId ?? null,
    assigneeId: parsed.assigneeId ?? null,
    groupId: parsed.groupId ?? null,
    serviceId: parsed.serviceId ?? null,
    categoryId: parsed.categoryId ?? null,
    sourceChannel: parsed.sourceChannel,
    channelRef: parsed.channelRef ?? null,
    parentId: parsed.parentId ?? null,
    externalRef: parsed.externalRef ?? null,
    custom: custom as never,
    createdBy: ctx.actor.id,
    createdByType: ctx.actor.type,
    updatedBy: ctx.actor.id,
  });

  await repo.insertTicketEvent(tx, ctx, id, 'created', { number, channel: parsed.sourceChannel });

  if (requesterId) {
    await tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: id, userId: requesterId, reason: 'requester' },
    });
  }

  await recordAudit(tx, ctx, {
    action: 'ticket.created',
    targetType: 'ticket',
    targetId: id,
    after: { number, type, title: parsed.title, status, priority },
  });

  await publish(tx, ctx, {
    definition: events.ticketCreated,
    aggregateId: id,
    aggregateVersion: ticket.version,
    payload: {
      ticketId: id,
      number,
      type,
      channel: parsed.sourceChannel,
      requesterId: requesterId ?? null,
      priority,
      serviceId: parsed.serviceId ?? null,
      categoryId: parsed.categoryId ?? null,
      groupId: parsed.groupId ?? null,
      orgId: ticket.orgId,
    },
  });

  return ticket;
}

/** Loads a ticket and checks the caller may see it, raising 404 if not. */
export async function getTicket(ctx: TenantContext, idOrNumber: string): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => loadVisible(tx, ctx, idOrNumber));
}

async function loadVisible(tx: Tx, ctx: TenantContext, idOrNumber: string): Promise<repo.TicketRow> {
  const ticket = await repo.findByIdOrNumber(tx, idOrNumber);
  if (!ticket) throw new NotFoundError('ticket', idOrNumber);
  authz.requireVisible(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket }, 'ticket');
  return ticket;
}

export interface ListResult {
  data: repo.TicketRow[];
  nextCursor: string | null;
}

export async function listTickets(
  ctx: TenantContext,
  filter: repo.ListFilter,
  options: { limit: number; cursor?: string; sort?: repo.ListOptions['sort'] },
): Promise<ListResult> {
  authz.require(ctx, 'ticket.read');
  const scope = scopeFilterFor(ctx);
  const query = prepareFilter(filter);

  return transaction(ctx, async (tx) => {
    const sort = options.sort ?? '-createdAt';
    const cursor = decodeCursor(options.cursor);
    const rows = await repo.listTickets(tx, query, {
      limit: options.limit + 1,
      sort,
      ...(cursor ? { cursor } : {}),
      ...(scope ? { scope } : {}),
    });

    const hasMore = rows.length > options.limit;
    const data = hasMore ? rows.slice(0, options.limit) : rows;
    const last = data.at(-1);
    return {
      data,
      nextCursor: hasMore && last ? encodeCursor(sort.includes('due') ? last.dueAt ?? last.createdAt : last.createdAt, last.id) : null,
    };
  });
}

/**
 * How many tickets match a filter, without fetching any of them.
 *
 * Added for MOD-12: a reporting module that wants to check its own projection
 * against the truth has to be able to ask the module that owns the truth, and
 * the alternative — reading `ticket` directly from the analytics code — would
 * make the check agree with the projection precisely when both are wrong about
 * the same thing. It is a normal query-service function, so it carries the same
 * permission check and the same scope filter as `listTickets`; a caller who can
 * only see their own tickets counts only their own.
 */
export async function countTickets(ctx: TenantContext, filter: repo.ListFilter = {}): Promise<number> {
  authz.require(ctx, 'ticket.read');
  const scope = scopeFilterFor(ctx);
  const query = prepareFilter(filter);
  return transaction(ctx, async (tx) => repo.countTickets(tx, query, scope));
}

/** Where a counted view stops counting. */
export const COUNT_CAP = 1000;

export interface CappedCount {
  /** The number of matching tickets, or `COUNT_CAP` when there are more. */
  count: number;
  /** True when there were more than `COUNT_CAP`, so `count` is a floor. */
  capped: boolean;
}

/**
 * How many tickets a list with this filter would page through, for a view's
 * badge (WA1).
 *
 * The same permission check and the same scope predicate as `listTickets`, so
 * a badge can never promise a ticket the list will not show. Capped, because
 * the number is for a sidebar and "999+" says everything a badge can usefully
 * say: the database stops at `COUNT_CAP + 1` rows instead of counting a
 * tenant's whole history every time an agent's views refresh, and the one
 * extra row is how the answer knows it was cut short.
 */
export async function countTicketsUpTo(ctx: TenantContext, filter: repo.ListFilter = {}, cap = COUNT_CAP): Promise<CappedCount> {
  authz.require(ctx, 'ticket.read');
  const scope = scopeFilterFor(ctx);
  const query = prepareFilter(filter);
  const counted = await transaction(ctx, async (tx) => repo.countTickets(tx, query, scope, cap + 1));
  return counted > cap ? { count: cap, capped: true } : { count: counted, capped: false };
}

/**
 * Checks a filter's date windows and fixes the instant its `sla` predicate is
 * judged against, once for the whole call.
 *
 * A window that ends before it starts is refused rather than answered with
 * nothing: an empty list for a reversed range reads as "no tickets", and the
 * caller's mistake would never surface. Equal bounds are allowed — `[t, t)` is
 * a legitimately empty window.
 */
function prepareFilter(filter: repo.ListFilter, now: Date = new Date()): repo.ListFilter {
  const windows = [
    ['createdAfter', 'createdBefore'],
    ['dueAfter', 'dueBefore'],
    ['resolvedAfter', 'resolvedBefore'],
  ] as const;
  for (const [after, before] of windows) {
    const from = filter[after];
    const to = filter[before];
    if (from && to && from.getTime() > to.getTime()) {
      throw new ValidationError('the window ends before it starts', [
        { field: `filter[${before}]`, code: 'window_reversed', message: `filter[${before}] is earlier than filter[${after}]` },
      ]);
    }
  }
  return filter.now ? filter : { ...filter, now };
}

/** The dimensions `GET /tickets/counts?groupBy=` splits by (R2g). */
export const COUNT_DIMENSIONS = ['priority', 'status', 'statusCategory', 'type', 'group', 'assignee', 'service', 'age', 'sla'] as const;
export type CountDimension = (typeof COUNT_DIMENSIONS)[number];

export interface TicketCountsBy {
  groupBy: CountDimension;
  /** One entry per key; `null` is "no value" (unassigned, no team, no service). */
  groups: { key: string | null; count: number }[];
  /** The filtered set's size, which the groups always sum to. */
  total: number;
}

/** The widest created or resolved window a grouped count accepts without open work. */
export const GROUPED_COUNT_MAX_WINDOW_DAYS = 400;

/** Clock skew allowed to a window that names only its start (see `assertBounded`). */
const OPEN_WINDOW_GRACE_MS = 5 * 60 * 1000;

const COLUMN_OF: Record<Exclude<CountDimension, 'age' | 'sla'>, repo.GroupColumn> = {
  priority: 'priority',
  status: 'status',
  statusCategory: 'statusCategory',
  type: 'type',
  group: 'groupId',
  assignee: 'assigneeId',
  service: 'serviceId',
};

/**
 * The display order of the dimensions whose values are a fixed vocabulary.
 * People read P1 before P4 and "new" before "closed", whatever the counts.
 */
const CANONICAL_ORDER: Partial<Record<CountDimension, readonly string[]>> = {
  priority: prioritySchema.options,
  status: canonicalStateSchema.options,
  statusCategory: statusCategorySchema.options,
  type: ticketTypeSchema.options,
};

/** Open and paused: the work an age or SLA breakdown is about. */
const LIVE_CATEGORIES = ['open', 'paused'];

/**
 * How many tickets fall in each value of one dimension (R2g), for the
 * distributions on the Service Desk Overview and Administration's breakdowns.
 *
 * The same permission check and scope predicate as `listTickets`, so each
 * group counts only rows that reader's list would show, and the groups sum to
 * exactly what `countTickets` returns for the same filter.
 *
 * Exact, not capped like a badge, which is affordable only because the set is
 * bounded first: the call must ask about open or paused work (or `sla`, which
 * selects open work), or name a created or resolved window of at most 400
 * days. Anything else would be a whole-history scan on every page view, and is
 * refused with 422. `age` and `sla` are breakdowns of live work, so they read
 * open and paused tickets unless the caller names categories; `sla` refuses
 * categories outside those two, because a resolved ticket is in none of its
 * buckets and the groups would no longer sum to the total.
 */
export async function countTicketsBy(
  ctx: TenantContext,
  filter: repo.ListFilter,
  dimension: CountDimension,
  now: Date = new Date(),
): Promise<TicketCountsBy> {
  authz.require(ctx, 'ticket.read');
  const scope = scopeFilterFor(ctx);

  // One instant for the guard, the `sla` filter and every bucket edge.
  const at = filter.now ?? now;
  const live = dimension === 'age' || dimension === 'sla';
  const query = prepareFilter(live && !filter.statusCategory?.length ? { ...filter, statusCategory: LIVE_CATEGORIES } : filter, at);
  if (dimension === 'sla' && query.statusCategory?.some((category) => !LIVE_CATEGORIES.includes(category))) {
    throw new ValidationError('an SLA breakdown counts open and paused work only', [
      { field: 'filter[statusCategory]', code: 'not_live', message: 'filter[statusCategory] may name only open and paused with groupBy=sla' },
    ]);
  }
  assertBounded(query, at);

  const groups = await transaction(ctx, async (tx) => {
    if (dimension === 'age') return repo.countByBuckets(tx, query, repo.ageBuckets(at), scope);
    if (dimension === 'sla') return repo.countByBuckets(tx, query, repo.slaBuckets(at), scope);
    return repo.countByColumn(tx, query, COLUMN_OF[dimension], scope);
  });

  return {
    groupBy: dimension,
    groups: ordered(dimension, groups),
    total: groups.reduce((sum, group) => sum + group.count, 0),
  };
}

/** Refuses a grouped count that would read a tenant's whole history (R2g guard). */
function assertBounded(filter: repo.ListFilter, now: Date): void {
  const categories = filter.statusCategory ?? [];
  if (categories.length > 0 && categories.every((category) => LIVE_CATEGORIES.includes(category))) return;
  if (filter.sla) return;
  const limitMs = GROUPED_COUNT_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // An open-ended window ends now: nothing is created or resolved in the
  // future, so "since 1 September" is bounded by today. It is measured on
  // this server's clock, a moment after the caller computed "400 days ago" on
  // its own, so it gets a few minutes' grace rather than a 422 for a request
  // that was within the limit when it was written.
  const within = (after?: Date, before?: Date) =>
    Boolean(after) && (before ?? now).getTime() - after!.getTime() <= limitMs + (before ? 0 : OPEN_WINDOW_GRACE_MS);
  if (within(filter.createdAfter, filter.createdBefore) || within(filter.resolvedAfter, filter.resolvedBefore)) return;
  throw new ValidationError('a grouped count needs open work or a date window', [
    {
      field: 'filter',
      code: 'unbounded',
      message: `name filter[statusCategory] within open,paused, or a created or resolved window of at most ${GROUPED_COUNT_MAX_WINDOW_DAYS} days`,
    },
  ]);
}

/**
 * Canonical order for fixed vocabularies (values outside it follow, largest
 * first); bucket order for `age` and `sla`, which arrive in it; largest first
 * for teams, people and services, with ties broken by key and "none" last so
 * the order is stable between refreshes.
 */
function ordered(dimension: CountDimension, groups: { key: string | null; count: number }[]): { key: string | null; count: number }[] {
  if (dimension === 'age' || dimension === 'sla') return groups;
  const canonical = CANONICAL_ORDER[dimension] ?? [];
  const rank = (key: string | null) => (key !== null && canonical.includes(key) ? canonical.indexOf(key) : canonical.length);
  return [...groups].sort(
    (a, b) =>
      rank(a.key) - rank(b.key) ||
      b.count - a.count ||
      (a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key)),
  );
}

/**
 * Whether this reader works the desk rather than raising tickets on it: a
 * `ticket.read` scope of `team` or `any`, not `own`.
 *
 * One definition, because two questions depend on it — which custom fields a
 * reader is shown, and whether they see a ticket's event history — and if the
 * answers ever disagreed, one door would hand out what the other withholds.
 */
export function worksTheDesk(ctx: TenantContext): boolean {
  const scope = authz.effectiveScope(ctx, 'ticket.read');
  return scope === 'team' || scope === 'any';
}

/**
 * Turns the caller's permission scope into a SQL predicate, so a list query
 * filters in the database rather than loading rows and discarding them.
 */
function scopeFilterFor(ctx: TenantContext): Record<string, unknown> | undefined {
  const scope = authz.effectiveScope(ctx, 'ticket.read');
  if (scope === 'any') return undefined;
  if (scope === 'team') {
    return {
      OR: [
        { groupId: { in: ctx.teamIds } },
        { requesterId: ctx.actor.id },
        { affectedUserId: ctx.actor.id },
        { assigneeId: ctx.actor.id },
        // The unrouted triage pool, scoped to the actor's organisations.
        ...(ctx.organisationIds.length ? [{ groupId: null, orgId: { in: ctx.organisationIds } }] : []),
      ],
    };
  }
  return {
    OR: [{ requesterId: ctx.actor.id }, { affectedUserId: ctx.actor.id }, { assigneeId: ctx.actor.id }],
  };
}

function encodeCursor(value: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: value.toISOString(), id })).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v: string; id: string };
    return { createdAt: new Date(parsed.v), id: parsed.id };
  } catch {
    throw new ValidationError('cursor is not valid', [{ field: 'cursor', code: 'invalid', message: 'unreadable cursor' }]);
  }
}

export async function updateTicket(
  ctx: TenantContext,
  idOrNumber: string,
  patch: UpdateTicketInput,
  ifMatch: number | undefined,
): Promise<repo.TicketRow> {
  const parsed = updateTicketSchema.parse(patch);
  if (Object.keys(parsed).length === 0) throw new ValidationError('no fields to update');

  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.update', { aggregate: 'ticket', record: ticket });
    requireIfMatch(ifMatch, ticket.version);

    // A patch carrying `custom` is a patch to *some* fields, not a replacement
    // of all of them: a client that sends one key must not silently clear the
    // other four. So the stored values are the starting point, the patch is
    // checked against the definitions, and the required check sees the result
    // rather than the fragment — otherwise changing one field would report a
    // different required field as missing because this request did not mention
    // it.
    if (parsed.custom !== undefined) {
      const stored = (ticket.custom as Record<string, unknown>) ?? {};
      const patch = validateCustom(
        await fieldsInTx(tx),
        ticket.type,
        parsed.custom as Record<string, unknown>,
        {
          type: ticket.type,
          priority: parsed.priority ?? ticket.priority,
          impact: parsed.impact ?? ticket.impact,
          urgency: parsed.urgency ?? ticket.urgency,
          serviceId: parsed.serviceId ?? ticket.serviceId,
          categoryId: parsed.categoryId ?? ticket.categoryId,
        },
        stored,
      );

      const merged = { ...stored };
      for (const [key, value] of Object.entries(patch)) {
        // Null is how a value is removed. Storing it would leave a key whose
        // presence still says the field was once set.
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      (parsed as Record<string, unknown>).custom = merged;
    }

    const changed: Record<string, { before: unknown; after: unknown }> = {};
    const data: Record<string, unknown> = {};
    for (const field of MUTABLE_FIELDS) {
      if (!(field in parsed)) continue;
      const after = (parsed as Record<string, unknown>)[field];
      const before = (ticket as unknown as Record<string, unknown>)[field];
      // `custom` is a JSONB column, so `before` has been through the database
      // and may come back with its keys in another order. Compared with
      // `JSON.stringify` this reads as a change on every update that touches
      // custom fields at all: an audit row, a version bump, a `ticket.updated`
      // event, and every rule and notification waiting on one.
      if (jsonEquals(before, after)) continue;
      changed[field] = { before, after };
      data[field] = after;
    }
    if (Object.keys(changed).length === 0) return ticket;

    // Changing impact or urgency re-derives priority unless it was set explicitly.
    if ((changed.impact || changed.urgency) && !changed.priority) {
      const impact = (parsed.impact ?? ticket.impact) as string | null;
      const urgency = (parsed.urgency ?? ticket.urgency) as string | null;
      const derived = await derivePriority(tx, ctx, impact, urgency);
      if (derived && derived !== ticket.priority) {
        changed.priority = { before: ticket.priority, after: derived };
        data.priority = derived;
      }
    }

    data.updatedBy = ctx.actor.id;
    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) throw new ConflictError('this ticket changed while you were editing it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'updated', { changed });
    await recordAudit(tx, ctx, {
      action: 'ticket.updated',
      targetType: 'ticket',
      targetId: ticket.id,
      before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.before])),
      after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.after])),
    });
    await publish(tx, ctx, {
      definition: events.ticketUpdated,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: { ticketId: ticket.id, number: ticket.number, changed },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'updated');
    return updated;
  });
}

function requireIfMatch(ifMatch: number | undefined, current: number): void {
  if (ifMatch === undefined) throw new PreconditionRequiredError();
  if (ifMatch !== current) {
    throw new ConflictError(`this ticket is at version ${current}; you sent ${ifMatch}`);
  }
}

export async function transitionTicket(
  ctx: TenantContext,
  idOrNumber: string,
  to: CanonicalState,
  options: { reason?: string; ifMatch?: number; resolutionCode?: string } = {},
): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const from = ticket.status as CanonicalState;

    authz.require(ctx, 'ticket.transition', { aggregate: 'ticket', record: ticket });

    // A requester may only make the moves the state machine marks as theirs.
    const actingAsRequester =
      !ctx.permissions.has('ticket.transition', 'team') && !ctx.permissions.has('ticket.transition', 'any');
    if (actingAsRequester && !isRequesterTransition(from, to)) {
      throw new ForbiddenError('ticket.transition', `a requester cannot move a ticket from ${from} to ${to}`);
    }
    if (requiresAdministratorOverride(from) && !ctx.permissions.has('ticket.update', 'any')) {
      throw new ForbiddenError('ticket.update', `${from} tickets can only be changed by an administrator, with a reason`);
    }
    if (requiresAdministratorOverride(from) && !options.reason) {
      throw new ValidationError('a reason is required to change a closed ticket', [
        { field: 'reason', code: 'required', message: 'a reason is required' },
      ]);
    }

    assertTransition(from, to);
    if (options.ifMatch !== undefined) requireIfMatch(options.ifMatch, ticket.version);

    // Reopening is bounded by policy, so a ticket cannot come back a year later.
    if (to === 'reopened') {
      const windowDays = await getSetting<number>(ctx, 'ticket.reopen.windowDays');
      const resolvedAt = ticket.resolvedAt?.getTime() ?? 0;
      if (windowDays > 0 && resolvedAt && Date.now() - resolvedAt > windowDays * 86_400_000) {
        throw new ValidationError(`this ticket was resolved more than ${windowDays} days ago; raise a linked ticket instead`);
      }
    }

    const at = new Date();
    const effects = effectsOf(from, to, at);
    const data: Record<string, unknown> = {
      status: to,
      statusCategory: effects.statusCategory,
      updatedBy: ctx.actor.id,
    };
    if (effects.resolvedAt !== 'unchanged') data.resolvedAt = effects.resolvedAt;
    if (effects.closedAt !== 'unchanged') data.closedAt = effects.closedAt;
    if (effects.incrementReopenCount) data.reopenCount = { increment: 1 };

    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) throw new ConflictError('this ticket changed while you were working on it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'status.changed', {
      from,
      to,
      reason: options.reason ?? null,
      resolutionCode: options.resolutionCode ?? null,
    });
    await recordAudit(tx, ctx, {
      action: 'ticket.status.changed',
      targetType: 'ticket',
      targetId: ticket.id,
      before: { status: from },
      after: { status: to },
      reason: options.reason ?? null,
    });
    await publish(tx, ctx, {
      definition: events.ticketStatusChanged,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        from,
        to,
        fromCategory: categoryOf(from),
        toCategory: effects.statusCategory,
        reason: options.reason ?? null,
      },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'status.changed');
    return updated;
  });
}

export async function assignTicket(
  ctx: TenantContext,
  idOrNumber: string,
  input: { assigneeId?: string | null; groupId?: string | null; method?: 'manual' | 'rule' | 'round_robin' | 'load_balanced' | 'skills' },
  ifMatch?: number,
): Promise<repo.TicketRow> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.assign', { aggregate: 'ticket', record: ticket });
    if (ifMatch !== undefined) requireIfMatch(ifMatch, ticket.version);

    const assigneeId = input.assigneeId === undefined ? ticket.assigneeId : input.assigneeId;
    const groupId = input.groupId === undefined ? ticket.groupId : input.groupId;
    if (assigneeId === ticket.assigneeId && groupId === ticket.groupId) return ticket;

    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, {
      assigneeId,
      groupId,
      updatedBy: ctx.actor.id,
    });
    if (affected === 0) throw new ConflictError('this ticket changed while you were assigning it', ticket);

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'assigned', {
      assigneeId,
      groupId,
      method: input.method ?? 'manual',
    });
    await recordAudit(tx, ctx, {
      action: 'ticket.assigned',
      targetType: 'ticket',
      targetId: ticket.id,
      before: { assigneeId: ticket.assigneeId, groupId: ticket.groupId },
      after: { assigneeId, groupId },
    });
    await publish(tx, ctx, {
      definition: events.ticketAssigned,
      aggregateId: ticket.id,
      aggregateVersion: ticket.version + 1,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        assigneeId,
        groupId,
        method: input.method ?? 'manual',
      },
    });

    const updated = (await repo.findById(tx, ticket.id))!;
    await notifyChange(ctx, updated, 'assigned');
    return updated;
  });
}

export const addCommentSchema = z.object({
  body: z.string().min(1).max(100_000),
  bodyFormat: z.enum(['text', 'html']).default('text'),
  visibility: z.enum(['public', 'internal']).default('public'),
  channel: z.enum(['portal', 'email', 'api', 'slack', 'teams', 'whatsapp', 'voice', 'mobile', 'import', 'system']).default('api'),
  externalRef: z.string().max(500).optional(),
});
export type AddCommentInput = z.input<typeof addCommentSchema>;

export async function addComment(ctx: TenantContext, idOrNumber: string, input: AddCommentInput) {
  const parsed = addCommentSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const permission = parsed.visibility === 'internal' ? 'ticket.comment.internal' : 'ticket.comment.public';
    authz.require(ctx, permission, { aggregate: 'ticket', record: ticket });

    const id = newId();
    const comment = await repo.insertComment(tx, {
      id,
      tenantId: ctx.tenantId,
      ticketId: ticket.id,
      authorId: ctx.actor.id,
      authorType: ctx.actor.type,
      visibility: parsed.visibility,
      body: parsed.body,
      bodyFormat: parsed.bodyFormat,
      channel: parsed.channel,
      externalRef: parsed.externalRef ?? null,
      createdBy: ctx.actor.id,
    });

    await recordAudit(tx, ctx, {
      action: 'ticket.comment.added',
      targetType: 'ticket',
      targetId: ticket.id,
      after: { commentId: id, visibility: parsed.visibility },
    });
    await publish(tx, ctx, {
      definition: events.ticketCommentAdded,
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        commentId: id,
        visibility: parsed.visibility,
        authorId: ctx.actor.id,
        channel: parsed.channel,
      },
    });

    await notifyChange(ctx, ticket, 'comment.added');
    return comment;
  });
}

/**
 * The merged timeline.
 *
 * What a reader is given depends on who they are, and the two contract tests
 * (`ticket-lifecycle`, `requester-timeline`) hold it to MOD-02-E1-S2: internal
 * notes and agent-only fields are never returned to a requester.
 *
 * - Internal notes are left out for anyone without the internal-note
 *   permission on this ticket, and so are the files attached to them: a
 *   filename such as `salary-review.xlsx` is itself the note's content.
 * - Events are left out entirely for a reader who does not work the desk.
 *   Their payloads are the desk's working record — an `updated` event carries
 *   every changed field before and after, custom fields included, whatever
 *   their classification; `status.changed` carries the agent's reason;
 *   `assigned` names the person and the routing method — and none of it was
 *   written for the requester. Filtering payloads key by key would need a rule
 *   per event type that every new event type then had to remember; leaving
 *   them out fails closed. The requester's view of progress is the ticket's
 *   own status and the public conversation, which is what the portal shows.
 *
 * Custom fields on `ticket` are the caller's to lens, as on every other ticket
 * read: the route does it with the same reader definition (`worksTheDesk`).
 */
export async function getTimeline(ctx: TenantContext, idOrNumber: string) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const includeInternal = authz.can(ctx, 'ticket.comment.internal', { aggregate: 'ticket', record: ticket });
    const includeEvents = worksTheDesk(ctx);

    const [comments, ticketEvents, tasks, clean] = await Promise.all([
      repo.listComments(tx, ticket.id, includeInternal),
      includeEvents ? repo.listEvents(tx, ticket.id) : Promise.resolve([]),
      repo.listTasks(tx, ticket.id),
      repo.listAttachments(tx, ticket.id, true),
    ]);

    // A file attached to a comment is shown only with that comment. The
    // comments list is already the reader's, so "its comment is in the list"
    // is the whole rule; a file attached to the ticket itself has no comment
    // to hide behind and is shown to anybody who may read the ticket.
    const shownComments = new Set(comments.map((comment) => comment.id));
    const attachments = includeInternal
      ? clean
      : clean.filter((attachment) => attachment.commentId === null || shownComments.has(attachment.commentId));

    const entries = [
      ...comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, comment: c })),
      ...ticketEvents.map((e) => ({ kind: 'event' as const, at: e.occurredAt, event: e })),
      ...tasks.map((t) => ({ kind: 'task' as const, at: t.createdAt, task: t })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return { ticket, entries, attachments, includeInternal, includeEvents };
  });
}

export async function createTask(
  ctx: TenantContext,
  idOrNumber: string,
  input: { title: string; description?: string; assigneeId?: string; groupId?: string; dueAt?: Date; key?: string; order?: number },
) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.task.manage', { aggregate: 'ticket', record: ticket });

    const id = newId();
    const task = await tx.ticketTask.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        key: input.key ?? null,
        title: input.title,
        description: input.description ?? null,
        assigneeId: input.assigneeId ?? null,
        groupId: input.groupId ?? null,
        dueAt: input.dueAt ?? null,
        order: input.order ?? 0,
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, { action: 'ticket.task.created', targetType: 'ticket_task', targetId: id, after: { title: input.title } });
    await publish(tx, ctx, {
      definition: events.ticketTaskCreated,
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        taskId: id,
        title: input.title,
        assigneeId: input.assigneeId ?? null,
        groupId: input.groupId ?? null,
      },
    });
    return task;
  });
}

export async function completeTask(ctx: TenantContext, taskId: string) {
  return transaction(ctx, async (tx) => {
    const task = await tx.ticketTask.findFirst({ where: { id: taskId } });
    if (!task) throw new NotFoundError('task', taskId);
    const ticket = await loadVisible(tx, ctx, task.ticketId);
    authz.require(ctx, 'ticket.task.manage', { aggregate: 'ticket', record: ticket });
    if (task.status === 'done') return task;

    const blockers = task.blockedBy.length
      ? await tx.ticketTask.findMany({ where: { id: { in: task.blockedBy }, status: { not: 'done' } } })
      : [];
    if (blockers.length > 0) {
      throw new ValidationError(`this task is blocked by ${blockers.length} unfinished task(s)`);
    }

    const updated = await tx.ticketTask.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date(), version: { increment: 1 } },
    });

    await repo.insertTicketEvent(tx, ctx, ticket.id, 'task.completed', { taskId, title: task.title });
    await recordAudit(tx, ctx, { action: 'ticket.task.completed', targetType: 'ticket_task', targetId: taskId, after: { status: 'done' } });
    await publish(tx, ctx, {
      definition: events.ticketTaskCompleted,
      aggregateId: ticket.id,
      payload: { ticketId: ticket.id, number: ticket.number, taskId, key: task.key },
    });
    return updated;
  });
}

export async function linkTickets(ctx: TenantContext, sourceIdOrNumber: string, targetIdOrNumber: string, linkType: LinkType) {
  return transaction(ctx, async (tx) => {
    const source = await loadVisible(tx, ctx, sourceIdOrNumber);
    const target = await loadVisible(tx, ctx, targetIdOrNumber);
    authz.require(ctx, 'ticket.link', { aggregate: 'ticket', record: source });
    if (source.id === target.id) throw new ValidationError('a ticket cannot be linked to itself');

    const existing = await tx.ticketLink.findFirst({ where: { sourceId: source.id, targetId: target.id, linkType } });
    if (existing) return existing;

    const link = await tx.ticketLink.create({
      data: { id: newId(), tenantId: ctx.tenantId, sourceId: source.id, targetId: target.id, linkType, createdBy: ctx.actor.id },
    });
    // The inverse is stored too, so either record can be read without a union query.
    await tx.ticketLink.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        sourceId: target.id,
        targetId: source.id,
        linkType: inverseLinkType[linkType],
        createdBy: ctx.actor.id,
      },
    });

    await repo.insertTicketEvent(tx, ctx, source.id, 'linked', { targetId: target.id, targetNumber: target.number, linkType });
    await recordAudit(tx, ctx, {
      action: 'ticket.linked',
      targetType: 'ticket',
      targetId: source.id,
      after: { targetId: target.id, linkType },
    });
    await publish(tx, ctx, {
      definition: events.ticketLinked,
      aggregateId: source.id,
      payload: { sourceId: source.id, targetId: target.id, linkType },
    });
    return link;
  });
}

export async function addWatcher(ctx: TenantContext, idOrNumber: string, userId: string, reason = 'manual') {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.watch', { aggregate: 'ticket', record: ticket });
    const existing = await tx.ticketWatcher.findFirst({ where: { ticketId: ticket.id, userId } });
    if (existing) return existing;
    return tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: ticket.id, userId, reason },
    });
  });
}

export interface LinkedTicket {
  linkType: string;
  createdAt: Date;
  ticket: repo.TicketRow;
}

/**
 * The tickets this one is linked to, from this ticket's side (WA5).
 *
 * `linkTickets` stores every link twice, once from each end with the inverse
 * type, so reading the rows this ticket is the source of already gives each
 * relationship in the words that suit it here ("blocks" on one side, "caused
 * by" on the other) without a union.
 *
 * A linked ticket the reader may not see is left out rather than shown as a
 * number: a link can outlive the reader's access to its target — the target
 * moved to another team since — and the title, status and even the existence
 * of somebody else's ticket are not this ticket's to disclose.
 */
export async function listLinks(ctx: TenantContext, idOrNumber: string): Promise<LinkedTicket[]> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const links = await repo.listLinks(tx, ticket.id);
    if (links.length === 0) return [];

    const targets = await repo.findManyById(tx, [...new Set(links.map((link) => link.targetId))]);
    const visible = new Map(
      targets
        .filter((target) => authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: target }))
        .map((target) => [target.id, target]),
    );
    return links
      .filter((link) => visible.has(link.targetId))
      .map((link) => ({ linkType: link.linkType, createdAt: link.createdAt, ticket: visible.get(link.targetId)! }));
  });
}

export interface WatcherRow {
  userId: string;
  reason: string;
  createdAt: Date;
}

/**
 * Who is watching a ticket (WA5).
 *
 * The desk sees everybody, which is what makes "add a watcher" safe to use:
 * the agent can see who is already told. A requester sees only their own row.
 * The other watchers are colleagues somebody copied in and agents following
 * the ticket, and which of them are on it is the desk's business — the same
 * privacy line as the portal showing a team rather than a person.
 */
export async function listWatchers(ctx: TenantContext, idOrNumber: string): Promise<WatcherRow[]> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    const rows = await repo.listWatchers(tx, ticket.id);
    const shown = worksTheDesk(ctx) ? rows : rows.filter((row) => row.userId === ctx.actor.id);
    return shown.map((row) => ({ userId: row.userId, reason: row.reason, createdAt: row.createdAt }));
  });
}

export async function presignAttachment(
  ctx: TenantContext,
  idOrNumber: string,
  input: { filename: string; mime: string; size: number },
) {
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(`attachments are limited to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`, [
      { field: 'size', code: 'too_large', message: 'file is too large' },
    ]);
  }
  const ticket = await getTicket(ctx, idOrNumber);
  authz.require(ctx, 'ticket.attachment.add', { aggregate: 'ticket', record: ticket });
  return { ticket, upload: presignUpload(ctx, { kind: 'attachment', ...input }) };
}

/**
 * Registers an uploaded object. The attachment stays invisible until the scan
 * worker marks it clean (ADR-0016), so a malicious file is never downloadable
 * even for the moment between upload and scan.
 */
export async function registerAttachment(
  ctx: TenantContext,
  idOrNumber: string,
  input: { objectKey: string; filename: string; mime: string; size: number; commentId?: string },
) {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.attachment.add', { aggregate: 'ticket', record: ticket });

    if (!input.objectKey.startsWith(`tenants/${ctx.tenantId}/`)) {
      throw new ValidationError('that object key does not belong to this tenant');
    }

    const id = newId();
    const attachment = await tx.attachment.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        commentId: input.commentId ?? null,
        objectKey: input.objectKey,
        filename: input.filename,
        mime: input.mime,
        size: input.size,
        scanStatus: 'pending',
        createdBy: ctx.actor.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'ticket.attachment.added',
      targetType: 'attachment',
      targetId: id,
      after: { filename: input.filename, size: input.size },
    });
    await publish(tx, ctx, {
      definition: events.ticketAttachmentAdded,
      aggregateId: ticket.id,
      payload: { ticketId: ticket.id, number: ticket.number, attachmentId: id, filename: input.filename, size: input.size },
    });
    await enqueue(ctx, 'scan', 'attachment.scan', { attachmentId: id }, { idempotencyKey: `scan-${id}` });

    return attachment;
  });
}

/** Pushes a "something changed" notice to open workspaces (ADR-0015). */
async function notifyChange(ctx: TenantContext, ticket: repo.TicketRow, action: string): Promise<void> {
  const topics = [topicForEntity(ctx.tenantId, 'ticket', ticket.id)];
  if (ticket.requesterId) topics.push(topicForUser(ctx.tenantId, ticket.requesterId));
  if (ticket.assigneeId) topics.push(topicForUser(ctx.tenantId, ticket.assigneeId));
  // The group as well, so a queue learns about a ticket nobody in front of it
  // has opened yet. An assignment that moves a ticket between groups notifies
  // the one it landed in; the one it left finds out by the refetch the notice
  // triggers, which is the same request it would have made anyway.
  if (ticket.groupId) topics.push(topicForGroup(ctx.tenantId, ticket.groupId));
  await publishNotice(ctx, topics, { entity: 'ticket', id: ticket.id, version: ticket.version, action });
}

export { repo, STATES };

// ---------------------------------------------------------------------------
// The automation write path.
//
// MOD-04 stays the only writer of a ticket row (docs/architecture/04 §3), so
// the rules engine — and the workflow engine after it — hands a described change
// to this function rather than reaching for the table. Everything here runs on
// the caller's transaction, which is what lets a rule be exactly-once with the
// event that triggered it.
// ---------------------------------------------------------------------------

/** Fields automation may write. Narrower than a person's update on purpose. */
const AUTOMATION_FIELDS = new Set([
  'impact',
  'urgency',
  'priority',
  'categoryId',
  'subcategoryId',
  'serviceId',
  'orgId',
  'locationId',
  'groupId',
  'dueAt',
]);

export interface AutomationProvenance {
  /** `ai` is a triage decision in `auto` mode (ADR-0051); `id` is the decision's. */
  kind: 'rule' | 'workflow' | 'ai';
  id: string;
  key: string;
  version: number;
  /** Why, in the author's words — carried into the audit entry. */
  reason?: string;
}

export interface AutomatedChange {
  patch?: Record<string, unknown>;
  /**
   * What each patched field must still hold for it to be written. A field
   * that has moved since the change was decided is refused and the others go
   * ahead: automation that decided on a ticket as it was must not write over
   * what somebody made of it since.
   */
  expect?: Record<string, unknown>;
  tags?: string[];
  watchers?: string[];
  status?: { status: string; reason?: string };
  /**
   * Who automation chose to do the work (MOD-20).
   *
   * Separate from `patch` on purpose. `assigneeId` is deliberately absent from
   * AUTOMATION_FIELDS, so a `setField` action can never name a person; and an
   * assignment is not a field change — it has its own ticket event, its own
   * audit action and its own published event, which notifications and webhooks
   * are already listening for.
   */
  assignee?: { userId: string; method: 'rule' | 'round_robin' | 'load_balanced' | 'skills'; reason?: string };
}

export interface AutomationOutcome {
  changed: Record<string, { before: unknown; after: unknown }>;
  tagsAdded: string[];
  watchersAdded: string[];
  statusChanged: { from: string; to: string } | null;
  assigned: { from: string | null; to: string } | null;
  refused: { what: string; why: string }[];
}

/**
 * Applies an automated change to a ticket.
 *
 * Automation is trusted to have been authorised when the rule was published, not
 * when it fires — there is no acting user at that point. What it is *not*
 * trusted to do is produce an impossible ticket, so the state machine still
 * decides whether a status change is legal, and a refused effect is reported
 * rather than thrown: one bad action in a rule must not roll back the event that
 * triggered it.
 */
export async function applyAutomatedChange(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  change: AutomatedChange,
  provenance: AutomationProvenance,
): Promise<AutomationOutcome> {
  const outcome: AutomationOutcome = {
    changed: {},
    tagsAdded: [],
    watchersAdded: [],
    statusChanged: null,
    assigned: null,
    refused: [],
  };

  const ticket = await repo.findById(tx, ticketId);
  if (!ticket) throw new NotFoundError('ticket not found');

  // --- field writes --------------------------------------------------------
  const data: Record<string, unknown> = {};
  for (const [field, after] of Object.entries(change.patch ?? {})) {
    if (!AUTOMATION_FIELDS.has(field)) {
      outcome.refused.push({ what: `setField ${field}`, why: 'automation may not write this field' });
      continue;
    }
    const before = (ticket as unknown as Record<string, unknown>)[field];
    if (change.expect && field in change.expect && !jsonEquals(before, change.expect[field])) {
      outcome.refused.push({ what: `setField ${field}`, why: 'the field changed after the change was decided' });
      continue;
    }
    if (jsonEquals(before, after)) continue;
    outcome.changed[field] = { before, after };
    data[field] = after;
  }

  if (Object.keys(data).length > 0) {
    data.updatedBy = null;
    const affected = await repo.updateWithVersion(tx, ticket.id, ticket.version, data as never);
    if (affected === 0) {
      // Someone edited the ticket between the event and the rule running. The
      // rule loses: a person's edit is never overwritten by automation.
      outcome.refused.push({ what: 'field changes', why: 'the ticket changed while the rule was running' });
      outcome.changed = {};
    } else {
      await repo.insertTicketEvent(tx, ctx, ticket.id, 'updated', {
        changed: outcome.changed,
        by: { automation: provenance.kind, key: provenance.key, version: provenance.version },
      });
      await recordAudit(tx, ctx, {
        action: 'ticket.updated',
        targetType: 'ticket',
        targetId: ticket.id,
        before: Object.fromEntries(Object.entries(outcome.changed).map(([k, v]) => [k, v.before])),
        after: Object.fromEntries(Object.entries(outcome.changed).map(([k, v]) => [k, v.after])),
        reason: provenance.reason ?? `${provenance.kind} ${provenance.key} v${provenance.version}`,
      });
      await publish(tx, ctx, {
        definition: events.ticketUpdated,
        aggregateId: ticket.id,
        aggregateVersion: ticket.version + 1,
        payload: { ticketId: ticket.id, number: ticket.number, changed: outcome.changed },
        actorOverride: automationActor(provenance),
      });
    }
  }

  // --- tags ----------------------------------------------------------------
  for (const tag of change.tags ?? []) {
    const existing = await tx.ticketTag.findFirst({ where: { ticketId: ticket.id, tag } });
    if (existing) continue;
    await tx.ticketTag.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        tag,
        addedBy: null,
        addedByType: provenance.kind,
      },
    });
    outcome.tagsAdded.push(tag);
  }

  // --- watchers ------------------------------------------------------------
  for (const userId of change.watchers ?? []) {
    const existing = await tx.ticketWatcher.findFirst({ where: { ticketId: ticket.id, userId } });
    if (existing) continue;
    await tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: ticket.id, userId, reason: provenance.kind },
    });
    outcome.watchersAdded.push(userId);
  }

  // --- assignee ------------------------------------------------------------
  if (change.assignee) {
    const current = (await repo.findById(tx, ticket.id))!;
    if (current.assigneeId === change.assignee.userId) {
      // Already theirs. Nothing to write, and nothing to notify them about.
    } else {
      const affected = await repo.updateWithVersion(tx, current.id, current.version, {
        assigneeId: change.assignee.userId,
        updatedBy: null,
      } as never);
      if (affected === 0) {
        outcome.refused.push({ what: 'assign', why: 'the ticket changed while the rule was running' });
      } else {
        outcome.assigned = { from: current.assigneeId, to: change.assignee.userId };
        await repo.insertTicketEvent(tx, ctx, ticket.id, 'assigned', {
          assigneeId: change.assignee.userId,
          groupId: current.groupId,
          method: change.assignee.method,
          by: { automation: provenance.kind, key: provenance.key, version: provenance.version },
        });
        await recordAudit(tx, ctx, {
          action: 'ticket.assigned',
          targetType: 'ticket',
          targetId: ticket.id,
          before: { assigneeId: current.assigneeId },
          after: { assigneeId: change.assignee.userId },
          reason: change.assignee.reason ?? `${provenance.kind} ${provenance.key} v${provenance.version}`,
        });
        await publish(tx, ctx, {
          definition: events.ticketAssigned,
          aggregateId: ticket.id,
          aggregateVersion: current.version + 1,
          payload: {
            ticketId: ticket.id,
            number: ticket.number,
            assigneeId: change.assignee.userId,
            groupId: current.groupId,
            method: change.assignee.method,
          },
          actorOverride: automationActor(provenance),
        });
      }
    }
  }

  // --- status --------------------------------------------------------------
  if (change.status) {
    const from = ticket.status as CanonicalState;
    const to = change.status.status as CanonicalState;
    if (!canTransition(from, to)) {
      outcome.refused.push({ what: `setStatus ${to}`, why: `a ticket cannot move from ${from} to ${to}` });
    } else if (from !== to) {
      const at = new Date();
      const stateEffects = effectsOf(from, to, at);
      const statusData: Record<string, unknown> = {
        status: to,
        statusCategory: stateEffects.statusCategory,
        updatedBy: null,
      };
      if (stateEffects.resolvedAt !== 'unchanged') statusData.resolvedAt = stateEffects.resolvedAt;
      if (stateEffects.closedAt !== 'unchanged') statusData.closedAt = stateEffects.closedAt;
      if (stateEffects.incrementReopenCount) statusData.reopenCount = { increment: 1 };

      const current = (await repo.findById(tx, ticket.id))!;
      const affected = await repo.updateWithVersion(tx, current.id, current.version, statusData as never);
      if (affected === 0) {
        outcome.refused.push({ what: `setStatus ${to}`, why: 'the ticket changed while the rule was running' });
      } else {
        outcome.statusChanged = { from, to };
        await repo.insertTicketEvent(tx, ctx, ticket.id, 'status.changed', {
          from,
          to,
          reason: change.status.reason ?? null,
          by: { automation: provenance.kind, key: provenance.key, version: provenance.version },
        });
        await recordAudit(tx, ctx, {
          action: 'ticket.status.changed',
          targetType: 'ticket',
          targetId: ticket.id,
          before: { status: from },
          after: { status: to },
          reason: change.status.reason ?? `${provenance.kind} ${provenance.key} v${provenance.version}`,
        });
        await publish(tx, ctx, {
          definition: events.ticketStatusChanged,
          aggregateId: ticket.id,
          aggregateVersion: current.version + 1,
          payload: {
            ticketId: ticket.id,
            number: ticket.number,
            from,
            to,
            fromCategory: categoryOf(from),
            toCategory: stateEffects.statusCategory,
            reason: change.status.reason ?? null,
          },
          actorOverride: automationActor(provenance),
        });
      }
    }
  }

  return outcome;
}

/**
 * Automation acts as itself, not as whoever happened to trigger the event.
 *
 * This is what stops a rule reacting to its own write: a consumer that sees a
 * `workflow` actor knows the change came from automation, and the rules engine
 * uses exactly that to avoid looping. An AI decision acts as `ai`, which the
 * rules engine does react to — a rule that routes by category should route a
 * ticket the AI categorised, as it would one a person did — and which never
 * loops, because triage runs once, on creation.
 */
function automationActor(provenance: AutomationProvenance) {
  return {
    type: provenance.kind === 'ai' ? ('ai' as const) : ('workflow' as const),
    id: provenance.id,
    displayName: `${provenance.kind}:${provenance.key}`,
  };
}

/**
 * The tags on a ticket.
 *
 * Goes through `loadVisible` rather than straight to the table: a tag can say
 * "vip" or "security-incident", so listing one must refuse for the same people,
 * and in the same way, as reading the ticket itself.
 */
export async function listTags(ctx: TenantContext, idOrNumber: string): Promise<string[]> {
  return transaction(ctx, async (tx) => {
    const ticket = await loadVisible(tx, ctx, idOrNumber);
    authz.require(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket });
    const rows = await tx.ticketTag.findMany({ where: { ticketId: ticket.id }, orderBy: { tag: 'asc' } });
    return rows.map((row) => row.tag);
  });
}

// ---------------------------------------------------------------------------
// The channel write path (MOD-03).
//
// A message that arrives by email is subject to exactly the rules a request
// through the API would be, so these go through the same insert and the same
// comment writer. What they add is the transaction: the inbound row and the
// ticket it produced commit together, or the provider retries and nothing was
// half-done.
// ---------------------------------------------------------------------------

export interface ChannelTicketInput {
  title: string;
  description: string;
  requesterId: string;
  sourceChannel: string;
  channelRef: string;
  orgId?: string | null;
}

export async function createFromChannel(
  ctx: TenantContext,
  tx: Tx,
  input: ChannelTicketInput,
): Promise<repo.TicketRow> {
  authz.require(ctx, 'ticket.create');

  // The organisation comes from the person who wrote in. A channel runs under a
  // system context, which belongs to no organisation, so without this the ticket
  // is created with none — and a ticket with neither a group nor an organisation
  // falls outside every agent's scope and is invisible to the whole service desk.
  const requester = await tx.user.findFirst({ where: { id: input.requesterId } });

  const parsed = createTicketSchema.parse({
    type: 'incident',
    title: input.title.slice(0, 300),
    description: input.description,
    sourceChannel: input.sourceChannel,
    channelRef: input.channelRef,
    requesterId: input.requesterId,
    ...(input.orgId ?? requester?.primaryOrgId ? { orgId: input.orgId ?? requester!.primaryOrgId } : {}),
  });
  return insertTicketOn(ctx, tx, parsed, input.requesterId);
}

export async function addCommentFromChannel(
  ctx: TenantContext,
  tx: Tx,
  ticketId: string,
  input: { body: string; authorId: string; channel: string },
) {
  const ticket = await repo.findById(tx, ticketId);
  if (!ticket) throw new NotFoundError('ticket not found');

  // A reply by email is always public: the sender cannot see the visibility
  // control, so defaulting to internal would silently hide what they wrote,
  // and defaulting an agent's reply to internal would hide it from the person
  // waiting for it.
  authz.require(ctx, 'ticket.comment.public', { aggregate: 'ticket', record: ticket });

  const comment = await repo.insertComment(tx, {
    id: newId(),
    tenantId: ctx.tenantId,
    ticketId: ticket.id,
    authorId: input.authorId,
    authorType: 'user',
    body: input.body,
    bodyFormat: 'text',
    visibility: 'public',
    channel: input.channel,
  } as never);

  await repo.insertTicketEvent(tx, ctx, ticket.id, 'comment.added', {
    commentId: comment.id,
    visibility: 'public',
    channel: input.channel,
  });
  await recordAudit(tx, ctx, {
    action: 'ticket.comment.added',
    targetType: 'ticket',
    targetId: ticket.id,
    after: { commentId: comment.id, visibility: 'public', channel: input.channel },
  });
  await publish(tx, ctx, {
    definition: events.ticketCommentAdded,
    aggregateId: ticket.id,
    payload: {
      ticketId: ticket.id,
      number: ticket.number,
      commentId: comment.id,
      visibility: 'public',
      authorId: input.authorId,
      channel: input.channel,
    },
  });

  return comment;
}

/**
 * Raises a request from a published catalogue item (MOD-05).
 *
 * Separate from `createTicket` because the routing and the priority come from
 * the catalogue rather than from the caller: a requester who could name their
 * own group could route work anywhere, and one who could name their own
 * priority could make everything a P1. This signature has no way to express
 * either, which is the point.
 */
export async function createRequestFromCatalogue(
  ctx: TenantContext,
  tx: Tx,
  input: {
    title: string;
    description: string;
    requesterId: string;
    serviceId: string;
    groupId: string | null;
    priority: string;
    answers: Record<string, unknown>;
  },
): Promise<repo.TicketRow> {
  authz.require(ctx, 'ticket.create');

  const requester = await tx.user.findFirst({ where: { id: input.requesterId } });
  const parsed = createTicketSchema.parse({
    type: 'request',
    title: input.title.slice(0, 300),
    description: input.description,
    sourceChannel: 'portal',
    requesterId: input.requesterId,
    serviceId: input.serviceId,
    priority: input.priority,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(requester?.primaryOrgId ? { orgId: requester.primaryOrgId } : {}),
    // The answers ride on the ticket so the workbench can show them without
    // joining back to the submission.
    custom: input.answers,
  });
  return insertTicketOn(ctx, tx, parsed, input.requesterId, Object.keys(input.answers));
}

// ---------------------------------------------------------------------------
// Migration (MOD-24) and history imports: tickets brought in from somewhere
// else. They live in `import-tickets.ts`; re-exported here so callers keep
// reaching them as `ticketService.importTicket` and the rest.
// ---------------------------------------------------------------------------

export {
  BATCH_AUDIT_MAX,
  IMPORT_CHUNK_MAX,
  importCommentSchema,
  importComments,
  importEventSchema,
  importLinkSchema,
  importLinks,
  importTaskSchema,
  importTicket,
  importTicketSchema,
  importTickets,
  type ImportCommentInput,
  type ImportEventInput,
  type ImportLinkInput,
  type ImportLinksOptions,
  type ImportLinksResult,
  type ImportTaskInput,
  type ImportTicketInput,
  type ImportTicketsOptions,
} from './import-tickets.js';
