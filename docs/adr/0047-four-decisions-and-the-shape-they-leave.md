# ADR-0047 · Four decisions, and the shape they leave

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-21, MOD-19, MOD-09, doc 13, doc 19 (OD-05, OD-06, OD-07)

## Context

Doc 19 has carried four open decisions since Phase 1. Each is a product
question rather than a technical one, which is why they stayed open: the code
was built to accommodate either answer, and picking one is not a developer's
call. They are now answered, and this records what each answer costs.

They have one thing in common worth naming. In every case the mechanism was
built and the *policy* was absent — plan rows with no price, a billable column
with a default nobody had chosen, a region column for tenant data and none for
where a prompt may be processed. A mechanism with no policy behind it is the
same failure this repository has found repeatedly (ADR-0044, ADR-0045): it
looks finished and decides nothing.

## Decision

**OD-05 · Per-agent seats, three tiers.** Starter (£19), Professional (£45),
Enterprise (negotiated), plus a `trial` that is not a tier. Priced per agent per
month, in micro-pence, on the `plan` row.

**OD-06 · Railway.** What docs 03 and 16 already assumed and `infra/railway`
already contains. The deploy pipeline is separate work; this decision only
stops it being blocked.

**OD-07 · A time entry is not billable unless somebody says so.** The schema
default is `false` and no seeded activity type is billable.

**AI residency · A per-tenant allowed-region list.** `tenant.ai_allowed_regions`,
empty meaning "wherever this tenant's own data lives". A provider declares
where it processes; the gateway refuses a call whose provider is outside the
tenant's list.

## Consequences

**Pricing is recorded and nothing is charged.** `price_per_agent_micros` says
what a plan costs. There is no payment provider, no invoice, no dunning and no
proration, and doc 23 carries all of that as absent rather than implied. An
operator editing these numbers is editing a price list.

Micro-pence, not pence, and not a decimal: every other amount in this platform
is held that way, and a second money convention is how two numbers that look
comparable turn out to be a thousand times apart. It is returned as a *string*
over the API, because a bigint does not survive JSON and a number would lose
precision on an annual figure for a large tenant.

**Enterprise has no list price, deliberately.** At that size the number comes
out of a negotiation, and publishing one would be a fiction. `null` is the
honest value and the schema allows it.

**The `team` plan is not renamed, and existing tenants keep it.** `seedPlans`
skips a key that exists, so a deployment that already seeded `team` keeps that
row and gains `starter` and `professional` alongside. Renaming would have
changed the plan a tenant is on without anybody deciding to move them.

**Under-billing is now the failure mode, and that is the point.** An agent has
to mark work billable. The cost is revenue nobody invoiced, which is a
conversation somebody has; the alternative is invoicing a customer for work
nobody meant to charge for, which is a refund and a lost argument about trust.

**Existing time entries are left alone.** The migration changes the default,
not the rows. An entry already recorded was entered under the old policy and
may already have been billed; rewriting it to match a new decision would change
history to suit the present.

**A residency policy nobody can write is a column, not a control** — so
`PUT /api/platform/v1/tenants/:id/ai-regions` exists, and it is a *platform*
door rather than a tenant one. Residency is a contractual term: a tenant that
could widen its own could remove the control, and a tenant that could narrow it
could lock itself out of every configured provider with no way to say why.

**The gateway refuses rather than routing elsewhere.** A fallback to a second
provider would be this platform deciding, on a customer's behalf, that
somewhere else is close enough — which is the whole of what a residency
commitment is meant to stop. 403 rather than 503, because waiting will not
change the answer and an error that looks transient invites a retry loop
against a policy. The check runs *before* the prompt is rendered, so a tenant
whose policy forbids the provider never has its ticket text interpolated into a
prompt string at all.

*Amended by ADR-0051.* A structured decision may move along a chain of
providers, but only between providers that are **all** inside the tenant's
allowed regions. One outside them is skipped, never used, and when none is
left the ticket keeps what intake gave it. Generation still refuses with 403.

**A provider that makes no external call has no region**, and `null` says so
rather than inventing one. The stub is the only such provider. This is not a
loophole — any provider that does make a call must name a region, `null` has to
be written deliberately, and the egress rule (ADR-0023) already stops a module
calling a provider behind the gateway's back. A provider that declares the
*wrong* region defeats the check, which is why it is the operator's statement
about their own deployment rather than something guessed from a hostname.

**Eleven places build a context from a tenant row**, and each used to spell
`region: tenant.region` by hand. Adding a second tenant-derived field to that
arrangement means eleven edits and one silent failure wherever somebody misses
one — and a residency policy that is simply absent in the worker reads exactly
like a residency policy that allows everything. `tenantFacts` names the set
instead, and widening the worker's `activeTenants` select was a change the
helper made visible rather than one anybody would have remembered.

**Making `allowedRegions` a required field of `GatewayCall` found a second call
site.** The evaluation runner sends the same prompts to the same provider as
the real thing, and an evaluation that was exempt would be a way to process a
tenant's data outside its regions by calling it a test. An optional field with
a permissive default would have left that hole open and looked fine.

## Alternatives considered

**Usage-based pricing, or seats plus metered AI.** The AI budget module already
measures spend in micro-pence, so the machinery exists. Rejected because a
buyer of a service desk forecasts headcount and cannot forecast tokens, and a
bill that moves with usage is the thing procurement asks about first. Revisit
when there is a customer whose AI spend is material.

**Billable by default.** Right for an MSP where nearly all work is chargeable.
Rejected because this platform is not only for MSPs, and the wrong default here
is silent in the direction that costs trust.

**A single EU region for everybody.** No policy table, no per-tenant setting,
nothing to get wrong. Rejected because it answers "no" to any customer who
requires domestic processing elsewhere, and the column it saves is one column.

**Inferring the provider's region from its endpoint hostname.** No operator
input to get wrong. Rejected because it is a control that is wrong quietly: a
proxy, a private endpoint or a CDN in front of a vendor all make the hostname
say nothing about the jurisdiction, and a confident wrong answer is worse here
than an explicit one somebody had to type.

**Defaulting an empty policy to "everything permitted".** The usual reading of
an empty allow-list in configuration. Rejected as the wrong way to fail: a
tenant provisioned before the column existed would silently permit every
region, which is the opposite of what its data-residency choice already said.
Empty inherits `tenant.region`, and `residencyPermits` refuses an empty list
outright so that a resolver bypassed by some future caller fails closed.
