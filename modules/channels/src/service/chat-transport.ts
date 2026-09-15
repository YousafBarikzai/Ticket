import type { Channel } from '../domain/commands.js';
import type { VerificationResult } from '../domain/signatures.js';
import type { ChatEvent } from '../domain/chat-guard.js';
import type { ParsedInbound } from './inbound-service.js';

/**
 * What a chat provider has to be able to do.
 *
 * Deliberately the same shape as `EmailTransport` — verify, parse, send —
 * because the inbound path should not be able to tell them apart. The
 * differences that matter are inside the three methods, not in the pipeline
 * around them, which is what "add a channel without touching ticket core"
 * (doc 18 §4) has to mean in practice.
 */

export interface ChatIdentityHint {
  /** The provider's id for the sender: `U0123`, an AAD object id. */
  externalId: string;
  /** What the provider says their email is, when it says anything. */
  email: string | null;
  /** Whether the provider claims to have verified it. */
  emailVerified: boolean;
  displayName: string | null;
}

/** A parsed chat event: an email `ParsedInbound` plus what chat adds. */
export interface ParsedChat extends ParsedInbound {
  chat: ChatEvent;
  identity: ChatIdentityHint;
  /** The provider's thread key, for replying where the person is looking. */
  threadId: string | null;
  /** The room or conversation, needed to post back. */
  roomId: string;
  /** Present when this arrived as a button rather than as a message. */
  action?: unknown;
  /** Present when this arrived as a slash command. */
  slashText?: string;
}

export interface OutboundChat {
  roomId: string;
  threadId: string | null;
  text: string;
  /** Approval buttons, when the message is asking for a decision. */
  actions?: { label: string; value: Record<string, unknown>; style?: 'primary' | 'danger' }[];
}

export interface ChatTransport {
  readonly name: string;
  readonly channel: Channel;
  /**
   * Whether this really came from the provider.
   *
   * Takes the raw body rather than the parsed one, because every provider signs
   * the bytes that arrived and re-serialising changes them.
   */
  verify(input: { rawBody: string; headers: Record<string, string | undefined>; url: string }): VerificationResult;
  parseInbound(body: unknown, headers: Record<string, string | undefined>): ParsedChat | null;
  send(message: OutboundChat): Promise<{ messageId: string | null }>;
}

const transports = new Map<string, ChatTransport>();

export function registerChatTransport(transport: ChatTransport): void {
  transports.set(transport.name, transport);
}

export function chatTransport(name: string): ChatTransport | undefined {
  return transports.get(name);
}

export function registeredChatTransports(): string[] {
  return [...transports.keys()].sort();
}

export function clearChatTransports(): void {
  transports.clear();
}
