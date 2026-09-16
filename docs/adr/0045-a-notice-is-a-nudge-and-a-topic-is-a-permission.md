# ADR-0045 · A notice is a nudge, and a topic is a permission

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-16, MOD-04, MOD-09, doc 08 §6, ADR-0015

## Context

ADR-0015 chose server-sent events over WebSockets in Phase 1, and the code was
written: `GET /api/v1/events/stream` has existed since then, `publishNotice`
and `subscribeTopics` are in the platform, and `ticket-service` has published a
notice on every change the whole time.

**Nothing had ever opened the stream.** The workbench refetched on its own
actions and polled a 1.5-second timer for an AI job. So a queue changed only
when the person looking at it changed something, and a ticket somebody else
moved sat on screen looking current. Every part of the mechanism worked and the
product had no realtime in it — the same shape as the session denylist in
ADR-0044, and found the same way: by building something that had to use it.

Connecting it exposed three things the design had not had to answer.

**A queue had no topic to watch.** Notices went to the ticket's own topic and
to the requester's and assignee's user topics. An agent watching their team's
queue is none of those for a ticket that has just arrived in it, so the one
screen that most needs to update by itself was the one screen that could not.

**Any topic could be watched by anyone.** The route took the `topics` query
parameter and subscribed to all of it. The reasoning on the endpoint — notices
carry no content, clients refetch, permissions are applied there — is right
about *content* and silent about everything else. The timing of a change and
the existence of an id are both real information, and any signed-in person
could ask for `ticket:<any id in their tenant>` and receive a live feed of when
somebody else touched a ticket they could not open.

**An AI job announced nothing.** `SuggestionPanel` polled because there was no
notice to wait for, and its comment said so: "SSE exists (ADR-0015) and would
be the better answer". A comment describing the better answer is how the better
answer stays unbuilt.

## Decision

**A notice stays a nudge, and a topic becomes a permission.** The wire format
does not change — `{entity, id, version, action, at}` and nothing else, with
every client refetching through the API. What changes is that each requested
topic is authorised before it is subscribed, and refused if it is not allowed:

| Topic | Who may watch it |
|---|---|
| `ticket:<id>` | Whoever `ticketService.getTicket` lets read it — the module's own check, not a second one |
| `group:<id>` | A member of that team, or anyone whose `ticket.read` scope is already `any` |
| `user:<id>` | Only that person |

**Refused, never skipped.** A client that asks for a topic it may not have gets
a 403, 404 or 422 and no stream.

**`topicForGroup`, and `notifyChange` publishes to it.** A queue watches its
teams' topics plus the person's own.

**The AI service announces a finished job** to the requester and to the
ticket, whichever way it finished — completed, failed or refused.

**The poll stays, slower.** `SuggestionPanel` keeps its timer at 5 s with a
ceiling of 12 instead of 1.5 s and 40: the same sixty seconds of patience, a
third of the requests.

## Consequences

**A refused topic closes the whole stream, not just that topic.** A client
asking for five topics and being refused one gets nothing. This is the right
way round — a stream that quietly subscribes to fewer topics than were asked
for is a screen that looks live and is not, which is precisely the failure this
ADR and ADR-0044 both exist to stop — but it does mean a client must not ask
for a topic speculatively. The workbench builds its topic list from `/me`, so
it only ever asks for what it has been told it has.

**Subscribing now costs a database read per ticket topic.** Capped at twenty
topics and paid once per connection rather than per notice. A queue watching
group topics pays nothing: team membership is already in the context.

**The queue refresh is coalesced, and announced.** A rule that touches twenty
tickets publishes twenty notices; a second's settle makes that one
`router.refresh()`. And it is said out loud in an `aria-live="polite"` region,
because rows that rearrange under somebody's cursor with no explanation are how
a person loses their place and their trust in the screen at once.

**A group topic tells a team member that *something* in their queue changed,
including about a ticket they cannot open.** A team can contain someone
restricted from an individual ticket in their own queue, and the notice names
its id. This is a deliberate and narrow acceptance: they can already list the
queue, the notice carries no content, and the refetch that follows applies the
real permissions. If per-ticket restriction within a team ever becomes a
supported feature rather than an edge, the group topic needs revisiting.

**The poll was not removed, and that is not timidity.** A stream is a thing
that can fail to open — an old browser, a buffering proxy, a corporate
middlebox — and the person watching a suggestion panel cannot tell a stream
that never connected from a job that never finished. The poll is the guarantee
and the stream is the speed. Both end in the same `settle()` and the same
refetch, so the two cannot disagree about what a finished job means, and the
suggestion is added by id so whichever arrives second does not add it twice.

**`Last-Event-ID` resume is still not built.** Doc 08 §6 describes a five-minute
Redis ring buffer per topic; there is none, and a reconnection therefore cannot
replay what it missed. What is built instead is `onReconnect`: the second
`ready` event on a connection means the stream dropped and came back, and the
page refetches rather than assuming the gap was empty. That is correct, just
more expensive than a resume would be. The BFF now forwards the `last-event-id`
header so the day a buffer exists, the client half already works. Recorded in
doc 23 as outstanding rather than implied by the documentation.

## Alternatives considered

**A tenant-wide `tickets` topic instead of per-group.** One topic, no
membership check, nothing to authorise. Rejected: it wakes every open browser
in the organisation on every change, and it tells every agent the timing of
every other team's work — a worse version of exactly the leak this ADR closes.

**Skip topics that fail authorisation, and report the count.** Keeps a partly
useful stream alive for a client with one bad topic. Rejected on the grounds
this codebase has now learned twice: a mechanism that appears to work and
silently does less than it claims is worse than one that fails. The `ready`
event already carries a count, and a count is not something a client checks.

**Replace the poll with the stream entirely.** Less machinery, one path.
Rejected because the two failure modes are indistinguishable to the person
waiting, and the cost of keeping the poll is one timer at a third of its old
rate.

**Push the changed ticket in the notice, so no refetch is needed.** Faster, and
one round trip instead of two. Rejected because it moves permission filtering
onto the wire: the same topic is watched by people with different access, and a
payload would have to be filtered per subscriber. Doc 08 §6's "clients refetch"
is what keeps the channel free of anything that needs filtering, and it is the
reason topic authorisation alone is sufficient.
