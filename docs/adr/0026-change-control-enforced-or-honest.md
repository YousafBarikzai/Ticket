# ADR-0026 · Change control is enforced where it can be and honest where it cannot

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-08-E3, §4.2 ITIL practices

## Context

Change control has one characteristic failure, and it is not changes going
wrong. It is changes going **unrecorded**.

Every control that makes recording a change more expensive than not recording
one buys a little safety and spends a lot of coverage. The arithmetic is worse
than it looks, because the changes that escape are not a random sample: they are
the routine ones (too small to be worth the paperwork) and the urgent ones (no
time for the paperwork). Those are, respectively, the changes most often made
and the changes most likely to have caused the outage somebody is investigating
next week.

A change record with holes in it is worse than no record at all, because it is
trusted. "There were no changes that night" is a sentence people act on.

The tempting design is to tighten everything: approve every change before it
happens, refuse any change outside a window, demand a root-cause-grade
justification for an emergency. Every one of those is defensible in isolation
and the combination produces a system whose real change process runs on a
spreadsheet somebody keeps privately.

## Decision

**Three kinds of change, approved three different ways, so the cost of
recording one stays proportionate to its risk.**

- **Standard** — pre-approved as a class by a published template. Raising one
  costs nothing beyond naming it, which is the point: the routine changes are
  the ones most often done unrecorded. The change is pinned to the template
  *version* that was signed off, so editing the template later cannot
  retroactively change what was approved.
- **Normal** — approved before it happens, through MOD-17. If no approval policy
  matches, the change is **approved with the reason recorded**, not left waiting
  for ever. A tenant that has not written a CAB policy is not asking for every
  change to be blocked; what matters is that "approved because no policy
  applied" is distinguishable from a change that slipped past one.
- **Emergency** — **recorded first, approved afterwards.** It goes straight to
  `scheduled`, owes a retrospective approval, and that debt is a column, an
  index and an endpoint rather than a good intention.

**A blackout window refuses. A change window advises.**

The asymmetry is deliberate and it is the second half of the same argument.
A blackout is a small number of declared periods with a named owner and a
reason — "finance cannot reconcile during a change" — and the entire point of
declaring one is that it holds. A warning is a thing people click through, and a
control everybody clicks through exists only in the audit report. So a change
overlapping a blackout is refused, and *overlapping* rather than *contained*,
because "it only runs twenty minutes into the freeze" is not an argument anybody
wants to be making.

Change windows are the opposite case: the set of legitimate exceptions is large,
and a hard refusal would push people to raise ordinary changes as emergencies —
trading a small governance win for a large hole in the record. So a change
outside every defined window is allowed, flagged, and reported.

**Two fields are worth refusing over, and no others.** A back-out plan, on
everything but an emergency change (which is already happening) — a change
nobody can undo at 2am is what turns a bad deploy into an outage. And a close
code, because a change closed with no outcome tells you nothing, and the only
reason to keep the record is to be able to ask later whether it worked.

Everything else is optional. In particular no free-text justification is
demanded anywhere, because a demanded justification is a filled box.

## Alternatives considered

- **Approve everything, including emergencies, before implementation.** The
  orthodox reading of ITIL. Rejected: it does not stop the emergency change, it
  stops the *record* of the emergency change, and the record is the only thing
  the platform was ever going to provide.
- **Warn on blackouts rather than refusing.** Rejected: see above. If a blackout
  is advisory it is documentation, and a tenant that wants documentation can
  write documentation.
- **Refuse changes outside a change window.** Rejected as the mirror image —
  it is the control most likely to be routed around, and the route around it is
  the emergency path, which is the one place coverage matters most.
- **A single "requires approval" boolean instead of three kinds.** Rejected: it
  cannot express *when* the approval happens, which is the only interesting
  difference between a standard change and an emergency one.
- **Auto-approving a normal change when no policy matches, silently.** Rejected.
  The behaviour is right; the silence is not. `approvalNote` carries the reason,
  so an auditor can tell the two cases apart.

## Consequences

- An emergency change can sit unapproved indefinitely, and that is visible
  rather than hidden: `GET /changes/owed-retrospectives` is the list, with an
  `overdue` count against a per-tenant threshold, and `change.closed` carries a
  null `retrospectiveApprovedAt` for one nobody ever came back to. **That number
  is the health metric for this module** — a rising count of unapproved
  emergency changes says the emergency path is being used as a shortcut, which
  is exactly what a permissive design has to be watched for.
- The retrospective approval is a separate permission from raising or
  implementing, and the service refuses it from the person who requested the
  change. The person who made the change at 3am is exactly the person who should
  not be signing it off at 9am.
- A published standard change template must have a back-out plan — enforced by
  the service *and* by a CHECK constraint, because a standard change inherits an
  approval nobody looks at twice.
- Weekly windows are local wall-clock times against a zone, for the reason
  ADR-0024 gives. "Saturday at ten" stays Saturday at ten across a
  daylight-saving change; a window that moved by an hour twice a year would put
  somebody's deployment outside it without either of them noticing.
- A change that has begun has no way back: `implementing → review` is the only
  route, and both "it worked" and "we backed it out" are close codes. A route
  back to `scheduled` would let a half-done change look as though it never
  started.
