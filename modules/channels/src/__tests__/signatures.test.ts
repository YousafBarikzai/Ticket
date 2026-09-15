import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SIGNATURE_AGE_SECONDS,
  verifyMetaSignature,
  verifySlackSignature,
  verifyTeamsSignature,
  verifyTwilioSignature,
} from '../domain/signatures.js';

/**
 * A chat webhook is a public URL that accepts JSON. Without these checks,
 * "a message from the finance director asking for every open ticket" is a
 * `curl` command, and every downstream control assumes an envelope that was
 * never proved genuine.
 */

const secret = 'test-signing-secret';
const body = JSON.stringify({ event: { text: 'hello' } });

const slackSignature = (timestamp: string, rawBody = body, signing = secret) =>
  `v0=${createHmac('sha256', signing).update(`v0:${timestamp}:${rawBody}`, 'utf8').digest('hex')}`;

describe('verifySlackSignature', () => {
  const now = 1_700_000_000_000;
  const timestamp = String(Math.floor(now / 1000));

  it('accepts a signature over the exact bytes that arrived', () => {
    const result = verifySlackSignature({
      rawBody: body,
      signature: slackSignature(timestamp),
      timestamp,
      signingSecret: secret,
      now,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a signature computed over re-serialised JSON', () => {
    // The mistake that makes people give up and skip verification: parsing and
    // re-stringifying changes key order and whitespace, so the signature never
    // matches and the check looks broken rather than strict.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    const result = verifySlackSignature({
      rawBody: reserialised,
      signature: slackSignature(timestamp),
      timestamp,
      signingSecret: secret,
      now,
    });
    expect(result).toEqual({ ok: false, failure: 'bad_signature' });
  });

  it('refuses a replay once the timestamp is old', () => {
    // A signature stays valid for ever once seen; the age bound is the only
    // thing that makes a captured request stop working.
    const stale = String(Math.floor(now / 1000) - MAX_SIGNATURE_AGE_SECONDS - 1);
    const result = verifySlackSignature({
      rawBody: body,
      signature: slackSignature(stale),
      timestamp: stale,
      signingSecret: secret,
      now,
    });
    expect(result.failure).toBe('stale_timestamp');
  });

  it('refuses a timestamp from the future by the same margin', () => {
    const ahead = String(Math.floor(now / 1000) + MAX_SIGNATURE_AGE_SECONDS + 1);
    expect(verifySlackSignature({ rawBody: body, signature: slackSignature(ahead), timestamp: ahead, signingSecret: secret, now }).failure).toBe('stale_timestamp');
  });

  it('refuses a signature made with another secret', () => {
    const result = verifySlackSignature({
      rawBody: body,
      signature: slackSignature(timestamp, body, 'a-different-secret'),
      timestamp,
      signingSecret: secret,
      now,
    });
    expect(result.failure).toBe('bad_signature');
  });

  it('refuses rather than passing when no secret is configured', () => {
    // The dangerous default. An unconfigured account must not accept
    // everything; it must accept nothing until somebody finishes setting it up.
    expect(verifySlackSignature({ rawBody: body, signature: 'v0=x', timestamp, signingSecret: undefined, now })).toEqual({
      ok: false,
      failure: 'not_configured',
    });
  });

  it('names a missing header rather than failing obscurely', () => {
    expect(verifySlackSignature({ rawBody: body, signature: undefined, timestamp, signingSecret: secret, now }).failure).toBe('missing_signature');
    expect(verifySlackSignature({ rawBody: body, signature: 'v0=x', timestamp: undefined, signingSecret: secret, now }).failure).toBe('missing_timestamp');
    expect(verifySlackSignature({ rawBody: body, signature: 'v0=x', timestamp: 'not-a-number', signingSecret: secret, now }).failure).toBe('missing_timestamp');
  });

  it('refuses a truncated signature without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, which would be both a
    // crash and a timing signal.
    expect(verifySlackSignature({ rawBody: body, signature: 'v0=abc', timestamp, signingSecret: secret, now }).failure).toBe('bad_signature');
  });
});

describe('verifyTeamsSignature', () => {
  const secretBase64 = Buffer.from('teams-shared-secret').toString('base64');
  const valid = createHmac('sha256', Buffer.from(secretBase64, 'base64')).update(body, 'utf8').digest('base64');

  it('accepts a correct HMAC', () => {
    expect(verifyTeamsSignature({ rawBody: body, authorization: `HMAC ${valid}`, secretBase64 }).ok).toBe(true);
  });

  it('signs with the decoded bytes of the secret, not its text', () => {
    // Signing the base64 string produces a value that looks entirely plausible
    // and never matches, which is a long afternoon.
    const wrong = createHmac('sha256', secretBase64).update(body, 'utf8').digest('base64');
    expect(verifyTeamsSignature({ rawBody: body, authorization: `HMAC ${wrong}`, secretBase64 }).failure).toBe('bad_signature');
  });

  it('requires the HMAC scheme rather than any authorization header', () => {
    expect(verifyTeamsSignature({ rawBody: body, authorization: `Bearer ${valid}`, secretBase64 }).failure).toBe('missing_signature');
  });

  it('refuses when no secret is configured', () => {
    expect(verifyTeamsSignature({ rawBody: body, authorization: `HMAC ${valid}`, secretBase64: undefined }).failure).toBe('not_configured');
  });
});

describe('verifyMetaSignature', () => {
  const appSecret = 'meta-app-secret';
  const valid = `sha256=${createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')}`;

  it('accepts a correct signature and refuses a wrong one', () => {
    expect(verifyMetaSignature({ rawBody: body, signature: valid, appSecret }).ok).toBe(true);
    expect(verifyMetaSignature({ rawBody: body, signature: 'sha256=deadbeef', appSecret }).failure).toBe('bad_signature');
  });

  it('refuses when no secret is configured', () => {
    expect(verifyMetaSignature({ rawBody: body, signature: valid, appSecret: undefined }).failure).toBe('not_configured');
  });
});

describe('verifyTwilioSignature', () => {
  const authToken = 'twilio-auth-token';
  const url = 'https://desk.example.com/api/v1/channels/voice/twilio';
  const params = { CallSid: 'CA123', From: '+441234567890', TranscriptionText: 'my laptop will not start' };
  const base = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key as keyof typeof params]}`, url);
  const valid = createHmac('sha1', authToken).update(base, 'utf8').digest('base64');

  it('accepts a correct signature', () => {
    expect(verifyTwilioSignature({ url, params, signature: valid, authToken }).ok).toBe(true);
  });

  it('sorts the parameters by key, which is where implementations differ', () => {
    const unsorted = createHmac('sha1', authToken)
      .update(`${url}From${params.From}CallSid${params.CallSid}TranscriptionText${params.TranscriptionText}`, 'utf8')
      .digest('base64');
    expect(verifyTwilioSignature({ url, params, signature: unsorted, authToken }).failure).toBe('bad_signature');
  });

  it('is bound to the exact URL, so the same body cannot be replayed elsewhere', () => {
    expect(
      verifyTwilioSignature({ url: `${url}?extra=1`, params, signature: valid, authToken }).failure,
    ).toBe('bad_signature');
  });

  it('refuses when no token is configured', () => {
    expect(verifyTwilioSignature({ url, params, signature: valid, authToken: undefined }).failure).toBe('not_configured');
  });
});
