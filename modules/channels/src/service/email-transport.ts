import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@itsm/platform';
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
 * Verifies an HMAC signature in constant time.
 *
 * Shared rather than written per provider, because a signature comparison with
 * `===` leaks its answer through timing, and that is exactly the sort of detail
 * each new adapter would otherwise get slightly wrong on its own.
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
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
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
