# ADR-0044 · A revocation that is not written is not a revocation

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-01, doc 08 §9, doc 09 §2, doc 15 §4

## Context

Building the workbench, the portal and the offline queue exercised paths that
four phases of module work had only ever described. Three of them turned out
to be promises the platform documented and did not keep. They are unrelated in
the code and identical in kind: in each case something was written against the
documentation rather than against the thing on the other side, and nothing
made the two meet.

**Nobody ever recorded a session.** Doc 09 §2 has a web application call
`POST /api/v1/auth/session` after a sign-in. The endpoint did not exist.
`userService.recordSession` existed and had one caller — an integration test.
So the `Session` table was empty in every real deployment, `GET /me/sessions`
returned `{ data: [] }` to everybody forever, and `DELETE /me/sessions/:id`
addressed rows that were never created.

Underneath that, a second break. `apps/api/src/auth/verify.ts` reads
`sess:deny:<sid>` from Redis on every authenticated request and refuses a
token whose session is listed. Nothing in the repository ever wrote that key.
`revokeSession` set `revoked_at` on a row that no request-time code path
consults. So even with the first break fixed, revoking a session would have
changed a column and nothing else: the token would have carried on working
until it expired. On a shared machine that is the difference between a
sign-out and a suggestion.

**An unknown key was silently discarded.** Zod's default object mode strips
what it does not recognise. Every request body in the API is parsed that way,
so `{"titel": "..."}` produced a 201 and a ticket with no title. The client
believed it had sent a title; the server never saw one; nothing anywhere said
so. This is the failure mode that produced three defects in the SDK's first
version, and it will produce more in every client written against this API by
anybody who cannot read its source.

**Two agents could take the same ticket.** `POST /tickets/:id/assign` read no
`If-Match`, so the second claim silently overwrote the first, and the agent who
made the first claim carried on working a ticket that was no longer theirs.
`PATCH` and `transitions` both refuse a stale version; assignment did not, and
the SDK had a comment explaining that the guarantee was absent rather than a
mechanism providing it.

## Decision

**A revocation writes the denylist inside the transaction that revokes the
row, and fails loudly if it cannot.** `modules/identity/src/service/session-denylist.ts`
owns the key. `revokeSession` denies before it updates; `deactivateUser` denies
every live session before it revokes them, as one pipeline, all or nothing.
A Redis outage raises `DependencyUnavailableError`, so the API answers 503 and
the administrator knows the access has not been withdrawn.

**The BFF tells the API about the session, and a failure there does not fail
the sign-in.** `packages/bff` calls `POST /api/v1/auth/session` from
`createSession` — the one place both sign-in paths pass through — and again on
every token refresh.

**Every request body under `/api/v1` is strict; module schemas are not.**
`.strict()` is applied at the 107 places a route parses a body, not on the
schema definitions the modules export.

**`POST /tickets/:id/assign` reads `If-Match` when it is offered, and does not
require it.**

## Consequences

**A session that cannot be recorded cannot be revoked, for one refresh
interval.** This is the one place in this change where the platform prefers
availability to correctness, and it is a real cost, not a technicality:
between a failed recording and the next refresh, that session is invisible to
"sign out everywhere". The alternative is worse. Refusing a sign-in because
one table is unreachable locks everybody out of an otherwise working platform
at the one moment they have no other route in, and it converts a degraded
capability into a total outage. The cost is bounded because the call repeats
on every refresh and `recordSession` is idempotent, and it is never silent:
the BFF logs each failure with the application name.

**A Redis outage stops revocations, and says so.** The verifier already fails
*open* on the same outage — it cannot read the denylist, so it lets the
request through. The two together are consistent: while Redis is down this
platform cannot enforce revocation, and it now says that rather than reporting
a success. Choosing the other way would mean an administrator told that an
account was locked out when it was not, which is the worse failure for a
control whose entire purpose is to be relied upon in an incident.

**Denying before committing can deny a session that was not revoked.** If the
transaction rolls back, a deny entry remains for a session that is still
valid: somebody is signed out who did not need to be. That is annoying and
recoverable. The other order — commit, then deny — produces a revocation that
never takes effect, which is the failure this whole ADR exists to remove.

**The denylist key is global, and deliberately not tenant-prefixed.** Every
other Redis key in this platform begins `t:<tenantId>:`, and the isolation
suite scans the keyspace to enforce it. `sess:deny:<sid>` is exempt, with the
exemption written into that scan: a `sid` is issued by the identity provider
and is unique across every tenant, and the verifier must consult the list
*before* it has established which tenant the token names, so a tenant-prefixed
key could not be read at that point in the request. The key holds no tenant
data — the key is the session identifier and the value is the string `1`.

**A client that sent an unknown key now gets a 422 where it used to get a
201.** That is the point, and it is a breaking change for any caller that was
relying on the old silence. No such caller exists in this repository. Module
schemas stay permissive on purpose: an internal caller that passes an extra
key is a type error caught at build time, and making those strict would mean
a job failing in production over a field a refactor left behind.

**Assignment is the one write where the version is optional, and that
asymmetry has to be explained wherever it shows.** A queue screen claims from
a list it read a minute ago; requiring `If-Match` there would mean re-reading
every row before every claim. The ticket page, which has read the ticket,
sends the version and gets the 409. The queue does not and keeps
last-write-wins. Both the route and the SDK say so in the same words.

## Alternatives considered

**Record the session from the API's own token verifier, on first sight of a
`sid`.** It needs no new endpoint and no cooperation from any client, and it
cannot be forgotten. Rejected because it puts a database write on the hot path
of every request — the verifier runs before everything — and because the
verifier would be recording a session it cannot date: only the sign-in knows
whether this is a new session or the four-hundredth request of an old one.

**Keep `revoked_at` as the only record and have the verifier read the session
table.** One source of truth, and no cache to fall out of step. Rejected on
cost: it is a database query on every authenticated request to answer a
question that is "no" essentially always. The denylist is the same answer at a
thousandth of the price, and its staleness window is bounded by a TTL we
choose.

**Make the module schemas strict and drop the route-level `.strict()`.** One
place instead of 107, and internal callers would be held to the same standard.
Rejected because the two boundaries have genuinely different needs: a stranger's
typo must be refused, and our own extra key is a build-time error that should
not become a production failure. The 107 sites are mechanical and were applied
by script.

**Require `If-Match` on assignment, like every other write.** Consistent, and
consistency is worth something. Rejected because it makes the queue — the
screen an agent spends the day in — re-read a ticket before every claim, for a
race that is real but rare, and because a 428 on a "Take" button is a worse
experience than a 409 on the second of two simultaneous claims.
