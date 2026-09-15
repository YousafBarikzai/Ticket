# ADR-0021 · Expression language: ordering across types raises, and is refused at publish

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-06, MOD-02, MOD-05, MOD-07, MOD-11, MOD-17 (every builder that stores a condition)

## Context

`@itsm/expr` is the one condition language: business rules, SLA policy matching,
approval step conditions, notification rules, form visibility and requirement,
catalogue entitlement and saved views all store conditions in it and evaluate
them with the same interpreter on the server and in the browser.

Until Phase 3 its `compare()` fell back to comparing operands as strings when
they were not both numbers. That made `ticket.title > 5` **true** — `"V"` sorts
after `"5"` — so a condition that is nonsense matched every ticket, reported no
error, and looked correct in the builder. The Phase 2 delivery record raised it
as the phase's one open decision (`21` §6.1) rather than changing Phase 1
behaviour already in use.

## Decision

Ordering (`gt`, `gte`, `lt`, `lte`) between two **present** values of different
kinds raises `ExprTypeError`. Two things make that safe to do:

1. **A missing value is not a type error.** An absent optional field still fails
   its comparison quietly, so a rule reading a custom field nobody filled in is
   not reported as broken.
2. **A `Date` may meet a string that parses as one.** This is load-bearing, not
   a convenience: the server holds a `Date` from the database and the browser
   holds the ISO string it became over JSON. Without the crossing, the dry-run
   panel and the live path would disagree about the same condition — the one
   thing a shared language exists to prevent.

Every caller catches, so the failure lands on the one rule, policy or field that
is wrong and not on the request: the rules engine records it against the rule
and keeps running the others, approvals skip the policy, entitlement denies, and
a form reports itself as misconfigured rather than rendering unpredictably.

Raising alone would only tell an author their rule is broken the first time a
ticket happened to hit it, in a log they do not read. So `checkExpr(expr, types)`
runs the same judgement statically against the caller's declared fact types, and
rule publishing refuses the definition with the conflict named on the field. A
path the caller cannot type — `fields.*`, `answers.*`, which are tenant-defined
— is not checked, and the runtime error remains the backstop for those.

## Alternatives considered

- **Leave it, documented and pinned by a test.** Rejected: the failure is silent
  and matches everything, which is the worst available direction for a rule
  engine. A condition that is wrong should do nothing, not everything.
- **Evaluate a mixed comparison as `false`.** Safer than the old behaviour and
  still silent: the author is never told, and a rule that quietly never matches
  is nearly as expensive to diagnose as one that always does.
- **Coerce toward the declared fact type.** Rejected: guessing what the author
  meant is how the original bug was born.

## Consequences

- Behaviour changed for conditions already published. Nothing in the seeded
  definitions or the test fixtures used an ordering comparison across types —
  checked by running the new checker over every seeded export — so the change
  landed without a data migration, but a tenant who wrote one will see the rule
  reported as broken rather than silently matching. That is the intent.
- Equality (`eq`, `in`) still compares across types by string coercion, so
  `5 == "5"` holds. Left deliberately: a cross-type equality answers *false* or
  matches one specific wrong value, where a cross-type ordering matched
  everything. Recorded as a smaller open question in `22` §6.
- Each caller now states its own failure direction in code rather than inheriting
  one, which is more lines but removes the question "what happens if this
  breaks?" from every future reader.
