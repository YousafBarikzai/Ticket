import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Canonical ticket states and categories (specification §5.3). Tenants may
 * configure their own states, but every configured state maps onto one of these
 * canonical states so SLA timers, reporting and channel adapters behave the same
 * everywhere.
 */
export const canonicalStateSchema = z.enum([
  'new',
  'in_progress',
  'pending_requester',
  'pending_third_party',
  'pending_approval',
  'resolved',
  'reopened',
  'closed',
  'cancelled',
]);
export type CanonicalState = z.infer<typeof canonicalStateSchema>;

export const statusCategorySchema = z.enum(['open', 'paused', 'resolved', 'closed']);
export type StatusCategory = z.infer<typeof statusCategorySchema>;

export const ticketTypeSchema = z.enum(['incident', 'request', 'problem', 'change', 'task', 'question']);
export type TicketType = z.infer<typeof ticketTypeSchema>;

export const prioritySchema = z.enum(['P1', 'P2', 'P3', 'P4']);
export type Priority = z.infer<typeof prioritySchema>;

export const impactUrgencySchema = z.enum(['high', 'medium', 'low']);

export const channelSchema = z.enum(['portal', 'email', 'api', 'slack', 'teams', 'whatsapp', 'voice', 'mobile', 'import', 'system']);
export type Channel = z.infer<typeof channelSchema>;

export const commentVisibilitySchema = z.enum(['public', 'internal']);

/** The number prefix used per ticket type, e.g. INC-000123. */
export const numberPrefix: Record<TicketType, string> = {
  incident: 'INC',
  request: 'REQ',
  problem: 'PRB',
  change: 'CHG',
  task: 'TSK',
  question: 'QNA',
};

export const ticketSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  type: ticketTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  statusCategory: statusCategorySchema,
  priority: prioritySchema,
  impact: impactUrgencySchema.nullable(),
  urgency: impactUrgencySchema.nullable(),
  requesterId: uuidSchema.nullable(),
  affectedUserId: uuidSchema.nullable(),
  assigneeId: uuidSchema.nullable(),
  groupId: uuidSchema.nullable(),
  serviceId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  orgId: uuidSchema.nullable(),
  sourceChannel: channelSchema,
  parentId: uuidSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  reopenCount: z.number().int(),
  custom: z.record(z.unknown()),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketCommentSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  authorId: uuidSchema.nullable(),
  visibility: commentVisibilitySchema,
  body: z.string(),
  bodyFormat: z.enum(['text', 'html']),
  channel: channelSchema,
  createdAt: isoDateTimeSchema,
  editedAt: isoDateTimeSchema.nullable(),
});
export type TicketComment = z.infer<typeof ticketCommentSchema>;

export const ticketEventSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  type: z.string(),
  actorType: z.string(),
  actorId: uuidSchema.nullable(),
  payload: z.record(z.unknown()),
  occurredAt: isoDateTimeSchema,
});

export const timelineEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment'), at: isoDateTimeSchema, comment: ticketCommentSchema }),
  z.object({ kind: z.literal('event'), at: isoDateTimeSchema, event: ticketEventSchema }),
  z.object({
    kind: z.literal('task'),
    at: isoDateTimeSchema,
    task: z.object({ id: uuidSchema, title: z.string(), status: z.string(), assigneeId: uuidSchema.nullable() }),
  }),
]);
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const linkTypeSchema = z.enum(['parent_of', 'child_of', 'duplicate_of', 'related_to', 'caused_by', 'blocks', 'affects']);
export type LinkType = z.infer<typeof linkTypeSchema>;

/** Inverse of each link type, so both records show the relationship correctly. */
export const inverseLinkType: Record<LinkType, LinkType> = {
  parent_of: 'child_of',
  child_of: 'parent_of',
  duplicate_of: 'duplicate_of',
  related_to: 'related_to',
  caused_by: 'blocks',
  blocks: 'caused_by',
  affects: 'affects',
};
