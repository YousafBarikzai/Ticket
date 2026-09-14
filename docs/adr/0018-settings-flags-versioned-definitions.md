# ADR-0018 · Settings, feature flags and versioned definitions as one configuration framework

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** MOD-13 definition of done, §4.4 configuration resolution, §10.4

## Context

"Configuration before custom code" requires every configurable item to be versioned, scoped (platform → tenant → organisation), validated, previewable, publishable with approval and reversible, and cached with fast invalidation. Ad-hoc configuration tables per module would fragment this.

## Decision

- **Settings:** keys declared in manifests with Zod schemas, defaults and allowed scopes; stored as `setting` + `setting_version`; resolved organisation → parent organisations → tenant → platform default; cached in Redis and invalidated by `config.published`.
- **Feature flags:** boolean settings with owner, expiry and optional plan gate (PH-3); lint fails on expired flags.
- **Versioned definitions:** forms, business rules, workflows, SLA policies, approval policies, notification templates and rules, surveys, catalogue items and status pages share one `definition → immutable version → publish/rollback` lifecycle with optional MOD-17 approval and a diff utility.
- **Configuration packages** (PH-3) export and import sets of the above as signed JSON bundles with dependency and impact analysis.
- One shared expression language (`packages/expr`) is used for every condition in these objects.

## Alternatives considered

- **Third-party feature-flag service.** Rejected: tenancy and plan gating are product concerns; no vendor needed at launch.
- **Per-module configuration tables.** Rejected by the specification (no ad-hoc config tables).

## Consequences

- Every builder gets history, rollback, preview and caching without bespoke code.
- Modules must declare settings in manifests (checked by the manifest test).
