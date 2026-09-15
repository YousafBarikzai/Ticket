import { createHmac } from 'node:crypto';
import { logger } from '@itsm/platform';
import { constantTimeEquals, timingSafeCompare } from '../domain/signatures.js';
import type { ParsedInbound } from './inbound-service.js';

/**
 * The email transport interface (docs/architecture/07 §6, OD-03).
 *
 * One interface, several providers. Postmark is the recommended default and
 * Microsoft Graph the second adapter, for tenants whose DPIA will not accept
 * mail being processed in the United States. Per-tenant selection arrives in
 * PH-3; what matters now is that the choice is an implementation of this
 * interface rather than a rewrite of the inbound path.
 *
 * OD-03 is still open, so the only transport registered by default is the
 * development one below. That is deliberate: a half-configured provider that
 * silently drops mail is worse than no provider at all.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  /** Threading headers the platform stamps so its own replies thread. */
  headers: Record<string, string>;
}

export interface ProviderRef {
  messageId: string;
  providerId: string | null;
}

export interface EmailTransport {
  readonly name: string;
  sendMessage(message: OutboundEmail): Promise<ProviderRef>;
  /** Turns a provider webhook body into the shape the inbound path expects. */
  parseInbound(body: unknown, headers: Record<string, string | undefined>): ParsedInbound | null;
  /** Whether this delivery really came from the provider. */
  verify(rawBody: string, headers: Record<string, string | undefined>): boolean;
}

/**
 * Verifies a plain HMAC-over-the-body signature, as the mail providers use.
 *
 * The chat providers each sign something more elaborate — Slack a timestamped
 * base string, Twilio the URL and its parameters — so their constructions live
 * in `domain/signatures.ts`. The constant-time comparison is shared with them,
 * because a comparison is the one part that must not be written twice.
 */
export function verifyHmac(rawBody: string, signature: string, secret: string, algorithm = 'sha256'): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac(algorithm, secret).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature.replace(/^sha\d+=/, ''), signature.includes('=') ? 'base64' : 'hex');
  } catch {
    return false;
  }
  return timingSafeCompare(provided, expected);
}

/**
 * The development transport.
 *
 * Writes what it would have sent to the log and accepts a plain JSON body as
 * inbound, so the whole path — webhook, threading, identity, ticket — can be
 * exercised locally and in tests without a provider account. It refuses to
 * verify anything, so it can never be mistaken for a production transport.
 */
export function developmentTransport(): EmailTransport {
  return {
    name: 'development',

    async sendMessage(message) {
      logger.info('email (development transport)', {
        to: message.to,
        subject: message.subject,
        messageId: message.headers['Message-ID'],
      });
      return { messageId: message.headers['Message-ID'] ?? '', providerId: null };
    },

    parseInbound(body) {
      const payload = body as Record<string, unknown>;
      const from = typeof payload.from === 'string' ? payload.from : null;
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : null;
      if (!from || !messageId) return null;

      const headers = (payload.headers ?? {}) as Record<string, string | undefined>;
      const text = typeof payload.text === 'string' ? payload.text : '';
      return {
        channel: 'email',
        externalMessageId: messageId,
        fromAddress: from,
        subject: typeof payload.subject === 'string' ? payload.subject : null,
        body: text,
        headers,
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        raw: payload,
      };
    },

    verify() {
      // Never trusted as a real signature check: in development the webhook is
      // reachable only from the local machine, and in production a real
      // transport is required.
      return process.env.NODE_ENV !== 'production';
    },
  };
}

// Re-exported so the transports that already import it from here keep working.
// The implementation is in `domain/signatures.ts`, which is the one place in
// this module that compares a secret.
export { constantTimeEquals };

const transports = new Map<string, EmailTransport>();

export function registerEmailTransport(transport: EmailTransport): void {
  transports.set(transport.name, transport);
}

export function emailTransport(name: string): EmailTransport | undefined {
  return transports.get(name);
}

export function registeredEmailTransports(): string[] {
  return [...transports.keys()].sort();
}
