import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { ValidationError } from '@itsm/platform';

/**
 * AWS Signature Version 4, header form.
 *
 * Here rather than in a module because signing is a property of the *request*,
 * and requests are built in one place (ADR-0023). A module that signed its own
 * request would be a module building an outbound request, which is the thing
 * the gateway exists to stop.
 *
 * What can and cannot be verified in this repository is worth saying plainly,
 * because MOD-10-E2 declined to write this for exactly that reason. The
 * algorithm is fully specified and every intermediate artefact is human-
 * readable: the canonical request and the string to sign are plain text, and the
 * tests assert them as plain text against AWS's published worked example, which
 * a reviewer can check line by line. What is *not* verified here is a live call
 * to AWS. The first real request is the acceptance test, and the failure mode if
 * this is wrong is a clean 403 with `SignatureDoesNotMatch`, not corruption.
 */

export const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';

/** SHA-256 of the empty string; AWS's payload hash for a body-less request. */
export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Both halves in one credential, so they rotate together.
 *
 * A key id and a secret kept as two credentials can be half-rotated, and a
 * half-rotated pair fails as `InvalidClientTokenId` — which reads like a
 * permissions problem and sends somebody to look at IAM policies.
 */
export const awsCredentialSchema = z.object({
  accessKeyId: z.string().min(1).max(128),
  secretAccessKey: z.string().min(1).max(256),
  /** Present for temporary credentials from STS; signed like any other header. */
  sessionToken: z.string().max(8_192).optional(),
});
export type AwsCredential = z.infer<typeof awsCredentialSchema>;

export interface SigningSpec {
  region: string;
  /** The AWS service name as it appears in the credential scope: `s3`, `config`. */
  service: string;
}

export interface SignableRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Exactly the bytes that will be sent, or undefined for no body. */
  body?: string;
}

export interface SignedParts {
  /** Headers to add to the request. Never logged: two of them are credentials. */
  headers: Record<string, string>;
  /** Kept for tests and for a support conversation with AWS; contains no secret. */
  canonicalRequest: string;
  stringToSign: string;
  scope: string;
}

/**
 * RFC 3986 percent-encoding, which is not what `encodeURIComponent` does.
 *
 * `encodeURIComponent` leaves `!'()*` alone; AWS requires them encoded, and a
 * request carrying an unencoded apostrophe in a query value signs cleanly and
 * is rejected. The unreserved set is exactly `A-Za-z0-9-_.~`.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(char)) out += char;
    else if (char === '/' && !encodeSlash) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `YYYYMMDDTHHMMSSZ`, which is the only time format the algorithm accepts. */
export function amzDate(at: Date): string {
  return `${at.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
}

function canonicalPath(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/';
  // Each segment is encoded; the separators are not. Path normalisation (`.`
  // and `..`) is the URL parser's job and has already happened by here.
  return pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(search: URLSearchParams): string {
  const pairs: [string, string][] = [];
  search.forEach((value, name) => pairs.push([uriEncode(name), uriEncode(value)]));
  // Sorted by encoded name, then by encoded value — byte order, not locale, for
  // the same reason `canonicalJson` sorts by code point: a locale-dependent sort
  // produces a signature that depends on the machine that made it.
  pairs.sort(([aName, aValue], [bName, bValue]) =>
    aName === bName ? (aValue < bValue ? -1 : aValue > bValue ? 1 : 0) : aName < bName ? -1 : 1,
  );
  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const normalised = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), `${value}`.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    canonical: normalised.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: normalised.map(([name]) => name).join(';'),
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * The four-step chain that turns a secret into a key good for one day, one
 * region and one service.
 *
 * The narrowing is the point: a signature captured off the wire cannot be
 * replayed against another region, another service, or tomorrow.
 */
export function signingKey(secretAccessKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Signs a request, returning the headers to add.
 *
 * `host` is derived from the URL rather than taken from the caller: signing a
 * `host` that differs from the one the request is actually sent to produces a
 * signature AWS rejects, and the caller is not the authority on where the
 * request is going — the gateway's address check already is.
 */
export function signAwsRequest(
  request: SignableRequest,
  credential: AwsCredential,
  spec: SigningSpec,
  at: Date = new Date(),
): SignedParts {
  if (!spec.region.trim() || !spec.service.trim()) {
    throw new ValidationError('an AWS-signed request needs a region and a service name');
  }

  const url = new URL(request.url);
  const timestamp = amzDate(at);
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${spec.region}/${spec.service}/aws4_request`;
  const payloadHash = request.body === undefined ? EMPTY_PAYLOAD_SHA256 : sha256Hex(request.body);

  const toSign: Record<string, string> = {
    ...request.headers,
    host: url.host,
    'x-amz-date': timestamp,
    // Required by S3 and harmless everywhere else; signing it means the body
    // cannot be swapped in flight without the signature failing.
    'x-amz-content-sha256': payloadHash,
    ...(credential.sessionToken ? { 'x-amz-security-token': credential.sessionToken } : {}),
  };
  // `authorization` is the output; including it in the input would be circular.
  delete toSign.authorization;
  delete toSign.Authorization;

  const { canonical, signed } = canonicalHeaders(toSign);
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonical,
    signed,
    payloadHash,
  ].join('\n');

  const stringToSign = [AWS_ALGORITHM, timestamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(credential.secretAccessKey, date, spec.region, spec.service), stringToSign).toString('hex');

  return {
    headers: {
      'x-amz-date': timestamp,
      'x-amz-content-sha256': payloadHash,
      ...(credential.sessionToken ? { 'x-amz-security-token': credential.sessionToken } : {}),
      authorization: `${AWS_ALGORITHM} Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    scope,
  };
}

/** Reads the stored credential, refusing a shape that cannot sign anything. */
export function parseAwsCredential(raw: string): AwsCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError(
      'an AWS credential is stored as JSON with accessKeyId and secretAccessKey; this one is not JSON',
    );
  }
  return awsCredentialSchema.parse(parsed);
}
