# ADR-0033 · A survey is a form with a score, asked once, where the person already is

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-18, MOD-02, MOD-03, MOD-12

## Context

Every service desk wants to know whether the people it helped think it
helped. Every service desk that asks finds the same three things: the survey
tool has its own idea of a question that is nothing like the form builder the
desk already uses; people are asked so often that only the angry ones answer;
and the link goes to an inbox the person stopped reading three tickets ago.

MOD-12 has already reserved a fact table and a metric for the answers. What
MOD-18 has to decide is what a survey *is*, when it is sent, and how it reaches
somebody.

## Decision

**A survey document is MOD-02's form document plus a scoring rule.** The
questions are fields — the same JSON Schema subset, the same UI elements, the
same visibility conditions and the same `validateForm` the catalogue runs. A
second question schema would be a second set of rules that disagree the first
time either changes. What a survey adds is one thing a form does not have:
which answer is *the* answer and what scale it was asked on, so a 1–5 and a
0–10 can sit on one chart. The score is normalised linearly with the bottom of
the scale at zero: a 1 on 1–5 is 0, not 20, because the worst answer available
should read as the worst answer.

**Published versions are immutable, and a response names the version it was
shown.** Exactly as a catalogue form. Editing the working copy changes nothing
already asked; publishing snapshots it. A response recorded against version 1
still says `1-5` after version 2 changed the scale, because that is what was
asked.

**One ask per person per thing, and no second ask to anybody inside the
window, from any trigger.** The throttle is the single number that decides
whether a feedback programme produces numbers or noise. It applies across every
survey and every trigger, not per survey, because the person being asked does
not experience surveys per survey. A person who resolved their own ticket is
not asked to rate themselves.

**The ask goes where the person already is.** By email through MOD-11, always;
and into the chat thread the ticket lives in, when it lives in one, through a
job so that the outbound call is not inside the event consumer's transaction.
In a thread the rating is a row of buttons where the provider has buttons and
a typed number where it does not, which is why MOD-03 gained an "awaiting a
reply" state on a conversation and a registrable custom action: MOD-18 depends
on MOD-03, so MOD-03 cannot import the handler; it looks it up by name.

**In a thread, only the person the survey was sent to may answer it.** A
button in a shared channel can be pressed by anybody in the channel. The sender
must have a linked, verified identity that matches the invitation's recipient;
otherwise the reply says so and records nothing. A rating from somebody else,
however well meant, is not that person's opinion.

**The link proves itself.** A survey lands in an inbox and has to work with no
session and no password. The link carries a signed token — tenant, invitation,
expiry, HMAC — and the invitation stores only the token's digest, so a
database read is not a way to answer for somebody. The page behind it is
served by the API as JSON for a portal and as a small escaped HTML form for a
browser, because the platform has no portal application in this repository and
a link has to land on something a person can use.

## Consequences

MOD-18 depends on MOD-02's contract, MOD-11's delivery, MOD-03's threads and
MOD-04's tickets, and MOD-12 depends on MOD-18. That is a lot of edges for a
small module and each one is deliberate: a survey module that owned its own
questions, its own delivery and its own thread-posting would be three more
copies of things this platform already does once.

The three triggers — a ticket resolved, a request fulfilled (a resolved ticket
of type `request`), a major incident resolved — are all read off events the
platform already publishes. Fulfilment is not a new event, because a new event
for "the same status change, but for a request" would be published by nobody
and consumed by one module.

`survey.responded` is the only thing anything downstream needs, and it carries
the normalised score. A dashboard that wants the raw answers reads the response
row; the projection deliberately does not.
