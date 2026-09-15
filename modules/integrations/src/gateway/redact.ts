/**
 * What may be written to `integration_log`.
 *
 * Every outbound call is logged with its request and response so that "the
 * connector stopped working on Tuesday" is answerable. That log is read by
 * support, exported with configuration, and kept for as long as the retention
 * policy says — so it must not contain the credential that made the call, or
 * the personal data in the payload.
 *
 * Redaction is by key name rather than by value, because a value-based rule
 * cannot tell a token from any other opaque string, and one that guesses will
 * either miss tokens or destroy the log's usefulness.
 */

/**
 * Terms that mark a field as carrying a credential, matched against the key
 * with separators removed — so `X-Acme-Api-Key`, `x_api_key` and `apiKey` all
 * hit `apikey`, which a list of exact names never would. Vendors prefix their
 * headers, and a redaction rule that only knows the unprefixed spelling is a
 * rule that works until the first real integration.
 *
 * Deliberately *not* here: the bare word `key`. Phase 2 learned that lesson
 * from the secret scanner — this platform is full of fields legitimately called
 * `key` holding rule keys, template keys and workflow keys, and redacting them
 * would make the log useless while protecting nothing. `X-Idempotency-Key` is
 * the case that matters: it is not a secret and it is exactly what somebody
 * debugging a duplicate call needs to see.
 */
const SECRET_TERMS = [
  'authorization',
  'cookie',
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'signature',
  'privatekey',
  'sessionid',
];

const REDACTED = '[redacted]';
const MAX_BODY_BYTES = 8_192;

function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_\s.]/g, '');
  return SECRET_TERMS.some((term) => normalised.includes(term));
}

export function redactHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = isSecretKey(key) ? REDACTED : value;
  }
  return out;
}

/**
 * Redacts a body, and truncates it.
 *
 * The truncation is not only about storage: a log line holding a megabyte of
 * somebody's payload is a data-protection question as much as a disk question,
 * and the first 8KB is what a person debugging actually reads.
 */
export function redactBody(body: unknown, depth = 0): unknown {
  if (depth > 6) return '[too deep]';

  if (typeof body === 'string') {
    // A form-encoded or bearer-ish string is still a secret carrier.
    if (body.length > MAX_BODY_BYTES) return `${body.slice(0, MAX_BODY_BYTES)}… [truncated]`;
    return body;
  }
  if (Array.isArray(body)) return body.slice(0, 50).map((entry) => redactBody(entry, depth + 1));
  if (body && typeof body === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : redactBody(value, depth + 1);
    }
    return out;
  }
  return body;
}

/**
 * Removes anything that looks like a credential from a URL before logging it.
 *
 * Query-string tokens are common in webhook URLs — including the Postmark
 * pattern this platform already supports — so a logged URL is a logged secret
 * unless something strips it.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return '[unparseable url]';
  }
}
