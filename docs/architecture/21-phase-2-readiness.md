# 21 · Phase 2 readiness and delivery record

**Status: delivered.** All six workstreams are built and verified against a live
PostgreSQL and Redis, and the walking skeleton runs 35 of 35 assertions against
the bundled production artefacts. This document records what was built, what it
found, and what remains — in the same shape as
[20](20-phase-1-readiness.md), so the two read as one delivery history.

At the time of writing: **13 modules, 74 tables, 93 endpoints, 42 event types**,
and **484 tests** (221 unit, 263 integration).

---

## 1. What Phase 2 is for

Phase 1 proved the platform could hold a ticket safely: one tenant's data
invisible to another, an audit trail that cannot be edited, a clock that starts
and stops correctly. None of that is yet a service desk.

Phase 2 is where the platform starts doing work on its own — routing what
arrives, chasing what is late, and asking the right person before something
happens. Every one of those is configuration rather than code, which is the
commitment made in [01 §2](01-overview.md) and the reason the expression
language and the versioned-definition lifecycle were built in Phase 1.

---

## 2. Delivered

### 2.1 Business rules engine (MOD-06-E0)

`modules/rules`. A tenant administrator writes a condition in the shared
expression language and picks actions from a closed set; the engine interprets
it (ADR-0009).

| Piece | Where |
|---|---|
| Closed action set, with the conflict rules | `modules/rules/src/domain/actions.ts` |
| Pure interpreter — `decide()` and `effectsOf()` | `modules/rules/src/service/engine.ts` |
| Facts a rule may read | `modules/rules/src/service/facts.ts` |
| Draft → publish → rollback, and the dry-run panel | `modules/rules/src/service/rule-service.ts` |
| The automation write path it uses | `ticketService.applyAutomatedChange` |

Four decisions worth carrying forward:

- **The closed action set is the security property**, not a simplification. A
  rule is authored through the admin UI, so the engine must not be able to
  express anything that administrator could not already do. No action runs code,
  calls a URL, or reads another tenant.
- **The dry run and the live path call the same function.** `decide()` is pure,
  so the test panel is the same evaluation rather than a second implementation
  of it that can drift. A "test mode" that drifts is worse than none.
- **MOD-04 remains the only writer of a ticket row.** The engine describes a
  change; MOD-04 validates the fields automation may write, puts a status change
  through the state machine, and reports a refusal rather than throwing — one bad
  action must not roll back the event that triggered it, and a person's
  concurrent edit always wins.
- **Automation acts as itself.** Writes publish with a `workflow` actor, which is
  how a rule avoids reacting to its own change. A rule whose action satisfies its
  own condition is the shape that loops.

### 2.2 Approvals (MOD-17)

`modules/approvals`. A policy is a versioned definition; a request pins the
version it opened on. Steps name *how* to find approvers rather than who they
are, and resolve when the step opens — a policy written in March must still find
the right approver in November.

The behaviour that decides whether this is safe is all in the quiet cases:

| Case | What happens | Why it matters |
|---|---|---|
| The subject is also an approver | Removed, last, so no rule can put them back | Approving your own request is no approval at all |
| A step resolves to nobody | Skipped, with the reason recorded | Blocking forever is how a policy becomes an outage |
| The quorum becomes unreachable | Settles as rejected | Otherwise it waits on people who have already decided |
| One rejection, quorum of two | Rejected | An approval chain is a series of vetoes, not a vote |
| An approver is deactivated | Step inherits to their delegate; quorum lowered to what remains | Someone leaving must not strand three changes |
| A delegate decides | Both the owed and the acting person recorded | The trail has to say who actually signed |

### 2.3 SLA policies, calendars and escalations (MOD-07-E1)

`modules/sla` gains the layer a service owner touches. Phase 1's timer engine is
unchanged underneath, which is the point: an SLA is retuned on a Tuesday
afternoon without a deployment.

Escalations turn a warning or a breach into something that reaches a person.
Two rules hold: **priority is only ever raised**, because an escalation that
lowered it would restart the clock with a longer target than the one just
missed; and **one tenant's bad rule cannot stop the tick**, because the
scheduler serves every tenant in the partition.

Three validations refuse configurations that look reasonable and quietly do
nothing — an escalation at a threshold no target warns at, a calendar the timer
engine could not compute against, and a priority matrix missing a combination.

---

## 3. Also delivered

### 3.1 Notification quiet hours, digests and preferences (MOD-11-E1)

Quiet hours mean "not now, but later"; digest mode means "not separately".
Conflating them gives a message that is neither prompt nor batched, so each
defers with its own reason and its own instant. The awkward cases are all in the
clock — a window crossing midnight, the recipient's time zone rather than the
server's, and daylight saving, where adding a fixed offset gets the release an
hour wrong in the direction that wakes somebody up. An urgent message goes
through both: whoever set quiet hours did not mean "do not tell me the building
is on fire".

### 3.2 Channel framework and email adapter (MOD-03)

Email is the reference channel the PH-4 adapters copy, so the split matters more
than the feature: the inbound path, the command set, the loop guard and the
identity check are the framework, and only parsing differs between an email and
a Slack event.

Two closed sets carry the safety. The **command set** is closed because a
channel message comes from outside and an envelope is trivially forged — an
adapter that could express anything would be an unauthenticated API.
**Unverified senders may only ask to be linked**, because "what is the status of
REQ-000123" from a forged address is a data leak.

The threading order — a header we stamp, then References, then a bracketed
subject token, then a new ticket — runs from hardest to get wrong to easiest,
because the weaker sources are the ones a mail client or an attacker can
influence.

### 3.3 Service catalogue and forms (MOD-05, MOD-02)

The form contract moved from the design system into `@itsm/contracts`, which
makes a claim the design system was already making literally true: the server
validates a submission by calling the same `validateForm` the browser called. A
second implementation would be a second set of rules, and the two would disagree
the first time either changed. The browser's validation is a convenience; the
server's is the control.

Submitting a request is the one place where an unprivileged person's input
becomes a ticket with a service, a group and a priority attached, so all three
come from the published catalogue item and none from the request body.
`createRequestFromCatalogue` has no parameter that could express a caller-chosen
group or priority.

**Entitlement is access control, not presentation.** The same predicate filters
the catalogue and is checked again on submission — filtering alone would be a
client-side control anyone guessing a key could walk past. An item you are not
entitled to returns 404, because its name alone can disclose that the thing
exists and who is likely to have one.

## 4. What remains

| Item | Module | State |
|---|---|---|
| Mobile foundation (iOS) | MOD-16 | Not started; depends on assumption AA-07 (Apple Developer account). |
| Admin console screens | MOD-13 | Every Phase 2 module's server side is complete and reachable through the API; no console screens yet. |
| A real email provider | OD-03 | Only the development transport is registered, and only outside production. Postmark and Microsoft Graph are adapters behind the same interface; the decision is the blocker, not the code. |
| Fulfilment plans and task templates | MOD-05 | Deferred to PH-3 with the workflow engine, which is what executes them. |

## 5. Verification

| Check | Result |
|---|---|
| Unit tests | 221 passing |
| Integration tests | 263 passing |
| Walking skeleton, against `node dist/api.js` and `node dist/worker.js` | 35 of 35 |
| — tenant isolation (Appendix D, release-blocking) | extended to rules and approvals |
| — permission matrix (Appendix B, release-blocking) | 127 cases |
| CI stages 1, 2 and 3 | green |
| Module contract | no violations |
| Typecheck (TypeScript strict) | clean |
| Secret scan, full history | clean |

The test harness gained `drainEvents()`, which runs the event handlers in
process the way the worker would. From Phase 2 on, rules, approvals and the
email channel are reachable only through events, so the suite has to be able to
drive one; Phase 1 could rely on the walking skeleton and a real worker.

---

## 6. Defects and traps this phase found

Recorded because each cost time and would cost it again.

| What | Why it mattered |
|---|---|
| `prisma migrate diff` proposes dropping the hand-written PH-1 objects | The generated tsvector columns, trigram indexes and `platform_table_allowlist` exist only in hand-written SQL. A generated migration silently undoes all three. Every Phase 2 migration was written by hand, taking only the additive statements. |
| The secret scanner reads a business rule key as an API key | `key: 'major-incident-p1'` matches the generic-api-key rule. Fixed with one narrow allowlist, verified by planting real credentials on fields called `key`, `apiKey` and `policyKey` and confirming they are still caught. |
| gitleaks silently ignores the plural `[[allowlists]]` block | A config written that way looks correct, changes nothing, and leaves the build red with no explanation. The singular `[allowlist]` form works. |
| `(?i)` in an allowlist regex exempts more than intended | Applied to the value as well as the field name, it would have exempted an upper-case credential assigned to `key:`. |
| `aquasecurity/trivy-action@0.28.0` does not exist | The tags carry a `v`. The job fails at set-up with only "unable to find version", which says nothing about the prefix. |
| A form condition reading `values.x` instead of `form.x` never holds | The obvious guess is always undefined, so the field never appears and nothing says why. Found by this module's own seed; now refused at save, like the rules engine's unknown-fact check. |
| npm ships inside the Node base image and bundles a critical CVE | The third time the same principle applied: the runtime image executes `node dist/…` and needs neither a transpiler, a package manager, nor npm. |
| The expression language compares mismatched types lexically | `ticket.title > 5` is **true**, because `"V"` sorts after `"5"`. A rule written that way matches everything and reports no error. Pinned by a test; **open for decision** — see below. |
| Two tenants could claim the same inbound email address | `channel_account` is the one table read *across* tenants — a provider webhook arrives with no tenant context — so duplicates meant mail routed to whichever row came back first. Now a partial unique index on the active rows. |
| Deleting a tenant left all its data behind | Only the directory row went. Every tenant-scoped table kept its rows, and an orphaned mailbox from a deleted tenant went on receiving mail. `purgeTenant` now deletes for real. |
| A data migration on a tenant-scoped table silently does nothing | Migrations run as a role that forced row-level security applies to, so an `UPDATE` with no `app.tenant_id` matches zero rows — and then fails on the index it was meant to clear the way for. |
| A failed statement aborts the whole PostgreSQL transaction | The first purge ran every table in one transaction, so one foreign-key violation made everything after it fail. It looked as though nothing could be deleted. |
| The production image shipped a transpiler, then a package manager | Found by the image scan, twice: esbuild's Go binary came in with `tsx`, and `tar` came in with pnpm. Neither is ever loaded by the application. Each deployable is now a bundle, and the runtime image carries Node and OpenSSL only. |
| Two major versions of BullMQ in one repo | Which behaviour you got depended on which file did the importing; a scheduled job id containing a colon started the worker under one and crashed it under the other. |
| A ticket raised by email had no organisation | Which put it outside every agent's scope — the same shape as the Phase 1 triage-pool finding, arriving by a different route. |
| `onBehalfOf` is a UUID column, not a note | Putting the channel name there failed the insert deep inside the audit writer, where the cause is hard to see. |

### 6.1 Open for decision

**Mixed-type comparison.** `compare()` in `packages/expr` falls back to comparing
operands as strings when they are not both numbers. That is defensible as a
language rule and dangerous as a rule-authoring experience: a condition that is
nonsense matches everything rather than nothing, silently.

The options are to leave it (documented, with a test pinning it), to make a
mixed-type comparison evaluate to `false`, or to make it raise so the rule is
reported as broken to its author. The third is the safest and the most
disruptive: the expression language is shared by SLA policy matching,
notification rules and the form renderer, so the blast radius is wider than the
rules engine. **Recommendation: make it raise**, caught per-rule as the engine
already catches an invalid pattern, so the author is told and other rules keep
running. Not done here because it changes Phase 1 behaviour that is in use.

---

## 7. What Phase 3 inherits

- The workflow engine (MOD-06-E1) has its sibling package, its expression
  language, its versioned-definition lifecycle and its automation write path
  already built. `startWorkflow` is declared in the rules action set and refuses
  at publish, naming PH-3; making it work is wiring, not design.
- `serviceOwner` approvers refuse at publish naming MOD-05, and resolve as soon
  as the catalogue exists.
- Meilisearch replaces PostgreSQL FTS from PH-3 (ADR-0017); the projection is
  rebuildable, so this is a consumer change, not a migration.
