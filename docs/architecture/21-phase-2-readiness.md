# 21 · Phase 2 readiness and delivery record

**Status: partially delivered.** Three of Phase 2's six workstreams are built and
verified against a live PostgreSQL and Redis; three remain. This document records
what was built, what it cost, what it found, and what is left — in the same shape
as [20](20-phase-1-readiness.md), so the two read as one delivery history.

At the time of writing: **11 modules, 66 tables, 78 endpoints, 38 event types**,
and **381 tests** (177 unit, 204 integration).

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

## 3. Not yet delivered

| Workstream | Module | State |
|---|---|---|
| Channel framework and email adapter | MOD-03 | Not started. The reference channel the PH-4 adapters copy ([07 §5](07-eventing-and-integration.md)). Needs OD-03 closed first — see §5. |
| Notification templates, rules and preferences | MOD-11-E1 | Partly present from PH-1: templates, rules and in-app delivery work. Preferences, digests and per-channel routing remain. |
| Catalogue, forms and portal server | MOD-05, MOD-02 | Not started. Blocks `serviceOwner` approvers, which currently refuse at publish. |
| Mobile foundation (iOS) | MOD-16 | Not started; depends on assumption AA-07 (Apple Developer account). |
| Rules and approvals admin UI | MOD-13 | Server side complete and reachable through the API; no console screens yet. |

Nothing above is blocked by a design problem. The first three are sequencing.

---

## 4. Verification

| Check | Result |
|---|---|
| Unit tests | 177 passing |
| Integration tests | 204 passing |
| — tenant isolation (Appendix D, release-blocking) | extended to rules and approvals |
| — permission matrix (Appendix B, release-blocking) | 127 cases |
| Module contract | no violations |
| Typecheck (TypeScript strict) | clean |
| Secret scan, full history | clean |
| CI stages 1 and 3 | green |
| CI stage 2 (image build and scan) | see §5 |

The test harness gained `drainEvents()`, which runs the event handlers in
process the way the worker would. From Phase 2 on, rules, approvals and the
email channel are reachable only through events, so the suite has to be able to
drive one; Phase 1 could rely on the walking skeleton and a real worker.

---

## 5. Defects and traps this phase found

Recorded because each cost time and would cost it again.

| What | Why it mattered |
|---|---|
| `prisma migrate diff` proposes dropping the hand-written PH-1 objects | The generated tsvector columns, trigram indexes and `platform_table_allowlist` exist only in hand-written SQL. A generated migration silently undoes all three. Every Phase 2 migration was written by hand, taking only the additive statements. |
| The secret scanner reads a business rule key as an API key | `key: 'major-incident-p1'` matches the generic-api-key rule. Fixed with one narrow allowlist, verified by planting real credentials on fields called `key`, `apiKey` and `policyKey` and confirming they are still caught. |
| gitleaks silently ignores the plural `[[allowlists]]` block | A config written that way looks correct, changes nothing, and leaves the build red with no explanation. The singular `[allowlist]` form works. |
| `(?i)` in an allowlist regex exempts more than intended | Applied to the value as well as the field name, it would have exempted an upper-case credential assigned to `key:`. |
| `aquasecurity/trivy-action@0.28.0` does not exist | The tags carry a `v`. The job fails at set-up with only "unable to find version", which says nothing about the prefix. |
| The expression language compares mismatched types lexically | `ticket.title > 5` is **true**, because `"V"` sorts after `"5"`. A rule written that way matches everything and reports no error. Pinned by a test; **open for decision** — see below. |

### 5.1 Open for decision

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

## 6. What Phase 3 inherits

- The workflow engine (MOD-06-E1) has its sibling package, its expression
  language, its versioned-definition lifecycle and its automation write path
  already built. `startWorkflow` is declared in the rules action set and refuses
  at publish, naming PH-3; making it work is wiring, not design.
- `serviceOwner` approvers refuse at publish naming MOD-05, and resolve as soon
  as the catalogue exists.
- Meilisearch replaces PostgreSQL FTS from PH-3 (ADR-0017); the projection is
  rebuildable, so this is a consumer change, not a migration.
