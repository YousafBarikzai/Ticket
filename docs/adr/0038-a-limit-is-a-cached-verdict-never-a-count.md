# ADR-0038 · A limit is a cached verdict, never a count

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-21, MOD-04, MOD-01, doc 10 §5

## Context

A plan limit has to answer one question on the request path — *may this
tenant raise another ticket* — and the obvious implementation answers it by
counting. That is wrong in a way that gets worse exactly as it matters
more: the count is over the table that grows, so the check slows down in
proportion to the tenant's size, and it runs on every creation, so the
platform's throughput becomes a function of how closely it is metered. Doc
10 said as much in Phase 1 — "enforced asynchronously … never on the
synchronous request path" — and left open what "enforced" then means, since
a limit nobody enforces is a warning with extra steps.

The second question is what a limit does when it is reached. Refusing
everything is wrong: a desk that cannot close the tickets it already has
because of a licence is a desk that will not renew. Refusing nothing is
also wrong: it is not a limit.

The third is who owns which number. A tenant that could raise its own hard
limit does not have a plan. A tenant that cannot bring its own *warning*
forward is a tenant being told about a problem later than it wanted to be.

## Decision

**The request path reads a verdict, not a figure.** One word — `ok`,
`warned`, `blocked` — cached per tenant per meter for a minute. Moving a
figure rewrites the word; a cache miss computes it from one small row.
The count itself happens where counting is cheap: as events land, and in a
nightly rebuild from the rows that define each meter. A tenant can
therefore be at most a minute over its limit, which is the right trade for
a commercial control and would be the wrong one for a security control —
so this is only ever used for commercial ones.

**It fails open.** If the cache is unreachable the work goes through.
Refusing every ticket in a company because Redis restarted is a worse
outcome than a tenant briefly exceeding a plan, and the platform's
`assertWithinLimit` is where that judgement lives rather than in each
caller.

**A hard limit stops the act that grows the meter, and nothing else.** Over
on agents means no new agent; over on tickets means no new ticket. Reading,
commenting, resolving and closing are never refused, and the refusal says
so: it names the plan, the figure, the limit, and that everything already
here keeps working. The status is **402**, not 403 — the caller is
permitted and the obstacle is commercial, so a client that retries after an
upgrade is doing the right thing and one that retries after a 403 is not.

**The socket is in the platform; the plan is in MOD-21.** `assertWithinLimit`
is a platform primitive that MOD-21 plugs into at boot, the way credentials
and scopes already work. MOD-04 can refuse a ticket without depending on
licensing, which keeps the dependency pointing the right way and keeps the
ticket module testable on its own. With nothing registered every check
passes, which is the right default for a deployment that sells nothing.

**Four meters, two shapes.** `agents` and `storage` are *live* figures —
true right now, re-measured from the source rows, so a person given two
roles is still one agent and a deleted attachment gives its space back.
`tickets` and `api_calls` are *counted* per calendar month. The period is
spelled out as a key (`live`, `2026-09`) rather than left as nullable
dates, because PostgreSQL treats NULLs in a unique index as distinct and a
live meter keyed on nulls would duplicate itself on every upsert — the
lesson MOD-12's rollup already paid for.

**`api_calls` cannot be rebuilt, and says so.** No row anywhere remembers a
request, so its figure is the counter: incremented in the cache on
response, flushed into the meter once a minute, and returned as `null` by
the function that rebuilds every other meter. Pretending it could be
recomputed would be worse than admitting it cannot.

**A migration's history is not this month's work.** Tickets brought in by
MOD-24 do not move the ticket meter. A desk that moves in on the first of
the month would otherwise spend its entire allowance on its own past.

**Plans are the deployment's; one threshold is the tenant's.** Plans and
their limits are written only through the platform console, carry no
`tenant_id`, and are read by every tenant. A tenant administrator sees the
plan, the usage and the limits, and may move its own *warning* threshold
anywhere below the hard line — refused above it, because a warning nobody
reaches before the refusal is a warning that does not exist. There is no
route anywhere that takes a hard limit from a tenant.

## Consequences

- Two numbers can disagree for up to a minute: the figure in the database
  and the verdict in the cache. Changing a plan drops the verdicts rather
  than waiting for them to expire, so an upgrade takes effect at once.
- The nightly rebuild corrects drift the way MOD-12's rollup does, and
  announces nothing when it finds the same figure: each line is announced
  once per period, through markers on the meter row.
- `LimitReachedError` is the first 402 in the platform. It needs no special
  handling — the existing problem-details mapper carries it — but it is a
  status clients have not seen before and belongs in the API documentation.
- Counting agents by role means a tenant that grants an agent role to fifty
  people who never sign in is charged for fifty agents. That is the right
  answer commercially and a surprising one operationally; the meter
  description says what it counts.
- The `usage.flush` job runs every minute, which is the most frequent
  schedule in the platform. It visits only tenants with something in the
  buffer, so an idle deployment does nothing sixty times an hour.
