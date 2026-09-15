# ADR-0022 · Email: Postmark and Microsoft Graph, chosen per tenant

**Status:** Accepted 2026-09-15 (closes OD-03) · **Date:** 2026-09 · **Specification reference:** MOD-03, §4.2 Channels, OD-03

## Context

Inbound and outbound email is the channel every service desk actually runs on.
The platform needs a provider, and the two candidates answer different
questions:

- **Postmark** is simpler to configure, has good deliverability, and parses
  inbound mail into a structured message rather than raw MIME.
- **Microsoft Graph** reads the mailbox where it already lives. For a customer
  whose DPIA commits them to keeping correspondence inside their own Microsoft
  geography, a provider that receives a copy is not acceptable at any price.

Picking one for the whole deployment means either turning away the second kind
of customer, or making the first kind register an application in Entra ID to
raise a ticket by email.

## Decision

Both, chosen **per tenant**, on the channel account.

The choice is a customer's, not an operator's: one customer's data-residency
commitment should not decide another customer's mail provider. So the account's
`config` names the transport and `transportForAccount()` builds it, with no
fallback — a misconfigured Graph mailbox sends nothing rather than quietly
sending through Postmark, because quietly sending through Postmark is precisely
the thing that tenant chose Graph to avoid.

**Credentials are referenced, not stored.** The account's `config` is
tenant-editable JSON, so a token in it would be readable by anyone who can
configure a mailbox and would appear in every audit payload and configuration
export. The account holds a name — `{ "credentialRef": "graph-acme" }` — and
the value resolves from the environment as `ITSM_CREDENTIAL_GRAPH_ACME`. That
works today, keeps secrets out of the database, and is a reference an encrypted
store can satisfy later without any adapter changing (09 §4; the store itself is
MOD-14's, in PH-4).

**Verification is per provider, so the account is resolved first.** The inbound
route now looks up which mailbox a delivery claims to be for *before* verifying
it, because a Graph notification and a Postmark webhook are verified in entirely
different ways. Resolving which mailbox a request names is not the same as
trusting the request; nothing is accepted until the verification that follows.

Neither provider's verification is as strong as one would like, and both
adapters refuse rather than assume:

- Postmark does not sign inbound webhooks. The documented protection is a secret
  in the URL over HTTPS. The adapter accepts that secret or an HMAC a proxy
  added, and refuses a delivery carrying neither — "no signature configured"
  must never read as "verified", or the endpoint is open to anyone who finds it.
- Graph does not sign notifications either; it echoes the `clientState` the
  subscription was created with. Every notification in a batch must match, since
  accepting the batch would accept a stranger's along with ours.

## Alternatives considered

- **Postmark only.** Rejected: it turns away every customer with a residency
  commitment, which in this market is most of the regulated ones.
- **Graph only.** Rejected: it makes a five-person IT team register an
  application in Entra ID before they can receive a ticket by email.
- **SMTP/IMAP for everything.** Considered. It is the universal answer and the
  worst one: polling IMAP is slow and fragile, MIME parsing is a security
  surface, and neither provider's threading metadata survives.
- **A deployment-wide provider with per-tenant overrides.** Rejected as a
  false economy: the override path is the one that carries the residency
  commitment, so it is the path that must be ordinary rather than exceptional.

## Consequences

- A Graph mailbox needs a renewal job: Graph subscriptions expire in about three
  days and a lapsed one fails **silently** — mail simply stops arriving, with
  nothing in the logs, because from Graph's point of view nothing went wrong.
  `renewGraphSubscription` exists for that job.
- Graph delivers a notification rather than the message, so inbound is two steps
  there and one everywhere else. Contained inside the adapter; the inbound path
  does not know.
- Graph rejects most standard internet headers as reserved, so the platform's
  threading token travels as an `x-` header. `resolveThread` already reads a
  header token first, which is what makes this work without a second threading
  scheme.
- `checkTransportConfig()` reports a missing credential at configuration time,
  because the symptom otherwise is "mail stopped arriving", which nobody notices
  for a day and nobody can diagnose from outside.
