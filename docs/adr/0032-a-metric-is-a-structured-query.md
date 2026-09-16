# ADR-0032 · A metric is a structured query, not an expression

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-12, §7 Authorisation

## Context

MOD-12-E1a built the star schema. E1b has to let people ask it questions, and
the questions a tenant wants are never quite the fourteen the platform ships:
"tickets raised by the finance organisation, excluding requests, that breached"
is one filter away from a built-in and is the metric somebody actually needs on
their dashboard.

There are three ways to let a tenant say that. A fixed catalogue with a filter
box, which cannot express a rate or a percentile the platform did not think of.
A free expression language compiled to SQL — the platform already has one,
`@itsm/expr`, used by rules and forms — which can express anything and is an
expression-to-SQL compiler with tenant-authored input, which is to say an
injection surface that has to be reviewed on every change forever. Or something
between.

## Decision

**A metric is a fact table, an aggregate, an optional field and a list of
`(field, operator, value)` filters, and every identifier comes from a catalogue.**

The catalogue (`FACT_CATALOGUE`) says, per fact, which columns exist, what type
each is, and which may be broken down by. A filter names a field by its
catalogue name; the query builder looks the column up and splices it in as a
quoted identifier from the catalogue, never from the request. The value travels
as a bound parameter. The two never meet: the unit tests read the generated SQL
as text and assert that no user value appears in it and no column appears that
the catalogue did not supply.

Built-in metrics are written in exactly the same shape. That is not a
convenience; it is the guarantee that there is one evaluator. A built-in path
and a custom path would be two implementations of "count the rows in a period",
and the session that built MOD-10 has already found three copies of one idea
disagreeing with each other three times.

Three consequences follow, and each is a line somebody will want to cross:

- **A tenant metric cannot express what the catalogue cannot name.** No
  computed columns, no joins, no sub-queries. A question that needs one is a
  new column on a fact table, added by a migration with a name and a comment —
  which is how a data warehouse should grow anyway.
- **The rollup answers only built-ins.** A tenant copy of "tickets raised" that
  looks identical today might add a filter tomorrow; the rollup would not know.
  So the fast path is reserved for metrics the platform versions, and the
  integration suite asserts the fast path and the scan agree.
- **`@itsm/expr` stays where it is.** Rules and forms evaluate expressions in
  memory over a document; nothing there becomes SQL. Bringing it here would
  have been the third way, and the third way is the compiler.

Team-scoped readers see their teams' numbers: a fact that carries a team gets a
filter added under them, and a fact that does not — approvals, notifications —
is refused rather than shown in full. A scope that cannot be honoured is not
quietly widened.

## Consequences

The catalogue is the API. Renaming a fact column is a breaking change for every
tenant metric that names it, so the catalogue keys are stable names (`teamId`)
mapped to columns (`team_id`), and the column can move without the key moving.

Percentiles and rates are supported because a service review asks for them —
"nine in ten resolved within" is the number in the contract — and because
leaving them out would have made the expression language the only way to get
them, which is how the third way arrives anyway.

Dashboards are the same table shared or personal, distinguished by an owner
column: a personal dashboard somebody wants to share becomes shared by clearing
one column, not by being rebuilt somewhere else. Reading is one permission
filtered by ownership; the query asks for "shared, or mine", so a private
dashboard is absent from everybody else's list by construction rather than by a
visibility flag somebody could forget to check.

A report run keeps its result. The figure in March's report is the figure
March's report showed, even after a rebuild has corrected the facts beneath it;
the CSV is rendered from the stored result on request, so nothing goes to
object storage and the link in the notification stays valid for as long as the
run exists. A row limit keeps a report a document rather than an export.
