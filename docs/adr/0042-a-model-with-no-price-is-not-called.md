# ADR-0042 · A model with no price is not called

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-09, ADR-0006, ADR-0023, ADR-0040, doc 13, **closes OD-04**

## Context

ADR-0040 built the whole governed AI service against a stub and left one thing
open: which provider. OD-04 has now been decided — Anthropic — and the
adapter is what that ADR predicted it would be, twenty lines of JSON mapping.

Two questions it did not predict came with it, and both are about money and
data rather than about models.

**What a call costs.** `costOf` looked a model up in a table and returned `0n`
when it found nothing. Against a stub with two priced models that was
invisible. Against a real provider it is a hole straight through the budget:
point a prompt at any model missing from the table and every call is recorded
as costing nothing, so the warning line is never reached, the cap never
blocks, and the first anybody hears of it is an invoice. The tempting fix — a
price list for the real models, committed here — makes it worse in a quieter
way: a vendor's published price changes without asking this repository, is
quoted in another currency, and would sit in the code looking like a fact
while being a guess that decides when a tenant stops being able to spend.

**Where the prompt goes.** ADR-0023 says the integration gateway is the only
way out of the platform, and everything it provides — destination checks, a
circuit breaker, timeouts, bounded reads — is exactly what a provider call
wants. But the gateway also records the request and response bodies to
`integration_log`, redacting credentials. A prompt is not a credential. It is
a rendered ticket: somebody's name, their machine, what they told the service
desk, and whichever knowledge articles were retrieved alongside. Putting one
through the gateway would copy all of that into a second table with a
different retention policy, a different audience and no relationship to the
ticket it came from.

## Decision

**A model with no price is refused before it is called.** `isPriced(model)` is
checked at the top of `callModel`, and an unpriced model raises `ModelNotPriced`
naming the models that *are* priced. A budget that cannot see a cost is not a
budget, and the honest failure is a refusal an operator can read rather than an
invoice they cannot explain.

**Prices are the operator's, supplied as configuration.** `AI_MODEL_PRICES` is
JSON keyed by model, in micro-pence per thousand tokens — the unit the budget
already works in, because a currency conversion left to a configuration file is
a conversion nobody checks. A malformed list stops the boot rather than
half-loading, since a budget that half-works is worse than a process that will
not start. Only the stub is priced in code, and it stays priced in the range of
a mid-sized model so that a budget which looks sensible in development still
looks sensible in production.

**The adapter calls the provider directly, and logs nothing but shapes.** Not
the prompt, not the completion, not the key. Token counts, the model, the stop
reason and the duration are enough to operate it, and the caller already
records those on the job row where they belong — attached to the ticket, under
that ticket's retention. The gateway's other services are reproduced in the
adapter at the smaller scale one fixed destination needs: a hard timeout, a
bounded read, and errors sorted into retryable and not.

**Failures are classified, not counted.** 429, 529 and 5xx are the provider
being busy or broken: `DependencyUnavailableError`, which is a 503 at the edge
and a retry in the worker. 400, 401 and 403 are this deployment being
misconfigured: `ValidationError`, which is not retried, because retrying a 401
sixty times is how an account gets rate-limited for a typo. The provider's own
error prose is never repeated outwards — it may quote the request, and the
request is the prompt.

**Configuration chooses the provider, and the stub is refused in production.**
`AI_PROVIDER` is `none`, `stub` or `anthropic`. `stub` in production throws at
boot: it answers without a model, and its presence would turn "no provider has
been chosen" from a refusal somebody fixes into answers somebody believes.
Unset outside production still registers the stub, so a developer who has
configured nothing gets a working suggestion surface.

## Consequences

**Good.** OD-04 is closed, and closing it changed no governance code at all,
which was the entire bet ADR-0040 made. The budget now measures what it claims
to measure. A deployment cannot spend money it cannot account for, and cannot
accidentally ship a stub. Nobody's ticket text is copied into the integration
log.

**Costs.** Adding a model is now two changes rather than one — the adapter's
list and the price list — and forgetting the second is a refusal rather than a
silent zero. That is the point, and it will still annoy somebody at three in
the morning. The adapter does not share the gateway's circuit breaker, so a
provider outage is absorbed by the job queue's retries rather than by a breaker
that opens; with a bounded queue and a per-tenant budget that is adequate, and
it is worth revisiting if the volume ever justifies one.

**What this does not settle.** The prices themselves are nobody's to assert
here, so a deployment that sets them wrong gets a budget that is wrong in
exactly the same way — this moves the error to where the information is, it
does not remove it. There is still no evaluation run against a real provider:
the datasets and thresholds exist and have only ever scored the stub, so the
promotion gate proves the *machinery* rather than the quality of a prompt.
Running one is the first thing to do with a key.
