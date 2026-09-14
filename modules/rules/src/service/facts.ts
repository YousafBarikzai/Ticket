import type { EvalContext } from '@itsm/expr';

/**
 * The facts a rule condition may read.
 *
 * This is a deliberate projection of the ticket, not the row: a rule author
 * should be able to reason about `ticket.priority` without discovering
 * `tenant_id`, and a rule must not be able to read a column that was never meant
 * to be a decision input. Publishing a rule that reads a path not on this list
 * is refused, because such a rule would silently never match.
 *
 * `fields.*` and `answers.*` are open-ended by design — custom fields and form
 * answers are tenant-defined and cannot be enumerated at build time.
 */
export const FACT_PATHS = [
  'ticket.type',
  'ticket.title',
  'ticket.description',
  'ticket.status',
  'ticket.statusCategory',
  'ticket.priority',
  'ticket.impact',
  'ticket.urgency',
  'ticket.sourceChannel',
  'ticket.orgId',
  'ticket.serviceId',
  'ticket.categoryId',
  'ticket.groupId',
  'ticket.assigneeId',
  'ticket.requesterId',
  'ticket.affectedUserId',
  'ticket.reopenCount',
  'ticket.hasAssignee',
  'ticket.hasGroup',
  'ticket.ageMinutes',
  'comment.visibility',
  'comment.authorId',
  'comment.isFromRequester',
  'requester.orgId',
  'requester.locationId',
  'requester.vip',
  'requester.tier',
  'event.type',
] as const;

export interface TicketFacts {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  statusCategory: string;
  priority: string;
  impact: string | null;
  urgency: string | null;
  sourceChannel: string;
  orgId: string | null;
  serviceId: string | null;
  categoryId: string | null;
  groupId: string | null;
  assigneeId: string | null;
  requesterId: string | null;
  affectedUserId: string | null;
  reopenCount: number;
  createdAt: Date;
  custom?: Record<string, unknown> | null;
}

export interface FactOptions {
  event?: string;
  comment?: { visibility: string; authorId: string | null };
  requester?: { orgId: string | null; locationId: string | null; vip: boolean; tier?: string | null } | null;
  /** Fixes "now" so a dry run and a live run of the same rule agree. */
  now?: Date;
}

export function factsForTicket(ticket: TicketFacts, options: FactOptions = {}): EvalContext {
  const now = options.now ?? new Date();
  return {
    ticket: {
      type: ticket.type,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      statusCategory: ticket.statusCategory,
      priority: ticket.priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      sourceChannel: ticket.sourceChannel,
      orgId: ticket.orgId,
      serviceId: ticket.serviceId,
      categoryId: ticket.categoryId,
      groupId: ticket.groupId,
      assigneeId: ticket.assigneeId,
      requesterId: ticket.requesterId,
      affectedUserId: ticket.affectedUserId,
      reopenCount: ticket.reopenCount,
      // Convenience facts: a rule author reaches for "unassigned" far more often
      // than for "assigneeId is null", and the expression language has no
      // is-null operator of its own.
      hasAssignee: ticket.assigneeId !== null,
      hasGroup: ticket.groupId !== null,
      ageMinutes: Math.floor((now.getTime() - new Date(ticket.createdAt).getTime()) / 60_000),
    },
    ...(options.comment
      ? {
          comment: {
            visibility: options.comment.visibility,
            authorId: options.comment.authorId,
            isFromRequester: options.comment.authorId !== null && options.comment.authorId === ticket.requesterId,
          },
        }
      : {}),
    requester: options.requester ?? { orgId: null, locationId: null, vip: false, tier: null },
    fields: (ticket.custom ?? {}) as Record<string, unknown>,
    event: { type: options.event ?? 'unknown' },
  };
}
