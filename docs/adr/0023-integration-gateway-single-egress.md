# ADR-0023 · The integration gateway is the only way out

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-14-E3, MOD-06-E2, §4 of [07](../architecture/07-eventing-and-integration.md)

## Context

From Phase 4 the platform makes outbound calls that a *tenant's configuration*
decides: workflow `action` nodes, connectors, and later the AI gateway. Four
things must be true of every one of them, and each is easy to get right once and
impossible to keep right if every caller does it:

1. The destination is somewhere the platform is allowed to reach.
2. The credential is attached without ever reaching a log or an audit payload.
3. A failing endpoint stops consuming workers.
4. The exchange is recorded in a form somebody can read afterwards.

The alternative — each module calling `fetch` — fails all four silently. A
module that forgets the destination check does not fail a test; it works, until
somebody points it at `169.254.169.254`.

## Decision

One egress path, `modules/integrations/src/gateway`, and everything else calls
it. A bare `fetch` to an external host outside that folder is a boundary
violation, checked like every other module contract rule.

**The destination check is an allowlist of public addresses.** A blocklist of
known-bad hostnames is defeated by an IP literal, by a name that resolves
somewhere private, and by the IPv4-mapped IPv6 form of the same ranges. All
three are ordinary rather than clever. The check resolves once and **returns the
addresses**, so the caller connects to what was checked rather than to the name
again — which is what closes DNS rebinding. Redirects are refused rather than
followed, because a 302 walks straight past a check performed on the URL the
administrator configured.

It also refuses plain `http` and credentials in the URL. A connector carries a
credential, and a credential in a URL ends up in logs, in `Referer` and in the
audit trail.

**The breaker is per (tenant, connector).** Two tenants using the same connector
kind are talking to different systems; one customer's outage must not become
everybody's. Half-open lets exactly one call through, because a hundred workers
probing a recovering endpoint is how a service that was coming back goes down
again. A 4xx does not open it — pausing a connector whose URL is simply wrong
hides the one message that would fix it.

**Redaction matches with separators stripped**, so `X-Acme-Api-Key` is caught.
Vendors prefix their headers. The bare word `key` is deliberately not a secret
term: this platform is full of rule keys and template keys, and
`X-Idempotency-Key` is exactly what somebody debugging a duplicate call needs.

**Actions are named definitions, not URLs in a workflow node.** The same call is
reused; the credential is named once and never appears in an exported graph;
and listing `action_definition` answers "what outbound calls can this platform
make?", which is the question a security review asks and which a URL buried in a
node cannot answer. The **host** of an action URL may not be templated — only
the path and query — because a templated host lets a workflow's own data choose
the destination, which is the SSRF guard with extra steps.

**A failure is permanent or transient, and the caller is told which.** A refused
destination or a missing credential will fail the same way five more times, so
it is recorded once for an operator rather than retried. A 5xx might not be.

## Alternatives considered

- **A per-module HTTP helper.** Rejected: four controls times every module, each
  of which fails silently when it drifts.
- **An egress proxy (Squid, or a Cloudflare Worker) enforcing the allowlist.**
  Genuinely attractive, and worth revisiting in PH-5 for defence in depth. It
  does not replace this: the proxy cannot attach a credential, cannot open a
  circuit, and cannot write a redacted log with the correlation ID.
- **Following redirects and re-checking each hop.** Considered. Rejected as
  more moving parts for a case that has never been a legitimate connector
  requirement — a connector points at its final address.
- **Storing credentials in the action's config.** Rejected for the same reason
  as channel accounts: config is tenant-editable and lands in audit payloads
  and exports.

## What the rule found immediately

Adding the check surfaced a real hole in Phase 1 code: **webhook delivery called
`fetch` directly**. A subscription's URL is tenant-configured, so a subscription
pointed at `169.254.169.254` would have been delivered to faithfully, signed,
on every matching event — outbound webhooks are the same request-forgery surface
as a connector, and had been since the module was written. It now goes through
the gateway, and a refused destination marks the delivery dead rather than
retrying it twelve times over a day.

That is the argument for checking the rule mechanically rather than trusting it:
the convention was already written down, and the code that broke it was written
by the same people who wrote the convention.

## Consequences

- Every outbound integration is one table's worth of rows an administrator can
  read, and one log they can search.
- An endpoint behind a corporate VPN, or on a private network, cannot be called.
  That is intended — it is the same rule from the platform's side — and a tenant
  needing it should expose a public endpoint or use a pull connector.
- The breaker's state is in process memory, so it is per worker and resets on
  deploy. Acceptable at this scale and deliberately not in Redis: a breaker that
  needs a round trip to decide whether to make a call has costs of its own.
  Revisit if worker counts make the divergence matter.
