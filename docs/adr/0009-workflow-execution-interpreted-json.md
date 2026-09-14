# ADR-0009 · Workflow execution: interpreted, versioned JSON definitions with persisted run state

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** ADR-09

## Context

Administrators must build automation without code, publish it safely, and rely on it surviving restarts without duplicate side effects.

## Decision

Workflows are JSON graphs (nodes, edges, expression-language conditions, template variables) validated by schema and published as immutable versions. An in-house interpreter runs on BullMQ, advancing one step per job with a durable step marker before and after each side effect and idempotency keys derived from run and step, so a restart re-executes without duplicates. Waits and timers are persisted in PostgreSQL and mirrored as delayed jobs. Business rules (PH-2) are a simpler interpreter over the same expression language. Test mode uses a dry-run action registry.

## Alternatives considered

- **Temporal / durable-execution frameworks.** Considered seriously; rejected for PH-1–PH-3 because of additional infrastructure and the need for an admin-authored, data-defined graph rather than code workflows. Revisit if orchestration complexity grows (PH-4 subflows/compensation).
- **Code generation from definitions.** Rejected by the specification: deployment coupling and audit difficulty.
- **Third-party low-code engines.** Rejected: permissions, audit and tenancy integration would be partial.

## Consequences

- Full control over versioning, audit and permissions; engine is a well-bounded component with chaos tests as its acceptance criteria.
- The team owns engine reliability; mitigated by the small node set in P1 and the exactly-once protocol.
