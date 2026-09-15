# ADR-0036 · An import is not a creation

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-24, MOD-04, MOD-01, MOD-05, MOD-14

## Context

A desk moving onto this platform brings its history: the people, the teams,
the services, and years of tickets with the conversations on them. The
obvious way to bring a ticket in is `createTicket` with the dates changed,
and it is wrong in three ways that only show up in production.

First, a created ticket sets things off. An SLA clock starts on a ticket
closed in 2021. A "your ticket has been raised" email goes to somebody who
raised it in another tool. The routing rules put it in a queue. Fifty
thousand tickets arrive and every reactive part of the platform reacts to
each of them, at once, on a Sunday.

Second, a created ticket is `new`. A migrated one was resolved, or pending,
or closed, and its dates say when — and if the import cannot say so, the
history it brought is a list of open tickets with today's date on them.

Third, a migration is run more than once. The dry run, the first attempt,
the attempt after the mapping was fixed, the delta the week before cut-over.
An import that cannot tell what it already brought in creates it again, and
the second run doubles the desk.

The same three apply, less dramatically, to users and teams and services:
a user provisioned by import must not be emailed a welcome; a team must not
be created twice because its name was spelled differently in one export.

## Decision

**A migrated record is inserted as it was, through the module that owns it,
and announced as an import.** MOD-04 grows `importTicket` and
`importComments`, which insert a ticket with the status and dates it had
and publish `ticket.imported` instead of `ticket.created`. The projections
that describe a record follow it — search indexes it, reporting projects it
— and the reactions that respond to a new one do not: no SLA timer, no
rule, no notification, no survey. Users, teams and services go through the
existing `createUser` (source `import`), `createTeam` and `createService`,
which react to nothing already.

**Every row is remembered.** The link table maps a source's identifier to
ours, per entity, per tenant. A row whose key is remembered is left alone
(or updated, if the mapping says `overwrite`), so a re-run is a delta and a
dry run followed by a commit does not double anything. A reference in a
ticket row — the caller's `sys_id`, the group's id — resolves through the
same table first, then by the natural key (an email, a team key), and a
requester nobody has, named by an email, becomes an external user rather
than an empty field, with a warning on the row.

**Nothing is guessed.** A status the value map does not name is a failed
row, not a closed ticket. A date in a form the reader does not know is a
failed row, not today. A field the entity does not have is a mapping refused
when it is saved, not a column silently ignored. The same two rules as
discovery (MOD-10), with one of this module's own: a row with only
*warnings* is imported — a comment attributed to nobody is worth more than
no comment — and the warning is on the record.

**Dry run first, and the records are the report.** A job in `dry_run` mode
walks every row through the same code as a commit with the writes turned
off, resolving references so a mapping that names the wrong field shows as
a warning on every row of the preview rather than a surprise on the commit.
Each row's outcome and problems are written as an `import_record`; a commit
is the same job again, for real.

**Presets are mappings, not connectors.** ServiceNow, Jira Service
Management and Freshservice are the generic HTTP source with the boxes
filled in — the path on the instance, where the records are, how the API
pages, the vendor's status and priority words — for the reason MOD-10 gave:
a preset that drifts is a mapping to correct rather than a connector to
rewrite, and a tool none of these cover is `http_json` with the same boxes
filled by hand. Every byte goes through the MOD-14 gateway. A CSV export is
uploaded into a bounded table and read once.

## Consequences

- `ticket.imported` is a new event; search and reporting consume it. A
  module that should describe imported tickets and does not is a module to
  add one line to, and the test that imports a ticket and looks for it in
  search is what finds the omission.
- The CSV reader and the dotted-path reader moved from MOD-10 into the
  platform package, because two modules now spend their lives inside other
  people's payloads and one grammar deserves one parser. MOD-10 re-exports
  them, so nothing there moved.
- Comments from a source that keeps them separately (ServiceNow's journal)
  are a job of their own, run after the tickets; from one that keeps them on
  the ticket (Jira) they arrive with it. Freshservice keeps them behind a
  call per ticket and they are not read; the preset says so.
- A ServiceNow journal entry names its author by `user_name`, not email, so
  those comments are attributed to nobody unless the users job used
  `user_name` as its external key. The preset's note says so; it is the
  kind of choice an administrator should make knowingly.
- An uploaded file lives in the database for a week, bounded at twenty
  megabytes. Larger exports are split; object storage (ADR-0016) takes over
  when it has a read path.
- Imported users are active and not deactivated, whatever the source said,
  because deactivation is a session-revoking act with its own audit trail.
  Deactivating departed users after an import is a follow-up an
  administrator runs by hand, or a later job kind.
