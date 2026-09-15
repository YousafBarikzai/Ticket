# ADR-0040 · The provider is a socket, and the governance is the product

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-09, ADR-0006, doc 13, OD-04

## Context

ADR-0006 settled that AI is a capability service rather than a feature
sprinkled through modules, and doc 13 described it in detail in Phase 1. It
was then deferred for three phases behind OD-04, the choice of model
provider — and the deferral quietly became a plan to build the whole thing
on the day a provider is chosen. That is the most expensive possible order:
the governance is the hard part, the provider call is twenty lines, and
building them together means the governance gets whatever attention is left
after the demo works.

The second question is what "governed" has to mean concretely, because the
word does no work on its own. A budget nobody can reach, a kill switch
nobody has tested, an evaluation threshold with no run behind it and an
evidence list nobody reads are all things a system can have while being
ungoverned in every way that matters.

## Decision

**Everything except the provider is built now.** The prompts, the
thresholds, the budgets, the kill switches, the evidence, the suggestion
lifecycle, the audit trail and the refusals are real and tested. Behind the
socket is a stub that answers deterministically and is priced like a
mid-sized model, so a budget that looks sensible against it still looks
sensible on the day OD-04 is closed. Closing OD-04 is then one adapter and
one `registerAiProvider` call.

**Nothing is registered by default.** A deployment with no provider refuses
every capability that calls a model, loudly, naming OD-04. The stub is
registered only outside production — the bargain the email module already
struck with its development transport, and for the same reason: in
production the stub's presence would turn "no provider has been chosen yet"
from a refusal somebody fixes into answers somebody believes.

**Everything that reads runs as the person who asked.** A job arrives at the
worker with the asker's *id* and the worker's *permissions*, which are the
platform's system set — so retrieval on the job's own context would search
the whole tenant and put the results in front of somebody entitled to a
fraction of it. Every permission check would have passed. The worker
therefore rebuilds the asking person's context from their roles before it
assembles anything, and a job whose asker has been deactivated is refused
rather than run. Everything that *writes* runs as the AI, on that person's
behalf, so the audit row names both.

**An answer with nothing behind it is refused, not generated.** A reply
drafted from no evidence reads exactly like a good one and speaks for the
organisation. `reply-draft` declines when retrieval found nothing, and the
refusal is actionable: what is missing is the knowledge base.

**Prompts are the deployment's; tone and language are the tenant's.** A
prompt carries no `tenant_id`, is written only by a platform operator, and
is immutable once written — a change is the next version. A tenant that
could rewrite its own prompt could rewrite its way past every threshold the
release gate depends on. What a tenant may change is how the answer should
read, which is two settings.

**A version is promoted by its evaluation, except the one that ships.** A
new version cannot be promoted without a run at or above its dataset's
threshold, and the refusal names the score and the threshold. The version
shipped with the deployment is promoted *by release* — there is nothing to
evaluate against at boot and possibly no provider at all — and the unit
suite is what gives that teeth: it runs every shipped prompt against its own
dataset, so a prompt that would fail its threshold cannot be released.

**Be precise about what an evaluation proves.** Against the stub it proves
the machinery: that a threshold blocks a promotion, that a score is
recorded, that a failing case names itself. It is not evidence that a prompt
is any good, and no figure from it should be quoted as though it were. That
becomes true the day a real provider is behind the socket, with no change to
the evaluation code — which is the whole argument for building it now.

**The AI budget is not one of MOD-21's meters**, although it looks like one.
A plan limit is what the tenant bought; this is what the tenant chose to
spend, and a tenant may set its own AI cap to zero. A meter is checked
against a figure that is already true; this is checked before a call whose
cost is not known until afterwards. What is shared is the refusal:
`LimitReachedError` and its 402, because the caller is permitted and the
obstacle is commercial.

**The figure is a sum of the jobs, never an accumulator.** `ai_budget.spent`
is recomputed from `ai_job` whenever one finishes, so a retried job cannot
inflate it and the month's spend can always be rebuilt from the rows beneath
it (ADR-0031). The one capability that calls no model — finding similar
tickets and known errors — costs nothing and stays available when the budget
has run out.

## Consequences

- A tenant can end a month one call over its cap, because a completion's
  cost is not known until it exists. That is the honest trade and the same
  shape as MOD-21's minute-old verdict: a commercial control may be
  approximately right, and a security control may not.
- Hybrid retrieval is lexical only. Doc 13 describes pgvector alongside
  full-text; embeddings against a stub would be noise, and the ACL-filtered
  search projection already answers the question. The vector half waits
  behind OD-04 with the provider that would generate them.
- A prompt promotion is audited rather than published as an event: an event
  is written into one tenant's outbox, and a prompt belongs to none of them.
- Prompts and completions are kept for audit and evaluation and swept after
  the tenant's retention window. The job, its cost and its outcome stay —
  they are the audit record and the figures the budget is rebuilt from.
- `similar-work` being free and instant makes it the capability most desks
  will actually use, which is a good outcome and was not the one anybody set
  out to build.
