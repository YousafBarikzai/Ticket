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
per pull request. **MOD-10 is complete**: E1 gave them something to point at, E2
gave the register somewhere to come from. **MOD-03 is complete**: email from
PH-2, and Slack, Teams, WhatsApp and voice on the same framework in PH-4. Phase 4 is where the platform reaches outside: calls to other systems, assets discovered
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

### 2.8 Request signing in the gateway (MOD-14-E3)

**The gap MOD-10-E2 named, closed.** AWS authenticates a *request* rather than a
caller: the signature covers the method, path, query, chosen headers and a hash
of the body, and is valid for one day, one region and one service. There is no
header to attach, because the header does not exist until the request is
finished — so signing happens in the gateway, where requests are finished
(ADR-0029).

Three things follow from doing it there. The body is **serialised once and both
signed and sent**, which is the classic SigV4 defect and one that fails only
against a live endpoint with no useful message. **`host` comes from the URL**,
not from the caller, because a signature over a host the request does not reach
is rejected and the caller is not the authority on the destination. And the
signature **never reaches the log**, by the same mechanism the bearer path
already used: the log is built from `request.headers`, which has never held a
credential.

**Both halves of the credential live in one stored value**, as JSON under the
kind `aws_sigv4`, validated when it is stored. Two separately-stored halves can
be half-rotated, and a half-rotated pair fails as `InvalidClientTokenId` — which
reads like a permissions problem and sends whoever is on call to IAM policies
rather than to the rotation an hour earlier.

**What is verified is stated rather than implied.** The canonical request and the
string to sign are asserted as plain text against AWS's published worked
example, which a reviewer can check line by line, and which is where SigV4
implementations actually go wrong: path and query encoding, header folding, the
signed-header list, the payload hash. What is not verified here is a live call to
AWS. **No test pins a signature hex from memory** — an assertion like that is
worth nothing if the memory is wrong and worse than nothing because it looks
like verification. The first real request is the acceptance test, and a wrong
signature fails as a clean 403.

A new discovery kind, `aws_api`, reads the Resource Groups Tagging API directly:
broad and shallow, an ARN and tags for everything. The `aws` export kind stays,
because an AWS Config snapshot is *richer* — resource types, regions, and the
relationships AWS already knows about — and plenty of organisations will share an
export bucket long before they issue signing keys. The larger win is not
discovery at all: every AWS API is now reachable from a connector or a workflow
action.

---

### 2.9 Chat channels: Slack and Teams (MOD-03-E2)

**The security boundary for a chat channel is the webhook signature and nothing
else.** An email adapter can at least fall back on the sending domain; a chat
webhook is a public URL that accepts JSON, so without a verified signature "a
message from the finance director asking for every open ticket" is a `curl`
command. Everything downstream — the identity policy, the closed command set —
assumes an envelope that was proved genuine here or not at all.

Four provider constructions, each a place to get it wrong: Slack signs a
timestamped base string, Teams an HMAC keyed by the *decoded bytes* of its
secret rather than its text, Meta a plain body hash, Twilio the URL with its
parameters appended in key order. The timestamp bound is what makes a captured
Slack request stop working — a signature is otherwise valid for ever. The
comparison is constant-time and there is exactly one of it in the module.

**The chat guard replaces RFC 3834 with the signals chat actually has**: the
desk hearing its own voice, another application posting, events *about* a
message rather than messages, and — the commonest by a wide margin — a channel
message that never addressed the desk at all. Each is counted separately,
because "37 rejected" tells nobody anything and "37 not addressed to us" tells
them the desk was invited to a busy channel.

**Identity gets a middle state, and it buys exactly one thing** (ADR-0030). A
workspace can report a verified email, which is real evidence the platform did
not gather — a workspace administrator can usually edit a profile. So it counts
only on a domain the tenant has claimed from that account, and it permits
raising a request in your own name and nothing else. The asymmetry is the whole
decision: a wrongly attributed `createTicket` is a ticket you did not raise,
addressed to you; a wrongly attributed `addComment` puts words in your mouth on
a record people are acting on, `getStatus` discloses, and `decideApproval`
commits money.

The obvious cut — trust the provider for reads, require a code for writes — is
wrong in both directions here, and saying why is the useful part: `getStatus` is
a read and the clearest disclosure risk in the set, `createTicket` is a write
and the safest thing on the list. Sorting by read and write sorts by the wrong
property.

**Teams uses the outgoing-webhook form and says why.** The richer Bot Framework
path needs an Azure AD JWT validated against published keys, with rotation,
issuer, audience and clock-skew handling — all of which this platform already
does correctly for Keycloak in `apps/api/src/auth`, and none of which is
reachable from a module without duplicating it or inverting a dependency. Doing
that badly would be worse than doing the HMAC form well, and the bot path fits
behind the same interface later. What the HMAC form costs is real and stated:
no timestamp, so de-duplication upstream is load-bearing rather than tidy.

**A latent trap found on the way in.** There was no raw-body capture anywhere,
and the email webhook reconstructed the body with `JSON.stringify(request.body)`
before verifying it. That had never bitten because both mail transports
authenticate with a shared-secret header rather than a body HMAC — but
`verifyHmac` was exported and waiting, and all four chat providers sign the
body. Re-serialising loses whitespace and reorders numeric-looking keys, so the
signature never matches, which reads as "the provider is broken" and usually
ends with somebody turning verification off.

---

### 2.10 WhatsApp and voice (MOD-03-E3)

**WhatsApp brings one rule neither Slack nor Teams has: the 24-hour session
window.** Meta permits a free-form message only for 24 hours after the person
last wrote; outside it, nothing but a pre-approved template may be sent. That is
not a quota to retry past. Repeatedly attempting free-form sends outside the
window is how a business number's quality rating is cut and eventually blocked —
losing the channel for every requester, not only the one being replied to. So
the window is checked before sending, and a reply that falls outside it is
reported and dropped while the other channels still carry it.

Delivery and read receipts arrive on the same webhook as messages and are not
messages; a message type the adapter cannot represent is dropped as unsupported
rather than raised as an empty ticket. A phone number is not an email and Meta
vouches for neither, so a WhatsApp identity is always linked by code — the
middle state from ADR-0030 does not apply.

**Voice is a call that has already happened, and the gap is stated first.** It
is not call control: no IVR, no menu, no transfer. Those need a live media
session driven by a provider's markup while somebody is on the line, and none of
it can be exercised against anything in this repository — the same reasoning
that kept an unverifiable AWS signer out of MOD-10-E2 until it could be built
where it was verifiable (ADR-0029).

What it is: the call-completed webhook every telephony provider sends
afterwards, carrying the caller's number, a recording and a transcript. That is
enough for what a service desk wants from voice — the call becomes a ticket with
what was said in it — and it is fully verifiable, because a signature over a
form body is a signature over a form body whether or not a phone was involved.

Two details worth the words. The transcript is recorded **as a transcript**
rather than quoted as the caller's words: it is somebody else's speech
recognition, it will sometimes be wrong, and an agent acting on a misheard
account number has been misled by the platform — so the recording URL travels
with it. And the signature is checked against the **configured** webhook URL,
not the one the request claims: a host header is attacker-controlled, and
signing against it would let somebody choose the string being verified.

Voice takes no automated replies. Calling somebody back is a person's decision,
and an automated outbound call is a different product with different regulations
attached.

### 2.11 The analytics projection pipeline (MOD-12-E1a)

**Reporting keeps its own star schema, fed by events, and rebuilds it rather
than trusting it** (ADR-0031). Fifteen tables: six dimensions, six fact tables,
a daily rollup, a cursor per projector and a drift log. Projectors run as
`required` consumers of seventeen event types across MOD-04, MOD-07, MOD-11 and
MOD-17.

The decision that shapes everything else is that **durations are computed once,
at projection, and stored**. A dashboard that recomputed a business-time
duration would need every calendar and every exception in scope for the whole
period being charted — and, worse, the same figure would change when somebody
edited an opening hour last March. A resolution time is a fact about what
happened, so it is fixed when it happens. Both numbers are kept: business
minutes, which is what an SLA was measured against, and elapsed minutes, which
is what the requester actually waited. A report that shows only the first
quietly disagrees with everybody's experience.

**Projectors read the source row rather than replaying the event payload.**
Delivery is at-least-once and unordered — two workers can process a status
change and an assignment for the same ticket at the same time, in either order
— so a projector that applied "status became resolved" from the payload would
produce a different answer depending on which finished last. The event says
*look again*; the row says *at what*. Two things cannot be read back and are
handled explicitly: the first response takes the earlier of the two candidate
times, and the comment count only ever rises.

**The rollup is treated as a cache of the facts.** Six slices per ticket per day
— all, team, service, priority, team+priority, service+priority — maintained by
addition and subtraction, and rebuilt nightly. For the rebuild to be a
*correction* rather than a *second opinion*, every counter has to be derivable
from a fact row, which is why reopens and breaches are counted against the day
the ticket was **raised** rather than the day they happened: the fact records the
former and not the latter. The integration suite asserts the two paths agree,
because if they did not, the drift check below would be measuring the difference
between two implementations rather than between the projection and the truth.

**Drift is measured against the module that owns the truth, through that
module's own service.** `ticketService.countTickets` was added for it. Reading
`ticket` from the analytics code would produce a check that agrees with the
projection exactly when both are wrong about the same thing — the soft-delete
predicate, the scope filter — which is the failure a reconciliation exists to
catch. Above 0.5 % over a thirty-day window ending an hour ago, a drift row is
written and `analytics.drift.detected` is published. The window ends an hour ago
because an event published a second ago has not been projected yet, and a check
that counted it would report drift on every run and teach everybody to ignore
the alert.

`fact_survey` exists with **no projector**. MOD-18 does not exist, so there are
no `survey.*` events to consume; the table is here so satisfaction needs no
migration when it lands, and so a dashboard can declare a widget that reads zero
rows rather than failing.

---

### 2.12 Metrics, dashboards and scheduled reports (MOD-12-E1b)

**A metric is a structured query, not an expression** (ADR-0032). A fact table,
an aggregate — count, sum, mean, median, 90th percentile or a rate — an optional
field and a list of `(field, operator, value)` filters. Every identifier comes
from a catalogue and is spliced in as a quoted column; every value a person
supplied travels as a bound parameter; the two never meet. Fourteen built-in
metrics are written in exactly the same shape as a tenant's own, so there is
one evaluator rather than two paths that drift apart. The unit tests read the
generated SQL as text and assert that no user value appears in it.

The headline ticket metrics are answered from the daily rollup when the query
is one the cube stores — a slice by team, service or priority, or a breakdown
by one of them — and from the facts otherwise. The integration suite asks the
same question both ways, through a built-in and through a tenant copy of it, and
asserts the two series are identical. Each query names which path answered, so
an operator can see it too.

Analytical reads run on their own pool: `DATABASE_URL_READONLY`, a replica where
the deployment has one and otherwise the primary under `app_readonly`, with a
fifteen-second statement timeout so a runaway query becomes an error for the
analyst rather than a slow save for everybody else (doc 06 §6). With no such URL
configured it falls back to the application pool, so development and the test
suite need no second database; the timeout still applies.

**Dashboards are one table, shared or personal.** A dashboard with no owner is
shared and needs `analytics.manage` to change; one with an owner is theirs and
needs only `analytics.read`. Reading is one permission filtered by ownership —
the query asks for "shared, or mine" — so a private dashboard is absent from
everybody else's list by construction, and a peek at its id is a 404, not a 403.
Three dashboards are seeded (service desk overview, teams, SLA) and left alone
once they exist, so a tenant's edits survive a redeploy. A widget that fails
reports on itself rather than taking the dashboard down.

**A report keeps its result.** A definition is an ordered list of sections; a
schedule says when — a structured `frequency, hour, minute, day, time zone`
rather than a cron string, because "Mondays at 08:00 London time" is what a
person means and it survives daylight saving without an argument about which
08:00 — and who. A run stores what it found, so the figure in March's report is
the figure March's report showed even after a rebuild has corrected the facts
underneath. The CSV is rendered from the stored result on request and served
from the API with a permission check, so nothing goes to object storage and the
link in the notification stays valid for as long as the run exists. Values that
would be formulas in a spreadsheet are defused; numbers are not, because a
margin of −30 minutes must stay a number.

Delivery goes through MOD-11 the way everything else does: the run publishes
`report.generated` and a seeded rule sends it. The rule's audience is a new
descriptor kind, `payload`, which says "whoever the event names" — a scheduled
report knows who asked for it and a rule written in advance cannot. MOD-12 ships
its template and rule as a *pack* that MOD-11's seed includes, so the rows stay
MOD-11's to write. A run somebody asked for right now notifies nobody: they are
looking at the result.

**The projector became a pure function of the source rows.** E1a carried two
things from the payload — the comment count, accumulated by one per event, and
the first response, taken as the earlier of two candidates. Both doubled or
drifted on a replay, and a projection that cannot be replayed cannot be rebuilt
from the outbox. Both are now read from `ticket_comment` like everything else,
and `replayProjection` — the API, and `pnpm platform analytics-rebuild` — hands
every consumed event back to the handlers without deleting anything first. The
integration suite replays a tenant and asserts the facts are unchanged, counts
included. ADR-0031 is amended.

**Forecasting is a straight line, and says so.** Ordinary least squares over the
series with the r² alongside, so a widget can put "this is a guess" in a number
rather than a footnote. Fewer than three points refuses to guess; a projection
never goes below zero. Nothing cleverer, because anything cleverer needs a year
of rollups to be judged against and that year does not exist yet.

---

### 2.13 Feedback and surveys (MOD-18)

**A survey is a form with a score** (ADR-0033). The questions are MOD-02's
form document — the same schema, the same UI elements, the same validator the
catalogue runs — and what a survey adds is a scoring rule: which answer is the
headline and what scale it was on, normalised to 0–100 so a 1–5 and a 0–10 sit
on one chart. Published versions are immutable and a response names the
version it was shown, so a survey re-scaled on Tuesday does not rewrite
Monday's answers.

**Three triggers, all read off events the platform already publishes.** A
ticket resolved, a request fulfilled — a resolved ticket of type `request`,
not a new event nobody would publish — and a major incident resolved, through
the ticket that raised it. A trigger may carry a condition in the rules
engine's expression language, type-checked at save time. One ask per person
per thing; no second ask to anybody inside the throttle window, from any
survey or trigger, because the person does not experience surveys per survey;
and nobody is asked to rate a ticket they resolved themselves.

**The ask goes where the person already is.** By email and in-app through
MOD-11, always, carrying a signed link. And into the chat thread the ticket
lives in when it lives in one — as a row of buttons on Slack and Teams, as a
typed number on WhatsApp — posted by a job so the outbound call is outside the
event consumer's transaction. MOD-03 gained two things for it: a registrable
custom action, because MOD-18 depends on MOD-03 and the handler has to be
looked up by name rather than imported; and an "awaiting a reply" state on a
conversation, so a "4" typed instead of clicked reaches the survey rather than
being read as a comment. **In a thread, only the person the survey was sent to
may answer it**: a button in a shared channel can be pressed by anyone, so the
sender's linked identity must match the recipient or the reply says so and
nothing is recorded.

**The link proves itself.** A signed token — tenant, invitation, expiry, HMAC,
through a new platform helper — and the invitation stores only its digest, so
a database read cannot answer for somebody. The page behind `/public/surveys/`
is served by the API: JSON for a portal, and a small escaped HTML form for a
browser, because there is no portal application in this repository and a link
has to land on something a person can use.

**MOD-12's `fact_survey` finally has a projector.** It reads the response row
and takes the team and service from the ticket at projection, so the default
dashboards' satisfaction widget stops reading zero rows the first time somebody
answers.

---

### 2.14 Time and cost (MOD-19)

**Three kinds of time, and one of them is free** (ADR-0034). `manual` is what
somebody wrote down; `timer` is what a clock they started measured; `automatic`
is how long the ticket sat in a working state, recorded when it leaves one,
against whoever held it then. The third is elapsed time, never effort: it is
priced at nothing and billable never, by a database constraint, reported beside
effort rather than added to it, and no built-in metric sums across the kinds.
Paused and settled states are measured but not recorded — waiting is not
working.

**The rate is written on the entry.** Resolved when the entry is logged — the
team's override, else the activity's default — so a rate changed next month
changes nothing already logged. Per team, not per person: a per-person rate is
a salary by another name. Every rate seeds at zero, because money is the
tenant's to state; cost appears the day a rate is entered, for entries logged
after it.

**One timer per person, not believed past twelve hours.** A second start names
the first; a stop after longer is capped and the cap is written into the note.

**Budgets** bound a tenant, a service, an organisation or a team for a month,
quarter or year. The running total moves as entries land and is recomputed
nightly — MOD-12's rollup shape, for the same reason — and each line (the
warning at 80 %, the limit at 100 %) is published once per period through
markers on the period row, so the recompute can correct drift without
re-announcing a line already crossed. Entries in another currency are logged
and skipped, not summed. The owner is told through MOD-11.

**MOD-12** gains `fact_time_entry` — the table doc 06 named before the module
existed — projected on `time.entry.logged`, removed on `time.entry.deleted`,
with three built-in metrics (`time.logged`, `time.cost`, `time.elapsed`) that
keep the kinds apart, a `money` unit, and two widgets on the seeded teams
dashboard.

---

---

### 2.15 Status page (MOD-23)

**The page is a statement, not a view** (ADR-0035). Its incidents, updates
and maintenance windows are the module's own rows, written by its handlers
from what MOD-08 publishes and by its API from what an operator types, and
read by the public page and nothing else. What the public is told is decided
once, in the handlers: a major incident appears only if it was declared
customer-facing; a timeline entry only if its audience is `public`; a
scheduled change only if it touches a service the page lists. The page has
its own five words for an incident and four for a component, mapped from the
desk's, so an internal state it was not designed to explain cannot leak by
being new.

**Every handler reads the row, not the payload**, carries the MOD-08 entry
it came from, and is idempotent from either direction: the same declaration
delivered twice opens nothing twice, an update that arrives before its
declaration opens the incident rather than being dropped, and resolution —
which arrives as both a public "resolved" update and an
`incident.major.resolved` event, in no particular order — is applied once.

**The tenant directory is the only pre-tenant lookup.** The page lives at
`/status/<tenant slug>` (or at `/status` on a mapped host). The public request
resolves the slug through MOD-21 and reads the page *as that tenant*, through
a context with no permissions that the database confines like any other. No
MOD-23 table joins the platform allowlist. The API serves the page — HTML to a
browser, JSON to anything else, cacheable for thirty seconds; the static
export in document 03 remains the end state and waits on OD-06.

**Subscribers are addresses**, confirmed by a signed link before anything is
sent, told through a job after the transaction that wrote the line, with the
row marked before the first email so a retried job sends nothing twice. The
subscribe endpoint says the same thing whatever the truth about the address
or the page, and is rationed per address and per client, in process.

**Components follow what touches them.** Each is recomputed as the worst of
every open incident over it, or maintenance if a window is live over it, or
operational — recomputed rather than nudged, so nothing is left red by an
incident resolved through another door. A five-minute sweep moves windows
through scheduled, in progress and completed by the clock and never revives
one somebody cancelled.

---

### 2.16 Migration (MOD-24)

**An import is not a creation** (ADR-0036). MOD-04 grows `importTicket` and
`importComments`, which insert a ticket with the status and dates it had
and publish `ticket.imported` rather than `ticket.created`: search and
reporting follow it, and no SLA clock, rule, notification or survey fires
for a ticket closed in 2021. Users, teams and services go through the
existing services, which react to nothing already.

**Every row is remembered** in a link table from the source's identifier to
ours, per entity, so a re-run is a delta, a dry run followed by a commit
doubles nothing, and a ticket row's `caller_id` finds the user a previous
job created. References resolve through the link first, then by natural
key; a requester nobody has, named by an email, becomes an external user
with a warning on the row.

**Nothing is guessed.** A status the value map does not name, a date in an
unknown form, a field the entity does not have: the first two are failed
rows, the third a mapping refused when it is saved. A row with only warnings
is imported, and the warning is on the record.

**Dry run first, and the records are the report.** The same code as a
commit with the writes turned off, references resolved so a wrong mapping
shows on every row of the preview; a commit is the same job again, for real.
Every row's outcome and problems are an `import_record`; the totals are on
the job; the person who started it is told through MOD-11.

**Sources.** A CSV upload (its own body limit, kept in a bounded table for a
week), a generic JSON endpoint through the gateway, and three named
adapters — ServiceNow, Jira Service Management, Freshservice — that are the
generic source with the boxes filled in: path, records path, paging
strategy (offset, page, link), the vendor's status and priority words. The
CSV reader and dotted-path reader moved from MOD-10 into the platform
package; MOD-10 re-exports them.

---

### 2.17 SCIM provisioning (MOD-01)

**The provider owns the people; the tenant owns the access** (ADR-0037).
`/scim/v2/Users` and `/scim/v2/Groups`, in the shapes Entra ID and Okta
send: a user is created, found by the one-equality filter providers use,
adopted when an account already exists, deactivated with every session
revoked, and brought back; a group is a team whose membership is kept in
step and which is retired, not deleted, when the group goes. A
tenant-configured map from group name to role grants and revokes roles as
membership changes, remembering which team granted what so a role an
administrator gave by hand is never the provider's to take.

**One token per tenant**, issued by an administrator, shown once, hashed,
carrying the tenant's slug so the request resolves through the directory
and then as that tenant; rotation overlaps for a day, revocation stops
everything. SCIM requests run with the permissions people and teams need
and nothing else; no session token opens the endpoint. Errors are SCIM
errors with a `scimType`, on their own handler.

**JIT is wired.** The API now provisions on a first login whose token
names nobody the platform knows, linking by email first — what doc 09
said from the start, and what the SCIM-then-login test exercises.

---

### 2.18 Plans, limits and metering (MOD-21)

**A limit is a cached verdict, never a count** (ADR-0038). The request path
reads one word per tenant per meter, cached for a minute; the counting
happens as events land and in a nightly rebuild from the rows beneath each
figure. It fails open: a limit is a commercial control, and refusing every
ticket in a company because the cache restarted is the worse outcome.

**Four meters, two shapes.** `agents` and `storage` are live figures
re-measured from the source rows; `tickets` and `api_calls` are counted per
calendar month, with the period spelled out as a key rather than left as
nullable dates. `api_calls` is the one meter that cannot be rebuilt — no
row remembers a request — and the function that rebuilds the others returns
null for it rather than inventing a figure. A migration's history does not
move the ticket meter.

**A hard limit stops the act that grows the meter and nothing else**, with
**402** rather than 403: the caller is permitted and the obstacle is
commercial. Reading, commenting, resolving and closing are never refused,
and the message says so as well as naming the plan and the limit. The
socket is a platform primitive (`assertWithinLimit`) that MOD-21 plugs into
at boot, so MOD-04 refuses a ticket without depending on licensing.

**Plans are the deployment's; one threshold is the tenant's.** Plans carry
no `tenant_id`, are written only through the platform console, and are read
by every tenant. An administrator may move its own warning threshold
anywhere below the hard line, and is refused above it. No route anywhere
takes a hard limit from a tenant.

---

## 3. What remains in Phase 4

| Module | Why it is not done |
|---|---|
| **MOD-09 AI service** | **OD-04 is deliberately deferred**: the gateway, budgets, prompt registry, evals and kill switch are to be built against a stub provider, and nothing reaches a real model until a provider is chosen. Scope is agent-facing suggestions — an agent accepts or rejects, and no AI output reaches a requester unreviewed. |
| **Voice call control** | E3 delivers voice as a completed-call webhook. Live IVR, menus and transfers need a media session driven by provider markup while somebody is on the line, which cannot be exercised against anything in this repository — the MOD-10-E2 reasoning, applied again. |
| **Teams as a registered bot** | E2 uses the outgoing-webhook form. The Bot Framework path needs Azure AD JWT validation, which belongs next to the platform's existing JWKS verifier rather than duplicated in a module. |
| **MOD-23 static export** | The page is served by the API (ADR-0035). The edge-hosted export that survives an API outage is a job that renders the same JSON to a file, and waits on a hosting account (OD-06). |
| **MOD-22 ESM packs** | Not started. Installable packs of services, forms and workflows for HR, facilities and finance desks. |

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
| The fixture lesson held, and cost nothing to apply | MOD-14-E3's SigV4 tests began with AWS's published example credentials, both halves. The secret half is forty characters of mixed-case base64 assigned to a field called `secretAccessKey`, which reads to a scanner as exactly what it looks like — the same shape as the Stripe fixture two rows down. The reflex was to write an allowlist entry. The better question was what the fixture buys: **nothing**. The canonical request and the string to sign do not contain the secret, the signing-key tests use their own values, and no test pins a signature. So the key *id* stayed, because assertions quote it, and the secret became `not-a-real-secret-for-signing-tests`. No exemption, no scan to argue with, and not one assertion weaker. Worth recording because the reflex was wrong in a way that would have looked reasonable in review: an allowlist is where a scanner stops protecting you, and the first question is always whether the credential-shaped thing needs to be there at all. |
| Every survey link answered 414 | The signed token rides in the URL path and is about three hundred characters; Fastify refuses a path parameter longer than a hundred by default, before any handler runs. Five of the seven failures in the survey suite's first live run were this one number, and no unit test could have seen it: the token, the route and the limit are three different layers that only meet in a running server. The limit is now two kilobytes, which is what browsers and mail clients carry without complaint. The other two failures were the suite's own ordering — a test that re-publishes the survey as 0–10 ran before the thread tests, which then found no buttons (eleven is a keyboard) and a "4" worth 40; it now runs last, and says why. |
| A reply in the desk's own thread was "not addressed" | The chat guard accepts a message only when it is a direct message or mentions the bot — the right rule for a busy channel the desk was merely invited to. It was also applied to a reply *inside a thread the desk itself opened*, so a "4" typed under a survey question on Slack would have been dropped as `not_addressed` before anything looked at it, and the survey would have waited for an @ nobody would think to type. Found reading the guard while writing the fake message for the thread test, not by the test. `acceptInbound` now looks the thread up where it has a transaction and tells the guard, which stays a pure function; the busy-channel rule is unchanged everywhere else and a unit test pins both halves. |
| The platform's `fingerprint` is eight hex characters | Written for showing a credential's identity in a log, it is the last eight characters of a SHA-256. MOD-18's first draft used it to bind a survey link to its invitation row — a 32-bit "hash" of a secret, in a column named `token_hash`. Nothing would have broken: the link is HMAC-signed and the check is a second factor. But a column named for a hash that holds a fingerprint is how the next person reasons wrongly about what the database can prove. The full digest now lives next to the short form, and each says what the other is for. |
| A notification rule for an event MOD-11 does not listen to never fires, silently | MOD-11 registers a handler per event type from a six-entry list, and its rule table accepts a rule for any event type at all. A rule for `report.generated` was seeded, validated, listed in the admin console and would have sent nothing, because no handler ever called `notifyForEvent` for it. The integration test that asks "where is the lead's notification" is what found it; the fix is one more entry, and the comment on the list now says what the list is. Handlers are registered at import and rules are read per tenant at run time, so the list cannot be derived from the rules — the third hand-maintained list this phase, and the first that cannot be replaced by a derivation. Now checked at boot: `registerNotificationPack` and the default rules are held to the list when the module loads, so a rule for an event MOD-11 does not listen for stops the process with the name of the list to extend, rather than shipping. |
| The CSV writer defused negative numbers | The formula guard prefixes anything beginning with `=`, `+`, `-` or `@` with a quote, so a spreadsheet shows it as text rather than running it. Written first over `String(value)`, which meant a margin of −30 minutes came out as `'-30` — text, in the one column that exists to be summed. Caught by a unit test whose name said the opposite of what its assertion did; reading the two together was the finding. A number is the platform's, not a person's, and is now written as a number. |
| Three test bugs in the time suite, found only against the live server | `pending` is a status *category*; the ticket states are `pending_requester`, `pending_third_party` and `pending_approval`, so the elapsed-time test's transition was refused with a 422 the unit tests could not see. And `[100, 80].sort()` is `[100, 80]`: JavaScript sorts numbers as strings unless told otherwise, so a test that meant "in ascending order" asserted the opposite and passed in the author's head. And the elapsed-time test expected two working stints where the module records three: `new` is category `open`, so the time between assignment and first pick-up is working time by the module's own rule, and the test had the rule wrong. All three in the test, none in the module; all the kind of thing a live run finds in its first three minutes. |
| An accumulating projector cannot be replayed | E1a's comment count was "the old count plus one" on every `ticket.comment.added`, which is right until an event is delivered twice past the inbox — a replay, precisely. E1b needed a replay to make the spec's `analytics:rebuild` real, and the first design was "delete the facts, then replay", which works and is a hard-delete on a reporting table in a command anybody with `analytics.admin` can run. The better fix was upstream: read the count from `ticket_comment` like every other field, so replay is idempotent by construction and deletes nothing. The projector is now a pure function of the source rows, which is what ADR-0031 already claimed. |
| The worker scheduled four jobs by hand, and the manifests declared five | `registerSchedules` in `apps/worker` was a list of four cron entries copied from module manifests. MOD-04's manifest declares `ticket.autoClose` hourly; nothing scheduled it, and nothing implements it either, so the manifest has been promising a job that does not exist since Phase 1. Found because MOD-12 needed two schedules and adding two more lines would have repeated the mistake. The list is now derived from the manifests at boot and skips any declared job with no registered handler, saying so in the log. That is the same shape as three earlier rows: a declaration copied into a second place drifts, and the fix is to have one place. |
| A unique index over nullable columns does not enforce uniqueness | The rollup's natural key is `(tenant, date, team, service, priority)` where the last three are null for "all". PostgreSQL treats NULLs in a unique index as distinct from one another, so `(t, d, NULL, NULL, NULL)` never conflicts with itself: the "all" row would have inserted a fresh duplicate on every upsert and every headline total would have climbed with every event. Caught reading the schema back before the migration was written, not by a test — the unit tests could not see it because no row ever reaches a database there. The row's identity is now a spelled-out grouping key (`all`, `team:<id>|priority:P1`) with a constraint that it is non-empty; the nullable columns stay for filtering. |
| A dependency named a module that does not exist | MOD-23's first manifest depended on `MOD-08`, which is the specification's name for a practice and nobody's module id: the incident, problem and change modules are `MOD-08-E1`, `-E2` and `-E3`. `validateRegistry` would have logged it at boot and carried on. Found by reading the id list before the first typecheck; the fix is the three real ids, and the reminder is that a manifest's `dependsOn` is checked against what is registered, not against the document it was copied from. |
| A public page nearly ran on the platform role | The first draft of MOD-23's slug lookup read `status_page` through `platformDb()`, because a public request has no tenant to read as. That read returns nothing — the table is isolated like every other — and the honest fix was to allowlist it, which is a public endpoint running on the role that sees every tenant. The better fix was to drop the page's own slug and use the tenant's: the directory is the one pre-tenant lookup the platform already permits, and everything after it reads as that tenant (ADR-0035). One fewer table on the allowlist, and nothing to enumerate. |
| The context plugin let `/status/` through, but not `/status` | The unauthenticated-path rule was a prefix match on `/status/`, written when the page had only a slug form. The host-resolved form has no slug and no trailing slash, and would have answered 401 on a tenant's own domain — the one URL a customer is most likely to be given. One more clause, and the comment on the rule now says what both forms are. |
| Uploads had a front door and no back room | ADR-0016 presigns uploads to object storage and nothing in the repository reads an object back; MOD-24 needed to read a CSV the administrator uploaded. Rather than build a read path against a store that has no account yet (OD-06), the file goes into a bounded table with its own body limit and a seven-day life. Small, honest, and the first thing to replace when object storage is real. |
| The commit deleted the file the re-run needed | MOD-24's first draft removed an uploaded CSV once a commit had read it, on the reasoning that the commit is the last reader. It is not: the module's own promise is that a commit run again changes nothing, and the integration test that proves the promise was the one that could not read the file. The file now lives its week and the sweep removes it; the test that found this is the one that asserts the second commit's counts are all `unchanged`. |
| JIT provisioning was written in Phase 1 and never called | `provisionFromToken` existed, was documented in doc 09, and had no caller: the context plugin resolved the actor by the token's user id and answered "this account no longer exists" to anybody the platform had not met. Every test signed in with a token that named an existing id, so nothing noticed. Found reading the plugin to add the SCIM branch; the fix is four lines and a test that logs in as a subject the platform has never seen. A function nothing calls is a promise the documentation is making on the code's behalf. The first live run then found the second half: a provider's token names its *subject*, which is not one of our ids, and looking that up as one is a database error rather than a miss — a 500 where the fallback should have run. The plugin now asks the database only for something shaped like an id. |
| A hand-written migration named the model, not the table | The `User` model lives in `app_user_account`, because `user` is a reserved word in PostgreSQL and the Phase 1 schema said so; the SCIM migration altered `"user"` and the migrate step failed before a test ran. Found by CI on the first run, which is what a migrate step in CI is for. A hand-written migration copies its table names from `@@map`, never from the model. |
| An accumulating handler, again, one ADR later | MOD-21's ticket meter moved by a delta on each `ticket.created`, which is the shape ADR-0031 was written about: delivery is at least once, so a redelivery counts the same ticket again, and the integration suite found a figure five higher than the tickets that existed. The same trap MOD-12's comment count fell into, reintroduced by somebody who had read the ADR — because "add one when it happens" is what counting *sounds* like. Every meter now re-measures from the rows that define it, and the only accumulator left is the API-call buffer, which is a counter rather than an event and is drained exactly once. Worth its own row rather than a footnote on ADR-0031: the rule needs to be applied at the moment a handler is written, and a second occurrence means the first telling was not enough. |
| The isolation suite caught a cache key the design had not thought about | The API-call buffer was one global Redis hash with a field per tenant, which reads as tidy and is the one key shape the platform refuses: it cannot be dropped when a tenant is purged, and it is one careless `hgetall` away from crossing a boundary. Nothing in MOD-21's own tests would ever have looked; the isolation suite scans the whole keyspace for anything not prefixed with a tenant, and named it on the first live run. Now one key per tenant, found by a scan over the prefix. The suite paid for itself again, and this is the argument for a test that asserts a *property of the system* rather than a behaviour of a feature. |
| A test whose measurement changed what it measured | The API-call assertion read the meter through `/api/v1/usage` — itself an API call, and therefore counted. "Flush twice, expect nothing the second time" could never be true, and the failure looked like a bug in the flush. It is now read from the database, and the assertion is the invariant that can actually be proved: the meter grows by exactly what the flush took out of the buffer. A test that perturbs its own subject is worse than no test, because it fails for a reason that is not the code's. |
| An SSRF guard makes its own gateway hard to test | A local test server is on a refused address, so there is no hermetic way to exercise a real successful call. Resolved by injecting `fetch`, the resolver and the **log sink**, which also bought the most valuable assertion in the module: the credential goes out on the wire and is nowhere in what was written down. |

---

## 5. Verification so far

| Check | Result |
|---|---|
| Unit tests | 896 passing, 564 of them over the modules |
| — the address guard | 14, each naming the attack or operational failure it prevents |
| — envelope encryption | 13, covering rotation, tampering and the absence of a key |
| — the gateway end to end | 14, with `fetch`, the resolver and the log sink injected; three of them over the signed path |
| — AWS SigV4 | 22, asserting the canonical request and string to sign as plain text a reviewer can check against AWS's published example |
| — chat webhook signatures | 18, one per way each of the four schemes is got wrong |
| — the chat guard's thread rule | 2, pinning that a reply in the desk's own thread is addressed and a reply anywhere else still is not |
| — the chat guard and identity policy | 32, including that an unrecognised verification method is treated as none |
| — the Slack and Teams adapters | 21, over parsing rather than sending |
| — WhatsApp and voice | 19, including the session window as a pure function and the refusal to sign against a claimed host |
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
| — the rollup arithmetic | 19, written so that a create-then-withdraw cycle must sum to zero and a team change must leave the headline total alone |
| — durations and ISO weeks | 10, including the year boundary where 1 January belongs to the previous ISO year |
| — the metric catalogue and query builder | 21, reading the generated SQL as text: catalogue columns quoted, user values as parameters, and every way a filter or a rollup plan is refused |
| — ranges, schedules, the trend line and CSV | 21, including the same 08:00 on both sides of daylight saving and the formula guard that leaves numbers alone |
| — survey documents, scoring and throttling | 19, including the scale that would have reported a 7 as 150 % and the button row that refuses to be a keyboard |
| — signed links | 4, including that a tampered payload is a bad signature whatever its expiry says |
| — time pricing, periods and thresholds | 12, including that one entry crossing both budget lines reports both and a decrement reports neither |
| — the MOD-11 listener list | 2, proving the boot-time check refuses a rule for an event nobody listens for and names the list to extend |
| — plan limits and the meters | 20, including that the line is reached rather than passed (five agents on a five-agent plan is the sixth refused), that a nightly rebuild announces nothing twice, that a live meter's period is a value and not a null, and that the platform's socket fails open when the checker itself fails |
| — SCIM as providers speak it | 15, including the capitalised op, the string boolean, the pathless PATCH, the member removal by selector, and the filter that is refused rather than ignored |
| — import mappings, presets and paging | 26, including that a status the map does not name is a failed row and not a guess, that every vendor preset passes its entity's checks, and that each paging strategy stops when it should and never before |
| — the status page vocabulary, allowance and rendering | 22, including that maintenance loses to anything actually broken, that the sweep never revives a cancelled window, that a refused subscribe attempt does not count against the person behind the script, and that a title of `<script>` renders as text |
| Integration, isolation and permissions | extended by 22 workload tests, a 23-test CMDB suite, a 22-test discovery suite, a 13-test projection suite (redelivery, team moves, rebuild-equals-incremental, drift), an 18-test reporting suite (rollup-equals-scan, personal dashboards invisible to others, a scheduled report reaching exactly the person named, replay leaving the facts unchanged), a 15-test survey suite (one ask per resolution, the link working with no session, a tampered link refused, the throttle, the self-resolver not asked, a new version leaving old answers alone, and in a Slack thread the requester's typed reply accepted and a stranger's button refused), a 15-test time-and-cost suite (the rate frozen on the entry after it changes, one timer per person, elapsed time recorded as its own free kind, a budget crossing both lines once each and withdrawing spend on deletion, and the kinds kept apart in the metrics), a 16-test metering suite (a tenant with no plan refusing nothing, agents counted as the people who work the desk and not the people who ask, a migration's history not spending the month's allowance, a tampered figure corrected by the rebuild, a warning that arrives once and reaches the administrators, a refusal that names the plan while comments and transitions still work, an upgrade taking effect at once, the requester role never refused, a warning threshold brought forward and refused above the hard line, and API calls buffered then flushed exactly once), a 19-test SCIM suite (the door opening only to the token and in the SCIM error shape when it does not, a user created and found by the provider's filter, adopted when it already exists, deactivated with its session revoked and brought back, a group becoming a team whose members hold the mapped role and lose it on leaving, a hand-granted role left alone, a rename following the map and the map re-applied when it changes, a first login landing on the SCIM-made account and refused once SCIM deactivates it, and a rotated token overlapping while a revoked one does not), a 13-test migration suite (teams and users from CSV with a dry run that writes nothing and a commit that lands the good rows and reports the bad one, the same commit again doubling nothing, tickets from a ServiceNow-shaped API arriving resolved and dated when raised with their references resolved, no SLA clock and no email, present in search and in the reporting facts, and a journal export landing on the tickets it belongs to), a 22-test status-page suite (a customer-facing major incident marking its service's component and an internal one never appearing, an internal update kept off the page beside a public one shown, resolution applied once from two events, a scheduled change becoming a notice that moves rather than multiplies, the sweep marking the component under maintenance, a subscriber confirmed by link, told once and not again after unsubscribing, and a private page answering nothing either way), ten permission-matrix entries and five register-write assertions, against live PostgreSQL, Redis and Meilisearch |
| Module contract | clean, including the new single-egress rule |

The rota tests are the highest-value read after the address guard. A night shift
over 29–30 March is seven hours and the same shift over 25–26 October is nine;
counted in milliseconds both would be eight, and everybody would go home an hour
early once a year. Each test names the silence it prevents rather than the line
it covers.
