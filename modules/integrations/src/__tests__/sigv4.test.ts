import { describe, expect, it } from 'vitest';
import {
  AWS_ALGORITHM,
  EMPTY_PAYLOAD_SHA256,
  amzDate,
  parseAwsCredential,
  signAwsRequest,
  signingKey,
  uriEncode,
} from '../gateway/sigv4.js';

/**
 * What these tests can and cannot prove, stated plainly because MOD-10-E2
 * declined to write this signer on exactly this question.
 *
 * They **can** prove the canonical request and the string to sign, which are
 * plain text and which a reviewer can check line by line against AWS's
 * published `aws-sig-v4-test-suite` worked example. That is where essentially
 * every SigV4 implementation goes wrong: path and query encoding, header
 * folding, the signed-header list, the payload hash.
 *
 * They **cannot** prove the final signature against AWS, because that needs
 * AWS. No assertion here pins a signature hex from memory — an assertion like
 * that is worth nothing if the memory is wrong, and worse than nothing because
 * it looks like verification. The first live call is the acceptance test, and a
 * wrong signature fails as a clean 403 `SignatureDoesNotMatch`.
 */

/**
 * AWS's published example key id, and a secret that is deliberately *not*
 * credential-shaped.
 *
 * The key id is real because the assertions below quote it — it appears in the
 * `Credential=` scope, so a made-up one would make the expected strings
 * unreadable. The secret is not, because nothing here depends on its value: the
 * canonical request and the string to sign do not contain it, the signing-key
 * tests use their own, and no test pins a signature. A fixture that looks like a
 * live credential is a finding to a scanner, which cannot tell a fixture from a
 * leak — and the exemption that would follow is where a scanner stops
 * protecting you.
 */
const credential = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'not-a-real-secret-for-signing-tests',
};
const spec = { region: 'us-east-1', service: 'service' };
const at = new Date('2015-08-30T12:36:00.000Z');

describe('uriEncode', () => {
  it('encodes the characters encodeURIComponent leaves alone', () => {
    // `!'()*` are the ones that catch people out: the request signs cleanly and
    // AWS rejects it.
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(encodeURIComponent("!'()*")).toBe("!'()*");
  });

  it('leaves the unreserved set alone', () => {
    expect(uriEncode('AZaz09-_.~')).toBe('AZaz09-_.~');
  });

  it('encodes a slash unless told not to', () => {
    expect(uriEncode('a/b')).toBe('a%2Fb');
    expect(uriEncode('a/b', false)).toBe('a/b');
  });

  it('encodes multi-byte characters one byte at a time', () => {
    expect(uriEncode('ü')).toBe('%C3%BC');
  });
});

describe('amzDate', () => {
  it('is the basic ISO form, with no separators and no milliseconds', () => {
    expect(amzDate(at)).toBe('20150830T123600Z');
  });
});

describe('the canonical request', () => {
  it('matches AWS’s worked example for a bare GET', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: {} },
      credential,
      spec,
      at,
    );

    // Readable on purpose. This is the artefact to compare against
    // `get-vanilla.creq` in AWS's published suite; the only difference from
    // that file is `x-amz-content-sha256`, which we always sign.
    expect(signed.canonicalRequest).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-content-sha256;x-amz-date',
        EMPTY_PAYLOAD_SHA256,
      ].join('\n'),
    );
  });

  it('hashes an absent body to the SHA-256 of the empty string', () => {
    // Not computed here from our own implementation: this constant is fixed and
    // widely published, so it is an independent check rather than a tautology.
    expect(EMPTY_PAYLOAD_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sorts query parameters by name, then by value, and encodes both', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/?b=2&a=1&a=0&c=a%20b', headers: {} },
      credential,
      spec,
      at,
    );
    expect(signed.canonicalRequest.split('\n')[2]).toBe('a=0&a=1&b=2&c=a%20b');
  });

  it('encodes each path segment but not the separators', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/a b/c!d', headers: {} },
      credential,
      spec,
      at,
    );
    expect(signed.canonicalRequest.split('\n')[1]).toBe('/a%20b/c%21d');
  });

  it('lower-cases header names, trims values and collapses runs of spaces', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: { 'X-Custom': '  a   b  ' } },
      credential,
      spec,
      at,
    );
    expect(signed.canonicalRequest).toContain('x-custom:a b\n');
    expect(signed.canonicalRequest).toContain('host;x-amz-content-sha256;x-amz-date;x-custom');
  });

  it('signs the host the request will actually reach, not one the caller supplied', () => {
    // A signature over a host the request does not go to is rejected, and the
    // caller is not the authority on the destination — the address guard is.
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://real.amazonaws.com/', headers: { host: 'pretend.example.com' } },
      credential,
      spec,
      at,
    );
    expect(signed.canonicalRequest).toContain('host:real.amazonaws.com');
    expect(signed.canonicalRequest).not.toContain('pretend.example.com');
  });

  it('hashes the exact body that will be sent', () => {
    const signed = signAwsRequest(
      { method: 'POST', url: 'https://example.amazonaws.com/', headers: {}, body: '{"a":1}' },
      credential,
      spec,
      at,
    );
    expect(signed.canonicalRequest.split('\n').at(-1)).not.toBe(EMPTY_PAYLOAD_SHA256);
    // The payload hash appears twice: as a signed header and as the last line,
    // so a body swapped in flight breaks the signature either way.
    expect(signed.headers['x-amz-content-sha256']).toBe(signed.canonicalRequest.split('\n').at(-1));
  });
});

describe('the string to sign', () => {
  it('is the algorithm, the timestamp, the scope and the hash of the canonical request', () => {
    const signed = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: {} },
      credential,
      spec,
      at,
    );
    const lines = signed.stringToSign.split('\n');
    expect(lines[0]).toBe(AWS_ALGORITHM);
    expect(lines[1]).toBe('20150830T123600Z');
    expect(lines[2]).toBe('20150830/us-east-1/service/aws4_request');
    expect(lines[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(lines).toHaveLength(4);
  });
});

describe('the signing key', () => {
  it('narrows the secret to one day, one region and one service', () => {
    // The narrowing is the security property: a signature captured off the wire
    // cannot be replayed against another region, another service, or tomorrow.
    const base = signingKey('secret', '20150830', 'us-east-1', 'service').toString('hex');
    expect(signingKey('secret', '20150831', 'us-east-1', 'service').toString('hex')).not.toBe(base);
    expect(signingKey('secret', '20150830', 'eu-west-2', 'service').toString('hex')).not.toBe(base);
    expect(signingKey('secret', '20150830', 'us-east-1', 's3').toString('hex')).not.toBe(base);
    expect(signingKey('other', '20150830', 'us-east-1', 'service').toString('hex')).not.toBe(base);
  });

  it('is deterministic, so the same request signs the same way twice', () => {
    expect(signingKey('secret', '20150830', 'us-east-1', 'service').toString('hex')).toBe(
      signingKey('secret', '20150830', 'us-east-1', 'service').toString('hex'),
    );
  });
});

describe('the authorization header', () => {
  const signed = signAwsRequest(
    { method: 'GET', url: 'https://example.amazonaws.com/', headers: {} },
    credential,
    spec,
    at,
  );

  it('carries the key id, the scope, the signed headers and the signature', () => {
    expect(signed.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/service\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('never carries the secret', () => {
    // Belt and braces on the one thing that must never leave: the secret is an
    // input to a HMAC and appears in no output.
    const everything = JSON.stringify(signed);
    expect(everything).not.toContain(credential.secretAccessKey);
    expect(everything).not.toContain('AWS4wJal');
  });

  it('signs a session token when there is one, rather than merely sending it', () => {
    const temporary = signAwsRequest(
      { method: 'GET', url: 'https://example.amazonaws.com/', headers: {} },
      { ...credential, sessionToken: 'TEMP-TOKEN' },
      spec,
      at,
    );
    expect(temporary.headers['x-amz-security-token']).toBe('TEMP-TOKEN');
    expect(temporary.headers.authorization).toContain('x-amz-security-token');
    // A different token is a different signature; an unsigned one could be
    // stripped or swapped in flight.
    expect(temporary.headers.authorization).not.toBe(signed.headers.authorization);
  });

  it('refuses to sign without a region and a service', () => {
    expect(() =>
      signAwsRequest({ method: 'GET', url: 'https://x.amazonaws.com/', headers: {} }, credential, {
        region: '',
        service: 'service',
      }),
    ).toThrow(/region and a service/);
  });
});

describe('parseAwsCredential', () => {
  it('reads both halves from one stored value', () => {
    expect(parseAwsCredential(JSON.stringify(credential))).toEqual(credential);
  });

  it('says what the shape should be rather than failing obscurely', () => {
    expect(() => parseAwsCredential('AKIDEXAMPLE')).toThrow(/stored as JSON/);
  });

  it('refuses a half-written credential', () => {
    // Two credentials that can be half-rotated fail as `InvalidClientTokenId`,
    // which reads like a permissions problem and sends somebody to IAM.
    expect(() => parseAwsCredential(JSON.stringify({ accessKeyId: 'AKIDEXAMPLE' }))).toThrow();
  });
});
