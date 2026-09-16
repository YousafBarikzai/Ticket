# ADR-0037 · The provider owns the people; the tenant owns the access

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-01, MOD-21, doc 09 §JIT

## Context

Until now a person existed on this platform because they signed in (JIT),
because an administrator typed them in, or because a migration brought
them. None of those is how a company knows who works there. The company's
identity provider knows: Entra ID or Okta has the joiner the day HR does,
and the leaver the hour security does, and the groups that say which desk
somebody sits on.

SCIM 2.0 is how a provider tells a service that. It is a small protocol
with a large tolerance problem: the RFC says one thing and each provider
does a slightly different one, and a server that reads the RFC too
literally refuses `Replace` for `replace`, `"False"` for `false`, and a
pathless PATCH that means exactly what a pathed one does. Meanwhile a
filter the server does not understand and quietly ignores is worse than
one it refuses, because the provider concludes the user does not exist
and creates them again.

Then there is the question SCIM does not answer: what does membership of
a provider's group *mean* here? A group is a team, obviously. Whether it is
also a role is a decision, and the wrong default in either direction is
bad — every group granting agent access is an incident, no group granting
anything is a desk nobody can staff.

## Decision

**The provider owns the people.** `/scim/v2/Users` creates, updates and
deactivates users through the same service functions an administrator's
click uses, with the actor `scim` on every audit line. `userName` is the
email, which is also how JIT and imports know a person, so the three
sources agree. An account that already exists — imported, invited, or
made by a first login — is adopted rather than reported as a conflict,
because the provider is right that the person exists; one the provider
already owns under a different `externalId` is a genuine duplicate and a
409. Deactivation is `deactivateUser`: every session and key revoked at
once, so a leaver loses access the moment the provider says so. DELETE is
deactivation too; the record stays for the tickets that name it.

**A group is a team, and the tenant decides whether it is a role.**
`/scim/v2/Groups` creates a team per group (adopting one with the same
name), keeps its membership in step, and retires it — members removed,
record kept — when the group is deleted. A tenant-configured map from
group name to role turns membership into access: joining a mapped group
grants the role, leaving it revokes the role, and the assignment remembers
which team granted it. A role an administrator granted by hand has no
such mark and is never the provider's to take. The map is replaced whole
and re-applied to everybody a SCIM group touches, so it cannot drift.

**The token names its tenant.** One bearer token per tenant, issued by an
administrator, shown once, stored as a hash. It carries the tenant's slug,
so a request that arrives with no session is resolved through the tenant
directory and then *as that tenant* (ADR-0035): the hash is compared
inside the tenant's own rows and there is no cross-tenant token table to
enumerate. Rotation keeps the old token for a day so the provider can be
updated without a gap; revocation stops every token at once. A SCIM
request runs with exactly the permissions people and teams need, and no
session token opens `/scim/v2`.

**Tolerant on the way in, honest on the way out.** Ops are read without
regard to case, booleans as strings are booleans, a pathless PATCH is
flattened into pathed ones, and attributes this platform does not keep
(title, department) are accepted and ignored. The filter grammar is one
equality on the attributes providers look up by, and anything else is
refused as `invalidFilter`. Errors are SCIM errors with a `scimType`, on
their own handler, because a provider reads that field to decide whether
to retry.

**JIT falls back to SCIM.** The API now provisions on first login when a
token names nobody the platform knows, linking by email first — which is
what doc 09 always said and nothing had wired.

## Consequences

- SCIM is the preferred source of people; JIT is the fallback for a tenant
  without it; imports (MOD-24) are for history. All three find a person by
  email.
- A team made by SCIM sits in the tenant's first organisation. A tenant
  with several organisations that wants provider groups in each is a
  setting this build does not have.
- Role mappings match a group's name, not its id, so a renamed group
  changes what it grants. That is deliberate: the map is something an
  administrator reads, and "Service Desk Agents grants agent" is readable
  where an object id is not. The rename test pins the behaviour.
- The API's context plugin gained two things it did not have: a SCIM
  branch, and the JIT call. The second was a gap since Phase 1, found by
  reading the plugin to add the first.
- Provider groups that are not mapped still become teams. That is the
  right default: a team costs nothing, and a queue somebody can route to
  is what a desk needs before it needs a role.
