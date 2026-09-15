import { logger } from '@itsm/platform';
import { verifyTwilioSignature } from '../domain/signatures.js';
import type { ChatTransport, OutboundChat, ParsedChat } from './chat-transport.js';

/**
 * Voice: a call that has already happened.
 *
 * **What this is not**, said first because the gap is the important part. It is
 * not call control: no IVR, no menu, no transfer, no hold music. Those need a
 * live media session and a state machine driven by a provider's markup while
 * somebody is on the line, and none of it can be exercised against anything in
 * this repository — the same reasoning that kept an unverifiable AWS signer out
 * of MOD-10-E2 (ADR-0029).
 *
 * **What it is**: the call-completed webhook every telephony provider sends
 * afterwards, carrying the caller's number, the recording, and a transcript.
 * That is enough for the thing a service desk actually wants from voice — the
 * call becomes a ticket, with what was said in it, attributed to whoever rang —
 * and it is fully verifiable, because a signature over a form body is a
 * signature over a form body whether or not a phone was involved.
 *
 * The transcript is the body. It is somebody else's speech recognition and it
 * will be wrong sometimes, so it is recorded as a transcript rather than as the
 * caller's words: the recording URL travels with it, and an agent who needs the
 * real thing can listen.
 */

export interface VoiceOptions {
  /** The provider auth token the signature is keyed with. */
  authTokenRef: string;
  /** The public URL this webhook is reached on; Twilio signs it. */
  webhookUrl: string;
}

function secretEnvName(ref: string): string {
  return `ITSM_CREDENTIAL_${ref.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Builds the ticket body from what the provider sent.
 *
 * Pure, and separate from the transport, because how a call is written down is
 * a product decision somebody will want to change without touching signature
 * verification.
 */
export function transcriptBody(input: {
  transcript: string | null;
  recordingUrl: string | null;
  durationSeconds: number | null;
}): string {
  const lines: string[] = [];
  if (input.transcript) {
    // Named as a transcript, not quoted as speech: it is somebody else's speech
    // recognition and it will sometimes be wrong, and an agent acting on a
    // misheard account number has been misled by the platform.
    lines.push(`Transcript of the call, as the telephony provider heard it:\n\n${input.transcript}`);
  } else {
    lines.push('The call was not transcribed.');
  }
  if (input.durationSeconds !== null) lines.push(`\nDuration: ${input.durationSeconds}s.`);
  if (input.recordingUrl) lines.push(`\nRecording: ${input.recordingUrl}`);
  return lines.join('\n');
}

export function voiceTransport(options: VoiceOptions): ChatTransport {
  return {
    name: 'voice',
    channel: 'voice',

    verify(input) {
      // Twilio posts form-encoded and signs the URL with the parameters
      // appended in key order, so the parsed body is what gets signed here
      // rather than the raw string.
      let params: Record<string, string> = {};
      try {
        params = Object.fromEntries(new URLSearchParams(input.rawBody));
      } catch {
        return { ok: false, failure: 'bad_signature' };
      }

      return verifyTwilioSignature({
        // The configured URL, not the one the request claims: a host header is
        // attacker-controlled, and signing against it would let somebody choose
        // the string being verified.
        url: options.webhookUrl,
        params,
        signature: input.headers['x-twilio-signature'],
        authToken: process.env[secretEnvName(options.authTokenRef)],
      });
    },

    parseInbound(body): ParsedChat | null {
      const payload = (body ?? {}) as Record<string, string>;
      const callSid = textOf(payload.CallSid);
      const from = textOf(payload.From);
      if (!callSid || !from) return null;

      // A call still in progress is not a call to write down. Only the
      // completed event becomes a ticket, so one call is one ticket rather than
      // one per status change.
      const status = textOf(payload.CallStatus);
      if (status && status !== 'completed') return null;

      const duration = Number(payload.CallDuration);
      const text = transcriptBody({
        transcript: textOf(payload.TranscriptionText),
        recordingUrl: textOf(payload.RecordingUrl),
        durationSeconds: Number.isFinite(duration) ? duration : null,
      });

      return {
        channel: 'voice',
        externalMessageId: callSid,
        fromAddress: from,
        subject: `Call from ${from}`,
        body: text,
        headers: {},
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        raw: payload,
        chat: {
          senderId: from,
          text,
          subtype: null,
          botId: null,
          // Somebody rang the service desk. There is no more direct form of
          // being addressed.
          direct: true,
          mentioned: true,
          sizeBytes: Buffer.byteLength(text, 'utf8'),
        },
        identity: {
          externalId: from,
          email: null,
          // Caller ID is spoofable and the provider does not vouch for it, so a
          // voice identity is always linked by code or by an administrator.
          emailVerified: false,
          displayName: textOf(payload.CallerName),
        },
        threadId: callSid,
        roomId: from,
      };
    },

    async send(_message: OutboundChat) {
      // Deliberately nothing. Calling somebody back is a decision a person
      // makes, not a side effect of a ticket update, and an automated outbound
      // call is a different product with different regulations attached.
      logger.info('a voice conversation does not take automated replies; the update went to the other channels');
      return { messageId: null };
    },
  };
}
