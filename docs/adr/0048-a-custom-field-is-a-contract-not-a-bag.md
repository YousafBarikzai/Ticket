# ADR-0048 · A custom field is a contract, not a bag

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-04, MOD-02, MOD-13, doc 06 §4

## Context

`field_definition` has existed since Phase 1. Its schema comment reads:

> Custom fields (PH-2 feature flag `ticket.customFields`), defined in PH-1 so
> the ticket API validates `custom` against them from the start.

Nothing in the repository read or wrote that table — not one reference — and
`createTicketSchema` took `custom: z.record(z.unknown()).default({})`. So:

- **`custom` accepted anything.** Any key, any shape, any size, on any ticket,
  from any caller holding `ticket.create`. A misspelled key was stored rather
  than refused, so a tenant would find out months later that half its tickets
  carry `costCentre` and half carry `cost_center`, and no report joins them.
- **Three columns describing who may see a field were decorative.**
  `classification`, `visibleTo` and `appliesTo` were written into the schema
  and consulted by nothing, so every custom value on a ticket went to everybody
  who could read the ticket — including the requester, through the portal.
- **`ticket.config.manage`** ("Manage categories and field definitions")
  granted access to no route.

This is the third instance of one pattern in this phase, after the session
denylist (ADR-0044) and the event stream (ADR-0045): the mechanism was built,
the thing that uses it was not, and the gap is invisible because the absent
behaviour and the satisfied behaviour look identical from outside.

## Decision

**Definitions get a service and three doors.** `listFields`, `saveField` and
`deactivateField`, behind `ticket.config.manage`, at
`GET|PUT|DELETE /api/v1/field-definitions`.

**`custom` is validated against them on every write.** Unknown key, wrong type,
a `select` value that is not an option, a required field left empty — all 422,
naming the key.

**A definition is deactivated, never deleted.** `DELETE` deactivates. Tickets
hold values against a definition, and removing it orphans them behind a
validator that would then refuse the next edit of every ticket carrying one.

**Reading is filtered by classification.** `public` reaches the requester;
`internal` reaches anybody working the desk; `restricted` additionally requires
one of the permissions the field names. A field the reader may not see is
*stripped*, not blanked.

**A patch to `custom` is a patch, not a replacement.** Sending one key leaves
the others alone; `null` clears a value.

## Consequences

**Every existing caller that writes `custom` had to be accounted for**, and
there turned out to be three with different answers.

- The **ticket API** is validated, which is the point.
- A **catalogue submission** is not, and passes its answers through by name.
  They were already checked against the request type's form schema (MOD-02) —
  a stricter check, because a form knows which of its own questions were
  required and what each accepts. Validating them again would mean duplicating
  every request type's questions as field definitions before the portal worked
  at all. The exemption is a list of keys rather than a boolean, so it is
  visible, is exactly as wide as the form that earned it, and cannot be reached
  by a caller that merely sets a flag.
- A **migration** (MOD-24) writes `custom` on its own path and is not
  validated. ADR-0036 already says an import is not a creation; refusing an
  import because the previous tool had a field this one does not would make
  migration impossible, and the alternative — dropping the values — loses the
  data the migration exists to carry.

**Form answers and field definitions both live in `custom`, and that is a seam
worth naming.** A request type's questions and a tenant's custom fields are two
systems writing one column. They coexist because the merge is by key and each
is validated by whoever owns it, but a key defined in both is decided by the
form. If custom fields ever need to be authoritative over a request type's
answers, this is where that fight happens.

**Changing a live field's type is refused.** `"12"` as text is not `12` as a
number, and a date that was a string is neither. A new key is the honest way to
change shape; the old one is deactivated and its values stay readable.

**`visibleTo` names permissions, not roles.** The reader's permissions are
already on the context, so this costs no lookup on a path that runs for every
ticket read, and naming the permission says what the field actually protects
("whoever may write an internal note") rather than what somebody happened to
call a group of people this year.

**Filtering on read is complete rather than partial**, which was checked rather
than assumed: neither the search index nor the analytics projections carry
custom values, so the ticket routes' presenter is the only path out. If either
ever indexes `custom`, it inherits this obligation and does not currently have
it.

**A malformed `requiredWhen` is treated as "not required".** A configuration
error must not make every ticket on the desk unsaveable. `saveField` parses the
expression, so reaching that branch means a row that predates this work or was
written around it.

**The lens is built once per request, not once per ticket.** A queue of fifty
would otherwise read the definitions fifty times to answer the same question.

## Alternatives considered

**Leave `custom` open and validate in the applications.** No migration, no new
service, and the workbench already renders a form. Rejected because the API is
the contract — a channel adapter, an integration and a migration all write
tickets without going near a browser, and validation that lives in one client
is validation three callers do not have.

**Delete a definition rather than deactivating it.** Simpler, and an
administrator asking to delete something usually means it. Rejected because the
values do not go with it: the next edit of every ticket carrying one would be
refused by the unknown-key rule, turning a tidy-up into an outage on historical
tickets.

**Blank a field the reader may not see, rather than stripping it.** Keeps the
response shape stable for a client. Rejected: a key with a null value tells
somebody the field exists and that there is something in it they are not being
shown, which for a `restricted` field is most of what was being kept from them.

**Make form answers into field definitions automatically.** One system instead
of two, and the seam above disappears. Rejected for now because a request
type's questions are scoped to that request type and a field definition is
scoped to the tenant: promoting every question to a tenant-wide field would
make a hundred one-off questions into a hundred permanent fields, and there is
no obvious way back. Recorded rather than closed.
