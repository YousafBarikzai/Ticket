# ADR-0034 · Three kinds of time, and one of them is free

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-19, MOD-12, MOD-04

## Context

"How long did that take" has three honest answers and one dishonest one. The
honest three: what somebody wrote down, what a clock they started measured,
and how long the ticket sat in a state where somebody was meant to be working
on it. The dishonest one is their sum.

Every time-tracking feature that reaches a management report eventually adds
them, because the third number is the biggest and the report looks more
complete with it in. From then on every lunch break, every overnight, every
"in progress" that was really "forgotten" is billed as effort, and the cost
figure is not wrong by a little; it is wrong by a multiple.

The rate question has the same shape. A rate is what an hour costs *now*. A
report is about what work cost *then*. A cost recomputed from today's rate
rewrites history every time somebody is promoted.

## Decision

**Three kinds on every row — `manual`, `timer`, `automatic` — and the
automatic kind is priced at nothing, billable never, and enforced by a
database constraint.** Elapsed time is a measurement of how long work takes;
it is never a measure of how much was done. It is reported beside effort in
the same summary, with its own metric in MOD-12, and no built-in metric sums
across the kinds. A tenant can define one that does, deliberately, with the
kind filter in the definition where a reviewer will see it.

**The rate is resolved when an entry is logged and written on the entry.**
Team override first, then the activity's default. A rate changed next month
changes nothing already logged; an entry *edited* is re-priced at today's
rate, because an edit is a new statement of what the work was. Per-team
rather than per-person, because a per-person rate is a salary by another name
and a reporting table is not where one belongs.

**A timer is one per person and is not believed past twelve hours.** A
second start names the first rather than starting a second. A stop after
longer than twelve hours is capped, and the cap is written into the note, so
a forgotten timer becomes a visible correction rather than three days of
work.

**Elapsed time is recorded when a ticket *leaves* a working state, against
whoever it was assigned to at that moment.** Spans are kept in a small table
of their own rather than read from the ticket timeline, because the
status-change handler needs "when did it enter the state it is leaving" at
once and the timeline is a log. Paused states — waiting on the requester —
and settled states are measured but not recorded: waiting is not working.

**A budget's running total is maintained incrementally and recomputed
nightly**, the shape MOD-12's rollup takes for the same reason. A threshold
is noticed the moment an entry crosses it, published once per period per
line through markers on the period row, and the nightly recompute corrects
any drift without re-announcing a line already crossed. A budget and an entry
in different currencies do not sum; the entry is logged and skipped, because
pounds and euros added together is a number with no meaning wearing a
currency sign.

## Consequences

Cost appears the day a rate is entered, and only for entries logged after it.
The seed sets every rate to zero rather than guessing: money is the tenant's
to state.

The kind is on every row, every fact and every event, and a report that wants
"total time" has to say which total it means. That is friction, and it is the
friction that keeps the cost figure meaning something.

`fact_time_entry`, the table doc 06 §6 named before the module existed, is
projected from `time.entry.logged` and removed by `time.entry.deleted`, so a
withdrawn entry leaves reporting as it left the ticket.
