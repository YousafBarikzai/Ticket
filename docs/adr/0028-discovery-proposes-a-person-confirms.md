# ADR-0028 · Discovery proposes; a person confirms

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-10-E2, §4.2, §6 Data

## Context

E1 built a register whose value is that its contents were decided (ADR-0027).
E2 connects it to feeds that produce thousands of records an hour without
anybody deciding anything, which is the point at which most CMDBs stop being
trustworthy — usually within a quarter of switching discovery on.

The mechanism is always the same. A feed writes straight through. Somebody
upstream renames a column, bumps an API version, loses a permission, or adds a
filter. Overnight, four hundred rows change. Nothing fails: the run reports
success, because from the platform's point of view it did succeed. The first
anybody hears of it is an impact answer during an incident that is quietly
wrong, and by then nobody can tell which rows were true last week.

The opposing pressure is real and should not be dismissed. A register that needs
a person to confirm every fact about every device is a register that does not
get populated, and an empty CMDB helps nobody. An estate of ten thousand devices
cannot be curated by hand.

## Decision

**Every disagreement is a proposal by default. A tenant loosens that field by
field, per source, once it has a reason to.**

- A record for something not in the register becomes a `create_ci` proposal.
- A record that disagrees with an existing item becomes an `update_ci` proposal
  carrying **both** values — a proposal whose current value is not shown is one
  nobody can judge.
- A relationship the feed claims becomes a `create_relationship` proposal, and
  only once **both ends are already in the register**. An edge to something that
  is not there yet would mean inventing the other end.
- A `ReconciliationRule` may set a field to `source_wins` or `ignore`, for one
  source or for all. Loosening is the interesting direction: a serial read from
  the device beats one typed by a person, and criticality is the exact opposite
  — no feed knows what matters to the business.

**A field the feed does not send is silence, not an instruction.** The single
most important line in the reconciler. A source that stops sending a column looks
exactly like every device in the estate losing that value at once, and under
`source_wins` a naive implementation would blank them all.

**Rejection is remembered, and pending proposals are superseded.** A proposal
somebody has already rejected, with the same values, is not raised again — or
saying no costs a click a day for ever, and a queue like that trains people to
accept everything to make it stop. A pending proposal for the same thing is
superseded rather than duplicated, so a daily run does not leave seven copies of
every disagreement by Sunday.

**Accepting takes `cmdb.manage`, not a permission of its own.** Accepting writes
the register, so it takes the permission to write the register. A separate "may
accept discovery" permission would be a way to write the register without the
permission to write the register.

**Everything a source writes is validated as a person's entry would be.**
Attributes go through the same class validation E1 put in. A source that could
write an attribute the class does not declare would be a way round that
validation, and a way round a rule is where the bad rows come from.

**The presets are mappings, not connectors.** Intune, Azure and AWS are the
generic HTTP source with the boxes filled in. There is no per-source code path,
so a tenant whose estate lives somewhere none of these cover configures the
generic kind and gets identical behaviour, and a preset that drifts is a mapping
to correct rather than a connector to rewrite.

**AWS is read from an inventory export, not from the API.** AWS authenticates
with SigV4 request signing; the gateway attaches a credential as one header
(ADR-0023). Signing would have to happen where outbound calls are built — inside
the gateway — and a signer written in this module could not be verified against
anything in this repository. An unverifiable signer that fails only against live
AWS is worse than an honest gap, so the `aws` kind consumes an AWS Config
snapshot or a tagging export. SigV4 in the gateway is the follow-up.

## Alternatives considered

- **Write straight through, with an audit trail.** The common design, and the
  reason so many CMDBs are quietly wrong. An audit trail tells you what happened
  after somebody already believed the wrong answer during an incident.
- **Per-field source authority as the default, with `propose` as the exception.**
  Rejected: it puts the safe behaviour behind configuration nobody writes on day
  one, which is exactly when a new feed is least trusted and most likely to be
  mis-mapped.
- **A confidence score, auto-applying above a threshold.** Rejected: the score
  would be invented here, and a number the platform made up is a worse basis for
  overwriting somebody's register than a rule a person wrote.
- **Auto-accept creations, propose only updates.** Tempting, because creations
  destroy nothing. Rejected: the failure it allows is a mis-mapped feed importing
  four hundred duplicates under a bad external key, and unpicking that is worse
  than confirming eighty laptops once. `acceptAll`, scoped to one source and one
  kind, is the same convenience without the failure mode.
- **Matching on the serial number rather than the source's own identifier.**
  Rejected for Intune specifically: a device re-imaged and re-enrolled keeps its
  serial and gets a new id, and manufacturers do reuse serials. Matching on a
  reused serial merges two machines into one record, and nobody notices.
- **Implementing SigV4 here anyway.** Rejected, as above.

## Consequences

- A large estate needs somebody to work the queue at first, and `acceptAll` —
  one source, one kind, bounded per call — is the operation that makes that
  reasonable: "yes, import the eighty laptops Intune found". It is deliberately
  not an "accept everything" button over a mixed queue.
- `DiscoveryRun` records `seen`, `unchanged`, `proposed`, `applied` and
  `rejected`. `applied` is the audit number the design turns on: what did
  discovery change on its own authority? `rejected` rising is the signal that a
  feed's shape changed, because a mapping that no longer fits rejects everything
  and says so.
- Runs are kept even when nothing changed. "This source has returned zero
  devices for a fortnight" is a fact nobody notices without a run history, and a
  source that quietly stopped is indistinguishable from an estate that quietly
  stopped changing.
- The network call happens outside any transaction and the writes go in chunks.
  A transaction held open across a call to somebody else's API is a transaction
  whose length somebody else decides.
- Feeds are bounded twice, by pages and by records, and hitting either bound is
  reported rather than silently truncated — a partial read makes every "not seen,
  so perhaps gone" conclusion unsafe, and those are the conclusions people act on.
- CSV is parsed rather than inferred: no type coercion, so a serial of `0012345`
  stays `0012345`, and a duplicate column header is refused rather than resolved.
- Contract dates are keyed to the **notice date**, not the end date. A report
  warning thirty days before a contract ends, on one with ninety days' notice,
  tells you sixty days too late — politely, and with a number in it.
