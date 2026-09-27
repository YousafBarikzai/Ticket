# ADR-0006 · AI as a governed capability service

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-06

## Context

AI features (suggestions, RAG search, virtual agent, agentic actions) must be permission-aware, cited, evaluated, budgeted, audited and switchable, and must not bind the product to one provider.

## Decision

All model access goes through `modules/ai`: a provider gateway with adapters (Anthropic, Azure OpenAI, AWS Bedrock, OpenAI-compatible local models), a versioned prompt registry, a context assembler that runs under the requesting actor's permissions and the classification registry, a permission-filtered retriever, an evaluation runner with promotion thresholds, per-tenant budgets and kill switches, tracing of every call, and (PH-5) a tool gateway for actions with dry run and approval. No module calls a provider directly (lint-enforced import rule). PH-1 lays the hooks: `ai` actor type, classification registry, flags, budget table, pgvector.

*Amended by ADR-0051.* Structured decisions (typed questions with a confidence
per answer) are a second kind of call through the same gateway. In a tenant's
`auto` mode, and only there, a decision may apply four routing fields without
a person: type, category, subcategory and assignment group. It never changes a
value a person set, every application is audited and reversible, and
everything else stays advisory.

## Alternatives considered

- **Per-feature provider calls.** Rejected: unauditable, unbudgeted, impossible to switch off centrally.
- **External AI orchestration platform.** Rejected for control and residency reasons; tracing/evaluation tools (Langfuse, Promptfoo) are used as components, not as the gateway.

## Consequences

- Every AI feature inherits governance for free; the PH-4 release gate is checkable from data.
- Slightly more latency (job-based suggestions) accepted for auditability; streaming is used where interactivity matters (virtual agent).
