# ADR-0035 · The status page is a statement, not a view

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-23, MOD-08, MOD-11, MOD-21

## Context

A status page is the one thing the service desk publishes to people who have
no account, no session and no reason to trust it beyond what it says. Two
temptations follow from that, and both are wrong in the same direction.

The first is to make the page a *view* over the incident record: filter
`major_incident` for the customer-facing ones, render the timeline, done. It
is less code, and it is also how an internal note reaches the public — the
filter is a predicate somebody edits, the timeline has three audiences, and
the wording the commander typed at 03:00 for the bridge is not the wording
anybody would choose for a customer. The page would say whatever the record
happened to say.

The second is to serve the page as *the platform*: a public URL has no tenant,
so resolve the slug with the platform role and read. That role sees every
tenant, which is what it is for, and a public endpoint that runs on it is a
public endpoint one bug away from listing customers.

There is also the question of where the page runs. Document 03 planned a
static export to edge hosting so the page survives an API outage — the right
end state, and one that needs a hosting account this repository does not yet
have (OD-06).

## Decision

**The page is the desk's own record.** `status_incident`, `status_update`,
`maintenance_window` and their components are MOD-23's tables, written by
its handlers from what MOD-08 publishes and by its API from what an operator
types, and read by the public page and by nothing else. What the public is
told is a *decision*, made once, in the handlers:

- A major incident appears only if it was declared customer-facing.
- A timeline entry appears only if its audience is `public`. `internal` and
  `stakeholders` never reach the page, whatever else changes.
- A scheduled change appears only if it touches a service the page lists as
  a component; a change nobody outside would notice has no public face.
- The five words the page can say about an incident, and the four about a
  component, are its own vocabulary, mapped from the desk's (`mitigating`
  is `identified`; `SEV2` is `major`), so an internal state the page was not
  designed to explain cannot leak by being new.

Every handler reads the source row rather than the payload (ADR-0031), and
every line carries the MOD-08 entry it came from, so redelivery is one line
and an update that arrives before its declaration opens the incident rather
than being dropped. Resolution is idempotent from both directions, because
it arrives from both.

**The tenant directory is the only pre-tenant lookup.** The page's URL is
`/status/<tenant slug>` — the slug the tenant already has, not a second one
on the page. A public request resolves the slug (or a mapped host) through
MOD-21's directory, which the platform role may read because it is what the
directory is for, and then reads the page *as that tenant*, through a context
with no permissions that the database confines to that tenant's rows like any
other. No MOD-23 table joins the platform allowlist; there is nothing to
enumerate.

**The API serves the page, for now.** HTML to a browser, JSON to anything
else, from the same handler, cacheable for thirty seconds. The static export
in document 03 stays the end state and is a job that renders the same JSON to
a file; it is not built until there is somewhere to put it, and a page that
exists beats a page that survives an outage nobody has had.

**Subscribers are addresses, confirmed before anything is sent.** The public
has no account here, so a subscriber is an email address and a signed link
(ADR-0033's mechanism), confirmed by a click so a stranger cannot subscribe
somebody else's inbox to a stream of outages. The subscribe endpoint answers
the same way whether the address is new, already subscribed or the page is
private, and it is rationed per address and per client, in process: the aim
is to make it useless as a relay, not to count precisely. Sending happens in
a job, after the transaction that wrote the line, and the row is marked before
the first email goes so a retried job does not send everybody the same one
twice.

## Consequences

- A public update posted through the bridge and one typed on the operator's
  page are the same row, the same event, the same email. The page cannot tell
  which door a line came through, and neither can a subscriber.
- Softening the public wording of an incident is an edit to the page's row,
  and the incident record is untouched. The two can disagree, and that is the
  point: one is the truth for the review, the other is what was said.
- A tenant's slug is now printed on a public URL. It always was a public
  identifier (it is in the login URL); this makes it one people bookmark, so
  renaming a tenant is a redirect somebody has to keep.
- A service added after the tenant was provisioned is not a component until
  the seed is re-run or somebody adds one, so an incident against it opens on
  the page with nothing to mark. The seed is idempotent on the component key
  precisely so it can be re-run.
- The page is only as available as the API. Recorded in document 18 as the
  open item it already was; the export job closes it when OD-06 is decided.
