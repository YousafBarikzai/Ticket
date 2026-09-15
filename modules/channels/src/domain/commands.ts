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
  /**
   * A button or a reply that belongs to another module — a survey rating, say.
   * The name selects a handler that module registered; the data is whatever the
   * platform put in the button, coming back as untrusted input. The handler
   * decides who may answer, because only it knows what the answer means.
   */
  z.object({ kind: z.literal('custom'), name: z.string().min(1).max(40), data: z.record(z.unknown()) }),
]);
export type ChannelCommand = z.infer<typeof channelCommandSchema>;

/**
 * What an unverified sender may do.
 *
 * Only ask to be linked. Everything else needs a verified identity, because
 * "what is the status of REQ-000123" from a forged address is a data leak, and
 * "add a comment" from one is a way to put words in someone's mouth.
 */
export const UNVERIFIED_COMMANDS: ReadonlySet<ChannelCommand['kind']> = new Set(['linkIdentity', 'custom']);

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
  // Chat channels. `loop_detected` is still our own bot hearing itself;
  // `bot_message` is somebody else's integration posting, which is ordinary
  // rather than a fault. `not_addressed` is the commonest of all — a busy
  // channel the desk was invited to — and counting it separately is what keeps
  // it from swamping the number that matters.
  'bot_message',
  'not_addressed',
  'unsupported_event',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
