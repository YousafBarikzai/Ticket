# ADR-0031 · Reporting is a projection of events, and it is rebuilt rather than trusted

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-12, §6 Event catalogue, §4.2

## Context

Every question a service desk gets asked at a monthly review — how many, how
fast, by whom, missed by how much — can be answered by querying the tables
MOD-04, MOD-07, MOD-11 and MOD-17 already keep. For the first few hundred
tickets that is also the right answer, and building anything else would be
premature.

It stops being the right answer for three separate reasons, and they arrive at
different times.

The first is contention. An analyst's "last twelve months by team" is a
sequential scan with a sort, and it runs on the same connection pool as the
ticket somebody is trying to save. The report is slow, which is annoying; the
save is slow, which is a support call.

The second is coupling. A report that joins across four modules is a fifth
reader of four schemas. Every one of those modules then has a constraint
nobody wrote down: change this column and the quarterly pack breaks. That is
precisely the coupling the modular monolith exists to avoid, and it is the kind
that never shows up in a dependency graph.

The third is the one that actually decides it: **history moves.** A resolution
time computed at query time depends on the calendar in force when the query
runs. Somebody edits an opening hour to add a bank holiday, and last March's
average resolution time changes. Nobody did anything wrong, nobody is told, and
the number in the board pack from April no longer matches the number the same
report produces in May. A figure that quietly rewrites itself is worse than one
that is missing.

## Decision

**MOD-12 keeps its own star schema, populated from the event stream, and
computes durations once — at projection — against the calendar in force at the
time.**

Four decisions follow from that, and each is the answer to a specific way this
design goes wrong elsewhere.

**Facts are updated in place, not appended per transition.** One row per
ticket, not one per status change. A table that grew a row for every priority
edit would make "how many tickets" a distinct count, and it would be enormous
in exactly the tenants that care.

**Projectors read the source row, not the event payload.** The event says *look
again*; the row says *at what*. Delivery is at-least-once and unordered — two
workers can process a status change and an assignment for the same ticket
concurrently, in either order — so a projector that applied the payload would
produce a different answer depending on which finished last. Reading the row
makes every projection converge on the same state regardless of order. The two
things that cannot be read back are handled explicitly: the first response takes
the earlier of the two candidate times, and the comment count only ever rises.

**The rollup is a cache of the facts, not a record.** Daily numbers are
maintained incrementally, because a ticket resolving should touch six small rows
rather than provoke a scan of everything raised that day. Anything maintained by
addition and subtraction drifts, so the same rows are rebuilt nightly from the
facts. For that to be a *correction* rather than a *second opinion*, every
counter has to be derivable from a fact row — which is why reopens and breaches
are counted against the day the ticket was **raised** rather than the day they
happened. The fact records the former and not the latter, so attributing them to
the day of the event would make the rebuild incapable of reproducing the
incremental result, and the difference between the two would measure the design
rather than any real problem.

**The projection is checked against the module that owns the truth, through
that module's own service.** MOD-12 asks MOD-04 to count, rather than counting
`ticket` itself. Reading the table directly would produce a check that agrees
with the projection exactly when both are wrong about the same thing — the
soft-delete predicate, the scope filter — which is the failure a reconciliation
exists to catch. Above 0.5 % over a thirty-day window, a drift row is written
and `analytics.drift.detected` is published.

## Consequences

Reporting is eventually consistent, by design and by a bounded amount: the
outbox has a five-second lag objective, so a figure is a few seconds behind the
ticket list. That is the right trade for the questions this module answers and
the wrong one for "what is on my queue right now", which is MOD-04's job and
stays there.

The star schema is a second copy of a subset of the data, so it costs storage
and it can be wrong. Both are accepted deliberately: the storage is small
relative to attachments, and the drift check exists precisely because "it can be
wrong" is not a thing to be argued away.

MOD-12 depends on five modules and nothing depends on MOD-12. Delete it and the
platform is unchanged. That asymmetry is what makes a reporting module safe to
rebuild from scratch, and it is worth protecting: the first thing that reads a
fact table to make an operational decision turns this from a cache into a system
of record, and the rebuild stops being safe.

`fact_survey` exists with no projector, because MOD-18 does not. The table is
here so that satisfaction needs no migration when it lands and a dashboard can
declare a widget that reads zero rows; registering a handler for an event type
nobody publishes would fail validation, and writing one nobody can test would be
worse.
