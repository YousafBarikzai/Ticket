import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  nextNumber,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import {
  channelSchema,
  events,
  inverseLinkType,
  linkTypeSchema,
  numberPrefix,
  type CanonicalState,
  type TicketType,
} from '@itsm/contracts';
import { STATES, categoryOf } from '../domain/state-machine.js';
import * as repo from '../repo/ticket-repo.js';

// ---------------------------------------------------------------------------
// Imports (MOD-24 migrations, ADR-0036; the demo's history, ADR-0056)
//
// Not `createTicket` with the dates changed. A migrated ticket arrives with
// its history: the status it had, when it was raised and when it was closed,
// the comments that were made on it. And it must not set anything off — an
// SLA clock on a ticket closed in 2021, a "your ticket was raised" email to
// somebody who raised it in another tool, a rule that routes it to a queue.
// So it is inserted as it was and announced as `ticket.imported`, which the
// projections follow and the reactions ignore (ADR-0036).
//
// The shared demo writes four months of a service desk the same way (A4 §2.1
// W3), so the path also takes what a history needs and a migration never had:
// the timeline as it happened, the tasks, the channel each reply came in on,
// and a whole chunk of tickets in one transaction with one audit row.
// ---------------------------------------------------------------------------

export const importCommentSchema = z.object({
  body: z.string().min(1).max(100_000),
  bodyFormat: z.enum(['text', 'html']).default('text'),
  visibility: z.enum(['public', 'internal']).default('public'),
  authorId: z.string().uuid().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  /** The source's own id for the comment, so the same one imported twice is one. */
  externalRef: z.string().max(500).optional(),
  /**
   * Where the reply came in: an e-mail answer reads as one on the timeline.
   * Omitted, `import`, which is what every imported comment said before.
   */
  channel: channelSchema.default('import'),
});
export type ImportCommentInput = z.input<typeof importCommentSchema>;

/**
 * One step of an imported ticket's timeline, written as the `ticket_event` it
 * would have been. `status.changed` steps are what `replayTimers` (MOD-07)
 * reads to rebuild the ticket's SLA clocks, so their `to` must be a state the
 * state machine knows.
 */
export const importEventSchema = z.object({
  type: z.string().min(1).max(60),
  payload: z.record(z.unknown()).default({}),
  /** The person who did it; null or omitted for the system. */
  actorId: z.string().uuid().nullable().optional(),
  occurredAt: z.coerce.date(),
});
export type ImportEventInput = z.input<typeof importEventSchema>;

/** A task on an imported ticket: the fulfilment steps a request had. */
export const importTaskSchema = z.object({
  title: z.string().min(1).max(500),
  assigneeId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  createdAt: z.coerce.date(),
  /** When it was done; omitted or null, it is still open. */
  completedAt: z.coerce.date().nullable().optional(),
});
export type ImportTaskInput = z.input<typeof importTaskSchema>;

export const importTicketSchema = z.object({
  type: z.enum(['incident', 'request', 'problem', 'change', 'task', 'question']).default('incident'),
  title: z.string().min(1).max(500),
  description: z.string().max(100_000).optional(),
  descriptionFormat: z.enum(['text', 'html']).default('text'),
  /** A canonical state; the mapping from the source's words is the caller's. */
  status: z.string().min(1).max(40),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  requesterId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  orgId: z.string().uuid().nullable().optional(),
  /** The source's reference, kept so people can still find "INC0012345". */
  externalRef: z.string().min(1).max(200),
  /**
   * How the requester reached the desk in the source system, when the source
   * says. Any real channel; omitted, the ticket records `import` exactly as
   * every import did before ADR-0056, so a MOD-24 mapping that names no
   * channel is unchanged. Either way the row's `origin` is `import`, which is
   * what keeps it off the ticket meter — so, unlike a creation, an import may
   * name `import` itself: it is only the default said out loud.
   */
  sourceChannel: channelSchema.default('import'),
  /**
   * Who raised it, when that was a person (an agent logging a phone call for
   * somebody). Omitted, the importer, as before.
   */
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable().optional(),
  closedAt: z.coerce.date().nullable().optional(),
  custom: z.record(z.unknown()).default({}),
  comments: z.array(importCommentSchema).max(1000).default([]),
  /**
   * The timeline as it happened, oldest first. When it starts with `created`
   * the ticket reads as raised here, and the `imported` line a migration adds
   * is left out (ADR-0056); otherwise that line is written as before.
   */
  events: z.array(importEventSchema).max(200).optional(),
  tasks: z.array(importTaskSchema).max(20).default([]),
  importJobId: z.string().uuid().nullable().optional(),
});
export type ImportTicketInput = z.input<typeof importTicketSchema>;
type ParsedImport = z.infer<typeof importTicketSchema>;

/** The most tickets one call takes: the audit row names every one of them. */
export const IMPORT_CHUNK_MAX = 200;

/** How many external references one batch audit row lists (A4 §2.9). */
const AUDIT_REFS_MAX = 200;

export interface ImportTicketsOptions {
  /**
   * `row` (the default): one `ticket.imported` audit row per ticket, as every
   * MOD-24 import has written. `batch`: one `ticket.imported.batch` row for
   * the whole call, in the same transaction (D19) — four months of history
   * is a few thousand tickets, and a trail of a few thousand identical rows
   * says less than eighty that each name the fifty tickets they brought in.
   */
  audit?: 'row' | 'batch';
  /** What the batch row calls the chunk, e.g. "demo g42 tickets 0401-0450". */
  label?: string;
  /** The audit rows' reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

const importOptionsSchema = z
  .object({
    audit: z.enum(['row', 'batch']).default('row'),
    label: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

function requireImporter(ctx: TenantContext): void {
  authz.require(ctx, 'ticket.create');
  if (!ctx.permissions.has('ticket.create', 'any')) {
    throw new ForbiddenError('ticket.create', 'importing tickets raised by other people needs tenant-wide permission');
  }
}

/**
 * The checks a history needs that one field cannot make on its own: a step
 * cannot come before the ticket existed, the timeline runs forwards, and a
 * status change names states the SLA replay can follow. Nothing here applies
 * to an import that brings no timeline or tasks, so MOD-24 is unaffected.
 */
function assertHistory(parsed: ParsedImport, prefix: string): void {
  const problems: { field: string; code: string; message: string }[] = [];
  const raised = parsed.createdAt.getTime();

  let previous = raised;
  (parsed.events ?? []).forEach((event, index) => {
    const at = event.occurredAt.getTime();
    if (at < raised) {
      problems.push({ field: `${prefix}events.${index}.occurredAt`, code: 'before_created', message: 'a step cannot happen before the ticket was raised' });
    } else if (at < previous) {
      problems.push({ field: `${prefix}events.${index}.occurredAt`, code: 'out_of_order', message: 'the timeline must run oldest first' });
    }
    previous = Math.max(previous, at);
    if (event.type === 'status.changed') {
      for (const key of ['from', 'to'] as const) {
        const value = event.payload[key];
        if (value === undefined && key === 'from') continue;
        if (typeof value !== 'string' || !(value in STATES)) {
          problems.push({ field: `${prefix}events.${index}.payload.${key}`, code: 'unknown_state', message: `not a ticket state: ${String(value)}` });
        }
      }
    }
  });

  parsed.tasks.forEach((task, index) => {
    if (task.createdAt.getTime() < raised) {
      problems.push({ field: `${prefix}tasks.${index}.createdAt`, code: 'before_created', message: 'a task cannot be added before the ticket was raised' });
    }
    if (task.completedAt && task.completedAt < task.createdAt) {
      problems.push({ field: `${prefix}tasks.${index}.completedAt`, code: 'before_created', message: 'a task cannot be done before it was added' });
    }
  });

  if (problems.length > 0) throw new ValidationError('the imported history does not hold together', problems);
}

async function insertImportedComment(tx: Tx, ctx: TenantContext, ticketId: string, comment: z.infer<typeof importCommentSchema>): Promise<boolean> {
  if (comment.externalRef) {
    const seen = await tx.ticketComment.findFirst({ where: { ticketId, externalRef: comment.externalRef }, select: { id: true } });
    if (seen) return false;
  }
  await repo.insertComment(tx, {
    id: newId(),
    tenantId: ctx.tenantId,
    ticketId,
    authorId: comment.authorId ?? null,
    authorType: comment.authorId ? 'user' : 'system',
    visibility: comment.visibility,
    body: comment.body,
    bodyFormat: comment.bodyFormat,
    channel: comment.channel,
    externalRef: comment.externalRef ?? null,
    ...(comment.createdAt ? { createdAt: comment.createdAt, updatedAt: comment.createdAt } : {}),
    createdBy: ctx.actor.id,
  });
  return true;
}

async function publishImported(tx: Tx, ctx: TenantContext, ticket: repo.TicketRow, externalRef: string | null, commentsAdded: number, importJobId: string | null): Promise<void> {
  await publish(tx, ctx, {
    definition: events.ticketImported,
    aggregateId: ticket.id,
    aggregateVersion: ticket.version,
    payload: {
      ticketId: ticket.id,
      number: ticket.number,
      type: ticket.type,
      status: ticket.status,
      externalRef,
      commentsAdded,
      importJobId,
    },
  });
}

/** The latest of the instants given, ignoring the ones that are not there. */
function latest(first: Date, ...rest: (Date | null | undefined)[]): Date {
  return rest.reduce<Date>((max, value) => (value && value > max ? value : max), first);
}

/** Writes one parsed ticket and everything that came with it, on the caller's transaction. */
async function insertImported(
  tx: Tx,
  ctx: TenantContext,
  parsed: ParsedImport,
  audit: 'row' | 'batch',
  reason: string | null,
): Promise<repo.TicketRow> {
  const status = parsed.status as CanonicalState;
  const type = parsed.type as TicketType;
  const number = await nextNumber(tx, ctx, type, numberPrefix[type]);
  const id = newId();
  const requesterId = parsed.requesterId ?? null;
  const timeline = parsed.events;
  // What a migration has always recorded as last touched; a history that says
  // when its last step was is later still.
  const lastTouched = latest(
    parsed.closedAt ?? parsed.resolvedAt ?? parsed.createdAt,
    ...(timeline ?? []).map((event) => event.occurredAt),
    ...parsed.tasks.flatMap((task) => [task.createdAt, task.completedAt]),
  );
  const createdById = parsed.createdById ?? null;

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
    priority: parsed.priority,
    impact: null,
    urgency: null,
    requesterId,
    affectedUserId: requesterId,
    assigneeId: parsed.assigneeId ?? null,
    groupId: parsed.groupId ?? null,
    serviceId: parsed.serviceId ?? null,
    categoryId: parsed.categoryId ?? null,
    sourceChannel: parsed.sourceChannel,
    // Provenance, not a channel: set here and nowhere else (ADR-0056).
    origin: 'import',
    channelRef: null,
    parentId: null,
    externalRef: parsed.externalRef,
    custom: parsed.custom as never,
    createdAt: parsed.createdAt,
    updatedAt: lastTouched,
    resolvedAt: parsed.resolvedAt ?? null,
    closedAt: parsed.closedAt ?? null,
    createdBy: createdById ?? ctx.actor.id,
    createdByType: createdById ? 'user' : ctx.actor.type,
    updatedBy: ctx.actor.id,
  });

  // A history that starts with its own `created` step reads as a ticket raised
  // here; anything else keeps the line that says where it came from.
  if (timeline?.[0]?.type !== 'created') {
    await repo.insertTicketEvent(tx, ctx, id, 'imported', { number, externalRef: parsed.externalRef, status });
  }
  for (const event of timeline ?? []) {
    await repo.insertTicketEvent(tx, ctx, id, event.type, event.payload, {
      occurredAt: event.occurredAt,
      actor: event.actorId ? { type: 'user', id: event.actorId } : { type: 'system', id: null },
    });
  }

  if (requesterId) {
    await tx.ticketWatcher.create({
      data: { id: newId(), tenantId: ctx.tenantId, ticketId: id, userId: requesterId, reason: 'requester' },
    });
  }

  let commentsAdded = 0;
  for (const comment of parsed.comments) {
    if (await insertImportedComment(tx, ctx, id, comment)) commentsAdded += 1;
  }

  for (const task of parsed.tasks) {
    const done = task.completedAt ?? null;
    await tx.ticketTask.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        ticketId: id,
        title: task.title,
        assigneeId: task.assigneeId ?? null,
        groupId: task.groupId ?? null,
        status: done ? 'done' : 'open',
        completedAt: done,
        createdAt: task.createdAt,
        updatedAt: done ?? task.createdAt,
        createdBy: ctx.actor.id,
      },
    });
  }

  if (audit === 'row') {
    await recordAudit(tx, ctx, {
      action: 'ticket.imported',
      targetType: 'ticket',
      targetId: id,
      after: { number, externalRef: parsed.externalRef, status, priority: parsed.priority, comments: commentsAdded, importJobId: parsed.importJobId ?? null },
      ...(reason ? { reason } : {}),
    });
  }
  await publishImported(tx, ctx, ticket, parsed.externalRef, commentsAdded, parsed.importJobId ?? null);
  return ticket;
}

/** Checks the parsed chunk before anything is written: states, histories, repeats. */
function assertChunk(parsed: ParsedImport[], indexed: boolean): void {
  const seen = new Set<string>();
  parsed.forEach((input, index) => {
    if (!(input.status in STATES)) throw new ValidationError(`unknown ticket status: ${input.status}`);
    assertHistory(input, indexed ? `${index}.` : '');
    if (seen.has(input.externalRef)) {
      throw new ConflictError(`the external reference ${input.externalRef} appears twice in this import`);
    }
    seen.add(input.externalRef);
  });
}

/** One transaction for the chunk: a ticket that is refused takes the rest of the chunk with it. */
async function importParsed(ctx: TenantContext, parsed: ParsedImport[], options: z.infer<typeof importOptionsSchema>): Promise<repo.TicketRow[]> {
  if (parsed.length === 0) return [];
  const reason = options.reason ?? null;

  return transaction(
    ctx,
    async (tx) => {
      const refs = parsed.map((input) => input.externalRef);
      const duplicates = await tx.ticket.findMany({
        where: { externalRef: { in: refs }, deletedAt: null },
        select: { number: true, externalRef: true },
      });
      for (const ref of refs) {
        const duplicate = duplicates.find((row) => row.externalRef === ref);
        if (duplicate) {
          throw new ConflictError(`a ticket with the external reference ${ref} already exists (${duplicate.number})`);
        }
      }

      const tickets: repo.TicketRow[] = [];
      for (const input of parsed) tickets.push(await insertImported(tx, ctx, input, options.audit, reason));

      if (options.audit === 'batch') {
        // One row for the chunk, naming every ticket in it (A4 §2.9). The
        // job id is the chunk's when every ticket shares it.
        const jobs = new Set(parsed.map((input) => input.importJobId ?? null));
        await recordAudit(tx, ctx, {
          action: 'ticket.imported.batch',
          targetType: 'import_batch',
          targetId: newId(),
          after: {
            label: options.label ?? null,
            count: tickets.length,
            first: tickets[0]!.number,
            last: tickets.at(-1)!.number,
            externalRefs: refs.slice(0, AUDIT_REFS_MAX),
            importJobId: jobs.size === 1 ? [...jobs][0]! : null,
          },
          ...(reason ? { reason } : {}),
        });
      }
      return tickets;
    },
    // Fifty tickets with their comments and timelines are a few thousand
    // statements; one ticket keeps the default every other write has.
    parsed.length > 1 ? { timeout: Math.min(120_000, 15_000 + parsed.length * 1_000) } : {},
  );
}

/**
 * Imports a chunk of tickets in one transaction (A4 §2.3): each as it was,
 * with its comments, timeline and tasks, numbered in order, and announced as
 * `ticket.imported` so the projections follow. Every row's `origin` is
 * `import`. Returns the tickets in the order given.
 *
 * Nothing that a creation sets off happens here: no SLA clock (the demo's
 * history gets its clocks from `replayTimers`), no rule, no notification.
 */
export async function importTickets(ctx: TenantContext, inputs: ImportTicketInput[], options: ImportTicketsOptions = {}): Promise<repo.TicketRow[]> {
  const parsed = z.array(importTicketSchema).max(IMPORT_CHUNK_MAX).parse(inputs);
  const settings = importOptionsSchema.parse(options);
  requireImporter(ctx);
  assertChunk(parsed, true);
  return importParsed(ctx, parsed, settings);
}

/**
 * Inserts a ticket as it was elsewhere, with its comments, in one transaction.
 * The chunk of one, audited row by row, exactly as MOD-24 has always had it.
 */
export async function importTicket(ctx: TenantContext, input: ImportTicketInput): Promise<repo.TicketRow> {
  const parsed = importTicketSchema.parse(input);
  requireImporter(ctx);
  assertChunk([parsed], false);
  const [ticket] = await importParsed(ctx, [parsed], { audit: 'row' });
  return ticket!;
}

/**
 * Adds comments to a ticket that was imported earlier, for sources that keep
 * the conversation in a separate export. One event for the lot, so the
 * projections refresh once rather than once per line.
 */
export async function importComments(
  ctx: TenantContext,
  ticketId: string,
  comments: ImportCommentInput[],
  importJobId: string | null = null,
): Promise<{ added: number }> {
  requireImporter(ctx);
  const parsed = comments.map((comment) => importCommentSchema.parse(comment));
  return transaction(ctx, async (tx) => {
    const ticket = await repo.findByIdOrNumber(tx, ticketId);
    if (!ticket) throw new NotFoundError('ticket', ticketId);
    let added = 0;
    for (const comment of parsed) {
      if (await insertImportedComment(tx, ctx, ticket.id, comment)) added += 1;
    }
    if (added > 0) {
      const row = await tx.ticket.findFirst({ where: { id: ticket.id }, select: { externalRef: true } });
      await recordAudit(tx, ctx, { action: 'ticket.comments.imported', targetType: 'ticket', targetId: ticket.id, after: { added, importJobId } });
      await publishImported(tx, ctx, ticket, row?.externalRef ?? null, added, importJobId);
    }
    return { added };
  });
}

// ---------------------------------------------------------------------------
// Links between imported tickets
// ---------------------------------------------------------------------------

export const importLinkSchema = z.object({
  /** The ticket the relationship is read from, by id or number. */
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  linkType: linkTypeSchema,
  /** When the two were linked. */
  at: z.coerce.date(),
});
export type ImportLinkInput = z.input<typeof importLinkSchema>;

export interface ImportLinksOptions {
  /** What the audit row calls the call, e.g. "demo g42 links". */
  label?: string;
  reason?: string;
}

export interface ImportLinksResult {
  /** Relationships written (each stored from both ends, as `linkTickets` stores it). */
  added: number;
  /** Relationships that were already there. */
  skipped: number;
}

/**
 * Links imported tickets as they were linked at the time (A4 §2.3): incidents
 * to the major incident they were part of, to the problem behind them, and the
 * story's tickets to one another.
 *
 * The rows are those `linkTickets` writes — both ends, the inverse type, a
 * `linked` line on the source's timeline — dated `at`. Like every import it
 * sets nothing off: no `ticket.linked` event, so no webhook tells a
 * subscriber about a link made months ago. One audit row for the call. A
 * relationship already there is skipped, so a retried chunk is harmless.
 */
export async function importLinks(ctx: TenantContext, links: ImportLinkInput[], options: ImportLinksOptions = {}): Promise<ImportLinksResult> {
  const parsed = z.array(importLinkSchema).max(1000).parse(links);
  const settings = z.object({ label: z.string().min(1).max(200).optional(), reason: z.string().min(1).max(500).optional() }).strict().parse(options);
  requireImporter(ctx);
  if (parsed.length === 0) return { added: 0, skipped: 0 };

  return transaction(
    ctx,
    async (tx) => {
      let added = 0;
      let skipped = 0;
      const pairs: { from: string; to: string; linkType: string }[] = [];

      for (const [index, link] of parsed.entries()) {
        const source = await repo.findByIdOrNumber(tx, link.from);
        if (!source) throw new NotFoundError('ticket', link.from);
        const target = await repo.findByIdOrNumber(tx, link.to);
        if (!target) throw new NotFoundError('ticket', link.to);
        if (source.id === target.id) throw new ValidationError('a ticket cannot be linked to itself');
        if (link.at < source.createdAt || link.at < target.createdAt) {
          throw new ValidationError('a link cannot be made before both tickets were raised', [
            { field: `${index}.at`, code: 'before_created', message: 'a link cannot be made before both tickets were raised' },
          ]);
        }

        const existing = await tx.ticketLink.findFirst({ where: { sourceId: source.id, targetId: target.id, linkType: link.linkType } });
        if (existing) {
          skipped += 1;
          continue;
        }
        for (const [from, to, linkType] of [
          [source.id, target.id, link.linkType],
          [target.id, source.id, inverseLinkType[link.linkType]],
        ] as const) {
          await tx.ticketLink.create({
            data: { id: newId(), tenantId: ctx.tenantId, sourceId: from, targetId: to, linkType, createdAt: link.at, createdBy: ctx.actor.id },
          });
        }
        await repo.insertTicketEvent(
          tx,
          ctx,
          source.id,
          'linked',
          { targetId: target.id, targetNumber: target.number, linkType: link.linkType },
          { occurredAt: link.at },
        );
        added += 1;
        if (pairs.length < AUDIT_REFS_MAX) pairs.push({ from: source.number, to: target.number, linkType: link.linkType });
      }

      if (added > 0) {
        await recordAudit(tx, ctx, {
          action: 'ticket.links.imported.batch',
          targetType: 'import_batch',
          targetId: newId(),
          after: { label: settings.label ?? null, count: added, skipped, links: pairs },
          ...(settings.reason ? { reason: settings.reason } : {}),
        });
      }
      return { added, skipped };
    },
    parsed.length > 50 ? { timeout: 60_000 } : {},
  );
}
