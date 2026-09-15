# ADR-0027 · Two registers, and a graph that is bounded, typed and never guessed

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-10-E1, §4.2, §6 Data

## Context

The CMDB is the module everybody asks for and nobody maintains. The reason is
consistent enough to design against: it gets built to be *complete* rather than
to be *useful*, so filling it in is somebody's chore and reading it is nobody's
habit — and a register nobody reads is a register nobody corrects. Within a year
it is wrong, still trusted, and quietly sending people to look at the one thing
that is fine.

Three specific decisions decide whether that happens here.

**What goes in it.** The orthodox model has one table for "things", with columns
for purchase cost, warranty, hostname and criticality. It collapses two
different questions with two different owners: finance asks what something cost,
who has it and when the cover runs out; operations asks what depends on it and
what falls over if it goes. One table means every column is optional for half
the rows, and a register like that gets filled in badly.

**How the graph is queried.** "What falls over if this goes?" is a reachability
question over a directed graph, asked during an incident by somebody who will
wait about two seconds. The estate is 100 000 items and 500 000 relationships
(doc 18 §1), and real estates are full of cycles: a webserver runs on a VM, the
VM is a member of a cluster, the cluster depends on the webserver for its health
check.

**Where the contents come from.** Discovery can propose thousands of
relationships an hour. Whether the platform may write them without a person
looking decides what the answer is worth.

## Decision

**An asset is a thing you own. A configuration item is a thing that can break.
Two tables, optionally linked, at most one asset per item.**

The same laptop is both. A spare monitor in a cupboard is an asset and not a
configuration item — nothing depends on it. A SaaS platform you consume is a
configuration item and not an asset — you own nothing. Each row then has a
reason for every column it carries, and the link between them is a nullable
foreign key with a partial unique index, not a pretence that the two registers
are one.

**Impact is a depth-bounded recursive CTE over typed edges, with path-array
cycle detection, cached per item for 60 seconds.**

- **Depth-bounded** (default 3, maximum 6, per-tenant setting). Beyond three
  hops an impact answer tends to reach everything, and an answer that reaches
  everything is not an answer.
- **Typed edges.** `depends_on`, `runs_on`, `installed_on` and `member_of` carry
  impact. `connected_to` does not: it is symmetric, it says two things can reach
  each other rather than that one needs the other, and including it is the other
  way a traversal ends up returning the whole estate.
- **Cycle detection by path array**, not by a visited set per level. Without it
  the query does not return a wrong answer, it returns *no* answer, and the
  first anybody hears of that is a request timing out during an incident.
- **Cached for 60 seconds, invalidated on any relationship write.** One new edge
  can change the answer for any item on either side of it at any depth, so the
  whole tenant's cached traversals are dropped rather than reasoned about.
- **Retirement is filtered inside the traversal**, not on the result. A
  decommissioned server that still has its old edges must not carry impact
  *through* itself to the things behind it.

**Direction is stated once and read the same way everywhere:** `from depends_on
to` means if **to** fails, **from** is in trouble. The API returns the sentence
back — "checkout depends on orders-db: if orders-db fails, checkout is in
trouble" — because a reversed edge is the mistake most often made and the one
least often noticed.

**Nothing infers a relationship or a link.** Every edge and every "this change
touched that item" was written by somebody who decided to write it. Discovery
(E2) proposes; a person confirms.

## Alternatives considered

- **One table for assets and configuration items.** The common model. Rejected:
  it is the shape that produces a register where every field is optional for
  half the rows.
- **A graph database for the CMDB.** Rejected for this phase. The traversal is
  bounded at depth 3 over two composite indexes and meets its target in
  PostgreSQL; a second datastore would add a consistency problem, an operational
  surface and a second transaction boundary to solve a problem that is not yet
  hard. ADR-0001's reasoning about extraction applies: the repository is one
  file, so if the estate outgrows this the query moves without the module moving.
- **An unbounded traversal with a result limit.** Rejected: the limit truncates
  after the work is done, so the pathological case still costs the time. The
  bound is what makes the cost predictable, and reporting "there may be more"
  when something sits at the bound is honest in a way a silent truncation is not.
- **Materialising the transitive closure on write.** Rejected: 500 000
  relationships make a closure that is enormous and that has to be maintained
  transactionally on every edge change — paying on every write to make a query
  fast that is already fast enough.
- **Caching longer than 60 seconds, or per-item invalidation.** Rejected: a
  stale impact answer is the specific failure this module cannot afford, and
  working out which cached answers one new edge invalidated costs more than
  dropping them.
- **Inferring affected items from a change's text, or from discovery, without
  confirmation.** Rejected. An empty CMDB sends people to ask somebody who
  knows; a confidently wrong one sends them somewhere else entirely.

## Consequences

- Attributes are declared on the class and validated on write, refusing rather
  than coercing. `cpuCount: "eight"` stored silently as a string is the row that
  breaks a report six months later, when nobody can tell which of four hundred
  rows is wrong. Validation returns *every* problem in one pass, so an importer
  fixes a spreadsheet once rather than forty times, and an attribute the class
  does not declare is refused as the typo it almost always is.
- Classes inherit, most general first, so a subclass may tighten what it
  inherits — "Server declares environment optional, Database Server requires
  it". A class loop is refused at write time, because the attributes a loop
  reports depend on where the depth bound happens to cut it.
- Configuration items are **retired, never deleted**. Deleting one breaks every
  incident, problem and change that named it, and the history is the whole
  reason to keep a CMDB. A CHECK constraint keeps `status = 'retired'` and
  `retired_at` in step, because the traversal reads the timestamp.
- The link table is polymorphic and shared across record types, so "what has
  touched this item?" is one query returning Tuesday's change and Wednesday's
  incident in one list. This closes the gap MOD-08 left: a change record that
  cannot name what it changed cannot be correlated with the outage that followed.
- Reading the register and writing it are separate permissions. An agent reads
  it during triage and may say what a ticket touched; writing the register is a
  lead's. The value of a CMDB is that its contents were decided, and one anybody
  may edit mid-incident stops being one anybody trusts.
- The asset register keeps assignments as a history rather than a current-holder
  column, with one open holding enforced by a partial unique index. "Who had
  this laptop in March?" is asked after something is found on it, and a column
  cannot answer it.
