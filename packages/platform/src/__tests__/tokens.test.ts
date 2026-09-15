import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../tokens.js';

process.env.DEV_TOKEN_SECRET = 'a-secret-for-these-tests-only';

const payload = { tenantId: '11111111-1111-4111-8111-111111111111', kind: 'survey_invitation', subjectId: '22222222-2222-4222-8222-222222222222', expiresAt: '2026-04-01T00:00:00Z' };
const now = new Date('2026-03-15T00:00:00Z');

describe('signed links', () => {
  it('round-trips a payload', () => {
    const verdict = verifyToken(signToken(payload), now);
    expect(verdict).toEqual({ ok: true, payload });
  });

  it('refuses a payload that has been altered, even by one character', () => {
    const token = signToken(payload);
    const [encoded, signature] = token.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...payload, subjectId: '33333333-3333-4333-8333-333333333333' })).toString('base64url');
    expect(verifyToken(`${tampered}.${signature}`, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyToken(`${encoded}.${signature!.slice(0, -1)}x`, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an expired link, and checks the signature first', () => {
    // A bad signature is reported as a bad signature whatever the expiry says:
    // the expiry is inside the payload, and the payload is untrusted until signed.
    expect(verifyToken(signToken(payload), new Date('2026-05-01T00:00:00Z'))).toEqual({ ok: false, reason: 'expired' });
    expect(verifyToken('bm90LWpzb24.bad', now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses something that is not a token at all', () => {
    expect(verifyToken('', now)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('no-dot-here', now)).toEqual({ ok: false, reason: 'malformed' });
  });
});
