import type { EventEnvelope } from '@itsm/contracts';
import { type TenantContext, type Tx, logger, metrics } from '@itsm/platform';
import { TWENTY_FOUR_SEVEN, type BusinessCalendar } from '@itsm/business-time';
import { timerService } from '@itsm/module-sla';
import { dateKey, durationsBetween } from '../domain/durations.js';
import { rollupDiff, type TicketFactShape } from '../domain/rollup.js';
import * as facts from '../repo/fact-repo.js';
import * as dims from '../repo/dimension-repo.js';
import * as rollups from '../repo/rollup-repo.js';

/**
 * The ticket projector.
 *
 * Every handler here follows the same three steps: read the fact as it stands,
 * work out what it should now say, write it and move the rollup by the
 * difference. The middle step reads the ticket row rather than replaying the
 * event payload, and that is the decision worth explaining.
 *
 * Event delivery is at-least-once and unordered: two workers can run a status
 * change and an assignment for the same ticket at the same time, in either
 * order. A projector that applied "status became resolved" from the payload
 * would therefore produce a different answer depending on which finished last.
 * Reading the row makes every projection converge on the same state no matter
 * what order the events arrive in — the event says *look again*, the row says
 * *at what*.
 *
 * Nothing is carried from one event to the next. The comment count and the
 * first response are read from `ticket_comment` in the same way, rather than
 * accumulated from `ticket.comment.added` as they were first written: an
 * accumulated count doubles on a replay, and a projection that cannot be
 * replayed cannot be rebuilt. Reading them back costs one indexed query and
 * makes the projector a pure function of the source rows.
 */

const PROJECTOR = 'ticket';

interface TicketSource {
  id: string;
  number: string;
  type: string;
  status: string;
  priority: string;
  serviceId: string | null;
  categoryId: string | null;
  groupId: string | null;
  assigneeId: string | null;
  requesterId: string | null;
  sourceChannel: string;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenCount: number;
}

async function loadTicket(tx: Tx, ticketId: string): Promise<TicketSource | null> {
  return tx.ticket.findFirst({
    where: { id: ticketId },
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      priority: true,
      serviceId: true,
      categoryId: true,
      groupId: true,
      assigneeId: true,
      requesterId: true,
      sourceChannel: true,
      createdAt: true,
      resolvedAt: true,
      closedAt: true,
      reopenCount: true,
    },
  }) as Promise<TicketSource | null>;
}

/**
 * The calendar this module measures against: the assigned team's, else 24/7.
 *
 * Deliberately not the SLA policy's calendar. "How long does this team take"
 * is a question about the team's working day, and a ticket that has moved
 * between two policies would otherwise be measured against whichever one it
 * ended on. SLA attainment is a different question with a different answer, and
 * it lives in `fact_sla_timer` where the policy's own calendar applies.
 */
async function calendarFor(tx: Tx, teamId: string | null): Promise<BusinessCalendar> {
  if (!teamId) return TWENTY_FOUR_SEVEN;
  const team = await tx.team.findFirst({ where: { id: teamId }, select: { calendarId: true } });
  if (!team?.calendarId) return TWENTY_FOUR_SEVEN;
  return timerService.loadCalendar(tx, team.calendarId);
}

function shapeOf(row: TicketFactShape | null): TicketFactShape | null {
  if (!row) return null;
  return {
    teamId: row.teamId,
    serviceId: row.serviceId,
    priority: row.priority,
    createdDate: row.createdDate,
    firstResponseAt: row.firstResponseAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    timeToFirstResponseMinutes: row.timeToFirstResponseMinutes,
    timeToResolveMinutes: row.timeToResolveMinutes,
    reopenCount: row.reopenCount,
    breached: row.breached,
  };
}

/**
 * The two comment-derived facts, read from the comments themselves.
 *
 * The first response is the earliest public reply from somebody other than
 * the requester — the same rule MOD-07 uses to stop the response clock, so the
 * two modules cannot disagree about when a ticket was answered.
 */
async function commentFacts(tx: Tx, ticket: TicketSource): Promise<{ commentCount: number; firstResponseAt: Date | null }> {
  const commentCount = await tx.ticketComment.count({ where: { ticketId: ticket.id, deletedAt: null } });
  const first = await tx.ticketComment.findFirst({
    where: {
      ticketId: ticket.id,
      deletedAt: null,
      visibility: 'public',
      ...(ticket.requesterId ? { OR: [{ authorId: { not: ticket.requesterId } }, { authorId: null }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return { commentCount, firstResponseAt: first?.createdAt ?? null };
}

/** What an event can add that no source row records. */
interface Increments {
  breached?: true;
}

/**
 * Rebuilds one ticket's fact from the source rows, then moves the rollup by
 * the difference. Every projector below is a call to this.
 */
export async function refreshTicketFact(
  ctx: TenantContext,
  tx: Tx,
  event: EventEnvelope,
  ticketId: string,
  increments: Increments = {},
): Promise<void> {
  const ticket = await loadTicket(tx, ticketId);
  if (!ticket) {
    // A ticket that has been hard-deleted, or an event for a tenant whose data
    // has gone. Nothing to project, and nothing to alarm about.
    logger.debug('ticket for projection no longer exists', { ticketId, type: event.type });
    return;
  }

  const before = await facts.findTicketFact(tx, ticketId);
  const occurredAt = new Date(event.occurredAt);

  await dims.ensureTeam(tx, ctx.tenantId, ticket.groupId);
  await dims.ensureService(tx, ctx.tenantId, ticket.serviceId);
  await dims.ensureCategory(tx, ctx.tenantId, ticket.categoryId);
  await dims.ensureChannel(tx, ctx.tenantId, ticket.sourceChannel);
  await dims.ensureUser(tx, ctx.tenantId, ticket.assigneeId, occurredAt);
  await dims.ensureUser(tx, ctx.tenantId, ticket.requesterId, occurredAt);

  const calendar = await calendarFor(tx, ticket.groupId);
  const { commentCount, firstResponseAt } = await commentFacts(tx, ticket);

  const resolutions = ticket.resolvedAt ? durationsBetween(ticket.createdAt, ticket.resolvedAt, calendar) : null;
  const response = firstResponseAt ? durationsBetween(ticket.createdAt, firstResponseAt, calendar) : null;

  const after: Omit<facts.FactTicketRow, 'id'> & { id?: string } = {
    ...(before ? { id: before.id } : {}),
    ticketId: ticket.id,
    number: ticket.number,
    type: ticket.type,
    priority: ticket.priority,
    status: ticket.status,
    serviceId: ticket.serviceId,
    categoryId: ticket.categoryId,
    teamId: ticket.groupId,
    assigneeId: ticket.assigneeId,
    requesterId: ticket.requesterId,
    channel: ticket.sourceChannel,
    createdDate: dateKey(ticket.createdAt),
    createdAt: ticket.createdAt,
    firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    timeToFirstResponseMinutes: response ? response.businessMinutes : null,
    timeToResolveMinutes: resolutions ? resolutions.businessMinutes : null,
    elapsedToResolveMinutes: resolutions ? resolutions.elapsedMinutes : null,
    reopenCount: ticket.reopenCount,
    commentCount,
    breached: (before?.breached ?? false) || increments.breached === true,
    lastEventId: event.id,
    lastEventAt: laterOf(before?.lastEventAt ?? null, occurredAt),
  };

  await dims.ensureDate(tx, after.createdDate);
  await facts.writeTicketFact(tx, ctx.tenantId, after);
  await rollups.applyEntries(tx, ctx.tenantId, rollupDiff(shapeOf(before), shapeOf(after)));
  await facts.advanceCursor(tx, ctx.tenantId, PROJECTOR, event.id, occurredAt);

  metrics.increment('analytics_facts_projected_total', { projector: PROJECTOR });
}

function laterOf(a: Date | null, b: Date): Date {
  return a && a > b ? a : b;
}

/**
 * Marks a ticket as having breached, called by the SLA projector.
 *
 * Separate from `refreshTicketFact` because the breach is a fact about a timer,
 * not about the ticket row: nothing on `ticket` records that a target was
 * missed, so there is nothing to read back and the flag has to be set by the
 * event that knows.
 */
export async function markBreached(ctx: TenantContext, tx: Tx, event: EventEnvelope, ticketId: string): Promise<void> {
  const before = await facts.findTicketFact(tx, ticketId);
  if (before?.breached) return;
  await refreshTicketFact(ctx, tx, event, ticketId, { breached: true });
}
