# ADR-0051 · A decision is not a generation

**Status:** Accepted 2026-09-25 · **Date:** 2026-09 · **Specification reference:** ADR-06, MOD-09, MOD-07, doc 13 · **Amends:** ADR-0006 (auto-application), ADR-0047 (fallback between providers)

## Context

Every call the AI module makes today asks a model to write something: a reply
draft, a ticket summary, an article draft. The answer is prose, a person reads
it, and nothing changes until that person acts (ADR-0006). That fits
generation, and it is the right line for anything a requester will read.

Triage is a different kind of question. What type of ticket is this, which
category and subcategory, which group should own it? The answer is one value
from a closed list, and it is only useful with a calibrated confidence. Asking
a general-purpose model to write that answer as prose, and then parsing it back,
costs the most expensive kind of call for the least demanding kind of answer.
Today nobody asks at all: a ticket that arrives by email is created as an
`incident` with no category, and a person triages it by hand.

Three things now make a second kind of call worth defining:

- **Decision engines exist as a product category.** One is JEV (TypeSafe).
  From its public material it takes a state and a named set of typed questions
  (`choice`, `score`, yes/no) and returns an answer with a confidence for each.
  The prices and latencies it advertises are orders of magnitude below a
  general model's. None of that has been checked against its official
  documentation yet, because that documentation cannot be reached from where
  this was written. Everything this ADR assumes about JEV is marked as
  unverified until it has been checked.
- **A decision is measurable.** A person eventually sets the field anyway, so
  every decision can be scored against the value the ticket ended up with. A
  generated reply has no such ground truth. Measurement is what makes it safe to
  let a decision act without a person, in a narrow set of cases.
- **The gateway assumed one provider per deployment** (doc 13 §6.1). A second
  kind of call from a second vendor, with the first vendor as its fallback,
  does not fit that shape.

There was also a defect this work surfaced. The model a call used when it named
none was the constant `stub-small`. That was right for the stub and refused by
every real provider, so a deployment configured for Anthropic could not produce
a single suggestion. It is fixed alongside this ADR. The default now belongs to
the provider (`AI_DEFAULT_MODEL`, else the provider's first model). A default
the provider does not offer stops the boot, and a default with no price is
logged as an error there.

## Decision

**Two kinds of call, one gateway.** `callModel` stays the only way to generate.
`decide` is added beside it in `modules/ai/src/service/gateway.ts`. It takes a
provider-neutral decision request: a purpose, a masked state, and named typed
questions with bounded answers. It returns one answer and one confidence
(0 to 1) per question. Both calls go through the same residency check, the same
price check and the same budget. No module calls a provider directly; ADR-0006's
rule is unchanged.

**Providers are named, and a purpose has a chain.** The registry holds several
providers by name, and `registerAiProvider` and `activeProvider` keep their
current meaning for generation. A provider may implement `decide`. Each decision
purpose has an ordered chain, for example `triage: jev → anthropic → rules`. The
gateway walks the chain:

- It **skips** a provider that is outside the tenant's allowed regions, not
  priced, open-circuited, or over its timeout. The reason is recorded.
- It stops at the first provider that answers.
- `rules` is the last link and makes no call. It means "leave the deterministic
  result that exists without AI". A chain that runs out changes nothing on the
  ticket. It never fails ticket creation.

**This amends ADR-0047 narrowly.** Moving to another provider is allowed only
between providers that are **all inside** the tenant's allowed regions. A
provider outside them is skipped, never used. The thing ADR-0047 forbids, the
platform deciding that somewhere else is close enough, still cannot happen.
Generation keeps its single provider and its 403.

**A decision runs after the ticket exists, never before.** Triage consumes
`ticket.created`. The ticket is created by the channel, portal or API exactly as
today, inside its own transaction. A decision provider that is slow or down
therefore cannot slow or fail an intake path. When triage changes a field that
an SLA policy matches on, it publishes `ticket.classified`. The SLA module
re-matches on that event. **The clock started at creation and keeps running**,
and only the targets may change. A ticket must not earn extra time because a
model was slow to classify it.

**Four modes per purpose per tenant: `off`, `shadow`, `suggest`, `auto`.** The
default is `off`.

- `shadow` decides and records, and changes and shows nothing.
- `suggest` turns answers at or above the suggest threshold (default 0.60) into
  ordinary advisory suggestions (ADR-0006).
- `auto` applies answers at or above the auto threshold (default 0.90), subject
  to everything below.

Thresholds are tenant settings. The mode is changed by a person holding
`ai.manage`, and every change is audited.

**This amends ADR-0006 narrowly: routing fields may be applied without a
person.** Only these, and only in `auto` mode:

- **category**, which includes subcategory: the two are one tree
- **assignment group**

Both are routing facts. A wrong one costs a re-route, and both are routinely
corrected by the people who work the queue. Ticket **type** was on this list as
first written and is not applied: a ticket's type is fixed when it is raised,
and making it changeable is a ticket-module decision with its own consequences
(numbering, workflows, SLA). Until that is decided, type is a suggestion. The
conditions:

- **Never over anything set.** Only an empty field is filled. A value that is
  there when the decision is made — a requester's choice on a form, a
  catalogue item's team, a rule that ran first — counts as a person's and is
  not changed. The write also expects each field to still hold what the
  decision saw, so a rule or a person who sets it in the seconds a provider
  takes wins, and that answer is offered as a suggestion instead.
- **Attributed.** Each application is written as actor `ai` through the ticket
  module's automation path, and audited (`ai.decision.applied`) with the
  decision id, the provider, the model and the confidence.
- **Reversible.** Each application can be undone in one action, which restores
  the previous value as the agent's own edit and records the correction.
- **Earned per tenant, per field, on every decision.** A field is applied only
  once that tenant's own settled record for it agrees with the values people
  settled on: 95% agreement over at least 200 decisions at or above the auto
  threshold, read over the last 90 days. The gate is checked on every
  decision, not when the mode is switched, so `auto` may be selected at any
  time and no way of writing the setting gets round it; a field that has not
  earned it is suggested exactly as in `suggest`. An applied value that nobody
  changed before the ticket was resolved counts as agreement, and one somebody
  changed counts against it, so a field that stops being right stops being
  applied.
- **Withdrawn automatically.** A correction is a person (actor `user`) changing
  an applied field to anything else, or undoing it; the AI's own writes and a
  rule reacting to them are not. If people correct more than 5% of the last
  100 applied decisions, the purpose steps down to `suggest`. The step-down is
  written as a new version of the mode setting, audited
  (`ai.decision.stepped_down`), and the tenant's administrators are told in
  the console and by email.

**Everything else stays advisory, whatever the confidence:** priority, impact,
urgency, major-incident declaration, escalation, status, and anything a
requester reads. Priority drives SLA targets and paging. A wrong P1 wakes
people, and a wrong P4 on a real outage breaches quietly. Those remain a
person's call.

**Every decision is recorded.** `ai_decision` holds, per decision:

- tenant, subject, purpose and mode
- the question-set version
- provider, model and provider request id
- the answers with their confidences
- latency, input and output tokens, and cost
- every link the chain tried, with the reason each one was skipped
- what was done: shadowed, suggested, applied or nothing
- later, the value people settled on, for scoring

Decision cost counts toward the tenant's AI budget. When the budget is
exhausted, a decision falls through to `rules`, and intake is not refused.
`ai_job` gains latency and the provider's request id, so generation has the
same record.

**Credentials are deployment secrets.** Credentials come only from environment
variables or the deployment's secret store (`ANTHROPIC_API_KEY`, and
`JEV_API_KEY` when that adapter exists). They are never taken from a tenant,
never written to a table, and never logged. A decision provider must declare
its processing region explicitly: an adapter with no configured region refuses
to register, because `null` means "makes no external call" and would pass every
residency check.

**The JEV adapter waits for its documentation.** It is not written until its
endpoint, authentication, request and response shapes, limits, processing region
and data-processing terms are checked against TypeSafe's official documentation
and contract. Until then the chain for `triage` is `anthropic → rules`, and the
foundation is proved against the stub and the Anthropic adapter. The Anthropic
adapter moves to the official SDK (`@anthropic-ai/sdk`) and answers `decide`
through structured outputs. It keeps its closed model list, its bounded response
read and its rule that nothing but shapes is logged.

## Alternatives considered

- **Replace the general model with a decision engine.** Rejected. Reply drafts,
  summaries and article drafts are prose for a person to read, and a decision
  engine does not write prose. These are two tools for two kinds of question.
- **Use the general model for decisions too, with no decision engine.** This
  works, and it is the fallback. At the prices in the plan, a triage decision
  costs about 65× more on Sonnet 5 and 160× more on Opus 5, and takes seconds
  rather than a fraction of one. It is kept as the second link, not the first.
- **Put classification in the rules engine or a workflow `ai.classify` node.**
  Rejected. The call would sit outside the AI module's residency check, price
  check, budget and audit, which is the arrangement ADR-0006 exists to prevent.
  Rules still run and still win: a rule that sets a category is a person's
  configuration, and triage treats it as human-set.
- **Classify before the ticket is created.** Rejected. It would make intake
  depend on an external service, and inbound email is accepted in one
  transaction. A mail server should not get a timeout because a model was slow.
- **Auto-apply every field above the threshold.** Rejected, for the priority
  reasons above. The allow-list can grow later, one field at a time, each by an
  ADR with its own shadow evidence.
- **A separate `DecisionProvider` interface and registry.** Rejected. One
  registry keeps one residency check, one price list and one place to look.
  `decide` is an optional method on `AiProvider`, and the gateway refuses a
  provider in a decision chain that does not implement it.
- **Retry the same provider until it answers.** Rejected. A decision is only
  worth having while the ticket is still new. It gets one retry on a retryable
  failure within a short timeout (2 s for a decision engine), then the chain
  moves on, and a circuit breaker stops a failing provider from charging every
  ticket its timeout.

## Consequences

- **Nothing changes for any tenant until an administrator chooses to.** Every
  purpose ships `off`. `shadow` is the first mode worth turning on, and it
  changes no ticket.
- **There is a second vendor to contract.** JEV needs a data-processing
  agreement and a stated processing region before any tenant's state is sent to
  it. Until then it cannot be registered, and it is the reason the adapter is
  gated.
- **Confidence has to be calibrated, not trusted.** The 0.90 and 0.60 defaults
  are starting points. The shadow record, scored against what people set, is
  what shows whether a provider's 0.9 means right nine times in ten. The `auto`
  gate reads that record, not the provider's claim.
- **The chain adds states to test**: skipped for residency, skipped for price,
  timed out, open circuit, over budget, and fell through to rules. Each has a
  unit test against the pure chain walker, and the record names which state a
  decision ended in.
- **The SLA module gains one consumer** (`ticket.classified`). It re-matches
  targets and never restarts a clock: time used is counted from creation on
  the new policy's calendar, less time paused, and a target already overdue
  under the new policy breaches on the next tick. Timers already met or
  breached, and targets the new policy lacks, are left as they are.
- **Rules react to what the AI sets.** The AI's write is published as actor
  `ai`, not `workflow`, so a rule that routes by category routes a ticket the
  AI categorised as it would one a person did. Triage runs once, on creation,
  so this cannot loop.
- **A group set by `auto` is a field change, not an assignment**, as it is
  when a rule sets one: it publishes `ticket.updated` and `ticket.classified`,
  not `ticket.assigned`, and so sends no assignment notification.
- **Doc 13 §6.1's "one provider per deployment" no longer holds for
  decisions.** Generation is unchanged.
- **Compliance is checkable from data.** `GET /ai/decisions` is read-only and
  lists what decided, how confidently, at what cost and with what outcome. The
  audit log carries every application and every mode change.
