# 23 · Phase 4 readiness and delivery record

**Status: in progress.** Phase 4 is the largest in the plan — roughly a dozen
modules — and is being delivered one module per pull request rather than as a
single drop. This document grows with it, in the same shape as
[20](20-phase-1-readiness.md), [21](21-phase-2-readiness.md) and
[22](22-phase-3-readiness.md).

---

## 1. What Phase 4 is for

Phases 1 to 3 built a platform that holds a ticket safely, acts on it inside one
event, and carries a multi-day process without losing its place. Everything it
does, it does to itself.

Phase 4 is where it reaches outside: calls to other systems, assets discovered
from them, incidents correlated from their monitoring, work routed by who is
actually on shift, and an AI service that reads the knowledge base built in
Phase 3. All of it needs one thing first, which is why that thing is module one.

---

## 2. Delivered

### 2.1 Integration gateway and connectors (MOD-14-E3, MOD-06-E2)

**The single way out.** Every outbound call a tenant's configuration can cause
goes through one place, so that four things are true once rather than in each
caller: the destination is checked, the credential is attached without reaching
a log, a failing endpoint stops consuming workers, and the exchange is recorded
readably.

**The destination check is an allowlist of public addresses**, not a blocklist
of known-bad hosts. A blocklist is defeated by an IP literal, by a name that
resolves somewhere private, and by the IPv4-mapped IPv6 form of the same ranges
— all ordinary rather than clever. It resolves once and returns the addresses so
the caller pins them, which closes DNS rebinding, and refuses redirects, because
a 302 walks past a check made on the URL an administrator configured.

The reason it exists at all: a connector's URL is configured by a tenant
administrator, who is a customer's employee and not ours. Without the check,
"call this URL when a ticket is raised" is a request-forgery primitive aimed at
our own network, and the highest-value target is `169.254.169.254`, where a
cloud provider hands out instance credentials to anything that asks.

**Credentials are envelope-encrypted and write-only.** AES-256-GCM with a
per-record data key wrapped by a per-environment KEK, so rotation re-wraps small
keys rather than rewriting every ciphertext and a database dump alone decrypts
nothing. The value never comes back out through the API: an operator sees a
fingerprint. A store that can read a secret back is a store whose read path is
the thing an attacker wants.

**The circuit breaker is per (tenant, connector)**, because two tenants using
the same connector kind are talking to different systems and one customer's
outage must not become everybody's. Half-open lets exactly one call through. A
4xx does not open it: pausing a connector whose URL is simply wrong hides the one
message that would fix it.

**Actions are named definitions, not URLs in a workflow node.** Listing
`action_definition` answers "what outbound calls can this platform make?", which
is the question a security review asks and which a URL buried in a node cannot
answer. The *host* of an action URL may not be templated — a templated host lets
a workflow's own data choose the destination, which is the SSRF guard with extra
steps.

**Failures are permanent or transient, and the caller is told which**, so a
retry policy does not spend five attempts on a URL that will never be allowed.
Permanent ones go to an error queue: one item per failing thing with a count,
not one per attempt, which would bury ten real problems under a thousand
retries. Replay reuses the original idempotency key, because the first attempt
may have reached the far end and failed on the way back — pressing retry must
not be able to create a duplicate account.

**Workflow `action` nodes work**, having refused at publish for the whole of
Phase 3 naming this module.

---

## 3. What remains in Phase 4

| Module | Why it is not done |
|---|---|
| **MOD-20 Workload and routing** | Unblocks `assignStrategy`, the last rule action still refusing at publish. The natural next module. |
| **MOD-08 ITIL practices** | Major incident, problem and change. Large, and self-contained: it touches no new infrastructure. |
| **MOD-10 Assets and CMDB** | Needs the gateway's pull-connector half, which is not built yet. |
| **MOD-09 AI service** | **OD-04 is deliberately deferred**: the gateway, budgets, prompt registry, evals and kill switch are to be built against a stub provider, and nothing reaches a real model until a provider is chosen. Scope is agent-facing suggestions — an agent accepts or rejects, and no AI output reaches a requester unreviewed. |
| **MOD-03 chat and voice** | Copies the email adapter, and now has the gateway to route through. |
| MOD-12, MOD-18, MOD-19, MOD-23, MOD-24, SCIM, metering | Not started. |

---

## 4. Defects and traps this phase has found

| What | Why it mattered |
|---|---|
| **Webhook delivery called `fetch` directly** | Subscription URLs are tenant-configured, so a subscription pointed at `169.254.169.254` would have been delivered to faithfully, **signed**, on every matching event. Outbound webhooks are the same request-forgery surface as a connector and had been since Phase 1 — through a security review. Found by the module-contract rule added with ADR-0023 on its first run, which is the argument for checking a convention mechanically: the convention was already written down, and the code that broke it was written by the same people who wrote it. |
| A test fixture read as a real credential | An `Authorization` header fixture, written to look like a live Stripe secret key so that the redaction tests exercised something realistic, failed the secret scanner. That is the scanner working: it cannot tell a fixture from a leak, and neither can a person skimming a diff. A test fixture should never be shaped like a credential — and, as the next row shows, writing *about* one afterwards is the same mistake wearing a hat. |
| The first allowlist entry for it was too broad | Written without the closing quote, it would have exempted the fixture *and anything beginning with it* — an unanchored literal is a prefix anybody can append a real key to. Caught by re-running the Phase 2 verification: assert the exemptions hold, then assert that real credentials wearing the same clothes are still reported. The lesson repeats because the mistake is easy. |
| Writing the fixture down again failed the same scan | This document's first draft quoted the offending string while explaining it, and stage 1 flagged the explanation. A scanner reads prose and code alike, and it is right to: a credential in a sentence is still a credential in the repository. Two lessons, and the second is the expensive one. **Describe the shape rather than reproduce it** — done here and in `.gitleaks.toml`'s own commentary, which had the same trap latent in it. And **a scan runs over a branch's whole range**, so removing the string in a later commit does not clear it: the two sentences needed their own exemptions, each bounded by fixed text on both sides so nothing can be appended to make one match a real key. Verified the way the row above was: assert the exemptions hold, then assert that real credentials wearing the same clothes are still reported. |
| An SSRF guard makes its own gateway hard to test | A local test server is on a refused address, so there is no hermetic way to exercise a real successful call. Resolved by injecting `fetch`, the resolver and the **log sink**, which also bought the most valuable assertion in the module: the credential goes out on the wire and is nowhere in what was written down. |

---

## 5. Verification so far

| Check | Result |
|---|---|
| Unit tests | 370 passing, 59 of them over this module |
| — the address guard | 14, each naming the attack or operational failure it prevents |
| — envelope encryption | 13, covering rotation, tampering and the absence of a key |
| — the gateway end to end | 11, with `fetch`, the resolver and the log sink injected |
| Module contract | clean, including the new single-egress rule |
