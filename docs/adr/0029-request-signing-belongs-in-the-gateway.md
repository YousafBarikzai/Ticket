# ADR-0029 · Request signing belongs in the gateway, and both halves of a credential travel together

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-14-E3, MOD-10-E2, §9 Security

## Context

ADR-0023 made the integration gateway the only way out of the platform, and gave
it one shape for authentication: attach a stored credential as a single header.
That covers bearer tokens, API keys and basic auth, which is most of the world.

It does not cover AWS. AWS Signature Version 4 authenticates a *request* rather
than a caller: the signature is computed over the method, the path, the query
string, a chosen set of headers and a hash of the body, and it is valid only for
one day, one region and one service. There is no header to attach, because the
header does not exist until the request is finished.

MOD-10-E2 met this and declined to solve it. Its `aws` discovery source reads an
inventory export instead of calling the API, and the ADR said why: a signer
written inside a module could not be verified against anything in this
repository, and an unverifiable signer that fails only against live AWS is worse
than an honest gap. That reasoning was about *where* and *how*, not about
whether, and this is the follow-up it named.

There is a second question underneath it. A SigV4 credential is not one secret
but two — an access key id and a secret access key, sometimes with a session
token — and the credential store holds one opaque value per name.

## Decision

**Signing happens in the gateway, at the point the request is assembled.**

A caller asks for it by passing `signing: { kind: 'aws_sigv4', region, service }`
alongside the credential; the gateway computes the signature over the request it
is about to send and merges the resulting headers into what goes on the wire.
Three consequences follow from doing it here rather than in a module:

- **The body is serialised once and both signed and sent.** Signing one
  serialisation and sending another is the classic SigV4 defect, and it fails
  only against a live endpoint, with no useful message.
- **`host` is taken from the URL, not from the caller.** A signature over a host
  the request does not reach is rejected, and the caller is not the authority on
  the destination — the address guard already is.
- **The signature never reaches the log.** The gateway's log is built from
  `request.headers`, which has never held a credential; signed headers are
  merged only into what is sent. The same property the bearer path already had,
  by the same mechanism.

**Both halves of an AWS credential live in one stored value**, as JSON, under
the credential kind `aws_sigv4`. Two separately-stored halves can be
half-rotated, and a half-rotated pair fails as `InvalidClientTokenId` — which
reads like a permissions problem and sends whoever is on call to look at IAM
policies rather than at the rotation that happened an hour ago. The shape is
validated when the credential is stored, not when it is first used.

**What is verified here, and what is not, is stated rather than implied.** The
canonical request and the string to sign are plain text, and the tests assert
them as plain text against AWS's published worked example, which a reviewer can
check line by line. That is where SigV4 implementations actually go wrong: path
and query encoding, header folding, the signed-header list, the payload hash.
What is *not* verified in this repository is a live call to AWS. No test pins a
signature hex from memory — an assertion like that is worth nothing if the
memory is wrong and worse than nothing because it looks like verification. The
first real request is the acceptance test, and a wrong signature fails as a clean
403 `SignatureDoesNotMatch`.

## Alternatives considered

- **A signer in `modules/assets`, for discovery only.** Rejected: it would make a
  module the builder of an outbound request, which is the thing ADR-0023 exists
  to prevent, and every other AWS caller would need its own copy.
- **A signer in `packages/platform`.** Rejected: nothing in the platform builds
  outbound requests, and putting it there would invite a module to use it
  directly and bypass the gateway.
- **Two credential refs for the key id and the secret.** Rejected for the
  half-rotation failure above.
- **A typed credential row with columns for the key id and the secret.**
  Rejected for now: it changes a security-sensitive table and its migration to
  serve one provider, and the JSON value is already sealed by the same envelope
  encryption.
- **Pinning a signature hex from AWS's test suite.** Rejected, and this is the
  decision this ADR most wants to be read for. A remembered constant that
  happens to be wrong produces a test that fails for ever or, worse, a test
  written to match a wrong implementation.
- **Continuing to read exports and not signing at all.** Rejected now that the
  work is bounded — but the export path stays, because an AWS Config snapshot is
  *richer* than the live tagging API and plenty of organisations will share an
  export bucket long before they issue signing keys.

## Consequences

- A new discovery source kind, `aws_api`, calls the Resource Groups Tagging API
  directly. It is broad and shallow — an ARN and tags for every resource — where
  the `aws` export kind is narrow and deep. Both remain; a tenant that wants both
  runs both.
- `aws_api` has no default URL, because the region is in the hostname. A source
  with no URL is refused when it is created rather than at two in the morning.
- Query parameters and header names are sorted by code point rather than by
  locale, for the same reason `canonicalJson` is: a locale-dependent sort makes
  a signature depend on the ICU data of the machine that produced it.
- The session token, when there is one, is signed rather than merely sent. An
  unsigned token could be stripped or swapped in flight.
- Every other AWS API is now reachable from a connector or a workflow action,
  not only discovery. That is most of the value, and it came for nothing.
