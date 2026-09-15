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
 * Two things cannot be read back that way and are handled explicitly: the first
 * response, which is the earliest public reply and so takes the earlier of the
 * two values, and the comment count, which only ever goes up.
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

/** Additions a specific event makes that cannot be read back off the ticket row. */
interface Increments {
  firstResponseAt?: Date;
  commentCount?: number;
  breached?: true;
}

/**
 * Rebuilds one ticket's fact from the ticket row plus whatever the event adds,
 * then moves the rollup by the difference. Every projector below is a call to
 * this with different increments.
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

  // The earlier of the two: a first response is the first one, and a late
  // delivery of the earlier comment must not push the number later.
  const firstResponseAt = earliest(before?.firstResponseAt ?? null, increments.firstResponseAt ?? null);

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
    commentCount: (before?.commentCount ?? 0) + (increments.commentCount ?? 0),
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

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
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

/** A public reply from somebody other than the requester: the response clock stops here. */
export async function isFirstResponse(
  tx: Tx,
  ticketId: string,
  payload: { visibility: string; authorId: string | null },
): Promise<boolean> {
  if (payload.visibility !== 'public') return false;
  const ticket = await tx.ticket.findFirst({ where: { id: ticketId }, select: { requesterId: true } });
  if (!ticket) return false;
  return ticket.requesterId !== payload.authorId;
}
