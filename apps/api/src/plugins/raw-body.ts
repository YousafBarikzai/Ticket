import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Keeps the bytes that actually arrived, alongside the parsed body.
 *
 * Every webhook signature in the platform is computed over the raw request
 * body. Fastify parses JSON and hands back an object, and the tempting
 * reconstruction — `JSON.stringify(request.body)` — does not reproduce what was
 * sent: whitespace is gone, and a payload with numeric-looking keys comes back
 * reordered. The signature then never matches, which reads as "the provider is
 * broken" rather than as "we are checking the wrong bytes", and the usual
 * resolution is that somebody turns verification off.
 *
 * It had not bitten yet only because the two mail transports authenticate with
 * a shared-secret header rather than a body HMAC. Slack, Teams, Meta and Twilio
 * all sign the body, so this has to exist before any of them can be trusted.
 *
 * Form-encoded bodies get the same treatment: Slack sends slash commands and
 * Twilio sends call events that way, and both sign the raw form string.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Exactly what arrived, for signature verification. */
    rawBody?: string;
  }
}

/** Bodies larger than this are not worth holding twice. */
const MAX_RAW_BYTES = 1024 * 1024;

function remember(request: FastifyRequest, body: string): void {
  if (Buffer.byteLength(body, 'utf8') <= MAX_RAW_BYTES) request.rawBody = body;
}

export const rawBodyPlugin = fp(async (app: FastifyInstance) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    remember(request, text);
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    remember(request, text);
    const parsed: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(text)) parsed[key] = value;
    done(null, parsed);
  });
});
