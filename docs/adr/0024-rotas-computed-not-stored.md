# ADR-0024 · Rotas, turns and shifts are computed from a definition, never stored as a cursor

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-20, §4.2 Workload and routing

> ADR-0023 is the integration gateway, delivered in the first Phase 4 change.
> This is the second.

## Context

MOD-20 has to answer three questions, over and over, for years:

- Who is on call right now?
- Whose turn is it to receive the next ticket?
- Is this person at work?

Each has an obvious implementation that is wrong in the same way. An on-call
rotation can hold a `currentMemberIndex` and a job that advances it every
Monday. Round robin can hold a `lastAssignedIndex` and increment it. A shift can
write `off_shift` onto everybody's availability row at six o'clock.

All three are **cursors**: state that is correct only if every advance happened
exactly once. In a platform whose eventing is deliberately at-least-once
(ADR-0002), whose jobs are retried, and whose workers restart, "exactly once"
is a property one has to build, not assume. A cursor that is advanced twice
skips somebody's turn; one that is missed repeats it; one that is advanced
during a replay does both. None of these fail loudly. The symptom is that
somebody is not paged on the night it matters, six weeks after the bug.

Daylight saving makes the same point arithmetically. A weekly rota advanced by
`7 × 86_400_000` milliseconds drifts an hour twice a year, and a handover that
was 09:00 becomes 08:00 and then, eventually, the wrong day.

## Decision

**Every one of these three answers is a pure function of a definition and the
clock. Nothing counts, nothing advances, nothing is swept.**

- **On call.** A rotation stores a start instant, a cadence, an ordered member
  list and a local handover time. `periodIndex(definition, at)` counts whole
  *local days* since the start — not milliseconds — and divides by the cadence.
  Asking the same question twice gives the same answer; asking it after a
  restart, a replay or a six-month outage gives the same answer.
- **Shifts.** A pattern of local wall-clock periods per weekday, converted
  through `@itsm/business-time`. `isOnShift(pattern, at)` is evaluated at read
  time. Nothing writes `off_shift` to anybody, so a worker that has not run for
  an hour cannot leave the rota an hour out of date.
- **Round robin.** Derived from `agent_routing_mark.last_assigned_at` — *when*
  each agent was last given work — rather than from an index into the member
  list. The mark is a projection, and the failure it can have is the cheap one:
  a late mark delays somebody's turn by a single ticket. It also never moves
  backwards, so an event arriving late cannot push somebody back up the queue.

**A swap is an override, not an edit.** Covering one week by reordering the
member list moves everybody's turn for ever; the rota is a fact about every
week and a swap is a fact about one of them. Overrides are stored separately,
win outright while they last, and leave the rotation untouched underneath —
which is why the week after a swap is still whoever's it was.

**A refusal is a published event.** When routing can find nobody, it publishes
`workload.assignment.declined` carrying the reason, and the ticket stays on the
group queue. "Nobody on the team can take it; 4 of 6 away" is something an
administrator acts on before lunch; a queue that silently stops moving is
indistinguishable from a broken router.

## Alternatives considered

- **A cursor advanced by a scheduled job.** The conventional answer, and the
  reason on-call tools have a "resync rota" button. Rejected: it makes
  correctness depend on a job having run exactly once, for years.
- **Materialising the schedule — a row per shift occurrence, per week, ahead of
  time.** Considered seriously; it is what most rostering products do, and it
  makes "show me next quarter" a plain query. Rejected here because it needs a
  horizon, a backfill job when the horizon is reached, and a regeneration path
  whenever a definition changes — three moving parts to replace one function,
  and each of them a way for the stored schedule to disagree with the rota
  people think they are on. If reporting later needs materialised occurrences
  they can be generated *from* these functions, which is the safe direction.
- **Counting load from a maintained counter.** Rejected for the same reason as
  the cursor: a counter drifts. Open tickets are counted live against
  `ticket(tenant_id, assignee_id, status_category)`, an index that already
  exists, so the number cannot be wrong.
- **Relaxing the filters when nobody is eligible** — routing to somebody who is
  away rather than declining. Rejected: it converts a visible staffing problem
  into an invisible one, and it puts work on somebody who is not there.

## Consequences

- "Who was on call last March?" is answerable without any history table, by
  asking the function about March — as long as the definition has not been
  edited since. Editing a rotation therefore records both member lists in the
  audit entry, which is what makes "when did my week move?" answerable.
- A rota can be queried for any instant, past or future, at no cost. The API
  takes `?at=`, and `upcomingHandovers` returns the next four with the answer,
  because the question behind "who is on call?" is almost always "and for how
  much longer?".
- A time zone or handover time that cannot be read is rejected at write time,
  by asking the function for one handover before the row is stored. The
  alternative is discovering it at 2am, from the thing that was supposed to say
  who to wake.
- Somebody on no shift at all is **not** off shift — they are simply not
  rostered. Without that distinction a tenant who enables the module before
  describing their shifts finds that nothing routes to anybody, which looks
  exactly like a broken installation.
- Availability carries a *reason*, not a boolean. "Away until Tuesday", "at
  lunch" and "has left" need different handling, and a return date that has
  passed clears itself at read time — except for "has left", which no date
  brings back.
