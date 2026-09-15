# ADR-0025 · A major incident is closed by its review, not by a status change

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-08-E1, §4.2 ITIL practices

## Context

Every incident process on paper ends with a post-incident review. Most of them,
in practice, do not. The reason is structural rather than cultural: by the time
the review is due, the service is back, the people who were up all night are
asleep, and nothing in the system distinguishes an incident that was understood
from one that was merely survived. The review becomes a thing somebody
*should* do, and things somebody should do lose to things somebody must.

The cost is specific. An organisation that restores service and moves on has
spent the outage and bought nothing with it. The same incident happens again,
and the second time nobody can even tell it is the same one, because there is
no record of the first beyond a closed ticket.

The obvious remedies are all weak:

- **A reminder.** A notification five days later, to people who have moved on.
- **A report.** "Incidents closed without a review" — read by whoever built the
  report.
- **A required field on closure.** Produces "human error" typed into a box.

Each of these treats the review as an obligation attached to a closed incident.
The incident is already closed; nothing depends on the review; so nothing
happens.

## Decision

**Resolved and closed are different states, and publishing the review is what
performs the closure.**

- **Resolved** means service is restored. It is the state everybody cares about
  during the incident and it is reached by an ordinary transition.
- **Closed** means resolved, reviewed, and the review published. There is no
  route to it through the status path at all: `transition(to: 'closed')` is
  refused and says to go through the review. `publishAndClose` publishes the
  review and closes the incident in one transaction.

The middle state — a published review on an incident nobody closed — is
therefore not reachable, which matters because that state is indistinguishable
from the failure this whole path exists to prevent.

**A review opens by itself the moment the incident resolves**, as a draft with a
due date. A review that has to be remembered is a review that is not written; a
draft with a date is a thing a queue can hold.

**One piece of content is required, and only one: every action must have an
owner.** "We should improve monitoring", owned by nobody, is how the same
incident happens twice. A root cause is *not* required, because a platform that
demanded one would be told "human error" — an owner is the one field that
cannot be fudged past the check, because the check is that a real person's
identifier is there.

**A severity whose policy does not require a review may be closed without one,
and the timeline says so.** Demanding a review of every small thing is how
reviews become a form nobody reads. "We decided not to review this" is itself a
decision somebody may want to ask about later, so it is recorded rather than
implied by an absence.

## Alternatives considered

- **One state, with a review flag.** Rejected: the flag is exactly the
  "somebody should" that fails. Nothing is prevented by an unset boolean.
- **Blocking resolution until a review exists.** Rejected, firmly. It would keep
  incidents open during the hours when "is it fixed?" is the only question
  anybody is asking, and teams would resolve the *ticket* and abandon the
  incident — losing the record entirely rather than merely the review.
- **Auto-generating the review from the timeline.** Considered, and it is the
  tempting one. Rejected because a generated review is a transcript, and the
  value of a review is the part that is not in the transcript: what people
  believed at the time and why it was wrong. The timeline is offered *to* the
  author instead.
- **Requiring a root cause.** Rejected as above: it buys a filled box, not an
  understanding, and a platform that cannot tell the difference should not
  pretend to.

## Consequences

- An incident can sit resolved for days. That is honest — it is resolved and
  not reviewed — and it is visible, where a closed-and-unreviewed incident is
  not. The review's `dueOn` is what a queue and a report hang off.
- Reopening is `resolved → mitigating`, never back to `declared`, so the
  declaration time every duration is measured from cannot be rewritten by an
  incident that came back. `resolvedAt` clears on reopening so it cannot count
  as met, and `durationMinutes` is refreshed to the later resolution.
- A published review cannot be edited: it is a record. Its **actions** can, and
  must be — whether somebody did what they agreed is live for weeks afterwards
  and is the only part anybody checks later.
- Closure is a single call, so an API client cannot construct the middle state
  by crashing between two.
- The timeline is append-only in the database (UPDATE refused by trigger),
  because the person most motivated to soften an entry is the person the entry
  is about. DELETE is *not* blocked: doing so would also block the tenant purge
  and leave a purged customer's incident timelines behind, which is a worse
  failure than the one it prevents.
