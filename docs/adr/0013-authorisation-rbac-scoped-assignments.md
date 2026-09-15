# ADR-0013 · Authorisation: RBAC with scoped assignments, resolved per aggregate, enforced in the service layer

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** §7 Authorisation, Appendix B, MOD-01-E2

## Context

Permissions must express "own / team / any" semantics, organisation subtrees (group IT sees subsidiaries), service ownership, delegation, MSP grants and, later, attribute-based rules, with p99 < 5 ms checks and 5 s propagation.

## Decision

- Permission keys are declared in module manifests and compiled into a registry; roles are sets of `(permission, scope)`; assignments bind roles to users with optional scope targets (organisation subtree, team, service) and validity windows.
- A `PermissionSet` is resolved per request and cached in Redis, invalidated by identity events.
- Checks happen **only in the service layer** (`authz.require`, `authz.can`, `authz.scopeFilter`), never in routes or UI; list queries are filtered in SQL by the scope predicate; foreign or invisible records return 404.
- Each module registers a `ScopeResolver` describing how "own" and "team" apply to its aggregates.
- ABAC (PH-4) is a policy layer evaluated after RBAC using the shared expression language; SoD rules live in the modules that own the decisions (approvals, configuration publishing).
- Roles are never taken from identity tokens (except the realm role `platform_operator`).

## Alternatives considered

- **Roles in Keycloak tokens.** Rejected: tokens would go stale and scopes cannot be expressed.
- **External policy engine (OPA/Cedar) from PH-1.** Deferred: adds infrastructure; the checker's interface allows it later for ABAC.
- **Pure ABAC.** Rejected: harder for administrators to reason about; RBAC seeds match the specification's matrix.

## Consequences

- Permission-matrix tests can be generated from seed data.
- Scope resolution is per-aggregate code that each module must maintain; the platform provides defaults (requester/assignee/team/org path).
