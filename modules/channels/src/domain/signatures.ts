import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Proving an inbound webhook came from the provider it claims to.
 *
 * This is the whole security boundary for a chat channel. An email adapter can
 * at least fall back on the sending domain; a chat webhook is a public URL that
 * accepts JSON, so without a signature check "a message from the CFO asking for
 * the status of every ticket" is a `curl` command. Everything downstream — the
 * identity policy, the closed command set — assumes the envelope is genuine,
 * and that assumption is bought here or not at all.
 *
 * Two properties matter beyond computing the HMAC correctly:
 *
 *   - **Compare in constant time.** A byte-by-byte comparison that returns early
 *     leaks the signature one byte at a time to anybody willing to time it.
 *   - **Bound the timestamp.** A signature is valid for ever once seen, so a
 *     replayed request is a genuine request unless the age is checked. Five
 *     minutes is Slack's own recommendation and is generous for a webhook.
 */

export type VerificationFailure =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'not_configured';

export interface VerificationResult {
  ok: boolean;
  failure?: VerificationFailure;
  detail?: string;
}

/** Five minutes, in seconds. */
export const MAX_SIGNATURE_AGE_SECONDS = 300;

/**
 * Constant-time comparison, and the only one in this module.
 *
 * `===` on a signature returns as soon as two bytes differ, which leaks the
 * expected value one byte at a time to anybody willing to time the responses.
 * It lives here rather than in each verifier because that is exactly the detail
 * every new adapter would get slightly wrong on its own.
 */
export function timingSafeCompare(a: Buffer, b: Buffer): boolean {
  // `timingSafeEqual` throws on a length mismatch, which would itself be both a
  // crash and a timing signal.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The same, for two secrets held as text. */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeCompare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

const safeEquals = constantTimeEquals;

/**
 * Slack's scheme: HMAC-SHA256 over `v0:{timestamp}:{raw body}`.
 *
 * The **raw** body, byte for byte as it arrived. Re-serialising the parsed JSON
 * changes key order and whitespace and produces a signature that never matches,
 * which is the mistake that makes people give up and skip verification.
 */
export function verifySlackSignature(input: {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  signingSecret: string | undefined;
  now?: number;
}): VerificationResult {
  if (!input.signingSecret) return { ok: false, failure: 'not_configured' };
  if (!input.signature) return { ok: false, failure: 'missing_signature' };
  if (!input.timestamp) return { ok: false, failure: 'missing_timestamp' };

  const sent = Number(input.timestamp);
  if (!Number.isFinite(sent)) return { ok: false, failure: 'missing_timestamp', detail: input.timestamp };

  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const age = Math.abs(now - sent);
  if (age > MAX_SIGNATURE_AGE_SECONDS) {
    return { ok: false, failure: 'stale_timestamp', detail: `${age}s` };
  }

  const expected = `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`, 'utf8')
    .digest('hex')}`;

  return safeEquals(expected, input.signature) ? { ok: true } : { ok: false, failure: 'bad_signature' };
}

/**
 * Teams outgoing webhooks: `Authorization: HMAC <base64>` over the raw body.
 *
 * The shared secret is base64 as Teams issues it and is the *bytes* of that
 * decoding, not the string. Signing the string produces a value that looks
 * entirely plausible and never matches.
 *
 * There is no timestamp in this scheme, so a captured request can be replayed
 * within whatever window the caller enforces elsewhere. That is the protocol's
 * limitation rather than a choice made here, and it is why message
 * de-duplication upstream is load-bearing rather than merely tidy.
 */
export function verifyTeamsSignature(input: {
  rawBody: string;
  authorization: string | undefined;
  secretBase64: string | undefined;
}): VerificationResult {
  if (!input.secretBase64) return { ok: false, failure: 'not_configured' };
  if (!input.authorization) return { ok: false, failure: 'missing_signature' };

  const match = /^HMAC\s+(.+)$/i.exec(input.authorization.trim());
  if (!match) return { ok: false, failure: 'missing_signature', detail: 'not an HMAC authorization header' };

  const expected = createHmac('sha256', Buffer.from(input.secretBase64, 'base64'))
    .update(input.rawBody, 'utf8')
    .digest('base64');

  return safeEquals(expected, match[1]!.trim()) ? { ok: true } : { ok: false, failure: 'bad_signature' };
}

/**
 * Meta's scheme for WhatsApp: `X-Hub-Signature-256: sha256=<hex>` over the raw
 * body, with the app secret.
 */
export function verifyMetaSignature(input: {
  rawBody: string;
  signature: string | undefined;
  appSecret: string | undefined;
}): VerificationResult {
  if (!input.appSecret) return { ok: false, failure: 'not_configured' };
  if (!input.signature) return { ok: false, failure: 'missing_signature' };

  const expected = `sha256=${createHmac('sha256', input.appSecret).update(input.rawBody, 'utf8').digest('hex')}`;
  return safeEquals(expected, input.signature.trim()) ? { ok: true } : { ok: false, failure: 'bad_signature' };
}

/**
 * Twilio's scheme, for voice: HMAC-SHA1 over the full URL with the POST
 * parameters appended in the order their *keys* sort, then base64.
 *
 * SHA-1 is Twilio's choice and not ours. It is used here only to verify a
 * signature Twilio produced, where the alternative is no verification at all;
 * nothing in this platform signs anything with it.
 */
export function verifyTwilioSignature(input: {
  url: string;
  params: Record<string, string>;
  signature: string | undefined;
  authToken: string | undefined;
}): VerificationResult {
  if (!input.authToken) return { ok: false, failure: 'not_configured' };
  if (!input.signature) return { ok: false, failure: 'missing_signature' };

  const base = Object.keys(input.params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${input.params[key] ?? ''}`, input.url);

  const expected = createHmac('sha1', input.authToken).update(base, 'utf8').digest('base64');
  return safeEquals(expected, input.signature.trim()) ? { ok: true } : { ok: false, failure: 'bad_signature' };
}
