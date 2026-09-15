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

### 2.2 Workload and routing (MOD-20)

**Who should do this?** The question every other module had been asking and none
could answer. A rule could put a ticket on a queue; it could not put it on a
person, because nothing knew who was at work, what they could do, or how much
they were already holding. `assignStrategy` had been in the rule schema since
PH-2 and refused at publish ever since.

**Rotas, shifts and turns are computed from a definition and the clock, never
advanced by a job** (ADR-0024). A rotation could hold a `currentMemberIndex`
and a Monday job; round robin could hold a `lastAssignedIndex`; a shift could
write `off_shift` onto everybody at six. All three are cursors — state that is
correct only if every advance happened exactly once, in a platform whose
eventing is deliberately at-least-once. A cursor advanced twice skips somebody's
turn and one that is missed repeats it, and neither fails loudly: the symptom is
that nobody is paged on the night it matters, six weeks after the bug.

Handovers are counted in whole **local days**, so a daylight-saving change
cannot move one by an hour and eventually by a turn. A swap is an **override**
that leaves the rotation untouched, because the rota is a fact about every week
and a swap is a fact about one of them — arranging cover by reordering the
member list moves everybody's turn for ever. Load is counted live against an
index that already existed, so the number cannot drift.

**A routing decision carries the candidates it rejected and why**, and
`GET /workload/routing/:teamId/explain` rehearses one without assigning
anything. "Nobody is available" is a complaint; "nobody on the team can take it;
4 of 6 away" is something an administrator acts on before lunch. When routing
finds nobody it publishes `workload.assignment.declined` with that reason and
the ticket stays on the group queue: a queue that silently stops moving is
indistinguishable from a broken router, and only one of those is worth waking
somebody for. Filters are never relaxed to find *somebody*, because that turns a
visible staffing problem into an invisible one.

Somebody who has **left** never receives work and no date brings them back.
Somebody **rostered off shift** does not; somebody on **no shift at all** is not
off shift but simply unrostered — without that distinction a tenant who enables
the module before describing their shifts finds that nothing routes to anybody,
which looks exactly like a broken installation.

**`assignStrategy` works.** The rules handler asks MOD-20 inside the same
transaction as the rule's other effects, so a rule that fires exactly once
assigns exactly once. It routes work that has nobody on it, and work it is
moving to another team; it does not take a ticket off the person already
working on it, because a rule on `ticket.updated` would otherwise reassign the
same ticket every time anybody touched it. The assignment reaches MOD-04
through an `assignee` channel on `applyAutomatedChange` rather than the field
patch: `assigneeId` is deliberately not a field automation may set, and an
assignment has its own ticket event, audit action and published event.

`ACTIONS_NOT_YET_AVAILABLE` is now empty. Every action the rule schema accepts
is one the platform carries out.

### 2.3 Major incident management (MOD-08-E1)

An ordinary ticket is one person's problem. A major incident is everybody's, and
what makes it different is not severity but **coordination**: somebody has to be
in charge, somebody has to keep the organisation informed on a promise it can
rely on, and afterwards somebody has to be able to say what happened.

**A commander is required at declaration.** The commonest way an hour is lost is
that everybody assumed somebody else was in charge. The role can be handed over,
and the hand-over goes on the timeline rather than only on the row, because "who
was running it at 04:10?" is a question a review asks and a current-value column
cannot answer.

**One open major incident per ticket, enforced by a partial unique index.** Two
people declaring the same outage within the same second is the normal case, not
a rare one, and the symptom is two bridges with half the responders on each.
Closed and stood-down incidents are excluded from the constraint, so a ticket
that breaks again can be declared again.

**The promise of an update is the product.** An organisation told "every thirty
minutes" reorganises its morning around that, and the damage of missing it is
not the missing information — it is that every future promise is discounted, so
people ring the service desk instead and take the responders off the incident.
The cadence comes from the severity so that nobody is choosing one at 3am; only
a `comms` entry resets it, because an internal observation is not an update to
the organisation; and when it is missed the sweep **reports** rather than posting
something on somebody's behalf, which would keep the cadence and destroy the
thing the cadence is for. The due time steps on by one interval rather than to
now, so a long silence keeps ringing instead of being reported once.

**Audience is access control, not presentation** — the lesson MOD-09 taught with
article audiences, one module along. A public update on an incident nobody
outside can see is refused rather than quietly downgraded, because downgrading
would leave the person who wrote it believing customers had been told.

**The timeline is append-only in the database.** A review answers "what did we
know, and when?", and a timeline somebody can revise afterwards cannot answer
it. UPDATE only: blocking DELETE would also block the tenant purge and leave a
purged customer's timelines behind.

**Resolved is not closed** (ADR-0025). Publishing the review is what closes the
incident, in one transaction, so the middle state — a published review on an
incident nobody closed — is not reachable. A review opens by itself when the
incident resolves, because a review that has to be remembered is not written.
Every action needs an owner and nothing else is demanded: a required root cause
buys "human error" typed into a box, where an owner is the one field that cannot
be fudged past the check.

---

## 3. What remains in Phase 4

| Module | Why it is not done |
|---|---|
| **MOD-08-E2 Problem management** | Problems, known errors, and the link from a major incident's review to the problem it raises. The natural next module: it has somewhere to attach now. |
| **MOD-08-E3 Change management** | Change records, CAB approval through MOD-17, change and blackout windows, standard change templates. |
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
| Delivering a feature leaves its refusal tests behind | The graph validator's unit test was updated when the `action` node became available; the integration test asserting the same refusal was missed, and stage 3 caught it. The pair exists because they check different layers, so they have to be found together — and a test that asserts a *message* naming a future phase has a shorter life than one that asserts behaviour. The replacement checks that the workflow publishes, which stays true for as long as the node exists. MOD-20 hit the same trap in the same week with the rules engine's `assignStrategy`, so it is worth looking for rather than waiting for. |
| An SSRF guard makes its own gateway hard to test | A local test server is on a refused address, so there is no hermetic way to exercise a real successful call. Resolved by injecting `fetch`, the resolver and the **log sink**, which also bought the most valuable assertion in the module: the credential goes out on the wire and is nowhere in what was written down. |

---

## 5. Verification so far

| Check | Result |
|---|---|
| Unit tests | 445 passing, 122 of them over the three modules |
| — the address guard | 14, each naming the attack or operational failure it prevents |
| — envelope encryption | 13, covering rotation, tampering and the absence of a key |
| — the gateway end to end | 11, with `fetch`, the resolver and the log sink injected |
| — rotas and shifts | 26, including both daylight-saving transitions with real dates |
| — routing strategies | 17, every tie-break and every refusal |
| — the incident lifecycle | 17, each naming the way an incident goes wrong without the rule |
| Integration, isolation and permissions | extended by 22 workload tests and four permission-matrix entries, against live PostgreSQL, Redis and Meilisearch |
| Module contract | clean, including the new single-egress rule |

The rota tests are the highest-value read after the address guard. A night shift
over 29–30 March is seven hours and the same shift over 25–26 October is nine;
counted in milliseconds both would be eight, and everybody would go home an hour
early once a year. Each test names the silence it prevents rather than the line
it covers.
