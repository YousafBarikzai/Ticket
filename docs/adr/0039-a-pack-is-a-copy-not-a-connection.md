# ADR-0039 · A pack is a copy, not a connection

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-22, MOD-05, MOD-06, MOD-07, MOD-09

## Context

An enterprise service management pack is meant to stand a non-IT desk up in
one action: HR, facilities, finance and legal get the services they offer,
the forms their requests are raised on, the workflow that fulfils them, the
SLA they answer to and the article that explains it. The question is not
what a pack contains. It is what the tenant owns afterwards, and what
happens the day the deployment ships a better version of it.

The obvious design links the tenant's items to the pack, so improvements
arrive automatically and tenant changes are stored as overrides. It is also
the design that makes a desk's form change under it on a Tuesday, for
reasons nobody in that tenant chose, and it puts the pack into the path a
request takes for ever — so a pack can never be withdrawn and a tenant can
never fully own its own configuration.

The second question is who may write a pack. An installed pack is not data:
it is a workflow, a set of conditions and an SLA policy. It is executable
configuration, and whoever writes one decides what runs.

## Decision

**Installing copies; the copy is the tenant's.** What lands is an ordinary
service, form, request type, workflow, policy and article, written through
the modules that own each of them — so a pack goes through the same
validation, the same audit rows and the same `catalogue.item.published`
event as anything an administrator typed in. Nothing about MOD-22 is
consulted at run time. A desk whose pack was withdrawn tomorrow carries on
working, because there is nothing left of the pack in the path a request
takes.

**An edit is a hash that no longer matches.** Each installed item records
the SHA-256 of the shipped definition it was copied from, over a canonical
shape both sides are normalised into by the same function. An item that
still hashes to that value is untouched; one that does not is somebody's
deliberate change. That single comparison is what makes the rest possible,
and it is why the normalisation is one function rather than two that agree
today.

**A newer version is offered, item by item, and never applied.** The diff
has eight answers, and the useful distinction is between *update* — the pack
moved, this copy is untouched, taking it is safe — and *conflict*, where
both moved and taking it would destroy work somebody did. Nothing moves
that was not named. An item the tenant refuses records the hash it refused,
so it is not offered again until the pack moves past that version, and an
item the pack stops shipping is reported and never withdrawn: a desk that
has used a request type for a year does not want it removed because the
deployment tidied its own catalogue.

**Packs are written with the deployment, never uploaded.** They live in
`modules/esm/src/packs`, are reviewed and released like any other change,
and the unit suite puts every shipped pack through the checks the modules
apply at install — the form documents, the workflow graphs, the references
between items. A tenant administrator cannot upload one, because an
uploaded workflow is a code path wearing a configuration surface.

**An install is resumable, not atomic.** Each owning module opens its own
transaction, so a pack cannot land in one. Every item is recorded as it
lands and the install stops at the first failure rather than pressing on, so
running it again continues from where it stopped and doubles nothing. A key
that already belongs to somebody else is a refusal before anything is
written, naming what clashed.

**A pack ships no identifiers, and says what it cannot know.** No team, no
owner, no calendar, no approval policy: a pack cannot know what a tenant
has. So an SLA policy matches on `ticket.serviceKey` rather than a pasted
identifier — the SLA matcher now reads the service by key as well as by id,
which is what a hand-written policy wanted anyway — escalations are left to
the desk, and everything a pack deliberately leaves undone is listed as a
next step in the install result rather than guessed at.

## Consequences

- MOD-05, MOD-06 and MOD-07 gained the update paths they had been missing
  since they were built: a service, a catalogue item, a form document, a
  workflow's label and an SLA policy's own fields could all be created and
  never changed. Packs needed them; every administrator needed them too.
- A tenant that edits everything it installs gets a diff full of conflicts
  and a pack that can never improve it. That is the right answer — it is
  their configuration — and the diff says so plainly rather than pretending.
- Articles are published where the tenant allows it and left in draft where
  the tenant reviews articles before publication, because a pack does not
  overrule a desk's own governance. The install result says which happened.
- `request.submitted` moves a *last used* timestamp on the installation and
  never a count: delivery is at least once (ADR-0031), and "when was this
  desk last used" is a question a maximum can answer honestly.
- Two packs cannot claim the same key, enforced by a unique index rather
  than by care. The cost is that a pack cannot extend another one's service;
  the benefit is that uninstalling never has to guess who owns what.
- Nothing uninstalls. Removing a pack would mean deleting the tenant's own
  configuration, which is the one thing a copy-on-install design promises not
  to do.
