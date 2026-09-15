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

**MOD-08 is complete**: major incident, problem and change, delivered one epic
per pull request, and **MOD-10 is complete**: E1 gave them something to point
at, E2 gave the register somewhere to come from. Phase 4 is where the platform reaches outside: calls to other systems, assets discovered
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

### 2.4 Problem management (MOD-08-E2)

The ITIL practice with a reputation for being the one nobody does. The usual
reason is structural: it is built around its least useful moment — finding the
root cause, weeks later, when everybody has moved on.

**So this module is built around the workaround instead.** A problem may become
a known error with no root cause at all, because the workaround is usually known
within hours — "use the old form", "restart the service" — and the cause within
weeks, if ever. Making the useful output wait for the interesting one is why
problem backlogs fill with problems nobody hears about again. Publishing a
workaround and becoming a known error are the same call, because there is no
useful moment at which a workaround exists and the problem is not one.

**A workaround is retired the moment it is obsolete, in the same transaction
that makes it obsolete.** The trap is specific: a problem is fixed, nobody
remembers the known error, and agents go on applying a workaround for a bug that
no longer exists — losing the time twice, once following it and once working out
why it did not help. Worse, the known-error list becomes something experienced
agents learn to ignore, which costs far more than the individual instances. The
retirement event names the knowledge article carrying the same words, so that
can be withdrawn too.

**Linked tickets are the argument.** "This should be fixed" is an opinion; "this
has hit forty-one people since March, and the workaround was applied to eleven
of them" is a case, and it is the only thing that gets a problem prioritised
against feature work. The link is unique per (problem, ticket), because two
agents linking the same ticket is what happens and a duplicate would inflate the
one number anybody uses.

**Recurrence is suggested, never created** — the same posture as the knowledge
review sweep. A platform that raised problems by itself would bury the three
somebody cares about, and the costs are asymmetric: a wrong suggestion costs a
glance, a wrong problem is a permanent list entry nobody dares delete.

The single exception is a **severe major incident's review, which raises exactly
one problem**, idempotent on the incident and held by a partial unique index. The
objection to automatic creation does not apply to a handful of records a year
that everybody already agrees need looking into.

### 2.5 Change management (MOD-08-E3)

Change control's characteristic failure is not changes going wrong. It is
changes going **unrecorded** — and the changes that escape are not a random
sample. They are the routine ones (too small to be worth the paperwork) and the
urgent ones (no time for the paperwork), which are respectively the changes most
often made and the changes most likely to have caused the outage somebody is
investigating next week. A change record with holes in it is worse than none,
because "there were no changes that night" is a sentence people act on.

So the controls are arranged to be **enforced where they can be and honest where
they cannot** (ADR-0026).

**Three kinds, approved three ways.** A *standard* change is pre-approved as a
class by a published template and pinned to the template version that was signed
off. A *normal* change goes to MOD-17 — and where no policy matches it is
approved with the reason recorded, because a tenant without a CAB policy is not
asking for every change to be blocked, and "approved because no policy applied"
must stay distinguishable from a change that slipped past one. An *emergency*
change is recorded first and approved afterwards.

**A blackout refuses; a change window advises.** The asymmetry is the same
argument twice. A blackout is a small number of declared periods with a named
owner and a reason, and the point of declaring one is that it holds — so an
overlapping change is refused, *overlapping* rather than *contained*. Change
windows have a large set of legitimate exceptions, and refusing there would push
people to raise ordinary changes as emergencies: a small governance win for a
large hole in the record.

**The emergency debt is a column, an index and an endpoint**, not a good
intention. `GET /changes/owed-retrospectives` lists the approvals nobody has
given, with an overdue count, and the retrospective approval is refused from the
person who requested the change — the person who made it at 3am is exactly the
person who should not sign it off at 9am. **A rising count of unapproved
emergency changes is this module's health metric**: it says the emergency path
is being used as a shortcut, which is what a permissive design has to be watched
for.

**Two fields are worth refusing over and no others**: a back-out plan on
everything but an emergency change, because a change nobody can undo at 2am
turns a bad deploy into an outage; and a close code, because the only reason to
keep the record is to be able to ask later whether it worked. No free-text
justification is demanded anywhere — a demanded justification is a filled box.

Weekly windows are local wall-clock times against a zone, for the reason
ADR-0024 gives, and the tests cover both UK daylight-saving transitions: the
Saturday 22:00–02:00 window is three hours long in March and five in October.

---

### 2.6 Assets and the CMDB (MOD-10-E1)

**Two registers, not one.** An asset is a thing you own; a configuration item is
a thing that can break. The same laptop is both, a spare monitor in a cupboard is
only an asset, and a SaaS platform you consume is only a configuration item. One
table for both is the shape that produces a register where every column is
optional for half the rows — and a register like that gets filled in badly and
then trusted. The link between them is a nullable key with a partial unique
index, so at most one asset is any one item (ADR-0027).

**Impact traversal is the only thing here with a performance target**, because
it is the only thing asked during an incident by somebody who will wait about
two seconds: under a second at 100 000 items and 500 000 relationships at depth
3 (doc 18 §1). Three mechanisms meet it — a depth bound, the two typed-edge
indexes doc 06 §2.4 names, and a 60-second per-item cache dropped on any
relationship write. Beyond three hops an answer tends to reach everything, and an
answer that reaches everything is not an answer.

**Cycle detection is not optional decoration.** Real estates are full of cycles:
a webserver runs on a VM, the VM is a member of a cluster, the cluster depends on
the webserver for its health check. Without the path array the query does not
return a wrong answer, it returns *no* answer, and the first anybody hears of it
is a request timing out mid-incident. The integration suite builds a three-item
cycle and asserts the traversal terminates with each item counted once at its
shortest distance.

**Retirement is filtered inside the traversal, not on the result.** A
decommissioned server that still carries its old edges must not pass impact
*through* itself to what sits behind it; filtering only the result would hide the
dead server and keep everything it reached. Items are retired, never deleted —
deleting one breaks every incident, problem and change that named it, and a CHECK
constraint keeps `status = 'retired'` and `retired_at` in step because the
traversal reads the timestamp.

**Direction is stated once and read back as a sentence.** `from depends_on to`
means: if **to** fails, **from** is in trouble. Writing a relationship returns
"checkout depends on orders-db: if orders-db fails, checkout is in trouble",
because a reversed edge is the mistake most often made and least often noticed,
and a confident wrong answer sends people to look at the one thing that is fine.

**Class-declared attributes are validated on write, refusing rather than
coercing**, and every problem is reported in one pass. `cpuCount: "eight"` stored
silently as a string is the row that breaks a report six months later; an
importer told about one bad field at a time fixes a spreadsheet forty times.
Classes inherit most-general-first so a subclass may tighten what it inherits,
and a class loop is refused at write time because the attributes a loop reports
depend on where the depth bound cuts it.

**The link table closes the gap MOD-08 left.** One polymorphic table across
ticket, major incident, problem and change, so "what has touched this item?"
returns Tuesday's change and Wednesday's incident in one list, in order. A change
record that cannot name what it changed cannot be correlated with the outage that
followed it.

**Nothing in this module infers anything.** Every edge and every link was written
by somebody who decided to write it. An empty CMDB sends people to ask somebody
who knows; a confidently wrong one sends them somewhere else entirely. Discovery
(E2) will propose; a person will still confirm. Reading and writing are separate
permissions for the same reason: an agent reads the register during triage and
may say what a ticket touched, but the register's value is that its contents were
decided.

---

### 2.7 Discovery, reconciliation and contracts (MOD-10-E2)

**The register stops depending on people typing, without starting to depend on a
feed being right.** Every disagreement between a source and the register is a
proposal by default, and a tenant loosens that field by field once it has a
reason to (ADR-0028). The failure this avoids is the one that ends most CMDBs: a
feed writes straight through, somebody upstream renames a column, four hundred
rows change overnight, the run reports success, and the first anybody hears of it
is an impact answer during an incident that is quietly wrong.

**A field the feed does not send is silence, not an instruction.** The single
most important line in the reconciler, and the one with a test named after it. A
source that stops sending a column — a permission lost, an API version bumped, a
filter somebody added — looks exactly like every device losing that value at
once, and under `source_wins` a naive implementation blanks them all.

**Rejection is remembered and pending proposals are superseded.** A proposal
somebody has already refused, with the same values, is not raised again;
otherwise saying no costs a click a day for ever and the queue trains people to
accept everything to make it stop. A pending proposal for the same thing is
superseded rather than duplicated, so a daily run does not leave seven copies of
every disagreement by Sunday.

**Accepting takes `cmdb.manage`.** Not a permission of its own: accepting writes
the register, and a separate "may accept discovery" permission would be a way to
write the register without the permission to write the register. Everything a
source writes is validated against its class exactly as a person's entry would
be, because a way round a rule is where the bad rows come from.

**The presets are mappings, not connectors.** Intune, Azure and AWS are the
generic HTTP source with the boxes filled in — there is no per-source code path,
so an estate that lives somewhere none of them cover configures the generic kind
and behaves identically. Intune matches on its own device id rather than the
serial: a machine re-imaged and re-enrolled keeps the serial and gets a new id,
and manufacturers do reuse serials.

**AWS reads an inventory export rather than the API, and says so.** AWS
authenticates with SigV4 request signing; the gateway attaches a credential as
one header, so signing belongs where outbound calls are built — inside the
gateway — and a signer written in this module could not be verified against
anything in this repository. An unverifiable signer that fails only against live
AWS is worse than an honest gap. **SigV4 in the gateway is tracked as the
follow-up**; Azure needs none of this and works natively through Resource Graph.

**CSV is parsed, not inferred.** No type coercion, so a serial of `0012345` stays
`0012345`; a quoted field containing a comma or a newline stays one field; a
duplicate column header is refused rather than resolved. Fifteen tests, because
the failure mode is silent — every column after a mis-read quote shifts by one
and the import succeeds.

**Contracts are keyed to the notice date, not the end date.** After the notice
date, renewal is no longer a decision, so a report that warns thirty days before
a contract *ends* on one with ninety days' notice tells you sixty days too late.
`notice_missed` is its own state and the sweep counts it separately: those are
contracts that have committed money nobody chose to commit this year.

---

## 3. What remains in Phase 4

| Module | Why it is not done |
|---|---|
| **SigV4 signing in the gateway** | The one thing MOD-10-E2 could not do honestly. AWS request signing belongs where outbound calls are built, not in a module; until it exists the `aws` discovery kind reads an inventory export. Small, self-contained, and it unlocks every AWS API rather than only this one. |
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
| A module can be built, registered and unreachable from its own tests | MOD-08-E1's integration suite failed on `Cannot find package '@itsm/module-incident'`, in two tests out of twenty-four — the two that import the module directly. The module existed, built, typechecked and was registered in the runtime; pnpm resolves only *declared* dependencies, and the integration suites live at the repository root, where it was not one. MOD-20 had the same gap and had simply not reached for its own package yet, which is the argument for a rule over a fix: the failure arrives on whichever suite first needs it, long after the module was written. Now checked mechanically as module-contract rule 7, and the rule was proved to fail before it was trusted to pass. |
| The same trap was already in MOD-04, and the platform had already solved it once | Auditing for the row below found `JSON.stringify(before) === JSON.stringify(after)` in `ticket-service.ts`, where `MUTABLE_FIELDS` includes `custom` — a JSONB column. Re-sending identical custom fields recorded a change: an audit row, a version bump, a `ticket.updated` event and every rule and notification waiting on one. Nothing failed; the ticket simply acquired a history of edits nobody made. The same audit found `packages/platform/src/audit.ts` already carrying a correct private `canonical()` for the hash chain — so the idea existed three times, once right and twice missing. It is now one helper in the platform, with a module-contract rule (8) failing the build on a hand-rolled comparison, proved to fail before it was trusted to pass. **The audit copy was deliberately left alone**: it sorts with `localeCompare` where the shared helper sorts by code point, and the two disagree on any key starting with a capital, so adopting the shared one would change historical hashes and make the nightly verifier report tampering that never happened. That `localeCompare` is itself locale-dependent, and therefore a reproducibility risk across Node builds with different ICU data, is recorded as a separate finding: fixing it needs a hash version on the row and a verifier that understands both. |
| `JSON.stringify` is not a value comparison once a value has been through JSONB | MOD-10-E2 fingerprints a discovery proposal so that one a person already rejected is not raised again. The fingerprint was `JSON.stringify(proposed)` on both sides — but PostgreSQL JSONB does not preserve key order, so the stored copy came back with its keys rearranged and never matched. The effect was not a crash: rejecting a proposal simply stopped working, and the same suggestion returned every run for ever, which is the behaviour the feature exists to prevent. Unit tests could not see it, because in JavaScript the object never round-trips; the integration suite found it on the first run against a real database. The same flaw was latent in the reconciler's object comparison, where it would have reported an unchanged attribute as changed on every run. Both now use a canonical fingerprint with sorted keys, and the unit tests assert that reordering keys does not change it while reordering a *list* does — order is information in one and not the other. |
| An SSRF guard makes its own gateway hard to test | A local test server is on a refused address, so there is no hermetic way to exercise a real successful call. Resolved by injecting `fetch`, the resolver and the **log sink**, which also bought the most valuable assertion in the module: the credential goes out on the wire and is nowhere in what was written down. |

---

## 5. Verification so far

| Check | Result |
|---|---|
| Unit tests | 573 passing, 250 of them over the six modules |
| — the address guard | 14, each naming the attack or operational failure it prevents |
| — envelope encryption | 13, covering rotation, tampering and the absence of a key |
| — the gateway end to end | 11, with `fetch`, the resolver and the log sink injected |
| — rotas and shifts | 26, including both daylight-saving transitions with real dates |
| — routing strategies | 17, every tie-break and every refusal |
| — the incident lifecycle | 17, each naming the way an incident goes wrong without the rule |
| — the problem lifecycle | 12, written so that reversing the workaround-first ordering fails |
| — change windows | 19, including both daylight-saving transitions and every overlap shape |
| — the change lifecycle | 16, pinning the three trades between control and coverage |
| — CMDB attributes and edges | 19, including the assertion that the traversal's default edge set and the domain's view of what carries impact cannot drift apart |
| — CSV reading | 15, every one a way a split-on-comma reader fails silently |
| — field mapping | 18, including each built-in preset's mapping |
| — reconciliation | 17, written so that removing the absence-is-silence rule fails, and so that a key-order difference from JSONB is not read as a change |
| — contract dates | 12, over notice, expiry and both sides of auto-renewal |
| Integration, isolation and permissions | extended by 22 workload tests, a 23-test CMDB suite, a 22-test discovery suite, five permission-matrix entries and five register-write assertions, against live PostgreSQL, Redis and Meilisearch |
| Module contract | clean, including the new single-egress rule |

The rota tests are the highest-value read after the address guard. A night shift
over 29–30 March is seven hours and the same shift over 25–26 October is nine;
counted in milliseconds both would be eight, and everybody would go home an hour
early once a year. Each test names the silence it prevents rather than the line
it covers.
