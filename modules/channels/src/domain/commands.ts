import { z } from 'zod';

/**
 * The closed set of things a channel may ask the platform to do
 * (docs/architecture/07 §5).
 *
 * Closed for the same reason the rules engine's action set is: a channel
 * message comes from outside, and an envelope is trivially forged. An adapter
 * that could express anything would be an unauthenticated API. These six are
 * what a conversation can legitimately mean, and each is carried out by the
 * same service the HTTP API uses, under a real TenantContext.
 */

export const CHANNELS = ['email', 'slack', 'teams', 'whatsapp', 'voice'] as const;
export type Channel = (typeof CHANNELS)[number];

export const channelCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('createTicket'), subject: z.string().min(1).max(300), body: z.string().max(100_000) }),
  z.object({ kind: z.literal('addComment'), ticketRef: z.string().min(1), body: z.string().max(100_000) }),
  z.object({ kind: z.literal('getStatus'), ticketRef: z.string().min(1) }),
  z.object({ kind: z.literal('decideApproval'), approvalId: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }),
  z.object({ kind: z.literal('linkIdentity'), code: z.string().min(4).max(12).optional() }),
  z.object({ kind: z.literal('handoff'), reason: z.string().max(200).optional() }),
]);
export type ChannelCommand = z.infer<typeof channelCommandSchema>;

/**
 * What an unverified sender may do.
 *
 * Only ask to be linked. Everything else needs a verified identity, because
 * "what is the status of REQ-000123" from a forged address is a data leak, and
 * "add a comment" from one is a way to put words in someone's mouth.
 */
export const UNVERIFIED_COMMANDS: ReadonlySet<ChannelCommand['kind']> = new Set(['linkIdentity']);

export function requiresVerifiedIdentity(command: ChannelCommand): boolean {
  return !UNVERIFIED_COMMANDS.has(command.kind);
}

/**
 * Reasons a message is dropped before it becomes a command.
 *
 * Each exists because of a specific way an inbound mailbox goes wrong, and
 * naming them separately is what makes the health dashboard useful: "37
 * rejected" tells nobody anything, "37 auto-replies" tells them a holiday
 * responder is in a loop with the service desk.
 */
export const REJECTION_REASONS = [
  'duplicate',
  'auto_reply',
  'loop_detected',
  'rate_limited',
  'too_large',
  'unknown_account',
  'unverified_sender',
  'empty',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
