# ADR-0049 · One console, two audiences, and the gate between them

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-13, MOD-01, MOD-04, doc 14 §1, doc 16 §2

## Context

Four phases built an enormous amount of configurability — custom fields,
forms, business rules, workflows, SLA policies, notification templates, the
catalogue, ESM packs, feature flags, plan limits, AI prompts and budgets — and
**none of it had an interface**. An administrator configured this platform with
`curl`. Doc 14 has described `apps/admin` since Phase 1 and doc 16 §2 assumes an
`admin` subdomain; neither existed.

Two questions had to be answered before writing a line, and both were the
product owner's rather than a developer's.

**Which builders come first.** Twelve, and one of them — the workflow graph
editor — is a project in its own right. Building all twelve shallowly would be
worse than building four properly.

**Whether the console serves one audience or two.** A tenant administrator
configures one desk. A platform operator provisions tenants and edits the price
list every tenant is sold against. These are different people with enormously
different blast radius, and putting them in one application means a screen
listing every customer is one permission check away from somebody who runs a
service desk.

## Decision

**Day-one setup first**: people, the shape of a ticket, and settings. The
things a deployment cannot be used at all without — nobody can be onboarded
without roles, and a ticket form nobody can edit is a product decision frozen
at seed time.

**Both audiences, in one application, in separate route groups.** `(admin)/`
and `(platform)/`, each with its own layout.

**The platform gate is in the section's layout, not on its pages.** Next
renders a segment's layout before any page inside it, so a route added to
`(platform)/` later is behind the check by construction rather than by
somebody remembering.

**It answers 404, not 403.**

**No service worker and no offline support.** Every other application here has
one; this must not.

## Consequences

**The gate's placement is the whole of its value.** A per-page check is one
page away from being forgotten, and the page somebody forgets is the one that
enumerates every customer on the deployment. Putting it in the layout means
forgetting is not available: a new file in that directory is gated whether or
not its author thought about it.

**404 rather than 403 is a deliberate refusal to be helpful.** "You may not see
this" tells somebody there is a platform section and that they are one
permission away from it. A 404 tells them nothing they did not already know.

**None of this is the security boundary, and the ADR says so where somebody
will read it.** The API refuses every `platform.*` call without
`platform.tenant.manage` whatever the console does — and no role in the shipped
role seed holds one, which the gate's test asserts using the real permission
list rather than a contrived one. The console's job here is not to enforce; it
is to not offer what it cannot deliver. A console that rendered a tenant list
and then showed a wall of 403s would be worse than one that says the section is
not there.

**An administration console that works offline is a hazard, not a feature.** A
console answering from a cache while somebody is changing a permission, a limit
or a residency policy shows them a configuration that is not the one in force,
and the mistake that invites is the expensive kind. This is the one application
in the repository with no service worker, and the omission is deliberate rather
than unfinished.

**Three screens write and the rest say they do not.** Custom fields and feature
flags can be changed here; creating a user, assigning a role, adding somebody to
a team and every typed tenant setting cannot. Each of those is a write with its
own failure mode, and a half-built form that posts one of them is worse than a
list with an honest note under it. Every such screen names what is missing on
the screen itself rather than only in doc 23, because the person who needs to
know is the one looking at it.

**The overview names the sections somebody cannot reach, and which permission
each needs.** An administrator who cannot find a screen asks a colleague, who
tells them it is missing. An administrator told which permission it needs asks
for the permission.

**Deriving a field key found a real defect in the first draft.** `keyFor`
camelCases a label, and the API requires `^[a-z][a-zA-Z0-9]{0,63}$`. "1st line"
produced `1stLine`, which the form would happily submit and the API would
refuse with a message about a regular expression. It now returns empty and the
editor asks for a different label — `firstLine` would be an invention and
`stLine` nonsense. The test that caught it was originally written as a
tautology, which is worth recording: a test asserting `x` equals a rearranged
`x` passes forever and proves nothing.

**A third application reaching for `fetch` had to be an explicit edit**, and it
was. `check-boundaries`'s egress allow-list names each application's browser
client individually with a comment saying why it is listed per app rather than
by pattern. Adding the console meant adding a line, which is the design working.

## Alternatives considered

**Tenant administration only, platform screens API-only.** One audience, one
permission model, no gate to get wrong. This was the recommendation; the
product owner chose both, having seen that argument. Recorded because the
choice is reversible and the reasoning should survive: the cost of the other
answer is one bundle serving two audiences, and it is paid in the care taken
with the gate rather than in features given up.

**Everything read-only in the first slice.** Cheaper per screen, and genuinely
useful for debugging a tenant. Rejected because it solves nothing about
*configuring* one, which is the gap the console exists to close.

**A generic settings editor: every key, as JSON, in a text box.** It would cover
every typed setting at once. Rejected because a text box that posts JSON is a
worse answer than none — it invites an administrator to break a tenant's
configuration in a way that reads as a syntax error rather than a decision, and
it makes the console's job look done when it is not.
