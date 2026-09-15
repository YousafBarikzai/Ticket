# 22 · Phase 3 readiness and delivery record

**Status: delivered, pending the pipeline.** All four workstreams are built, the
two open decisions Phase 2 left are closed, and the walking skeleton runs 45
assertions against the bundled production artefacts. This document records what
was built, what it found, and what remains — in the same shape as
[20](20-phase-1-readiness.md) and [21](21-phase-2-readiness.md), so the three
read as one delivery history.

At the time of writing: **15 modules, 85 tables, 119 endpoints, 50 event types**,
**22 accepted decision records**, and **303 unit tests** alongside the
integration, isolation and permission suites.

---

## 1. What Phase 3 is for

Phase 1 proved the platform could hold a ticket safely. Phase 2 made it act on
its own inside a single event — routing what arrives, chasing what is late,
asking the right person before something happens.

Phase 3 adds the two things a service desk needs that neither of those covers:
**time** and **knowledge**.

Time, because the useful automations do not finish inside one event. "Ask the
manager, wait for the hardware, then tell the requester" takes days, survives
restarts, and must not do its work twice when a worker dies halfway through. A
rules engine cannot express that, and bolting waits onto one produces something
that is neither.

Knowledge, because the cheapest ticket is the one nobody raises. That only works
if the answer is findable by the person who needs it and invisible to the person
who should not see it, which makes a knowledge base an access-control problem
wearing a content-management costume.

---

## 2. The decision Phase 2 left open (ADR-0021)

`compare()` in `packages/expr` fell back to comparing operands as strings when
they were not both numbers, which made `ticket.title > 5` **true** — `"V"` sorts
after `"5"` — so a nonsense condition matched every ticket and reported no error.

Closed as recommended: **it raises.** Two carve-outs keep that safe.

- **A missing value is not a type error.** An absent optional field still fails
  its comparison quietly, so a rule reading a custom field nobody filled in is
  not reported as broken. Without this, every rule touching a custom field would
  have become an error the first time somebody left it blank.
- **A `Date` may meet a string that parses as one.** Load-bearing rather than a
  convenience: on the server a timestamp arrives from the database as a `Date`,
  and in the browser the same value has been through JSON and is an ISO string.
  Without the crossing, the dry-run panel and the live path would disagree about
  the same condition — the one thing a shared expression language exists to
  prevent.

Raising alone would only tell an author their rule is broken the first time a
ticket happened to hit it, in a log they do not read. So `checkExpr()` applies
the same judgement statically against the caller's declared fact types, and rule
publishing refuses the definition with the conflict named on the field. Forms
are checked exactly, because the form schema already declares each property's
type. A tenant-defined namespace — `fields.*`, `answers.*` — is not checked and
must not be: claiming otherwise would mean refusing every rule that reads a
custom field.

Every caller states its own failure direction in code rather than inheriting
one: the engine fails the one rule and keeps going, approvals skip the policy,
entitlement denies, a field whose visibility cannot be decided is hidden, and a
form with an unevaluable condition reports itself as misconfigured at the top
rather than rendering fields that behave unpredictably.

Nothing seeded used an ordering comparison across types — checked by running the
new checker over every seeded export — so the change landed without a data
migration.

---

## 3. Delivered

### 3.1 Workflow engine (MOD-06-E1)

The rules engine's sibling. Both interpret JSON over the same expression
language and the same versioned-definition lifecycle; what this one adds is that
a run takes minutes or days rather than milliseconds.

**Exactly-once rests on one unique constraint.** Claiming a step means inserting
`wf_step_run(run, step, attempt)`; a second worker reaching the same step fails
the insert and stops. No locks, no leases, no clock. The effect runs *between*
two transactions with that row as a durable marker, and the idempotency key is
deliberately independent of the attempt — so a worker killed mid-effect retries
with the same key and whatever it did deduplicates rather than happening twice.

The asymmetry is the whole design: the engine promises **at-least-once
execution** and derives **exactly-once effects** from the key, because a
distributed system cannot promise the first and a person cannot tolerate the
second.

**A run is pinned to the version it started on.** Publishing a change must not
rewrite what is in flight. A person's request finishing under rules nobody chose
for it is the failure that makes an organisation stop trusting automation, and
it is indistinguishable from a bug when it happens.

**Waits live in PostgreSQL**, not only as delayed jobs. Redis is a scheduler,
not a system of record, and a run that vanishes because a queue was flushed is
what an automation engine never gets forgiven for. A sweep re-fires timers Redis
has forgotten.

**Validation refuses at publish what would be silent at run time**: unreachable
nodes, dead ends, loops with no way out, a wait for an event with no timeout, a
mistyped `{{path}}`, and `action` steps, which arrive with MOD-06-E2. The test
panel drives the same graph through a registry that writes nothing, so a
rehearsal cannot take a different path from the real run.

`startWorkflow` now works. It had refused at publish for the whole of Phase 2,
naming this phase.

### 3.2 Knowledge base (MOD-09)

Articles as versioned definitions, the same shape as rules, forms and SLA
policies — because the questions asked after an article gives somebody the wrong
instruction are the same ones. What did this say when they followed it? Who
approved that wording? Can we go back? A knowledge base whose history is a
mutable text field answers none of them.

So a published article stays published while the next version is written,
publication freezes a version, and a rollback publishes an earlier version's
content **forward** as a new one. Version 8 restoring version 3 leaves a history
showing that a rollback happened, which a silent reversion would hide.

**Audience is access control, not presentation**, for the same reason catalogue
entitlement is. A runbook naming the break-glass account must not reach a
requester's portal, and "we do not render it on that page" is not a control when
search is a different page and the API is a different client. It is enforced
twice: through the search ACL, which decides what is *listed*, and on the read
path, which decides what is *served* — so somebody who guesses a key is refused
with a 404 rather than a 403 that would confirm the article exists.

Retiring removes the search document immediately and keeps the versions:
withdrawn instructions that are still findable are worse than missing ones,
because a reader has no way to know they are withdrawn.

Deflection counts articles recorded as having closed a ticket, not views. A
knowledge base judged on views optimises for interesting titles.

### 3.3 Search on Meilisearch (MOD-09, closes OD-02)

A `SearchBackend` interface now sits between what search means and where it
runs. The projection table, the ACL shape, the indexer and every caller are
unchanged, which is what ADR-0017 predicted and what made the swap contained.

**The PostgreSQL projection is not a legacy path.** It is written in the same
transaction as the change it describes, so it is the one backend that can never
be stale, and it is what search falls back to when the engine is unreachable.
Losing the search server costs typo tolerance and true facet counts rather than
search. Every response reports which engine answered, so a degraded answer is
visible rather than indistinguishable from a healthy one.

**Both backends filter on one resolved `Visibility`** rather than each deriving
a predicate from the context, because that is the only way two implementations
of a permission filter stay in agreement. The integration suite asks both
directly, at every scope, and compares: an engine returning one document the SQL
would have hidden is a data breach, not a relevance bug, and no test of either
engine alone would catch it.

One index per tenant, *and* `tenantId` filtered on every query — the index name
is a string and strings can be built wrongly. A purged tenant takes its index
with it, through a purge-hook registry in the platform so that tenancy need not
know which modules keep state elsewhere.

Written against `fetch` rather than the official client: the API this uses is
six endpoints, and the production image scan has already rejected three
libraries the application never executes.

### 3.4 Email providers (MOD-03, closes OD-03, ADR-0022)

Postmark and Microsoft Graph, chosen **per tenant** on the channel account,
because it is a customer's decision and not an operator's. One customer's
data-residency commitment should not decide another customer's mail provider.

There is no fallback between them. A misconfigured Graph mailbox sends nothing
rather than quietly sending through Postmark — which is precisely what that
tenant chose Graph to avoid.

**Credentials are referenced, never stored.** The account's `config` is
tenant-editable JSON, so a token in it would be readable by anyone who can
configure a mailbox and would land in every audit payload and configuration
export. The account names a credential; the value resolves from the environment.
That is a reference an encrypted store can satisfy later without any adapter
changing.

**The inbound route resolves which mailbox a delivery claims to be for before
verifying it**, because a Graph notification and a Postmark webhook are verified
in entirely different ways. Looking up which mailbox a request names is not the
same as trusting the request.

Neither provider's verification is as strong as one would like, and both
adapters refuse rather than assume. Postmark does not sign inbound webhooks, so
the adapter requires the URL secret and refuses a delivery carrying nothing —
"no signature configured" must never read as "verified". Graph echoes a
`clientState` instead of signing, and every notification in a batch must match,
since accepting the batch would accept a stranger's along with ours.

---

## 4. What remains

| | |
|---|---|
| **MOD-06-E2 actions and connectors** | `action` nodes are refused at publish naming PH-4. They need the integration gateway for rate limits, credentials and redacted logs; building them without it would mean a workflow that can call any URL with no budget and no audit. |
| **A per-tenant credential store** | Provider credentials resolve from the environment today. That is safe and works on a per-service environment, but a true multi-tenant deployment wants an encrypted store (MOD-14, PH-4). The reference indirection is already in place, so this is a resolver change rather than an adapter change. |
| **A Graph subscription renewal job** | The function exists; the schedule that calls it does not. Until it does, a Graph mailbox needs its subscription renewed by hand every three days. |
| **Railway and Cloudflare** | Still the gate for pipeline stages 4 to 6. Nothing in Phase 3 changes that. |
| **Nine specification change requests** | SCR-01…SCR-09 remain open in [19 §4](19-risks-and-decisions.md). |

---

## 5. Verification

| Check | Result |
|---|---|
| Unit tests | 303 passing |
| Integration, isolation and permission suites | green in CI against a live PostgreSQL, Redis and Meilisearch |
| — tenant isolation (Appendix D, release-blocking) | extended to knowledge and workflow runs |
| — permission matrix (Appendix B, release-blocking) | extended to knowledge and workflow operations |
| Walking skeleton | 45 assertions against `node dist/api.js` and `node dist/worker.js` |
| CI stage 1 — validate | green |
| CI stage 2 — image build and vulnerability scan | green |
| CI stage 3 — integration | green |

The isolation suite continues to seed two tenants with **deliberately identical
data** — the same article keys, the same workflow keys, the same titles —
because a leak between tenants whose data differs is easy to spot and one
between tenants whose data matches is not.

---

## 6. Defects and traps this phase found

Recorded because each cost time and would cost it again.

| What | Why it mattered |
|---|---|
| `eq` compared **truthiness** whenever either side was a boolean | `{ eq: [x, true] }` held for any non-empty string. That is the exact shape of a workflow condition node's branch, so every one would have followed its "yes" edge whatever the step returned. Found by a workflow test, fixed in the expression language, and pinned there. |
| The graph validator called every timeout handler unreachable | Reachability followed `edges`, and `onTimeoutKey` is not an edge. It reported the reference workflow this platform *ships* as invalid — which would have taught administrators that the validator cries wolf, and that is a lesson they only need once. |
| A requester could never find a public knowledge article | The search ACL's `tenantWide` means "visible to a caller whose scope is team or wider", because every ticket carries it and that is what keeps one requester's ticket out of another's results. An article for the whole tenant is meant for requesters, so self-service knowledge was invisible to the people it exists for. Fixed with a separate `everyone` flag; tickets never set it. |
| Publishing a second version of an article was refused | `publishArticle` asserted a `published → published` transition, so every edit after the first came back with "this article is already published". Publishing the next version is not a transition: the status does not change, the current version does. |
| A bulk edit granted an agent the wrong knowledge scope | A `replace(..., 2)` intended for the requester role hit the agent's block too, leaving agents with `knowledge.read` at `own` scope — which would have made internal runbooks unreachable by the only people they are written for. The same shape as the Phase 2 role-permission defect, found the same way: by printing every role's grants rather than reading the diff. |
| A retired article stayed in the search engine | `removeDocument` deleted the projection row and nothing removed the document from Meilisearch, so withdrawn instructions remained findable — worse than an article that never existed, because a reader has no way to know they are withdrawn. The same shape as the Phase 2 tenant-purge defect, one layer out: the database looked clean and the copy lived elsewhere. It now publishes the same event an index does, and the consumer that already handles "the row has gone" removes it. |
| The Meilisearch image carries neither curl nor wget | A Docker health check would have failed for the wrong reason and the whole integration stage would have looked broken. The test setup polls `/health` from the runner instead. |
| `require()` in an ES module | Reached for out of habit while writing a constant-time comparison. It typechecks and fails at run time, in a verification path — the worst place for it. The shared `constantTimeEquals` now covers both adapters. |
| An open fact namespace cannot be spell-checked | `{{answers.emial}}` cannot be caught at publish, because form answers are tenant-defined. A test asserting otherwise was wrong, not the code. The same principle as `fields.*` in the rules engine; worth stating once rather than rediscovering per module. |

### 6.1 A smaller question left open

`eq` still compares a number to the string of that number: `5 == "5"` holds.
Left deliberately, and recorded here rather than fixed quietly. A cross-type
equality answers *false* or matches one specific wrong value; a cross-type
ordering matched *everything*, which is why only ordering was made to raise. The
boolean case was different in kind — it matched everything a branch could
return — and was fixed.

If this is to change, Phase 4 is the time, and it should change the same way:
raise, caught per rule, with a static check at publish.

---

## 7. What Phase 4 inherits

- The workflow engine's node set, retry protocol and error queue are built.
  `action` nodes need the integration gateway and nothing else; the refusal at
  publish already names it.
- The search backend interface has two implementations, so a third — the vector
  retriever for the governed AI service — is an implementation rather than a
  redesign. The ACL is applied before ranking, which is what ADR-0017 said would
  make it reusable.
- Knowledge articles are versioned, audience-scoped and indexed, which is what
  the PH-4 retriever needs to cite them without leaking them.
- The credential reference indirection is in place, so MOD-14's encrypted store
  is a resolver change.
